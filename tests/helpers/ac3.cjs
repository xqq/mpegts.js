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
    frame22050: ac3Frame([0x0b, 0x77, 0x01, 0x1f, 0xd4, 0x87, 0xc0, 0x00], 576)
};

module.exports = { ac3Frame, ac3, eac3 };
