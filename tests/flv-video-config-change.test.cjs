const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { h264, h265 } = require('./helpers/video.cjs');

const videoHeader = Uint8Array.of(0x46, 0x4c, 0x56, 1, 1, 0, 0, 0, 9, 0, 0, 0, 0);

function tag(type, timestamp, body) {
    const tag = new Uint8Array(11 + body.length + 4);
    const view = new DataView(tag.buffer);
    view.setUint32(0, (type << 24) | body.length);
    view.setUint32(4, timestamp << 8);
    tag.set(body, 11);
    view.setUint32(11 + body.length, 11 + body.length);
    return tag;
}

function avcConfig(timestamp, level) {
    const sps = h264.handBuiltSps(level);
    return tag(9, timestamp, concatBytes(
        Uint8Array.of(0x17, 0, 0, 0, 0, 1, sps[1], sps[2], sps[3], 0xff, 0xe1, 0, sps.length),
        sps, Uint8Array.of(1, 0, h264.pps.length), h264.pps
    ));
}

function avcFrame(timestamp, isKeyframe) {
    const nalu = isKeyframe ? h264.idr : h264.nonIdr;
    return tag(9, timestamp, concatBytes(
        Uint8Array.of(isKeyframe ? 0x17 : 0x27, 1, 0, 0, 0, 0, 0, 0, nalu.length), nalu
    ));
}

function hevcConfig(timestamp, sps) {
    const header = new Uint8Array(23);
    header[0] = 1;
    header[1] = 1;
    header[21] = 0xff;
    header[22] = 3;
    return tag(9, timestamp, concatBytes(
        Uint8Array.of(0x90, 0x68, 0x76, 0x63, 0x31), header,  // SequenceStart, hvc1
        Uint8Array.of(32, 0, 1, 0, h265.vps.length), h265.vps,
        Uint8Array.of(33, 0, 1, 0, sps.length), sps,
        Uint8Array.of(34, 0, 1, 0, h265.pps.length), h265.pps
    ));
}

function hevcFrame(timestamp, isKeyframe) {
    const nalu = isKeyframe ? h265.idr : h265.trail;
    return tag(9, timestamp, concatBytes(
        Uint8Array.of(isKeyframe ? 0x93 : 0xa3, 0x68, 0x76, 0x63, 0x31, 0, 0, 0, nalu.length), nalu
    ));
}

function createRemuxer(header) {
    const load = loadSource();
    const FLVDemuxer = load('demux/flv-demuxer.js').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new FLVDemuxer(FLVDemuxer.probe(header.buffer), {});
    const remuxer = new MP4Remuxer({ isLive: false });
    demuxer.onError = (type, info) => assert.fail(`${type}: ${info}`);
    demuxer.onMediaInfo = () => {};
    remuxer.bindDataSource(demuxer);
    return { demuxer, remuxer };
}

for (const configInNextChunk of [false, true]) {
    test(`FLV emits old AVC frames before the replacement init segment (config in ${configInNextChunk ? 'next' : 'same'} chunk)`, () => {
        const oldFrames = concatBytes(videoHeader, avcConfig(0, 30), avcFrame(0, true), avcFrame(40, false));
        // The sequence header timestamp need not match the first picture's timestamp.
        const config = avcConfig(0, 31);
        const newFrames = concatBytes(avcFrame(100, true), avcFrame(140, false));
        const firstChunk = configInNextChunk ? oldFrames : concatBytes(oldFrames, config, newFrames);
        const { demuxer, remuxer } = createRemuxer(firstChunk);

        const events = [];
        remuxer.onInitSegment = (_, segment) => events.push({ codec: segment.codec });
        remuxer.onMediaSegment = (_, segment) => {
            events.push({
                count: segment.sampleCount,
                beginDts: segment.info.beginDts,
                endDts: segment.info.endDts,
                isKeyframe: segment.info.firstSample.isSyncPoint
            });
        };

        assert.equal(demuxer.parseChunks(firstChunk.buffer, 0), firstChunk.length);
        if (configInNextChunk) {
            assert.equal(demuxer.parseChunks(config.buffer, oldFrames.length), config.length);
            assert.deepEqual(events.map(event => event.codec ?? event.beginDts), ['avc1.42c01e', 0]);
            assert.equal(demuxer.parseChunks(newFrames.buffer, oldFrames.length + config.length), newFrames.length);
        }

        assert.deepEqual(events, [
            { codec: 'avc1.42c01e' },
            configInNextChunk
                ? { count: 1, beginDts: 0, endDts: 40, isKeyframe: true }
                : { count: 2, beginDts: 0, endDts: 100, isKeyframe: true },
            ...(configInNextChunk ? [{ count: 1, beginDts: 40, endDts: 100, isKeyframe: false }] : []),
            { codec: 'avc1.42c01f' },
            { count: 1, beginDts: 100, endDts: 140, isKeyframe: true }
        ]);
    });
}

test('FLV emits the stashed HEVC sample before its new init segment', () => {
    const oldFrames = concatBytes(videoHeader, hevcConfig(0, h265.sps25), hevcFrame(0, true), hevcFrame(40, false));
    const replacement = concatBytes(hevcConfig(80, h265.sps128x64), hevcFrame(80, true), hevcFrame(120, false));
    const { demuxer, remuxer } = createRemuxer(oldFrames);
    const events = [];
    remuxer.onInitSegment = () => events.push('init');
    remuxer.onMediaSegment = (_, segment) => {
        events.push([segment.info.beginDts, segment.info.firstSample.isSyncPoint]);
    };
    assert.equal(demuxer.parseChunks(oldFrames.buffer, 0), oldFrames.length);
    assert.equal(demuxer.parseChunks(replacement.buffer, oldFrames.length), replacement.length);
    assert.deepEqual(events, ['init', [0, true], [40, false], 'init', [80, true]]);
});

test('FLV finishes the prior video configuration when the audio configuration arrives late', () => {
    const file = concatBytes(
        Uint8Array.of(0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0),
        avcConfig(0, 30),
        avcFrame(0, true),
        avcFrame(40, false),
        avcConfig(80, 31),
        tag(8, 80, Uint8Array.of(0xaf, 0, 0x12, 0x10)),
        tag(8, 80, Uint8Array.of(0xaf, 1, 0x01)),
        avcFrame(80, true),
        avcFrame(120, false)
    );
    const { demuxer, remuxer } = createRemuxer(file);
    const events = [];
    remuxer.onInitSegment = (type, segment) => events.push(type === 'video' ? segment.codec : 'audio init');
    remuxer.onMediaSegment = (type, segment) => {
        events.push([type, segment.info.beginDts, segment.sampleCount]);
    };
    assert.equal(demuxer.parseChunks(file.buffer, 0), file.length);
    assert.deepEqual(events, [
        'avc1.42c01e',
        'audio init',
        ['video', 0, 1],
        ['video', 40, 1],
        'avc1.42c01f',
        ['video', 80, 1]
    ]);
});

test('FLV preserves the shared timestamp base and normal AAC batching at a video config change', () => {
    const file = concatBytes(
        Uint8Array.of(0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0),
        avcConfig(0, 30),
        tag(8, 0, Uint8Array.of(0xaf, 0, 0x12, 0x10)),  // AAC-LC, 44.1 kHz, stereo
        tag(8, 0, Uint8Array.of(0xaf, 1, 0x01)),
        avcFrame(20, true),
        tag(8, 23, Uint8Array.of(0xaf, 1, 0x02)),
        avcFrame(60, false),
        avcConfig(100, 31),
        avcFrame(100, true)
    );
    const { demuxer, remuxer } = createRemuxer(file);
    const events = [];
    remuxer.onInitSegment = (type, segment) => {
        if (type === 'video') events.push(segment.codec);
    };
    remuxer.onMediaSegment = (type, segment) => {
        events.push([type, segment.info.beginDts]);
    };

    assert.equal(demuxer.parseChunks(file.buffer, 0), file.length);
    assert.deepEqual(events, [
        'avc1.42c01e',
        ['video', 20],
        ['audio', 0],
        ['video', 60],
        'avc1.42c01f'
    ]);
    remuxer.flushStashedSamples();
    assert.deepEqual(events.at(-1), ['audio', 23]);
});
