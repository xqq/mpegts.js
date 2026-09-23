const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { adtsFrame, loasFrame } = require('./helpers/aac.cjs');

// PES timestamp (90 kHz) of the n-th AAC frame (1024 samples at 44.1 kHz), starting at 1 second
function framePts(n) {
    return 90000 + Math.round(n * 1024 * 90000 / 44100);
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

// [dts in milliseconds, frame marker] of each queued sample
function queuedFrames(demuxer) {
    return Array.from(demuxer.audio_track_.samples, sample => [sample.dts, sample.unit[0]]);
}

const eight_frames = [[1000, 0], [1023, 1], [1046, 2], [1069, 3], [1092, 4], [1116, 5], [1139, 6], [1162, 7]];

test('TS ADTS AAC completes a frame split across two PES', () => {
    const demuxer = createDemuxer();
    const frames = [0, 1, 2, 3].map(marker => adtsFrame(marker));

    demuxer.parseADTSAACPayload(concatBytes(frames[0], frames[1], frames[2].subarray(0, 100)), framePts(0));
    // The PTS of a PES belongs to the first frame starting in it, which is frame 3 here
    demuxer.parseADTSAACPayload(concatBytes(frames[2].subarray(100), frames[3]), framePts(3));

    assert.deepEqual(queuedFrames(demuxer), eight_frames.slice(0, 4));
});

test('TS ADTS AAC completes a frame whose header is split across two PES', () => {
    const demuxer = createDemuxer();
    const frames = [0, 1, 2, 3].map(marker => adtsFrame(marker));

    demuxer.parseADTSAACPayload(concatBytes(frames[0], frames[1], frames[2].subarray(0, 3)), framePts(0));
    demuxer.parseADTSAACPayload(concatBytes(frames[2].subarray(3), frames[3]), framePts(3));

    assert.deepEqual(queuedFrames(demuxer), eight_frames.slice(0, 4));
});

test('TS ADTS AAC does not prepend a completed frame to later PES again', () => {
    const demuxer = createDemuxer();
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map(marker => adtsFrame(marker));

    demuxer.parseADTSAACPayload(concatBytes(frames[0], frames[1], frames[2].subarray(0, 100)), framePts(0));
    demuxer.parseADTSAACPayload(concatBytes(frames[2].subarray(100), frames[3]), framePts(3));
    demuxer.parseADTSAACPayload(concatBytes(frames[4], frames[5]), framePts(4));
    demuxer.parseADTSAACPayload(concatBytes(frames[6], frames[7]), framePts(6));

    assert.deepEqual(queuedFrames(demuxer), eight_frames);
});

test('TS LOAS AAC does not hold back a frame ending exactly at the end of a PES', () => {
    const demuxer = createDemuxer();
    const frames = [0, 1, 2, 3].map(marker => loasFrame(marker, marker === 0));

    demuxer.parseLOASAACPayload(concatBytes(frames[0], frames[1]), framePts(0));
    assert.deepEqual(queuedFrames(demuxer), eight_frames.slice(0, 2));
    assert.equal(demuxer.aac_last_incomplete_data_, null);

    demuxer.parseLOASAACPayload(concatBytes(frames[2], frames[3]), framePts(2));
    assert.deepEqual(queuedFrames(demuxer), eight_frames.slice(0, 4));
    assert.equal(demuxer.aac_last_incomplete_data_, null);
});

test('TS LOAS AAC completes a frame whose syncword is split across two PES', () => {
    const demuxer = createDemuxer();
    const frames = [0, 1, 2].map(marker => loasFrame(marker, marker === 0));

    demuxer.parseLOASAACPayload(concatBytes(frames[0], frames[1].subarray(0, 1)), framePts(0));
    demuxer.parseLOASAACPayload(concatBytes(frames[1].subarray(1), frames[2]), framePts(2));

    assert.deepEqual(queuedFrames(demuxer), eight_frames.slice(0, 3));
});

test('TS LOAS AAC does not replay a completed frame after a PES leaving nothing incomplete', () => {
    const demuxer = createDemuxer();
    const frames = [0, 1, 2, 3, 4].map(marker => loasFrame(marker, marker === 0));
    // Each PES ends with one byte which is not part of a frame
    const stray = Uint8Array.of(0x00);

    demuxer.parseLOASAACPayload(concatBytes(frames[0], frames[1].subarray(0, 50)), framePts(0));
    demuxer.parseLOASAACPayload(concatBytes(frames[1].subarray(50), frames[2], stray), framePts(2));
    demuxer.parseLOASAACPayload(concatBytes(frames[3], frames[4], stray), framePts(3));

    assert.deepEqual(queuedFrames(demuxer), eight_frames.slice(0, 5));
});
