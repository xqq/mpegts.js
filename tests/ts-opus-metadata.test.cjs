const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');

function opusPMT(version, channels) {
    // Program 1, PID 256, Opus registration and channel configuration descriptors.
    // The PMT parser does not validate the trailing CRC bytes.
    return Uint8Array.of(
        0x02, 0xb0, 0x1c, 0, 1, 0xc1 | (version << 1), 0, 0,
        0xe1, 0x00, 0xf0, 0,
        0x06, 0xe1, 0x00, 0xf0, 0x0a,
        0x05, 0x04, 0x4f, 0x70, 0x75, 0x73,
        0x7f, 0x02, 0x80, channels,
        0, 0, 0, 0
    );
}

test('Opus metadata changes before the first PES preserve timestamp initialization', () => {
    const load = loadSource();
    const TSDemuxer = load('demux/ts-demuxer.ts').default;
    const MP4Remuxer = load('remux/mp4-remuxer.js').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    const remuxer = new MP4Remuxer({});
    demuxer.current_program_ = 1;
    demuxer.onMediaInfo = () => {};

    const events = [];
    remuxer.onInitSegment = (type) => {
        assert.equal(type, 'audio');
        events.push({ type: 'init' });
    };
    remuxer.onMediaSegment = (type, segment) => {
        assert.equal(type, 'audio');
        events.push({
            type: 'media',
            count: segment.sampleCount,
            beginDts: segment.info.beginDts,
            endDts: segment.info.endDts
        });
    };
    remuxer.bindDataSource(demuxer);

    demuxer.parsePMT(opusPMT(0, 2));
    demuxer.parsePMT(opusPMT(1, 1));
    assert.equal(remuxer.getTimestampBase(), undefined);
    assert.deepEqual(events, [{ type: 'init' }, { type: 'init' }]);

    // Three 20 ms Opus access units, starting at one second (90 kHz PES clock).
    demuxer.parseOpusPayload(Uint8Array.of(
        0x7f, 0xe0, 1, 0xf8,
        0x7f, 0xe0, 1, 0xf8,
        0x7f, 0xe0, 1, 0xf8
    ), 90000);
    demuxer.dispatchAudioVideoMediaSegment();
    assert.equal(remuxer.getTimestampBase(), 1000);
    assert.deepEqual(events[2], { type: 'media', count: 2, beginDts: 0, endDts: 40 });

    // An empty demuxer queue must still flush the remuxer's stashed last sample
    // before the next initialization segment once real samples have arrived.
    assert.equal(demuxer.audio_track_.samples.length, 0);
    demuxer.parsePMT(opusPMT(2, 2));
    assert.equal(remuxer.getTimestampBase(), 1000);
    assert.deepEqual(events.slice(3), [
        { type: 'media', count: 1, beginDts: 40, endDts: 60 },
        { type: 'init' }
    ]);
});
