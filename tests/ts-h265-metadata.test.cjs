const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { readMoof } = require('./helpers/mp4.cjs');
const { annexB, h265 } = require('./helpers/video.cjs');

function createDemuxer(events) {
    const load = loadSource();
    const TSDemuxer = load('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_video_ = true;
    demuxer.onMediaInfo = () => {};

    demuxer.onTrackMetadata = (type, metadata) => {
        assert.equal(type, 'video');
        events.push({
            type: 'metadata',
            width: metadata.codecWidth,
            height: metadata.codecHeight,
            // From the VPS, in the byte after avgFrameRate of the HEVCDecoderConfigurationRecord
            numTemporalLayers: (metadata.hvcc[21] >> 3) & 0x07,
            temporalIdNested: (metadata.hvcc[21] >> 2) & 0x01,
            hvcc: Buffer.from(metadata.hvcc).toString('hex')
        });
    };
    demuxer.onDataAvailable = (audioTrack, videoTrack, force) => {
        assert.equal(audioTrack, null);
        assert.equal(force, true);
        events.push({ type: 'flush', dts: Array.from(videoTrack.samples, sample => sample.dts) });
        videoTrack.samples = [];
        videoTrack.length = 0;
    };

    return demuxer;
}

// Feeds one access unit per PES at 25 fps, in 90 kHz timestamps
function frameFeeder(demuxer) {
    let index = 0;
    return (...nalus) => {
        const timestamp = 90000 + 3600 * index++;
        demuxer.parseH265Payload(annexB(...nalus), timestamp, timestamp, 0, 0);
    };
}

// The hvcC TSDemuxer dispatches for a stream that starts with these parameter sets
function initialHvcc(vps, sps, pps) {
    const events = [];
    frameFeeder(createDemuxer(events))(vps, sps, pps, h265.idr);
    assert.equal(events.length, 1);
    return events[0].hvcc;
}

for (const { label, vps, sps, numTemporalLayers, temporalIdNested } of [
    {
        label: 'the SPS changes',
        vps: h265.vps,
        sps: h265.sps128x64,
        numTemporalLayers: 1,
        temporalIdNested: 1
    },
    {
        // The new resolution triggers the reinitialization, the VPS changes along with it
        label: 'the VPS and SPS change',
        vps: h265.vpsTemporalLayers,
        sps: h265.spsTemporalLayers,
        numTemporalLayers: 2,
        temporalIdNested: 0
    }
]) {
    test(`TS H.265 flushes and dispatches new metadata when ${label}`, () => {
        const events = [];
        const demuxer = createDemuxer(events);
        const frame = frameFeeder(demuxer);

        frame(h265.vps, h265.sps25, h265.pps, h265.idr);
        frame(h265.trail);
        // Encoders repeat the parameter sets before each IRAP picture
        frame(h265.vps, h265.sps25, h265.pps, h265.idr);
        assert.equal(events.length, 1, 'unchanged parameter sets must not reinitialize the track');

        frame(vps, sps, h265.pps, h265.idr);
        frame(h265.trail);
        frame(vps, sps, h265.pps, h265.idr);
        frame(h265.trail);

        // The new metadata used to never be dispatched, so the frames at the new resolution
        // were remuxed under the old hvcC. Its hvcC must be the one of a stream that starts
        // with the new parameter sets, VPS included.
        assert.deepEqual(events, [
            {
                type: 'metadata',
                width: 64,
                height: 64,
                numTemporalLayers: 1,
                temporalIdNested: 1,
                hvcc: initialHvcc(h265.vps, h265.sps25, h265.pps)
            },
            { type: 'flush', dts: [1000, 1040, 1080] },
            {
                type: 'metadata',
                width: 128,
                height: 64,
                numTemporalLayers,
                temporalIdNested,
                hvcc: initialHvcc(vps, sps, h265.pps)
            }
        ]);
        assert.deepEqual(Array.from(demuxer.video_track_.samples, sample => sample.dts), [1120, 1160, 1200, 1240]);
    });
}

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
        const meta = remuxer._videoMeta;
        events.push({ init: initSegment.codec, width: meta.codecWidth, height: meta.codecHeight });
    };
    remuxer.onMediaSegment = (type, segment) => {
        const info = segment.info;
        const moof = readMoof(segment.data);
        assert.equal(moof.decodeTime, info.beginDts);
        assert.ok(moof.sampleDurations.every(duration => duration > 0), 'sample durations must not be zero');
        events.push({ count: segment.sampleCount, beginDts: info.beginDts, endDts: info.endDts });
    };
    remuxer.bindDataSource(demuxer);

    return { demuxer, remuxer };
}

test('TS H.265 remuxes a stashed frame under the old init segment when the SPS changes right after a remux', () => {
    const events = [];
    const { demuxer, remuxer } = createRemuxingDemuxer(events);
    const frame = frameFeeder(demuxer);

    frame(h265.vps, h265.sps25, h265.pps, h265.idr);
    frame(h265.trail);
    frame(h265.trail);
    // A normal remux keeps the last frame stashed in the remuxer,
    demuxer.dispatchAudioVideoMediaSegment();
    // so the parameter-set change has to flush that frame alone before the new init segment.
    frame(h265.vps, h265.sps128x64, h265.pps, h265.idr);
    frame(h265.trail);
    frame(h265.trail);
    demuxer.dispatchAudioVideoMediaSegment();
    remuxer.flushStashedSamples();

    assert.deepEqual(events, [
        { init: 'hvc1.1.1.L30.B0', width: 64, height: 64 },
        { count: 2, beginDts: 0, endDts: 80 },
        { count: 1, beginDts: 80, endDts: 120 },
        { init: 'hvc1.1.1.L30.B0', width: 128, height: 64 },
        { count: 2, beginDts: 120, endDts: 200 },
        { count: 1, beginDts: 200, endDts: 240 }
    ]);
});
