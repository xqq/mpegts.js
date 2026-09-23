const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { mp3Frame, concatBytes } = require('./helpers/mp3.cjs');

// MPEG-1 Layer III, 128 kbps, 44.1 kHz stereo: 417-byte frames of 1152 samples
const original = mp3Frame([0xff, 0xfb, 0x90, 0x00], 417);

function createDemuxer(events) {
    const load = loadSource();
    const TSDemuxer = load('demux/ts-demuxer.ts').default;
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
            duration: metadata.refSampleDuration
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

for (const { label, header, frameLength, sampleRate, channelCount, objectType, samplesPerFrame } of [
    {
        label: 'sample rate',
        header: [0xff, 0xfb, 0x94, 0x00],
        frameLength: 384,
        sampleRate: 48000,
        channelCount: 2,
        objectType: 34,
        samplesPerFrame: 1152
    },
    {
        label: 'channel count',
        header: [0xff, 0xfb, 0x90, 0xc0],
        frameLength: 417,
        sampleRate: 44100,
        channelCount: 1,
        objectType: 34,
        samplesPerFrame: 1152
    },
    {
        label: 'MPEG audio layer',
        header: [0xff, 0xfd, 0x80, 0x00],
        frameLength: 417,
        sampleRate: 44100,
        channelCount: 2,
        objectType: 33,
        samplesPerFrame: 1152
    },
    {
        // MPEG-2 Layer III frames carry 576 samples
        label: 'MPEG audio version',
        header: [0xff, 0xf3, 0x84, 0x00],
        frameLength: 192,
        sampleRate: 24000,
        channelCount: 2,
        objectType: 34,
        samplesPerFrame: 576
    }
]) {
    test(`TS MPEG audio flushes and updates metadata when ${label} changes`, () => {
        const events = [];
        const demuxer = createDemuxer(events);

        const changed = mp3Frame(header, frameLength);
        demuxer.parseMP3Payload(original, 90000);
        demuxer.parseMP3Payload(original, 92351);
        assert.equal(events.length, 1, 'unchanged metadata must not reinitialize the track');

        demuxer.parseMP3Payload(changed, 94702);
        demuxer.parseMP3Payload(changed, 97053);

        assert.deepEqual(events, [
            { type: 'metadata', codec: 'mp3', rate: 44100, channels: 2, duration: 1152 / 44100 * 1000 },
            { type: 'flush', units: [original, original] },
            {
                type: 'metadata',
                codec: 'mp3',
                rate: sampleRate,
                channels: channelCount,
                duration: samplesPerFrame / sampleRate * 1000
            }
        ]);
        assert.equal(demuxer.audio_metadata_.object_type, objectType);
        assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.unit), [changed, changed]);
    });
}

test('TS MPEG audio flushes exactly the frames before a change inside one PES', () => {
    const events = [];
    const demuxer = createDemuxer(events);

    const mono = mp3Frame([0xff, 0xfb, 0x90, 0xc0], 417);
    demuxer.parseMP3Payload(concatBytes(original, original, mono, mono), 90000);

    assert.deepEqual(events, [
        { type: 'metadata', codec: 'mp3', rate: 44100, channels: 2, duration: 1152 / 44100 * 1000 },
        { type: 'flush', units: [original, original] },
        { type: 'metadata', codec: 'mp3', rate: 44100, channels: 1, duration: 1152 / 44100 * 1000 }
    ]);
    assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.unit), [mono, mono]);
});
