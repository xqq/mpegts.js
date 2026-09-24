const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { ac3, eac3 } = require('./helpers/ac3.cjs');

const { AC3Parser, EAC3Parser } = loadSource()('demux/ac3.ts');

// Copy of a frame with byte 4 of its header replaced: fscod (2 bits) and frmsizecod (6) for AC-3,
// fscod (2), fscod2 or numblkscod (2), acmod (3) and lfeon (1) for E-AC-3
function withByte4(frame, byte4) {
    const copy = frame.slice();
    copy[4] = byte4;
    return copy;
}

// Frames whose header FFmpeg's AC-3 parser rejects. Each test puts the valid frame it is made from
// right after it, where the parser should resync.
const ac3Cases = [
    // 0x4c -> 0xcc: fscod 3 (reserved) and frmsizecod 12, which used to throw a TypeError
    { label: 'the reserved fscod 3', frame: withByte4(ac3.frame44100, 0xcc) },
    // 0x4c -> 0x66: fscod 1 and frmsizecod 38, past the 38 frame sizes, which used to end the payload
    { label: 'frmsizecod 38', frame: withByte4(ac3.frame44100, 0x66) }
];

const eac3Cases = [
    // 0xd4 -> 0xf4: fscod 3 and fscod2 3 (reserved), acmod 2, lfeon 0, which used to give an
    // undefined sample rate
    { label: 'the reserved fscod2 3', frame: withByte4(eac3.frame22050, 0xf4) }
];

for (const { label, frame } of ac3Cases) {
    test(`AC3Parser skips a header with ${label} and resyncs at the next syncword`, () => {
        const parser = new AC3Parser(concatBytes(frame, ac3.frame44100));
        const frames = [];
        let ac3_frame = null;
        while ((ac3_frame = parser.readNextAC3Frame()) != null) {
            frames.push([ac3_frame.data.byteOffset, ac3_frame.sampling_frequency, ac3_frame.data.byteLength]);
        }

        // [offset in the payload, sampling frequency, frame length] of each frame
        assert.deepEqual(frames, [[416, 44100, 416]]);
        // The skipped header is not held back as the beginning of an incomplete frame
        assert.equal(parser.hasIncompleteData(), false);
    });
}

for (const { label, frame } of eac3Cases) {
    test(`EAC3Parser skips a header with ${label} and resyncs at the next syncword`, () => {
        const parser = new EAC3Parser(concatBytes(frame, eac3.frame22050));
        const frames = [];
        let eac3_frame = null;
        while ((eac3_frame = parser.readNextEAC3Frame()) != null) {
            frames.push([eac3_frame.data.byteOffset, eac3_frame.sampling_frequency, eac3_frame.num_blks, eac3_frame.data.byteLength]);
        }

        // [offset in the payload, sampling frequency, number of blocks, frame length] of each frame
        assert.deepEqual(frames, [[576, 22050, 6, 576]]);
        // The skipped header is not held back as the beginning of an incomplete frame
        assert.equal(parser.hasIncompleteData(), false);
    });
}

// Returns the audio metadata TSDemuxer dispatches for the parsed payload, and the
// [dts in milliseconds, frame length] of each sample it queues
function demuxAudio(parsePayload) {
    const TSDemuxer = loadSource()('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_audio_ = true;
    demuxer.onMediaInfo = () => {};
    demuxer.onDataAvailable = () => {};

    const metadata = [];
    demuxer.onTrackMetadata = (type, meta) => {
        metadata.push({
            type,
            codec: meta.codec,
            audioSampleRate: meta.audioSampleRate,
            refSampleDuration: meta.refSampleDuration
        });
    };
    parsePayload(demuxer);

    const samples = Array.from(demuxer.audio_track_.samples, sample => [sample.dts, sample.unit.byteLength]);
    return { metadata, samples };
}

for (const { label, frame } of ac3Cases) {
    test(`TS AC-3 skips a header with ${label}`, () => {
        const { metadata, samples } = demuxAudio(demuxer => demuxer.parseAC3Payload(concatBytes(frame, ac3.frame44100), 90000));

        // Only the valid frame, with the metadata of its header, and the PES timestamp since the
        // skipped bytes take no time
        assert.deepEqual(metadata, [{
            type: 'audio',
            codec: 'ac-3',
            audioSampleRate: 44100,
            refSampleDuration: 1536 / 44100 * 1000
        }]);
        assert.deepEqual(samples, [[1000, 416]]);
    });
}

for (const { label, frame } of eac3Cases) {
    test(`TS E-AC-3 skips a header with ${label}`, () => {
        const { metadata, samples } = demuxAudio(demuxer => demuxer.parseEAC3Payload(concatBytes(frame, eac3.frame22050), 90000));

        // Only the valid frame, with the metadata of its header, and the PES timestamp since the
        // skipped bytes take no time
        assert.deepEqual(metadata, [{
            type: 'audio',
            codec: 'ec-3',
            audioSampleRate: 22050,
            refSampleDuration: 256 * 6 / 22050 * 1000
        }]);
        assert.deepEqual(samples, [[1000, 576]]);
    });
}
