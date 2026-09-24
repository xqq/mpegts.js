// Builds an AC-3 or E-AC-3 frame from the first bytes of its header. Tests pass the frame
// length worked out by hand from the header (A/52 Table 5.18 for AC-3, frmsiz for E-AC-3)
// instead of computing it, so the parser's own arithmetic is what gets checked. The parsers
// do not check CRCs, and the zero-filled body can never be mistaken for a syncword.
function ac3Frame(header, frameLength) {
    const frame = new Uint8Array(frameLength);
    frame.set(header, 0);
    return frame;
}

// Unless stated otherwise, the headers below are the first bytes of real encoder output of
// ffmpeg 9.0.1 for `-f lavfi -i sine=frequency=1000:sample_rate=<rate> -ac 2 -c:a ac3 -b:a 96k`
// (or `-c:a eac3`): stereo (acmod 2) without LFE, 1536 samples per frame.

const ac3 = {
    // crc1, then fscod 1 (44.1 kHz) and frmsizecod 12: 208 words; bsid 8
    frame44100: ac3Frame([0x0b, 0x77, 0xf2, 0x89, 0x4c, 0x40, 0x43, 0xe1], 416),
    // crc1, then fscod 2 (32 kHz) and frmsizecod 12: 288 words; bsid 8
    frame32000: ac3Frame([0x0b, 0x77, 0x21, 0xcb, 0x8c, 0x40, 0x43, 0xe1], 576)
};

const eac3 = {
    // frmsiz 207: 208 words, then fscod 1 (44.1 kHz) and numblkscod 3 (6 blocks); bsid 16
    frame44100: ac3Frame([0x0b, 0x77, 0x00, 0xcf, 0x74, 0x87, 0xc0, 0x00], 416),
    // frmsiz 287: 288 words, then fscod 2 (32 kHz) and numblkscod 3 (6 blocks); bsid 16
    frame32000: ac3Frame([0x0b, 0x77, 0x01, 0x1f, 0xb4, 0x87, 0xc0, 0x00], 576),
    // Hand-built, as ffmpeg does not encode reduced sample rates: the 32 kHz header with fscod 3
    // and fscod2 1 (22.05 kHz), which always means 6 blocks. FFmpeg's AC-3 parser reads 22050 Hz
    // and 1536 samples from the ffmpeg 32 kHz stream patched that way, CRCs fixed up.
    frame22050: ac3Frame([0x0b, 0x77, 0x01, 0x1f, 0xd4, 0x87, 0xc0, 0x00], 576),

    // The 44.1 kHz header with byte 4 edited: fscod (2), numblkscod or fscod2 (2), acmod (3), lfeon (1).
    // acmod 1 (1/0, mono), as ffmpeg writes it for -ac 1
    frame44100Mono: ac3Frame([0x0b, 0x77, 0x00, 0xcf, 0x72, 0x87, 0xc0, 0x00], 416),
    // lfeon 1 (2/0 and LFE, 2.1), as ffmpeg writes it for -af aformat=channel_layouts=2.1
    frame44100Lfe: ac3Frame([0x0b, 0x77, 0x00, 0xcf, 0x75, 0x87, 0xc0, 0x00], 416),
    // acmod 7 and lfeon 1 (3/2 and LFE, 5.1), as ffmpeg writes it for -af aformat=channel_layouts=5.1
    frame44100Surround: ac3Frame([0x0b, 0x77, 0x00, 0xcf, 0x7f, 0x87, 0xc0, 0x00], 416),
    // Hand-built: numblkscod 0 (1 block, 256 samples). ffmpeg only codes fewer than 6 blocks above
    // 940.8 kbit/s at 44.1 kHz, in larger frames (the same byte 4 for -b:a 3072k). FFmpeg's AC-3
    // parser reads 44100 Hz and 256 samples from the ffmpeg stream patched that way, CRCs fixed up.
    frame44100OneBlock: ac3Frame([0x0b, 0x77, 0x00, 0xcf, 0x44, 0x87, 0xc0, 0x00], 416),

    // Other fields of the 44.1 kHz header edited.
    // Hand-built, as encoders write bsid 16: bsid 15 in byte 5, which FFmpeg's AC-3 parser and
    // decoder still take for E-AC-3 (bsid 11 to 16) in the ffmpeg stream patched that way, CRCs
    // fixed up.
    frame44100Bsid15: ac3Frame([0x0b, 0x77, 0x00, 0xcf, 0x74, 0x7f, 0xc0, 0x00], 416),
    // Hand-built: strmtyp 1 in byte 2, a dependent substream (2/0), like the one that extends an
    // independent 5.1 substream to 7.1. FFmpeg's AC-3 parser joins each frame of the ffmpeg stream
    // patched that way to the 5.1 frame before it, in packets of 1536 samples, CRCs fixed up.
    frame44100Dependent: ac3Frame([0x0b, 0x77, 0x40, 0xcf, 0x74, 0x87, 0xc0, 0x00], 416),
    // -b:a 192k: frmsiz 416, 417 words
    frame44100At192k: ac3Frame([0x0b, 0x77, 0x01, 0xa0, 0x74, 0x87, 0xc0, 0x00], 834)
};

module.exports = { ac3Frame, ac3, eac3 };
