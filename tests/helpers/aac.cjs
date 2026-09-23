const { concatBytes } = require('./bytes.cjs');

// Builds an ADTS frame of AAC-LC, 44.1 kHz stereo without CRC. The first byte of the
// zero-filled payload is a marker, so that tests can tell frames apart.
function adtsFrame(marker, frameLength = 200) {
    const frame = new Uint8Array(frameLength);
    frame.set([
        0xff, 0xf1,                            // syncword, MPEG-4, layer 0, protection absent
        0x50,                                  // AAC-LC, 44.1 kHz, channel configuration 2 (high bit)
        0x80 | ((frameLength >>> 11) & 0x03),  // channel configuration 2 (low bits), frame length
        (frameLength >>> 3) & 0xff,
        ((frameLength & 0x07) << 5) | 0x1f,    // frame length, buffer fullness 0x7FF
        0xfc                                   // buffer fullness, one raw data block
    ]);
    frame[7] = marker;
    return frame;
}

// Writes values bit by bit, most significant bit first
class BitWriter {
    constructor() {
        this.bits = [];
    }

    write(value, bitCount) {
        for (let i = bitCount - 1; i >= 0; i--) {
            this.bits.push((value >>> i) & 1);
        }
    }

    toBytes() {
        const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
        this.bits.forEach((bit, i) => {
            bytes[i >> 3] |= bit << (7 - (i & 7));
        });
        return bytes;
    }
}

// Builds a LOAS AudioSyncStream frame of AAC-LC, 44.1 kHz stereo. The first frame of a
// stream carries the StreamMuxConfig, later frames reuse it. The first payload byte is a marker.
function loasFrame(marker, withStreamMuxConfig, payloadLength = 150) {
    const writer = new BitWriter();
    writer.write(withStreamMuxConfig ? 0 : 1, 1);  // useSameStreamMux
    if (withStreamMuxConfig) {
        writer.write(0, 1);     // audioMuxVersion
        writer.write(1, 1);     // allStreamsSameTimeFraming
        writer.write(0, 6);     // numSubFrames
        writer.write(0, 4);     // numProgram
        writer.write(0, 3);     // numLayer
        writer.write(2, 5);     // AudioSpecificConfig: audioObjectType AAC-LC
        writer.write(4, 4);     // samplingFrequencyIndex: 44.1 kHz
        writer.write(2, 4);     // channelConfiguration
        writer.write(0, 3);     // GASpecificConfig
        writer.write(0, 3);     // frameLengthType
        writer.write(0xff, 8);  // latmBufferFullness
        writer.write(0, 1);     // otherDataPresent
        writer.write(0, 1);     // crcCheckPresent
    }
    writer.write(payloadLength, 8);  // PayloadLengthInfo
    writer.write(marker, 8);         // PayloadMux
    for (let i = 1; i < payloadLength; i++) {
        writer.write(0, 8);
    }

    const audioMuxElement = writer.toBytes();
    // syncword 0x2B7 (11 bits) and audioMuxLengthBytes (13 bits)
    const header = Uint8Array.of(0x56, 0xe0 | (audioMuxElement.byteLength >>> 8), audioMuxElement.byteLength & 0xff);
    return concatBytes(header, audioMuxElement);
}

module.exports = { adtsFrame, loasFrame };
