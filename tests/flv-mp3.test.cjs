const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { mp3Frame, concatBytes } = require('./helpers/mp3.cjs');

// FLV SoundSpec byte: SoundFormat 2 (MP3), 44 kHz, 16-bit, stereo. For MP3 the actual
// sample rate and channel count are taken from the frame headers.
const MP3_SOUND_SPEC = 0x2f;

// MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417-byte frames of 1152 samples (26.12 ms)
const stereo = mp3Frame([0xff, 0xfb, 0x90, 0x00], 417);

function createDemuxer(metadata) {
    const FLVDemuxer = loadSource()('demux/flv-demuxer.js').default;
    const demuxer = new FLVDemuxer({ dataOffset: 9, hasAudioTrack: true, hasVideoTrack: false }, {});
    demuxer.onError = (type, info) => assert.fail(`${type}: ${info}`);
    demuxer.onMediaInfo = () => {};
    demuxer.onTrackMetadata = (type, meta) => {
        assert.equal(type, 'audio');
        metadata.push({
            codec: meta.codec,
            rate: meta.audioSampleRate,
            channels: meta.channelCount,
            duration: meta.refSampleDuration
        });
    };
    demuxer.onDataAvailable = () => {};
    return demuxer;
}

// Parses the body of one FLV audio tag: the SoundSpec byte followed by MP3 frames
function parseAudioTag(demuxer, timestamp, ...frames) {
    const body = concatBytes(Uint8Array.of(MP3_SOUND_SPEC), ...frames);
    demuxer._parseAudioData(body.buffer, 0, body.byteLength, timestamp);
}

// [dts, frame length] of each queued sample
function queuedSamples(demuxer) {
    return Array.from(demuxer._audioTrack.samples, sample => [sample.dts, sample.unit.byteLength]);
}

test('FLV MP3 takes metadata from the first frame header once', () => {
    const metadata = [];
    const demuxer = createDemuxer(metadata);

    parseAudioTag(demuxer, 0, stereo);
    parseAudioTag(demuxer, 26, stereo);

    assert.deepEqual(metadata, [{ codec: 'mp3', rate: 44100, channels: 2, duration: 1152 / 44100 * 1000 }]);
    const mi = demuxer._mediaInfo;
    assert.deepEqual([mi.audioCodec, mi.audioSampleRate, mi.audioChannelCount, mi.audioDataRate], ['mp3', 44100, 2, 128]);
    assert.deepEqual(queuedSamples(demuxer), [[0, 417], [26, 417]]);
});

// FLVDemuxer used to assume 1152 samples per frame and MPEG-1 bitrates for every MPEG audio version
for (const { label, header, frameLength, sampleRate, channelCount, bitRate, samplesPerFrame } of [
    {
        label: 'MPEG-2 Layer III, 64 kbps, 22.05 kHz',
        header: [0xff, 0xf3, 0x80, 0x00],
        frameLength: 208,
        sampleRate: 22050,
        channelCount: 2,
        bitRate: 64,
        samplesPerFrame: 576
    },
    {
        label: 'MPEG-2.5 Layer III, 8 kbps, 8 kHz, mono',
        header: [0xff, 0xe3, 0x18, 0xc0],
        frameLength: 72,
        sampleRate: 8000,
        channelCount: 1,
        bitRate: 8,
        samplesPerFrame: 576
    },
    {
        label: 'MPEG-1 Layer II, 192 kbps, 48 kHz',
        header: [0xff, 0xfd, 0xa4, 0x00],
        frameLength: 576,
        sampleRate: 48000,
        channelCount: 2,
        bitRate: 192,
        samplesPerFrame: 1152
    },
    {
        label: 'MPEG-1 Layer I, 384 kbps, 48 kHz',
        header: [0xff, 0xff, 0xc4, 0x00],
        frameLength: 384,
        sampleRate: 48000,
        channelCount: 2,
        bitRate: 384,
        samplesPerFrame: 384
    }
]) {
    test(`FLV MP3 takes samples per frame and bitrate from the frame header, ${label}`, () => {
        const metadata = [];
        const demuxer = createDemuxer(metadata);

        parseAudioTag(demuxer, 0, mp3Frame(header, frameLength));

        assert.deepEqual(metadata, [{
            codec: 'mp3',
            rate: sampleRate,
            channels: channelCount,
            duration: samplesPerFrame / sampleRate * 1000
        }]);
        assert.equal(demuxer._mediaInfo.audioDataRate, bitRate);
    });
}

test('FLV MP3 gives each frame of a tag its own sample', () => {
    const demuxer = createDemuxer([]);
    // The byte after the header marks each frame
    const frames = [0, 1, 2].map(index => {
        const frame = mp3Frame([0xff, 0xfb, 0x90, 0x00], 417);
        frame[4] = index;
        return frame;
    });

    // The tag timestamp belongs to the first frame
    parseAudioTag(demuxer, 1000, ...frames);

    assert.deepEqual(
        Array.from(demuxer._audioTrack.samples, sample => [sample.dts, sample.unit[4]]),
        [[1000, 0], [1026, 1], [1052, 2]]
    );
});

test('FLV MP3 skips data which is not a frame, and drops an incomplete frame at the end of a tag', () => {
    const demuxer = createDemuxer([]);

    parseAudioTag(demuxer, 0, Uint8Array.of(0x00, 0x12, 0x34), stereo, stereo.subarray(0, 100));

    assert.deepEqual(queuedSamples(demuxer), [[0, 417]]);
});

// Builds an audio-only FLV file with one audio tag for each [timestamp, body]
function flvFile(tags) {
    const parts = [
        Uint8Array.of(0x46, 0x4c, 0x56, 0x01, 0x04, 0x00, 0x00, 0x00, 0x09),  // FLV header, audio only
        new Uint8Array(4)                                                     // PreviousTagSize0
    ];
    for (const [timestamp, body] of tags) {
        const size = body.byteLength;
        const previousTagSize = 11 + size;
        parts.push(Uint8Array.of(
            0x08,                                                   // TagType: audio
            (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff,  // DataSize
            (timestamp >>> 16) & 0xff, (timestamp >>> 8) & 0xff, timestamp & 0xff,
            (timestamp >>> 24) & 0xff,                              // TimestampExtended
            0x00, 0x00, 0x00                                        // StreamID
        ), body, Uint8Array.of(
            (previousTagSize >>> 24) & 0xff, (previousTagSize >>> 16) & 0xff,
            (previousTagSize >>> 8) & 0xff, previousTagSize & 0xff
        ));
    }
    return concatBytes(...parts);
}

test('FLV MP3 keeps an exact duration for the last frame flushed at the end of stream', () => {
    // MPEG-2 Layer III, 64 kbps, 22.05 kHz: 208-byte frames of 576 samples (26.12 ms)
    const lsf_frame = mp3Frame([0xff, 0xf3, 0x80, 0x00], 208);
    const file = flvFile([0, 26, 52].map(timestamp => [timestamp, concatBytes(Uint8Array.of(MP3_SOUND_SPEC), lsf_frame)]));

    const load = loadSource();
    const FLVDemuxer = load('demux/flv-demuxer.js').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new FLVDemuxer(FLVDemuxer.probe(file.buffer), {});
    const remuxer = new MP4Remuxer({ isLive: false });
    demuxer.onError = (type, info) => assert.fail(`${type}: ${info}`);
    demuxer.onMediaInfo = () => {};

    const segments = [];
    remuxer.onInitSegment = () => {};
    remuxer.onMediaSegment = (type, segment) => {
        segments.push({
            count: segment.sampleCount,
            beginDts: segment.info.beginDts,
            endDts: segment.info.endDts,
            lastDuration: segment.info.lastSample.duration
        });
    };
    remuxer.bindDataSource(demuxer);

    demuxer.parseChunks(file.buffer, 0);
    // The end of stream flushes the last frame alone, which only refSampleDuration can time.
    // Based on 1152 samples per frame, it used to last 52 ms.
    remuxer.flushStashedSamples();

    assert.deepEqual(segments, [
        { count: 2, beginDts: 0, endDts: 52, lastDuration: 26 },
        { count: 1, beginDts: 52, endDts: 78, lastDuration: 26 }
    ]);
});
