const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { adtsFrame, loasFrame } = require('./helpers/aac.cjs');

const { AACADTSParser, AACLOASParser } = loadSource()('demux/aac.ts');

// [audio object type, sampling frequency, channel configuration, payload length, marker] of each frame
function readAllADTSFrames(parser) {
    const frames = [];
    let frame = null;
    while ((frame = parser.readNextAACFrame()) != null) {
        frames.push([frame.audio_object_type, frame.sampling_frequency, frame.channel_config, frame.data.byteLength, frame.data[0]]);
    }
    return frames;
}

test('AACADTSParser reads consecutive frames', () => {
    const parser = new AACADTSParser(concatBytes(adtsFrame(0), adtsFrame(1)));

    // The payload of a 200-byte frame follows its 7-byte header
    assert.deepEqual(readAllADTSFrames(parser), [[2, 44100, 2, 193, 0], [2, 44100, 2, 193, 1]]);
    assert.equal(parser.hasIncompleteData(), false);
});

test('AACADTSParser keeps a frame header split at the end of data as incomplete data', () => {
    const second = adtsFrame(1);

    for (let split = 1; split <= 7; split++) {
        const parser = new AACADTSParser(concatBytes(adtsFrame(0), second.subarray(0, split)));

        assert.deepEqual(readAllADTSFrames(parser), [[2, 44100, 2, 193, 0]]);
        assert.deepEqual(parser.getIncompleteData(), second.subarray(0, split));

        const next_parser = new AACADTSParser(concatBytes(parser.getIncompleteData(), second.subarray(split)));
        assert.deepEqual(readAllADTSFrames(next_parser), [[2, 44100, 2, 193, 1]]);
    }
});

test('AACADTSParser keeps no incomplete data for trailing bytes that cannot begin a frame', () => {
    for (const trailing of [[0x00], [0xff, 0x00], [0x12, 0x34, 0x56]]) {
        const parser = new AACADTSParser(concatBytes(adtsFrame(0), Uint8Array.from(trailing)));

        assert.deepEqual(readAllADTSFrames(parser), [[2, 44100, 2, 193, 0]]);
        assert.equal(parser.hasIncompleteData(), false);
        assert.equal(parser.getIncompleteData(), null);
    }

    // A syncword may still begin after other trailing bytes
    const parser = new AACADTSParser(concatBytes(adtsFrame(0), Uint8Array.of(0x00, 0xff, 0xf1)));
    assert.deepEqual(readAllADTSFrames(parser), [[2, 44100, 2, 193, 0]]);
    assert.deepEqual(parser.getIncompleteData(), Uint8Array.of(0xff, 0xf1));
});

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

test('AACLOASParser keeps the first byte of a split syncword as incomplete data', () => {
    const second = loasFrame(1, true);
    const parser = new AACLOASParser(concatBytes(loasFrame(0, true), second.subarray(0, 1)));

    assert.deepEqual(readAllLOASFrames(parser), [[2, 44100, 2, 150, 0]]);
    assert.deepEqual(parser.getIncompleteData(), Uint8Array.of(0x56));

    const next_parser = new AACLOASParser(concatBytes(parser.getIncompleteData(), second.subarray(1)));
    assert.deepEqual(readAllLOASFrames(next_parser), [[2, 44100, 2, 150, 1]]);
});

test('AACLOASParser keeps no incomplete data for a trailing byte that cannot begin a syncword', () => {
    const parser = new AACLOASParser(concatBytes(loasFrame(0, true), Uint8Array.of(0x00)));

    assert.deepEqual(readAllLOASFrames(parser), [[2, 44100, 2, 150, 0]]);
    assert.equal(parser.hasIncompleteData(), false);
    assert.equal(parser.getIncompleteData(), null);
});
