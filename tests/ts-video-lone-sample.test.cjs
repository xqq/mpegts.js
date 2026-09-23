const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { readMoof } = require('./helpers/mp4.cjs');
const { annexB, av1InTs, h264, h265, av1 } = require('./helpers/video.cjs');

// Without timing info, TSDemuxer assumes 23.976 fps
const REFERENCE_DURATION = 1000 * (1000 / 23976);

// Connects a TSDemuxer to a real MP4Remuxer, which keeps the segment history (isLive: false)
function createRemuxingDemuxer(events) {
    const load = loadSource();
    const TSDemuxer = load('demux/ts-demuxer.ts').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    const remuxer = new MP4Remuxer({ isLive: false });
    demuxer.has_video_ = true;
    demuxer.onMediaInfo = () => {};

    remuxer.onInitSegment = (type, initSegment) => {
        events.push({ init: initSegment.codec, refSampleDuration: remuxer._videoMeta.refSampleDuration });
    };
    remuxer.onMediaSegment = (type, segment) => {
        const info = segment.info;
        const moof = readMoof(segment.data);
        assert.equal(moof.decodeTime, info.beginDts);
        assert.ok(moof.sampleDurations.every(duration => duration > 0), 'sample durations must not be zero');
        events.push({
            count: segment.sampleCount,
            beginDts: info.beginDts,
            endDts: info.endDts,
            lastDuration: info.lastSample.duration
        });
    };
    remuxer.bindDataSource(demuxer);

    return { demuxer, remuxer };
}

// Feeds one frame per PES at 25 fps, in 90 kHz timestamps
function frameFeeder(parsePayload) {
    let index = 0;
    return (payload) => {
        const timestamp = 90000 + 3600 * index++;
        parsePayload(payload, timestamp, timestamp, 0, 0);
    };
}

test('TS H.264 without VUI keeps valid durations for frames remuxed alone', () => {
    const events = [];
    const { demuxer, remuxer } = createRemuxingDemuxer(events);
    const frame = frameFeeder(demuxer.parseH264Payload.bind(demuxer));

    frame(annexB(h264.handBuiltSps(), h264.pps, h264.idr));
    frame(annexB(h264.nonIdr));
    frame(annexB(h264.nonIdr));
    // A normal remux keeps the last frame stashed in the remuxer,
    demuxer.dispatchAudioVideoMediaSegment();
    // so the codec change (level 3.0 to 3.1) has to flush that frame alone.
    frame(annexB(h264.handBuiltSps(31), h264.pps, h264.idr));
    frame(annexB(h264.nonIdr));
    frame(annexB(h264.nonIdr));
    demuxer.dispatchAudioVideoMediaSegment();
    // The end of stream flushes the last frame alone as well.
    remuxer.flushStashedSamples();

    // Lone frames used to last NaN ms, which made every later timestamp NaN
    assert.deepEqual(events, [
        { init: 'avc1.42c01e', refSampleDuration: REFERENCE_DURATION },
        { count: 2, beginDts: 0, endDts: 80, lastDuration: 40 },
        { count: 1, beginDts: 80, endDts: 120, lastDuration: 40 },
        { init: 'avc1.42c01f', refSampleDuration: REFERENCE_DURATION },
        { count: 2, beginDts: 120, endDts: 200, lastDuration: 40 },
        { count: 1, beginDts: 200, endDts: 240, lastDuration: 40 }
    ]);
});

for (const { label, codec, firstFrame, nextFrame, parse } of [
    {
        // Used to last 1000 ms (1 fps)
        label: 'H.265 without VUI timing info',
        codec: 'hvc1.1.1.L30.B0',
        firstFrame: annexB(h265.vps, h265.spsNoTiming, h265.pps, h265.idr),
        nextFrame: annexB(h265.trail),
        parse: 'parseH265Payload'
    },
    {
        // Used to last Infinity ms
        label: 'AV1 without timing_info',
        codec: 'av01.0.00M.08',
        firstFrame: av1InTs(av1.sequenceHeader, av1.keyFrame),
        nextFrame: av1InTs(av1.keyFrame),
        parse: 'parseAV1Payload'
    }
]) {
    test(`TS ${label} keeps a valid duration for the last frame at the end of stream`, () => {
        const events = [];
        const { demuxer, remuxer } = createRemuxingDemuxer(events);
        // Set from the AV1 video descriptor of the PMT, unused for H.265
        demuxer.video_metadata_.av1c = parse === 'parseAV1Payload' ? av1.configRecord : undefined;
        const frame = frameFeeder(demuxer[parse].bind(demuxer));

        frame(firstFrame);
        frame(nextFrame);
        frame(nextFrame);
        demuxer.dispatchAudioVideoMediaSegment();
        frame(nextFrame);
        frame(nextFrame);
        frame(nextFrame);
        demuxer.dispatchAudioVideoMediaSegment();
        remuxer.flushStashedSamples();

        assert.deepEqual(events, [
            { init: codec, refSampleDuration: REFERENCE_DURATION },
            { count: 2, beginDts: 0, endDts: 80, lastDuration: 40 },
            { count: 3, beginDts: 80, endDts: 200, lastDuration: 40 },
            { count: 1, beginDts: 200, endDts: 240, lastDuration: 40 }
        ]);
    });
}
