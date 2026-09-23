const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { loasFrame } = require('./helpers/aac.cjs');

const { AACLOASParser } = loadSource()('demux/aac.ts');

// Reads all LOAS frames, passing each frame on as the StreamMuxConfig of the next one
function readAllLOASFrames(parser) {
    const frames = [];
    let frame = null;
    while ((frame = parser.readNextAACFrame(frame ?? undefined)) != null) {
        frames.push([frame.audio_object_type, frame.sampling_frequency, frame.channel_config, frame.data.byteLength, frame.data[0]]);
    }
    return frames;
}

test('AACLOASParser reads a frame ending exactly at the end of data', () => {
    const parser = new AACLOASParser(concatBytes(loasFrame(0, true), loasFrame(1, false)));

    // [audio object type, sampling frequency, channel configuration, payload length, marker]
    assert.deepEqual(readAllLOASFrames(parser), [[2, 44100, 2, 150, 0], [2, 44100, 2, 150, 1]]);
    assert.equal(parser.hasIncompleteData(), false);
    assert.equal(parser.getIncompleteData(), null);
});

test('AACLOASParser keeps a frame running past the end of data as incomplete data', () => {
    const second = loasFrame(1, false);
    const parser = new AACLOASParser(concatBytes(loasFrame(0, true), second.subarray(0, 50)));

    assert.deepEqual(readAllLOASFrames(parser), [[2, 44100, 2, 150, 0]]);
    assert.equal(parser.hasIncompleteData(), true);
    assert.deepEqual(parser.getIncompleteData(), second.subarray(0, 50));
});
