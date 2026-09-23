const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { annexB, av1InTs, h264, h265, av1 } = require('./helpers/video.cjs');

const load = loadSource();
const SPSParser = load('demux/sps-parser.js').default;
const H265Parser = load('demux/h265-parser.js').default;
const AV1OBUParser = load('demux/av1-parser.ts').default;

// Copy into a plain object of this realm, the parsers run in their own vm context
function frameRate(details) {
    return { ...details.frame_rate };
}

for (const { label, sps, expected } of [
    {
        label: 'a hand-built SPS without VUI parameters',
        sps: h264.handBuiltSps(),
        expected: { fixed: true, fps: 0, fps_den: 0, fps_num: 0 }
    },
    {
        label: 'an h264_videotoolbox SPS without VUI parameters',
        sps: h264.videotoolboxSps,
        expected: { fixed: true, fps: 0, fps_den: 0, fps_num: 0 }
    },
    {
        // Two ticks per frame
        label: 'a libx264 SPS at 25 fps',
        sps: h264.x264Sps,
        expected: { fixed: false, fps: 25, fps_den: 2, fps_num: 50 }
    }
]) {
    test(`H.264 frame rate of ${label}`, () => {
        assert.deepEqual(frameRate(SPSParser.parseSPS(sps)), expected);
    });
}

for (const { label, sps, expected } of [
    {
        label: 'a libx265 SPS at 25 fps',
        sps: h265.sps25,
        expected: { fixed: false, fps: 25, fps_den: 1, fps_num: 25 }
    },
    {
        label: 'a libx265 SPS at 30000/1001 fps',
        sps: h265.sps30000,
        expected: { fixed: false, fps: 30000 / 1001, fps_den: 1001, fps_num: 30000 }
    },
    {
        // Used to be 1/1, which TSDemuxer took for 1 fps
        label: 'a libx265 SPS without VUI timing info',
        sps: h265.spsNoTiming,
        expected: { fixed: false, fps: 0, fps_den: 1, fps_num: 0 }
    }
]) {
    test(`H.265 frame rate of ${label}`, () => {
        assert.deepEqual(frameRate(H265Parser.parseSPS(sps)), expected);
    });
}

for (const { label, sequenceHeader, expected } of [
    {
        label: 'an SVT-AV1 sequence header without timing_info',
        sequenceHeader: av1.sequenceHeader,
        expected: { fixed: true, fps: 0, fps_den: 1, fps_num: 0 }
    },
    {
        // num_ticks_per_picture_minus_1 is coded without leading zeros, so uvlc() reads no value bits
        label: 'one 1001/60000 s tick per picture',
        sequenceHeader: av1.sequenceHeader1Tick,
        expected: { fixed: true, fps: 60000 / 1001, fps_den: 1001, fps_num: 60000 }
    },
    {
        // Used to be the tick rate, 59.94 fps
        label: 'two 1001/60000 s ticks per picture',
        sequenceHeader: av1.sequenceHeader2Ticks,
        expected: { fixed: true, fps: 60000 / 2002, fps_den: 2002, fps_num: 60000 }
    },
    {
        // Used to be the tick rate, 90000 fps
        label: '3000 ticks of 1/90000 s per picture',
        sequenceHeader: av1.sequenceHeader3000Ticks,
        expected: { fixed: true, fps: 30, fps_den: 3000, fps_num: 90000 }
    }
]) {
    test(`AV1 frame rate of ${label}`, () => {
        assert.deepEqual(frameRate(AV1OBUParser.parseOBUs(sequenceHeader)), expected);
    });
}

// Returns the video metadata TSDemuxer dispatches for the parsed payload
function dispatchVideoMetadata(parsePayload) {
    const TSDemuxer = loadSource()('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_video_ = true;
    demuxer.onMediaInfo = () => {};

    const metadata = [];
    demuxer.onTrackMetadata = (type, meta) => {
        metadata.push({ type, fps: meta.frameRate.fps, refSampleDuration: meta.refSampleDuration });
    };
    parsePayload(demuxer);

    assert.equal(metadata.length, 1);
    return metadata[0];
}

const parseH264 = (sps, pps) => (demuxer) => {
    demuxer.parseH264Payload(annexB(sps, pps, h264.idr), 90000, 90000, 0, 1);
};
const parseH265 = (sps) => (demuxer) => {
    demuxer.parseH265Payload(annexB(h265.vps, sps, h265.pps, h265.idr), 90000, 90000, 0, 1);
};
const parseAV1 = (sequenceHeader) => (demuxer) => {
    // Set from the AV1 video descriptor of the PMT
    demuxer.video_metadata_.av1c = av1.configRecord;
    demuxer.parseAV1Payload(av1InTs(sequenceHeader, av1.keyFrame), 90000, 90000, 0, 1);
};

// Without timing info, the frame rate stays unknown (0) and TSDemuxer assumes 23.976 fps
// like FLVDemuxer. It used to dispatch NaN (H.264), 1000 ms (H.265) and Infinity (AV1).
for (const { label, parsePayload } of [
    { label: 'H.264, hand-built SPS', parsePayload: parseH264(h264.handBuiltSps(), h264.pps) },
    { label: 'H.264, h264_videotoolbox', parsePayload: parseH264(h264.videotoolboxSps, h264.videotoolboxPps) },
    { label: 'H.265, libx265 without VUI timing info', parsePayload: parseH265(h265.spsNoTiming) },
    { label: 'AV1, SVT-AV1', parsePayload: parseAV1(av1.sequenceHeader) }
]) {
    test(`TS video refSampleDuration assumes 23.976 fps without timing info, ${label}`, () => {
        assert.deepEqual(dispatchVideoMetadata(parsePayload), {
            type: 'video',
            fps: 0,
            refSampleDuration: 1000 * (1000 / 23976)
        });
    });
}

for (const { label, parsePayload, fps, refSampleDuration } of [
    // fixed_frame_rate_flag 0 does not matter
    { label: 'H.264, libx264', parsePayload: parseH264(h264.x264Sps, h264.x264Pps), fps: 25, refSampleDuration: 40 },
    { label: 'H.265, libx265', parsePayload: parseH265(h265.sps30000), fps: 30000 / 1001, refSampleDuration: 1000 * (1001 / 30000) },
    { label: 'AV1, two ticks per picture', parsePayload: parseAV1(av1.sequenceHeader2Ticks), fps: 60000 / 2002, refSampleDuration: 1000 * (2002 / 60000) }
]) {
    test(`TS video refSampleDuration follows the timing info, ${label}`, () => {
        assert.deepEqual(dispatchVideoMetadata(parsePayload), { type: 'video', fps, refSampleDuration });
    });
}
