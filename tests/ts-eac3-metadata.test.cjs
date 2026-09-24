const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { eac3 } = require('./helpers/ac3.cjs');

const original = eac3.frame44100;

function createDemuxer(events) {
    const TSDemuxer = loadSource()('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_audio_ = true;
    demuxer.onMediaInfo = () => {};

    demuxer.onTrackMetadata = (type, metadata) => {
        assert.equal(type, 'audio');
        events.push({
            type: 'metadata',
            codec: metadata.codec,
            rate: metadata.audioSampleRate,
            channels: metadata.channelCount,
            duration: metadata.refSampleDuration,
            // The dec3 payload, copied into an array of this realm
            dec3: Array.from(metadata.config)
        });
    };
    demuxer.onDataAvailable = (audioTrack, videoTrack, force) => {
        assert.equal(videoTrack, null);
        assert.equal(force, true);
        events.push({ type: 'flush', units: Array.from(audioTrack.samples, sample => sample.unit) });
        audioTrack.samples = [];
        audioTrack.length = 0;
    };

    return demuxer;
}

// The metadata of frames of the given number of 256-sample blocks. dec3 (ETSI TS 102 366 Annex F):
// data_rate in kbit/s (13 bits), num_ind_sub (3), fscod (2), bsid (5), reserved (1), asvc (1),
// bsmod (3), acmod (3), lfeon (1), then zeros for no dependent substream.
function metadata(rate, channels, blocks, dec3) {
    return { type: 'metadata', codec: 'ec-3', rate, channels, duration: 256 * blocks / rate * 1000, dec3 };
}

// 96 kbit/s, fscod 1, bsid 16, acmod 2, lfeon 0
const originalMetadata = metadata(44100, 2, 6, [0x03, 0x00, 0x60, 0x04, 0x00]);

for (const { label, frame, sampleRate, channelCount, blocks, dec3 } of [
    // fscod 2
    { label: 'sample rate', frame: eac3.frame32000, sampleRate: 32000, channelCount: 2, blocks: 6, dec3: [0x03, 0x00, 0xa0, 0x04, 0x00] },
    // acmod 1
    { label: 'channel mode', frame: eac3.frame44100Mono, sampleRate: 44100, channelCount: 1, blocks: 6, dec3: [0x03, 0x00, 0x60, 0x02, 0x00] },
    // lfeon 1
    { label: 'LFE channel', frame: eac3.frame44100Lfe, sampleRate: 44100, channelCount: 3, blocks: 6, dec3: [0x03, 0x00, 0x60, 0x05, 0x00] },
    // The same 416 bytes for 256 samples instead of 1536: 573 kbit/s
    { label: 'number of blocks', frame: eac3.frame44100OneBlock, sampleRate: 44100, channelCount: 2, blocks: 1, dec3: [0x11, 0xe8, 0x60, 0x04, 0x00] },
    // bsid 15
    { label: 'bitstream identification', frame: eac3.frame44100Bsid15, sampleRate: 44100, channelCount: 2, blocks: 6, dec3: [0x03, 0x00, 0x5e, 0x04, 0x00] }
]) {
    test(`TS E-AC-3 flushes and updates metadata when ${label} changes`, () => {
        const events = [];
        const demuxer = createDemuxer(events);

        demuxer.parseEAC3Payload(original, 90000);
        demuxer.parseEAC3Payload(original, 93135);
        assert.equal(events.length, 1, 'unchanged metadata must not reinitialize the track');

        demuxer.parseEAC3Payload(frame, 96269);
        demuxer.parseEAC3Payload(frame, 99404);

        // The new metadata used to never be dispatched, so the new frames were remuxed under the
        // old sample entry, dec3 and refSampleDuration
        assert.deepEqual(events, [
            originalMetadata,
            { type: 'flush', units: [original, original] },
            metadata(sampleRate, channelCount, blocks, dec3)
        ]);
        assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.unit), [frame, frame]);
    });
}

test('TS E-AC-3 flushes exactly the frames before a change inside one PES', () => {
    const events = [];
    const demuxer = createDemuxer(events);
    const oneBlock = eac3.frame44100OneBlock;

    demuxer.parseEAC3Payload(concatBytes(original, original, oneBlock, oneBlock), 90000);

    assert.deepEqual(events, [
        originalMetadata,
        { type: 'flush', units: [original, original] },
        metadata(44100, 2, 1, [0x11, 0xe8, 0x60, 0x04, 0x00])
    ]);
    assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.unit), [oneBlock, oneBlock]);
});

test('TS E-AC-3 does not reinitialize when only the bit rate changes', () => {
    const events = [];
    const demuxer = createDemuxer(events);
    const faster = eac3.frame44100At192k;

    demuxer.parseEAC3Payload(original, 90000);
    demuxer.parseEAC3Payload(faster, 93135);
    demuxer.parseEAC3Payload(faster, 96269);

    // The data rate of dec3 follows the frame size, but nothing decodes or times by it
    assert.deepEqual(events, [originalMetadata]);
    assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.unit), [original, faster, faster]);
});

test('TS E-AC-3 does not reinitialize at the dependent substreams of a 7.1 stream', () => {
    const events = [];
    const demuxer = createDemuxer(events);
    const syncframes = concatBytes(eac3.frame44100Surround, eac3.frame44100Dependent);

    demuxer.parseEAC3Payload(syncframes, 90000);
    demuxer.parseEAC3Payload(syncframes, 93135);

    // Only the independent 5.1 substream (acmod 7, lfeon 1) is compared with the metadata. The
    // 2/0 dependent substream would reinitialize the track at every syncframe.
    assert.deepEqual(events, [metadata(44100, 6, 6, [0x03, 0x00, 0x60, 0x0f, 0x00])]);
});
