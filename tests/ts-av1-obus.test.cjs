const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { av1InTs, av1 } = require('./helpers/video.cjs');

const toHex = (bytes) => Buffer.from(bytes).toString('hex');

const METADATA = { type: 'video', codec: 'av01.0.00M.08', width: 64, height: 64 };

function createDemuxer(events) {
    const TSDemuxer = loadSource()('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_video_ = true;
    demuxer.onMediaInfo = () => {};
    demuxer.onTrackMetadata = (type, metadata) => {
        events.push({ type, codec: metadata.codec, width: metadata.codecWidth, height: metadata.codecHeight });
    };
    // Only forced flushes, before new codec metadata
    demuxer.onDataAvailable = (audioTrack, videoTrack, force) => {
        assert.equal(audioTrack, null);
        assert.equal(force, true);
        events.push({ type: 'flush', samples: samplesOf(videoTrack) });
        videoTrack.samples = [];
        videoTrack.length = 0;
    };
    // Set from the AV1 video descriptor of the PMT
    demuxer.video_metadata_.av1c = av1.configRecord;
    return demuxer;
}

// Feeds the OBUs of one temporal unit per PES at 29.97 fps, in 90 kHz timestamps
function temporalUnitFeeder(demuxer) {
    let index = 0;
    return (...obus) => {
        const timestamp = 90000 + 3003 * index++;
        demuxer.parseAV1Payload(av1InTs(...obus), timestamp, timestamp, 0, 0);
    };
}

// The OBUs (as hex) and key frame flag of each sample of a track, copied into arrays of this
// realm: the demuxer runs in its own vm context
function samplesOf(track) {
    return Array.from(track.samples, sample => ({
        obus: Array.from(sample.units, unit => toHex(unit.data)),
        isKeyframe: sample.isKeyframe
    }));
}

function queuedSamples(demuxer) {
    return samplesOf(demuxer.video_track_);
}

test('TS AV1 skips the temporal delimiter before the first sequence header', () => {
    const events = [];
    const demuxer = createDemuxer(events);

    // Used to throw a TypeError: parseOBUs() returns undefined without a sequence header
    demuxer.parseAV1Payload(av1InTs(av1.temporalDelimiter, av1.sequenceHeader, av1.keyFrame), 90000, 90000, 0, 1);

    assert.deepEqual(events, [METADATA]);
    // The key frame sample keeps its sequence header, as an AV1 sync sample requires
    assert.deepEqual(queuedSamples(demuxer), [
        { obus: [av1.sequenceHeader, av1.keyFrame].map(toHex), isKeyframe: true }
    ]);
});

test('TS AV1 dispatches the size of a key frame of testsrc2', () => {
    const events = [];
    const demuxer = createDemuxer(events);

    // Used to throw an InvalidArgumentException in the frame header parser
    demuxer.parseAV1Payload(av1InTs(av1.temporalDelimiter, av1.sequenceHeader, av1.testsrc2KeyFrame), 90000, 90000, 0, 1);

    assert.deepEqual(events, [METADATA]);
    assert.deepEqual(queuedSamples(demuxer), [
        { obus: [av1.sequenceHeader, av1.testsrc2KeyFrame].map(toHex), isKeyframe: true }
    ]);
});

for (const { label, obus } of [
    {
        // Used to throw an IllegalStateException in the sequence header parser
        label: 'with a decoder model',
        obus: [av1.decoderModelSequenceHeader, av1.decoderModelKeyFrame]
    },
    {
        // Used to throw an IllegalStateException in the frame header parser: idLen was NaN
        label: 'with frame ids',
        obus: [av1.frameIdSequenceHeader, av1.frameIdKeyFrame]
    }
]) {
    test(`TS AV1 dispatches the size of a key frame of libaom ${label}`, () => {
        const events = [];
        const demuxer = createDemuxer(events);

        demuxer.parseAV1Payload(av1InTs(av1.temporalDelimiter, ...obus), 90000, 90000, 0, 1);

        // Resized: coded at 32x32
        assert.deepEqual(events, [{ type: 'video', codec: 'av01.0.00M.08', width: 32, height: 32 }]);
        assert.deepEqual(queuedSamples(demuxer), [{ obus: obus.map(toHex), isKeyframe: true }]);
    });
}

test('TS AV1 queues no sample before the first key frame when joining a stream between key frames', () => {
    const events = [];
    const demuxer = createDemuxer(events);
    const feed = temporalUnitFeeder(demuxer);

    // Nothing can be parsed before the first sequence header (this used to throw a TypeError),
    feed(av1.temporalDelimiter, av1.hiddenInterFrame, av1.interFrame);
    feed(av1.temporalDelimiter, av1.showExistingFrame);
    // and inter frames after one still have to wait for the key frame, which dispatches the init segment
    feed(av1.temporalDelimiter, av1.sequenceHeader, av1.interFrame);
    feed(av1.temporalDelimiter, av1.interFrame);
    assert.deepEqual(events, []);
    assert.deepEqual(queuedSamples(demuxer), []);

    feed(av1.temporalDelimiter, av1.sequenceHeader, av1.keyFrame);
    feed(av1.temporalDelimiter, av1.interFrame);

    assert.deepEqual(events, [METADATA]);
    assert.deepEqual(queuedSamples(demuxer), [
        { obus: [av1.temporalDelimiter, av1.sequenceHeader, av1.keyFrame].map(toHex), isKeyframe: true },
        { obus: [av1.temporalDelimiter, av1.interFrame].map(toHex), isKeyframe: false }
    ]);
});

// The temporal units of SVT-AV1 with its default prediction structure (random access): a key frame,
// a hidden and a shown inter frame, a frame header showing the hidden frame, an inter frame
const TEMPORAL_UNITS = [
    [av1.sequenceHeader, av1.keyFrame],
    [av1.hiddenInterFrame, av1.interFrame],
    [av1.showExistingFrame],
    [av1.interFrame],
    [av1.sequenceHeader, av1.keyFrame]
];

for (const { label, temporalUnit } of [
    { label: 'with temporal delimiters', temporalUnit: obus => [av1.temporalDelimiter, ...obus] },
    // The carriage of AV1 in MPEG-2 TS lets muxers remove temporal delimiters
    { label: 'without temporal delimiters', temporalUnit: obus => obus }
]) {
    test(`TS AV1 flags only samples with a key frame as keyframes, ${label}`, () => {
        const events = [];
        const demuxer = createDemuxer(events);
        const feed = temporalUnitFeeder(demuxer);

        // Only frame headers set the key frame flag, the temporal delimiter after a key frame must not keep it
        for (const obus of TEMPORAL_UNITS) {
            feed(...temporalUnit(obus));
        }

        assert.deepEqual(events, [METADATA]);
        assert.deepEqual(queuedSamples(demuxer).map(sample => sample.isKeyframe), [true, false, false, false, true]);
    });
}

test('TS AV1 does not flag a frame header with show_existing_frame right after a key frame as a keyframe', () => {
    const demuxer = createDemuxer([]);
    const feed = temporalUnitFeeder(demuxer);

    feed(av1.sequenceHeader, av1.keyFrame);
    // Such a frame header has no frame type: it used to keep the flag of the key frame
    feed(av1.showExistingFrame);
    feed(av1.interFrame);

    assert.deepEqual(queuedSamples(demuxer).map(sample => sample.isKeyframe), [true, false, false]);
});

for (const { label, obus, metadata } of [
    {
        // Used to go unnoticed: stored with the new sequence header, the details were compared with themselves
        label: 'with a new sequence header',
        obus: [av1.sequenceHeader128x96, av1.keyFrame128x96],
        metadata: { type: 'video', codec: 'av01.0.00M.08', width: 128, height: 96 }
    },
    {
        // The parser updates the details of the sequence header in place: the dispatched ones must be a copy
        label: 'without a new sequence header',
        obus: [av1.frameSizeKeyFrameHeader],
        metadata: { type: 'video', codec: 'av01.0.00M.08', width: 48, height: 32 }
    }
]) {
    test(`TS AV1 flushes and dispatches new metadata when a key frame changes the resolution, ${label}`, () => {
        const events = [];
        const demuxer = createDemuxer(events);
        const feed = temporalUnitFeeder(demuxer);

        feed(av1.temporalDelimiter, av1.sequenceHeader, av1.keyFrame);
        feed(av1.temporalDelimiter, av1.interFrame);
        feed(av1.temporalDelimiter, ...obus);

        assert.deepEqual(events, [
            METADATA,
            {
                type: 'flush',
                samples: [
                    { obus: [av1.sequenceHeader, av1.keyFrame].map(toHex), isKeyframe: true },
                    { obus: [av1.temporalDelimiter, av1.interFrame].map(toHex), isKeyframe: false }
                ]
            },
            metadata
        ]);
        assert.deepEqual(queuedSamples(demuxer), [
            { obus: [av1.temporalDelimiter, ...obus].map(toHex), isKeyframe: true }
        ]);
    });
}
