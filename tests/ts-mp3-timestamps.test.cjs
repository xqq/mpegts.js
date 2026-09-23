const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { mp3Frame, concatBytes } = require('./helpers/mp3.cjs');

// MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417-byte frames of 1152 samples (26.12 ms).
// The byte after the header marks each frame, so tests can tell frames apart.
function frame(index) {
    const data = mp3Frame([0xff, 0xfb, 0x90, 0x00], 417);
    data[4] = index;
    return data;
}

// PES timestamp (90 kHz) of the n-th frame of the stream, which starts at 1 second
function framePts(n) {
    return 90000 + Math.round(n * 1152 * 90000 / 44100);
}

function createDemuxer() {
    const TSDemuxer = loadSource()('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_audio_ = true;
    demuxer.onMediaInfo = () => {};
    demuxer.onTrackMetadata = () => {};
    demuxer.onDataAvailable = () => {};
    return demuxer;
}

// [dts in milliseconds, frame index, frame length] of each queued sample
function queuedFrames(demuxer) {
    return Array.from(demuxer.audio_track_.samples, sample => [sample.dts, sample.unit[4], sample.unit.byteLength]);
}

test('TS MPEG audio gives each frame of a PES its own timestamp', () => {
    const demuxer = createDemuxer();
    demuxer.parseMP3Payload(concatBytes(frame(0), frame(1), frame(2)), framePts(0));

    assert.deepEqual(queuedFrames(demuxer), [[1000, 0, 417], [1026, 1, 417], [1052, 2, 417]]);
});

test('TS MPEG audio advances timestamps by the duration of each frame', () => {
    // MPEG-2 Layer III, 64 kbps, 24 kHz: 192-byte frames of 576 samples (24 ms)
    const lsf_frame = mp3Frame([0xff, 0xf3, 0x84, 0x00], 192);
    const demuxer = createDemuxer();
    demuxer.parseMP3Payload(concatBytes(lsf_frame, lsf_frame, lsf_frame), 90000);

    assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.dts), [1000, 1024, 1048]);
});

for (const split of [200, 2]) {
    test(`TS MPEG audio completes a frame split across two PES ${split} bytes after its start`, () => {
        const demuxer = createDemuxer();
        const split_frame = frame(2);

        demuxer.parseMP3Payload(concatBytes(frame(0), frame(1), split_frame.subarray(0, split)), framePts(0));
        // The PTS of a PES belongs to the first frame starting in it, which is frame 3 here
        demuxer.parseMP3Payload(concatBytes(split_frame.subarray(split), frame(3)), framePts(3));

        assert.deepEqual(queuedFrames(demuxer), [[1000, 0, 417], [1026, 1, 417], [1052, 2, 417], [1078, 3, 417]]);
    });
}

test('TS MPEG audio continues the previous frame for a PES without PTS', () => {
    const demuxer = createDemuxer();
    demuxer.parseMP3Payload(concatBytes(frame(0), frame(1)), framePts(0));
    demuxer.parseMP3Payload(concatBytes(frame(2), frame(3)), undefined);

    assert.deepEqual(queuedFrames(demuxer), [[1000, 0, 417], [1026, 1, 417], [1052, 2, 417], [1078, 3, 417]]);
});

test('TS MPEG audio drops a split frame when the next PES does not continue it', () => {
    const demuxer = createDemuxer();
    const split_frame = frame(2);

    demuxer.parseMP3Payload(concatBytes(frame(0), frame(1), split_frame.subarray(0, 200)), framePts(0));
    // e.g. a splice: the timestamps jump by 10 seconds, the rest of frame 2 is only junk now
    demuxer.parseMP3Payload(concatBytes(split_frame.subarray(200), frame(3)), framePts(3) + 10 * 90000);

    assert.deepEqual(queuedFrames(demuxer), [[1000, 0, 417], [1026, 1, 417], [11078, 3, 417]]);
});

test('TS MPEG audio gives the PES timestamp to the first frame starting in the PES', () => {
    const demuxer = createDemuxer();
    // Joining a stream in the middle: the PES starts with the rest of a frame never seen
    demuxer.parseMP3Payload(concatBytes(frame(0).subarray(100), frame(1), frame(2)), framePts(1));

    assert.deepEqual(queuedFrames(demuxer), [[1026, 1, 417], [1052, 2, 417]]);
});

test('TS MPEG audio drops a PES without PTS if there is no frame before it', () => {
    const demuxer = createDemuxer();
    demuxer.parseMP3Payload(concatBytes(frame(0), frame(1)), undefined);
    demuxer.parseMP3Payload(concatBytes(frame(2), frame(3)), framePts(2));

    assert.deepEqual(queuedFrames(demuxer), [[1052, 2, 417], [1078, 3, 417]]);
});
