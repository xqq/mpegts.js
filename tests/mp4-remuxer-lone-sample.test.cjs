const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { readMoof } = require('./helpers/mp4.cjs');

// A real MP4Remuxer fed with video samples directly
function createRemuxer(isLive, refSampleDuration) {
    const MP4Remuxer = loadSource()('remux/mp4-remuxer.js').default;
    const remuxer = new MP4Remuxer({ isLive });
    // Set directly: dispatching it would need a real codec configuration for the init segment
    remuxer._videoMeta = { type: 'video', timescale: 1000, refSampleDuration };

    const segments = [];
    remuxer.onMediaSegment = (type, segment) => {
        const info = segment.info;
        const moof = readMoof(segment.data);
        assert.equal(moof.decodeTime, info.beginDts);
        segments.push({
            count: segment.sampleCount,
            beginDts: info.beginDts,
            endDts: info.endDts,
            durations: moof.sampleDurations
        });
    };

    const track = { type: 'video', id: 1, sequenceNumber: 0, samples: [], length: 0 };
    const queue = (...dtsList) => {
        for (const dts of dtsList) {
            track.samples.push({ units: [{ data: new Uint8Array(4) }], length: 4, isKeyframe: true, dts, pts: dts, cts: 0 });
            track.length += 4;
        }
    };

    return { remuxer, track, queue, segments };
}

// What TSDemuxer used to dispatch without timing info for H.264, AV1 and H.265
for (const { label, refSampleDuration } of [
    { label: 'NaN', refSampleDuration: NaN },
    { label: 'Infinity', refSampleDuration: Infinity },
    { label: '1000 ms', refSampleDuration: 1000 }
]) {
    for (const isLive of [true, false]) {
        test(`MP4Remuxer gives a lone video sample the last remuxed duration, refSampleDuration ${label}, ${isLive ? 'live' : 'VOD'}`, () => {
            const { remuxer, track, queue, segments } = createRemuxer(isLive, refSampleDuration);

            // 25 fps: a normal remux keeps the frame at 80 ms stashed,
            queue(0, 40, 80);
            remuxer.remux(null, track);
            // which a forced flush (e.g. before a new init segment) then remuxes alone.
            remuxer.remux(null, track, true);
            queue(120, 160, 200);
            remuxer.remux(null, track);
            // The end of stream flushes the frame at 200 ms alone as well.
            remuxer.flushStashedSamples();

            assert.deepEqual(segments, [
                { count: 2, beginDts: 0, endDts: 80, durations: [40, 40] },
                { count: 1, beginDts: 80, endDts: 120, durations: [40] },
                { count: 2, beginDts: 120, endDts: 200, durations: [40, 40] },
                { count: 1, beginDts: 200, endDts: 240, durations: [40] }
            ]);
        });
    }
}

test('MP4Remuxer uses refSampleDuration for a lone video sample when nothing was remuxed yet', () => {
    const { remuxer, track, queue, segments } = createRemuxer(false, 1000 * (1000 / 23976));

    // e.g. a metadata change right after the first frame
    queue(0);
    remuxer.remux(null, track, true);
    queue(40, 80, 120);
    remuxer.remux(null, track);
    remuxer.flushStashedSamples();

    assert.deepEqual(segments, [
        { count: 1, beginDts: 0, endDts: 41, durations: [41] },
        { count: 2, beginDts: 41, endDts: 121, durations: [40, 40] },
        { count: 1, beginDts: 121, endDts: 161, durations: [40] }
    ]);
});
