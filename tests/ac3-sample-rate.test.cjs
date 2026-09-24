const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { ac3, eac3 } = require('./helpers/ac3.cjs');

const { AC3Parser, EAC3Parser } = loadSource()('demux/ac3.ts');

const ac3Cases = [
    // fscod 1 and 2 used to give 44200 and 33000 Hz
    { label: '44.1 kHz', frame: ac3.frame44100, sampleRate: 44100 },
    { label: '32 kHz', frame: ac3.frame32000, sampleRate: 32000 }
];

const eac3Cases = [
    { label: '44.1 kHz', frame: eac3.frame44100, sampleRate: 44100 },
    { label: '32 kHz', frame: eac3.frame32000, sampleRate: 32000 },
    // fscod2 1 used to give 22060 Hz
    { label: '22.05 kHz (reduced sample rate)', frame: eac3.frame22050, sampleRate: 22050 }
];

for (const { label, frame, sampleRate } of ac3Cases) {
    test(`AC3Parser reads the sample rate of AC-3 at ${label}`, () => {
        const parser = new AC3Parser(concatBytes(frame, frame));
        const frames = [];
        let ac3_frame = null;
        while ((ac3_frame = parser.readNextAC3Frame()) != null) {
            frames.push([ac3_frame.sampling_frequency, ac3_frame.data.byteLength]);
        }

        // [sampling frequency, frame length] of each frame
        assert.deepEqual(frames, [[sampleRate, frame.byteLength], [sampleRate, frame.byteLength]]);
    });
}

for (const { label, frame, sampleRate } of eac3Cases) {
    test(`EAC3Parser reads the sample rate of E-AC-3 at ${label}`, () => {
        const parser = new EAC3Parser(concatBytes(frame, frame));
        const frames = [];
        let eac3_frame = null;
        while ((eac3_frame = parser.readNextEAC3Frame()) != null) {
            frames.push([eac3_frame.sampling_frequency, eac3_frame.num_blks, eac3_frame.data.byteLength]);
        }

        // [sampling frequency, number of blocks, frame length] of each frame
        assert.deepEqual(frames, [[sampleRate, 6, frame.byteLength], [sampleRate, 6, frame.byteLength]]);
    });
}

// Returns the audio metadata TSDemuxer dispatches for the parsed payload. The sample rate goes
// into the sample entry, and MP4Remuxer regenerates the audio timestamps from refSampleDuration.
function dispatchAudioMetadata(parsePayload) {
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

    assert.equal(metadata.length, 1);
    return metadata[0];
}

for (const { label, frame, sampleRate } of ac3Cases) {
    test(`TS AC-3 refSampleDuration follows the sample rate, ${label}`, () => {
        const metadata = dispatchAudioMetadata(demuxer => demuxer.parseAC3Payload(concatBytes(frame, frame), 90000));

        // 1536 samples per frame
        assert.deepEqual(metadata, {
            type: 'audio',
            codec: 'ac-3',
            audioSampleRate: sampleRate,
            refSampleDuration: 1536 / sampleRate * 1000
        });
    });
}

for (const { label, frame, sampleRate } of eac3Cases) {
    test(`TS E-AC-3 refSampleDuration follows the sample rate, ${label}`, () => {
        const metadata = dispatchAudioMetadata(demuxer => demuxer.parseEAC3Payload(concatBytes(frame, frame), 90000));

        // 256 samples per block, 6 blocks per frame
        assert.deepEqual(metadata, {
            type: 'audio',
            codec: 'ec-3',
            audioSampleRate: sampleRate,
            refSampleDuration: 256 * 6 / sampleRate * 1000
        });
    });
}
