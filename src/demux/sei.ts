
export class SEIData {
    type: number;
    size: number;
    uuid: Uint8Array;
    user_data: Uint8Array;
    pts?: number;
}

function ebsp2rbsp(uint8array: Uint8Array): Uint8Array {
    let src = uint8array;
    let src_length = src.byteLength;
    let dst = new Uint8Array(src_length);
    let dst_idx = 0;

    for (let i = 0; i < src_length; i++) {
        if (i >= 2) {
            // Unescape: Skip 0x03 after 00 00
            if (src[i] === 0x03 && src[i - 1] === 0x00 && src[i - 2] === 0x00) {
                continue;
            }
        }
        dst[dst_idx] = src[i];
        dst_idx++;
    }

    return new Uint8Array(dst.buffer, 0, dst_idx);
}

export function parseSEI(data: Uint8Array, pts?: number, codec?: 'h264' | 'h265'): SEIData | null {
    if (!data || data.byteLength < 2) {
        return null;
    }

    // Determine NALU header size based on codec
    let naluHeaderSize = 1;  // Default for H.264
    if (codec === 'h265') {
        naluHeaderSize = 2;
    }

    // Convert EBSP to RBSP (skip NALU header)
    let rbsp_data = ebsp2rbsp(data.subarray(naluHeaderSize));
    let offset = 0;

    // Check for trailing bits (0x80)
    if (offset === rbsp_data.byteLength - 1 && rbsp_data[offset] === 0x80) {
        return null;
    }

    // Parse payload type (can be multiple bytes for extended types)
    let payloadType = 0;
    while (offset < rbsp_data.byteLength && rbsp_data[offset] === 0xFF) {
        payloadType += 255;
        offset++;
    }
    if (offset >= rbsp_data.byteLength) {
        return null;
    }
    payloadType += rbsp_data[offset++];

    // Parse payload size (can be multiple bytes for extended sizes)
    let payloadSize = 0;
    while (offset < rbsp_data.byteLength && rbsp_data[offset] === 0xFF) {
        payloadSize += 255;
        offset++;
    }
    if (offset >= rbsp_data.byteLength) {
        return null;
    }
    payloadSize += rbsp_data[offset++];

    // Check if we have enough data
    if (offset + payloadSize > rbsp_data.byteLength) {
        return null;
    }

    let sei_data = new SEIData();
    sei_data.type = payloadType;
    sei_data.size = payloadSize;

    // Extract payload
    let payload = rbsp_data.subarray(offset, offset + payloadSize);

    // SEI payload type 5 is user_data_unregistered (with UUID)
    // This is the same for both H.264 and H.265
    if (payloadType === 5 && payloadSize >= 16) {
        // First 16 bytes are UUID
        sei_data.uuid = payload.subarray(0, 16);
        sei_data.user_data = payload.subarray(16);
    } else {
        // ignore
    }

    if (pts !== undefined) {
        sei_data.pts = pts;
    }

    return sei_data;
}
