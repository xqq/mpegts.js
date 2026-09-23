const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { mp3Frame, concatBytes } = require('./helpers/mp3.cjs');

const load = loadSource();
const { MP3FrameParser } = load('demux/mp3.ts');
const { MPEG4AudioObjectTypes } = load('demux/mpeg4-audio.ts');

function readAllFrames(parser) {
    const frames = [];
    let frame;
    while ((frame = parser.readNextMP3Frame()) != null) {
        // Copy into a plain object of this realm, the parser runs in its own vm context
        frames.push({ ...frame });
    }
    return frames;
}

// Frame lengths and samples per frame are worked out from ISO/IEC 11172-3 and 13818-3
// (they agree with FFmpeg's mpegaudiodecheader.c), not from the parser's arithmetic.
const fixtures = [
    {
        label: 'MPEG-1 Layer III, 128 kbps, 44.1 kHz',
        header: [0xFF, 0xFB, 0x90, 0x00],
        frameLength: 417,
        sampleRate: 44100, bitRate: 128, samplesPerFrame: 1152, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer3
    },
    {
        label: 'MPEG-1 Layer III with padding',
        header: [0xFF, 0xFB, 0x92, 0x00],
        frameLength: 418,
        sampleRate: 44100, bitRate: 128, samplesPerFrame: 1152, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer3
    },
    {
        // The 16-bit CRC after the header is counted in the frame length
        label: 'MPEG-1 Layer III with CRC',
        header: [0xFF, 0xFA, 0x90, 0x00],
        frameLength: 417,
        sampleRate: 44100, bitRate: 128, samplesPerFrame: 1152, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer3
    },
    {
        label: 'MPEG-1 Layer III, mono',
        header: [0xFF, 0xFB, 0x90, 0xC0],
        frameLength: 417,
        sampleRate: 44100, bitRate: 128, samplesPerFrame: 1152, channelCount: 1,
        objectType: MPEG4AudioObjectTypes.kLayer3
    },
    {
        label: 'MPEG-1 Layer III, 128 kbps, 48 kHz',
        header: [0xFF, 0xFB, 0x94, 0x00],
        frameLength: 384,
        sampleRate: 48000, bitRate: 128, samplesPerFrame: 1152, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer3
    },
    {
        label: 'MPEG-2 Layer III, 64 kbps, 22.05 kHz',
        header: [0xFF, 0xF3, 0x80, 0x00],
        frameLength: 208,
        sampleRate: 22050, bitRate: 64, samplesPerFrame: 576, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer3
    },
    {
        label: 'MPEG-2.5 Layer III, 8 kbps, 8 kHz, mono',
        header: [0xFF, 0xE3, 0x18, 0xC0],
        frameLength: 72,
        sampleRate: 8000, bitRate: 8, samplesPerFrame: 576, channelCount: 1,
        objectType: MPEG4AudioObjectTypes.kLayer3
    },
    {
        label: 'MPEG-1 Layer II, 192 kbps, 48 kHz',
        header: [0xFF, 0xFD, 0xA4, 0x00],
        frameLength: 576,
        sampleRate: 48000, bitRate: 192, samplesPerFrame: 1152, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer2
    },
    {
        // Unlike Layer III, Layer II keeps 1152 samples per frame in MPEG-2
        label: 'MPEG-2 Layer II, 64 kbps, 24 kHz',
        header: [0xFF, 0xF5, 0x84, 0x00],
        frameLength: 384,
        sampleRate: 24000, bitRate: 64, samplesPerFrame: 1152, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer2
    },
    {
        label: 'MPEG-1 Layer I, 384 kbps, 48 kHz',
        header: [0xFF, 0xFF, 0xC4, 0x00],
        frameLength: 384,
        sampleRate: 48000, bitRate: 384, samplesPerFrame: 384, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer1
    },
    {
        // Layer I frames are whole 4-byte slots: 8 slots, not 48 * 32000 / 44100 = 34 bytes
        label: 'MPEG-1 Layer I, 32 kbps, 44.1 kHz',
        header: [0xFF, 0xFF, 0x10, 0x00],
        frameLength: 32,
        sampleRate: 44100, bitRate: 32, samplesPerFrame: 384, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer1
    },
    {
        // Padding adds a whole slot to Layer I frames
        label: 'MPEG-1 Layer I with padding',
        header: [0xFF, 0xFF, 0x12, 0x00],
        frameLength: 36,
        sampleRate: 44100, bitRate: 32, samplesPerFrame: 384, channelCount: 2,
        objectType: MPEG4AudioObjectTypes.kLayer1
    }
];

for (const fixture of fixtures) {
    test(`MP3FrameParser parses ${fixture.label}`, () => {
        const frame = mp3Frame(fixture.header, fixture.frameLength);
        const parser = new MP3FrameParser(concatBytes(frame, frame));

        const expected = {
            object_type: fixture.objectType,
            sample_rate: fixture.sampleRate,
            channel_count: fixture.channelCount,
            bit_rate: fixture.bitRate,
            samples_per_frame: fixture.samplesPerFrame,
            data: frame
        };
        assert.deepEqual(readAllFrames(parser), [expected, expected]);
        assert.equal(parser.hasIncompleteData(), false);
        assert.equal(parser.getIncompleteData(), null);
    });
}

// MPEG-1 Layer III, 128 kbps, 44.1 kHz
const stereo = mp3Frame([0xFF, 0xFB, 0x90, 0x00], 417);
const mono = mp3Frame([0xFF, 0xFB, 0x90, 0xC0], 417);
const stereo_48k = mp3Frame([0xFF, 0xFB, 0x94, 0x00], 384);

test('MP3FrameParser follows frame header changes between frames', () => {
    const parser = new MP3FrameParser(concatBytes(stereo, stereo_48k, mono));

    assert.deepEqual(
        readAllFrames(parser).map(frame => [frame.sample_rate, frame.channel_count, frame.data.byteLength]),
        [[44100, 2, 417], [48000, 2, 384], [44100, 1, 417]]
    );
});

test('MP3FrameParser skips data before the first frame header', () => {
    const garbage = Uint8Array.of(0x00, 0x12, 0x34, 0x56, 0x78);
    const parser = new MP3FrameParser(concatBytes(garbage, stereo, stereo));

    assert.deepEqual(readAllFrames(parser).map(frame => frame.data), [stereo, stereo]);
});

test('MP3FrameParser skips a fake syncword which is not followed by another frame header', () => {
    // A valid-looking header at offset 1, whose next frame would start inside the real first frame
    const garbage = Uint8Array.of(0x00, 0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
    const parser = new MP3FrameParser(concatBytes(garbage, stereo, stereo));

    const frames = readAllFrames(parser);
    assert.deepEqual(frames.map(frame => frame.data), [stereo, stereo]);
    assert.equal(frames[0].data.byteOffset, garbage.byteLength);
});

for (const { label, header } of [
    { label: 'reserved MPEG audio version', header: [0xFF, 0xEB, 0x90, 0x00] },
    { label: 'reserved layer', header: [0xFF, 0xF9, 0x90, 0x00] },
    { label: 'invalid bitrate index', header: [0xFF, 0xFB, 0xF0, 0x00] },
    { label: 'reserved sampling frequency index', header: [0xFF, 0xFB, 0x9C, 0x00] },
    { label: 'free format bitrate', header: [0xFF, 0xFB, 0x00, 0x00] }
]) {
    test(`MP3FrameParser skips a frame header with ${label}`, () => {
        const rejected = mp3Frame(header, 417);

        assert.deepEqual(readAllFrames(new MP3FrameParser(rejected)), []);
        assert.deepEqual(
            readAllFrames(new MP3FrameParser(concatBytes(rejected, stereo, stereo))).map(frame => frame.data),
            [stereo, stereo]
        );
    });
}

test('MP3FrameParser keeps a frame running past the end of data as incomplete data', () => {
    const parser = new MP3FrameParser(concatBytes(stereo, mono.subarray(0, 100)));

    assert.deepEqual(readAllFrames(parser).map(frame => frame.data), [stereo]);
    assert.equal(parser.hasIncompleteData(), true);
    assert.deepEqual(parser.getIncompleteData(), mono.subarray(0, 100));

    // Prepending the incomplete data to the data that follows completes the frame
    const next_parser = new MP3FrameParser(concatBytes(parser.getIncompleteData(), mono.subarray(100), stereo));
    assert.deepEqual(readAllFrames(next_parser).map(frame => frame.data), [mono, stereo]);
    assert.equal(next_parser.hasIncompleteData(), false);
});

test('MP3FrameParser keeps a frame header split at the end of data as incomplete data', () => {
    for (let split = 1; split < 4; split++) {
        const parser = new MP3FrameParser(concatBytes(stereo, mono.subarray(0, split)));

        assert.deepEqual(readAllFrames(parser).map(frame => frame.data), [stereo]);
        assert.deepEqual(parser.getIncompleteData(), mono.subarray(0, split));

        const next_parser = new MP3FrameParser(concatBytes(parser.getIncompleteData(), mono.subarray(split)));
        assert.deepEqual(readAllFrames(next_parser).map(frame => frame.data), [mono]);
    }
});

test('MP3FrameParser keeps no incomplete data for trailing bytes that cannot begin a frame', () => {
    for (const trailing of [[0x00], [0x12, 0x34], [0xFF, 0x00], [0x00, 0x00, 0x00]]) {
        const parser = new MP3FrameParser(concatBytes(stereo, Uint8Array.from(trailing)));

        assert.deepEqual(readAllFrames(parser).map(frame => frame.data), [stereo]);
        assert.equal(parser.hasIncompleteData(), false);
        assert.equal(parser.getIncompleteData(), null);
    }

    // A syncword may still begin after other trailing bytes
    const parser = new MP3FrameParser(concatBytes(stereo, Uint8Array.of(0x00, 0xFF, 0xFB)));
    assert.deepEqual(readAllFrames(parser).map(frame => frame.data), [stereo]);
    assert.deepEqual(parser.getIncompleteData(), Uint8Array.of(0xFF, 0xFB));
});

test('MP3FrameParser finds no frame in data without any frame header', () => {
    const parser = new MP3FrameParser(new Uint8Array(1000));

    assert.equal(parser.readNextMP3Frame(), null);
    assert.equal(parser.hasIncompleteData(), false);
});
