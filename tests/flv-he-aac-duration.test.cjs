const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { readMoof } = require('./helpers/mp4.cjs');

// AudioSpecificConfig layouts as written by _parseAACAudioSpecificConfig.
// Explicit HE-AAC (SBR, audio object type 5): 44.1 kHz output over a 22.05 kHz LC core
const HE_AAC_44100_OUTPUT = Uint8Array.of(0x2a, 0x13, 0x88, 0x00);
// Same stream with the rate fields in the other order: 22.05 kHz signaled, 44.1 kHz extension
const HE_AAC_22050_SIGNALED = Uint8Array.of(0x2b, 0x92, 0x08, 0x00);
// LC-AAC (audio object type 2), 44.1 kHz, stereo
const LC_AAC_44100 = Uint8Array.of(0x12, 0x10);

// One FLV audio tag body: SoundSpec byte, AACPacketType 0 (sequence header), AudioSpecificConfig
function aacSequenceHeaderTag(asc) {
    return concatBytes(Uint8Array.of(0xaf, 0x00), asc);
}

// AACPacketType 1 (raw frame) with a dummy payload
function aacRawFrameTag() {
    return concatBytes(Uint8Array.of(0xaf, 0x01), new Uint8Array(24));
}

function createDemuxer() {
    const FLVDemuxer = loadSource()('demux/flv-demuxer.js').default;
    const demuxer = new FLVDemuxer({ dataOffset: 9, hasAudioTrack: true, hasVideoTrack: false }, {});
    demuxer.onError = (type, info) => assert.fail(`${type}: ${info}`);
    demuxer.onMediaInfo = () => {};
    demuxer.onTrackMetadata = () => {};
    return demuxer;
}

function parseTag(demuxer, body, timestamp) {
    demuxer._parseAudioData(body.buffer, 0, body.byteLength, timestamp);
}

test('FLV HE-AAC computes refSampleDuration from 2048 decoded samples per frame', () => {
    for (const [label, asc] of [
        ['44.1 kHz output signaled', HE_AAC_44100_OUTPUT],
        ['22.05 kHz core signaled', HE_AAC_22050_SIGNALED],
    ]) {
        const demuxer = createDemuxer();

        parseTag(demuxer, aacSequenceHeaderTag(asc), 0);

        // A HE-AAC frame decodes to 2048 output samples at 44.1 kHz, about 46.4 ms (#292)
        assert.equal(demuxer._audioMetadata.refSampleDuration, 2048 / 44100 * 1000, label);
    }
});

test('FLV LC-AAC keeps refSampleDuration at 1024 decoded samples per frame', () => {
    const demuxer = createDemuxer();

    parseTag(demuxer, aacSequenceHeaderTag(LC_AAC_44100), 0);

    assert.equal(demuxer._audioMetadata.refSampleDuration, 1024 / 44100 * 1000);
});

test('FLV HE-AAC remuxes audio frames with their real duration', () => {
    const load = loadSource();
    const FLVDemuxer = load('demux/flv-demuxer.js').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new FLVDemuxer({ dataOffset: 9, hasAudioTrack: true, hasVideoTrack: false }, {});
    const remuxer = new MP4Remuxer({ isLive: false });
    demuxer.onError = (type, info) => assert.fail(`${type}: ${info}`);
    demuxer.onMediaInfo = () => {};

    const segments = [];
    remuxer.onInitSegment = () => {};
    remuxer.onMediaSegment = (type, segment) => {
        const info = segment.info;
        const moof = readMoof(segment.data);
        segments.push({ beginDts: info.beginDts, durations: moof.sampleDurations });
    };
    remuxer.bindDataSource(demuxer);

    // Sequence header, then two HE-AAC frames 46 ms apart
    parseTag(demuxer, aacSequenceHeaderTag(HE_AAC_44100_OUTPUT), 0);
    parseTag(demuxer, aacRawFrameTag(), 0);
    parseTag(demuxer, aacRawFrameTag(), 46);
    demuxer._onDataAvailable(demuxer._audioTrack, demuxer._videoTrack);
    remuxer.flushStashedSamples();

    // The last sample's duration comes from refSampleDuration alone: 46 ms, not 23 ms
    const durations = segments.flatMap(segment => segment.durations);
    assert.equal(durations.at(-1), Math.floor(2048 / 44100 * 1000));
});
