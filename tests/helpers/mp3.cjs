const { concatBytes } = require('./bytes.cjs');

// Builds an MPEG audio frame from its 4-byte header. Tests pass the frame length taken from
// the specification instead of computing it, so the parser's own arithmetic is what gets
// checked. The zero-filled body can never be mistaken for a frame header.
function mp3Frame(header, frameLength) {
    const frame = new Uint8Array(frameLength);
    frame.set(header, 0);
    return frame;
}

module.exports = { mp3Frame, concatBytes };
