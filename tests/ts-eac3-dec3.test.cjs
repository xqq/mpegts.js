const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { eac3 } = require('./helpers/ac3.cjs');

// Returns the config TSDemuxer dispatches for an E-AC-3 frame, which MP4Remuxer writes as the
// payload of the dec3 box
function dispatchDec3(frame) {
    const TSDemuxer = loadSource()('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, {});
    demuxer.has_audio_ = true;
    demuxer.onMediaInfo = () => {};
    demuxer.onDataAvailable = () => {};

    const configs = [];
    demuxer.onTrackMetadata = (type, meta) => {
        // Copy into an array of this realm, the demuxer runs in its own vm context
        configs.push(Array.from(meta.config));
    };
    demuxer.parseEAC3Payload(frame, 90000);

    assert.equal(configs.length, 1);
    return configs[0];
}

// EC3SpecificBox (ETSI TS 102 366 Annex F): data_rate in kbit/s (13 bits), num_ind_sub (3),
// then for the one independent substream fscod (2), bsid (5), reserved (1), asvc (1),
// bsmod (3), acmod (3), lfeon (1), reserved (3), num_dep_sub (4) and reserved (1)
for (const { label, frame, dec3 } of [
    // FFmpeg's dec3 for the same ffmpeg streams: 96 kbit/s, fscod 1 or 2, bsid 16, acmod 2.
    // The data rate used to be twice the bit rate in bit/s, packed without parentheses:
    // 7c 78 60 04 00 and 00 00 a0 04 00.
    { label: '44.1 kHz', frame: eac3.frame44100, dec3: [0x03, 0x00, 0x60, 0x04, 0x00] },
    { label: '32 kHz', frame: eac3.frame32000, dec3: [0x03, 0x00, 0xa0, 0x04, 0x00] },
    // By hand, as FFmpeg cannot decode, and so will not mux, E-AC-3 at reduced sample rates:
    // 66 kbit/s and fscod 3. fscod used to be fscod2 instead: cc c8 60 04 00.
    { label: '22.05 kHz (reduced sample rate)', frame: eac3.frame22050, dec3: [0x02, 0x10, 0xe0, 0x04, 0x00] }
]) {
    test(`TS E-AC-3 dec3 has the data rate in kbit/s and the fscod of the bitstream, ${label}`, () => {
        assert.deepEqual(dispatchDec3(frame), dec3);
    });
}
