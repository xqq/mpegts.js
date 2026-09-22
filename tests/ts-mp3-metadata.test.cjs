const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');

for (const { label, header, sampleRate, channelCount, objectType } of [
    {
        label: 'sample rate',
        header: [0xff, 0xfb, 0x94, 0x00],
        sampleRate: 48000,
        channelCount: 2,
        objectType: 34
    },
    {
        label: 'channel count',
        header: [0xff, 0xfb, 0x90, 0xc0],
        sampleRate: 44100,
        channelCount: 1,
        objectType: 34
    },
    {
        label: 'MPEG audio layer',
        header: [0xff, 0xfd, 0x80, 0x00],
        sampleRate: 44100,
        channelCount: 2,
        objectType: 33
    }
]) {
    test(`TS MPEG audio flushes and updates metadata when ${label} changes`, () => {
        const load = loadSource();
        const TSDemuxer = load('demux/ts-demuxer.ts').default;
        const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
        demuxer.has_audio_ = true;
        demuxer.onMediaInfo = () => {};

        const events = [];
        demuxer.onTrackMetadata = (type, metadata) => {
            assert.equal(type, 'audio');
            events.push({
                type: 'metadata',
                codec: metadata.codec,
                rate: metadata.audioSampleRate,
                channels: metadata.channelCount
            });
        };
        demuxer.onDataAvailable = (audioTrack, videoTrack, force) => {
            assert.equal(videoTrack, null);
            assert.equal(force, true);
            events.push({ type: 'flush', units: Array.from(audioTrack.samples, sample => sample.unit) });
            audioTrack.samples = [];
            audioTrack.length = 0;
        };

        // Only the MPEG audio headers are needed by this payload parser.
        const original = Uint8Array.of(0xff, 0xfb, 0x90, 0x00); // MPEG-1 Layer III, 44.1 kHz stereo
        const changed = Uint8Array.from(header);
        demuxer.parseMP3Payload(original, 90000);
        demuxer.parseMP3Payload(original, 92351);
        assert.equal(events.length, 1, 'unchanged metadata must not reinitialize the track');

        demuxer.parseMP3Payload(changed, 94702);
        demuxer.parseMP3Payload(changed, 97053);

        assert.deepEqual(events, [
            { type: 'metadata', codec: 'mp3', rate: 44100, channels: 2 },
            { type: 'flush', units: [original, original] },
            { type: 'metadata', codec: 'mp3', rate: sampleRate, channels: channelCount }
        ]);
        assert.equal(demuxer.audio_metadata_.object_type, objectType);
        assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.unit), [changed, changed]);
    });
}
