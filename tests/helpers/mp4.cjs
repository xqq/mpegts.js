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

module.exports = { readMoof };
