const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { readMoof } = require('./helpers/mp4.cjs');
const { eac3 } = require('./helpers/ac3.cjs');

function createDemuxer() {
    const TSDemuxer = loadSource()('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_audio_ = true;
    demuxer.onMediaInfo = () => {};
    demuxer.onTrackMetadata = () => {};
    demuxer.onDataAvailable = () => {};
    return demuxer;
}

// dts in milliseconds of each queued sample
function queuedDts(demuxer) {
    return Array.from(demuxer.audio_track_.samples, sample => sample.dts);
}

for (const { label, frame, dts } of [
    // 6 blocks of 256 samples: 34.83 ms
    { label: '6 blocks', frame: eac3.frame44100, dts: [1000, 1034, 1069] },
    // 1 block of 256 samples: 5.80 ms, which used to be counted as 6 blocks, 1000, 1034 and 1069
    { label: '1 block', frame: eac3.frame44100OneBlock, dts: [1000, 1005, 1011] }
]) {
    test(`TS E-AC-3 advances timestamps inside a PES by the duration of each frame, ${label}`, () => {
        const demuxer = createDemuxer();
        demuxer.parseEAC3Payload(concatBytes(frame, frame, frame), 90000);

        assert.deepEqual(queuedDts(demuxer), dts);
    });
}

test('TS E-AC-3 advances timestamps by the duration of the new frames after a change inside one PES', () => {
    const demuxer = createDemuxer();
    const oneBlock = eac3.frame44100OneBlock;
    demuxer.parseEAC3Payload(concatBytes(eac3.frame44100, eac3.frame44100, oneBlock, oneBlock), 90000);

    // onDataAvailable does not take the frames flushed at the change, so they stay queued
    assert.deepEqual(queuedDts(demuxer), [1000, 1034, 1069, 1075]);
});

// Connects a TSDemuxer to a real MP4Remuxer, which keeps the segment history (isLive: false)
// and fills audio timestamp gaps, as by default (fixAudioTimestampGap: true)
function createRemuxingDemuxer(events) {
    const load = loadSource();
    const TSDemuxer = load('demux/ts-demuxer.ts').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    const remuxer = new MP4Remuxer({ isLive: false, fixAudioTimestampGap: true });
    demuxer.has_audio_ = true;
    demuxer.onMediaInfo = () => {};

    remuxer.onInitSegment = (type, initSegment) => {
        events.push(`init ${initSegment.codec}`);
    };
    remuxer.onMediaSegment = (type, segment) => {
        const info = segment.info;
        const moof = readMoof(segment.data);
        assert.equal(moof.decodeTime, info.beginDts);
        assert.ok(moof.sampleDurations.every(duration => duration > 0), 'sample durations must not be zero');
        assert.equal(moof.sampleDurations.reduce((sum, duration) => sum + duration, 0), info.endDts - info.beginDts);
        events.push({ count: segment.sampleCount, beginDts: info.beginDts, endDts: info.endDts });
    };
    remuxer.bindDataSource(demuxer);

    return { demuxer, remuxer };
}

test('TS E-AC-3 remuxes frames of 1 block without repeating or dropping any', () => {
    const events = [];
    const { demuxer, remuxer } = createRemuxingDemuxer(events);
    const pes = concatBytes(...Array(6).fill(eac3.frame44100OneBlock));

    // 3 PES of 6 frames of 256 samples at 44.1 kHz, which start 34.83 ms apart
    for (let i = 0; i < 3; i++) {
        demuxer.parseEAC3Payload(pes, 90000 + Math.round(i * 6 * 256 * 90000 / 44100));
    }
    // A normal remux keeps the last frame stashed in the remuxer, the end of stream flushes it
    demuxer.dispatchAudioVideoMediaSegment();
    remuxer.flushStashedSamples();

    // The 18 frames, 104.49 ms. The remuxer used to find the frames of a PES further apart than
    // their duration, so it repeated frames to fill the gaps and dropped frames that then overlapped:
    // 42 samples over 243 ms.
    assert.deepEqual(events, [
        'init ec-3',
        { count: 17, beginDts: 0, endDts: 98 },
        { count: 1, beginDts: 98, endDts: 104 }
    ]);
});
