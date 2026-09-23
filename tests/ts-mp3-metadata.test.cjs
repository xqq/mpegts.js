const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { mp3Frame, concatBytes } = require('./helpers/mp3.cjs');

// MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417-byte frames of 1152 samples
const original = mp3Frame([0xff, 0xfb, 0x90, 0x00], 417);
const mono = mp3Frame([0xff, 0xfb, 0x90, 0xc0], 417);

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

    demuxer.parseMP3Payload(concatBytes(original, original, mono, mono), 90000);

    assert.deepEqual(events, [
        { type: 'metadata', codec: 'mp3', rate: 44100, channels: 2, duration: 1152 / 44100 * 1000 },
        { type: 'flush', units: [original, original] },
        { type: 'metadata', codec: 'mp3', rate: 44100, channels: 1, duration: 1152 / 44100 * 1000 }
    ]);
    assert.deepEqual(Array.from(demuxer.audio_track_.samples, sample => sample.unit), [mono, mono]);
});

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';

// Reads baseMediaDecodeTime and sample durations from the moof box of a fMP4 media segment
function readMoof(buffer) {
    const view = new DataView(buffer);
    const moof = { decodeTime: undefined, sampleDurations: [] };

    (function readBoxes(offset, end) {
        while (offset + 8 <= end) {
            const size = view.getUint32(offset);
            const type = String.fromCharCode(...new Uint8Array(buffer, offset + 4, 4));
            if (type === 'moof' || type === 'traf') {
                readBoxes(offset + 8, offset + size);
            } else if (type === 'tfdt') {
                moof.decodeTime = view.getUint32(offset + 12);
            } else if (type === 'trun') {
                // 16 bytes per sample after sample_count and data_offset, sample_duration first
                const sampleCount = view.getUint32(offset + 12);
                for (let i = 0; i < sampleCount; i++) {
                    moof.sampleDurations.push(view.getUint32(offset + 20 + i * 16));
                }
            }
            offset += size;
        }
    })(0, buffer.byteLength);

    return moof;
}

// Connects a TSDemuxer to a real MP4Remuxer, which keeps the segment history (isLive: false)
function createRemuxingDemuxer(globals, events) {
    const load = loadSource(globals);
    const TSDemuxer = load('demux/ts-demuxer.ts').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    const remuxer = new MP4Remuxer({ isLive: false });
    demuxer.has_audio_ = true;
    demuxer.onMediaInfo = () => {};

    let container = null;
    remuxer.onInitSegment = (type, initSegment) => {
        container = initSegment.container;
        events.push(`init ${container}`);
    };
    remuxer.onMediaSegment = (type, segment) => {
        const info = segment.info;
        if (container === 'audio/mp4') {
            const moof = readMoof(segment.data);
            assert.equal(moof.decodeTime, info.beginDts);
            assert.ok(moof.sampleDurations.every(duration => duration > 0), 'sample durations must not be zero');
            assert.equal(moof.sampleDurations.reduce((sum, duration) => sum + duration, 0), info.endDts - info.beginDts);
        }
        events.push({
            count: segment.sampleCount,
            beginDts: info.beginDts,
            endDts: info.endDts,
            lastDuration: info.lastSample.duration
        });
    };
    remuxer.bindDataSource(demuxer);

    return { demuxer, remuxer };
}

for (const { label, globals, container } of [
    { label: 'fMP4 (Firefox)', globals: { navigator: { userAgent: FIREFOX } }, container: 'audio/mp4' },
    { label: 'audio/mpeg', globals: {}, container: 'audio/mpeg' }
]) {
    test(`TS MPEG audio keeps valid durations when metadata changes right after a remux, ${label}`, () => {
        const events = [];
        const { demuxer, remuxer } = createRemuxingDemuxer(globals, events);

        // 7 frames per PES, like the default audio PES size of FFmpeg's MPEG-TS muxer.
        // Frame n starts at n * 26.12 ms: the last stereo frame (n = 20) at 522.4 ms, and
        // the first mono frame at 548.6 ms, relative to the first frame.
        const pes = (frame) => concatBytes(frame, frame, frame, frame, frame, frame, frame);
        const pesPts = (index) => 90000 + Math.round(index * 7 * 1152 * 90000 / 44100);

        for (let i = 0; i < 3; i++) {
            demuxer.parseMP3Payload(pes(original), pesPts(i));
        }
        // A normal remux keeps the last stereo frame stashed in the remuxer,
        demuxer.dispatchAudioVideoMediaSegment();
        // so the metadata change has to flush that frame alone.
        demuxer.parseMP3Payload(pes(mono), pesPts(3));
        demuxer.parseMP3Payload(pes(mono), pesPts(4));
        demuxer.dispatchAudioVideoMediaSegment();
        // The end of stream flushes the last mono frame alone as well.
        remuxer.flushStashedSamples();

        assert.deepEqual(events, [
            `init ${container}`,
            { count: 20, beginDts: 0, endDts: 522, lastDuration: 26 },
            { count: 1, beginDts: 522, endDts: 548, lastDuration: 26 },
            `init ${container}`,
            { count: 13, beginDts: 548, endDts: 888, lastDuration: 26 },
            { count: 1, beginDts: 888, endDts: 914, lastDuration: 26 }
        ]);
    });
}

test('TS MPEG audio keeps a valid duration for a single queued frame flushed by a metadata change', () => {
    const events = [];
    const { demuxer } = createRemuxingDemuxer({ navigator: { userAgent: FIREFOX } }, events);

    demuxer.parseMP3Payload(original, 90000);
    // A remux leaves a single frame queued in the demuxer
    demuxer.dispatchAudioVideoMediaSegment();
    demuxer.parseMP3Payload(mono, 92351);

    assert.deepEqual(events, [
        'init audio/mp4',
        { count: 1, beginDts: 0, endDts: 26, lastDuration: 26 },
        'init audio/mp4'
    ]);
});
