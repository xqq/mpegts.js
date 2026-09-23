const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { readMoof } = require('./helpers/mp4.cjs');

// Connects an FLVDemuxer to a real MP4Remuxer, which keeps the segment history (isLive: false)
function createRemuxingDemuxer(segments) {
    const load = loadSource();
    const FLVDemuxer = load('demux/flv-demuxer.js').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new FLVDemuxer({ dataOffset: 9, hasAudioTrack: true, hasVideoTrack: false }, {});
    const remuxer = new MP4Remuxer({ isLive: false });
    demuxer.onError = (type, info) => assert.fail(`${type}: ${info}`);
    demuxer.onMediaInfo = () => {};

    remuxer.onInitSegment = (type, initSegment) => {
        assert.equal(initSegment.codec, 'ipcm');
    };
    remuxer.onMediaSegment = (type, segment) => {
        const info = segment.info;
        const moof = readMoof(segment.data);
        assert.equal(moof.decodeTime, info.beginDts);
        segments.push({
            count: segment.sampleCount,
            beginDts: info.beginDts,
            endDts: info.endDts,
            durations: moof.sampleDurations
        });
    };
    remuxer.bindDataSource(demuxer);

    return { demuxer, remuxer };
}

// Parses the body of one FLV audio tag: the SoundSpec byte followed by zero-filled PCM data
function parsePcmTag(demuxer, soundSpec, timestamp, byteLength) {
    const body = new Uint8Array(1 + byteLength);
    body[0] = soundSpec;
    demuxer._parseAudioData(body.buffer, 0, body.byteLength, timestamp);
}

for (const { label, soundSpec, segmentTags, expected } of [
    {
        // 4 bytes per sample frame: 4096 bytes last 23.2 ms, 1764 bytes 10 ms
        label: '16-bit stereo, 44.1 kHz',
        soundSpec: 0x3f,  // SoundFormat 3 (linear PCM, little endian), 44 kHz, 16-bit, stereo
        segmentTags: [
            [[0, 4096], [23, 4096], [46, 1764]],
            [[56, 4096], [79, 4096], [102, 4096]]
        ],
        expected: [
            { count: 2, beginDts: 0, endDts: 46, durations: [23, 23] },
            { count: 1, beginDts: 46, endDts: 56, durations: [10] },
            { count: 2, beginDts: 56, endDts: 102, durations: [23, 23] },
            { count: 1, beginDts: 102, endDts: 125, durations: [23] }
        ]
    },
    {
        // 1 byte per sample frame: 2205 bytes last 200 ms, 441 bytes 40 ms
        label: '8-bit mono, 11.025 kHz',
        soundSpec: 0x34,  // SoundFormat 3, 11 kHz, 8-bit, mono
        segmentTags: [
            [[0, 2205], [200, 2205], [400, 441]],
            [[440, 2205], [640, 2205], [840, 2205]]
        ],
        expected: [
            { count: 2, beginDts: 0, endDts: 400, durations: [200, 200] },
            { count: 1, beginDts: 400, endDts: 440, durations: [40] },
            { count: 2, beginDts: 440, endDts: 840, durations: [200, 200] },
            { count: 1, beginDts: 840, endDts: 1040, durations: [200] }
        ]
    }
]) {
    // A lone tag used to last NaN ms, which made every later timestamp NaN
    test(`FLV PCM keeps exact durations for tags remuxed alone at the end of a segment, ${label}`, () => {
        const segments = [];
        const { demuxer, remuxer } = createRemuxingDemuxer(segments);

        for (const tags of segmentTags) {
            for (const [timestamp, byteLength] of tags) {
                parsePcmTag(demuxer, soundSpec, timestamp, byteLength);
            }
            // Dispatch like parseChunks does: the remuxer keeps the last tag stashed,
            demuxer._onDataAvailable(demuxer._audioTrack, demuxer._videoTrack);
            // and the end of each segment of a multi-segment source flushes it alone.
            remuxer.flushStashedSamples();
        }

        // The shorter last tag of the first segment gets its exact duration, so the next
        // segment follows it without a gap
        assert.deepEqual(segments, expected);
    });
}
