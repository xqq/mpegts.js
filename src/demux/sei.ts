import Log from '../utils/logger';

export interface SEIData {
    type: number;
    size: number;
    // Only present for payload type 5 (user_data_unregistered).
    uuid?: Uint8Array;
    // uuid as lowercase 8-4-4-4-12 hex, the same form hls.js reports
    uuid_string?: string;
    user_data?: Uint8Array;
    pts?: number;
}

// The SEI fields of Config. Both can be changed during playback with MSEPlayer.updateSEIConfig().
export interface SEIConfig {
    // false: SEI NAL units are not parsed at all
    enableSEIParsing?: boolean;
    // null: every SEI message is reported.
    // Array: only user_data_unregistered messages whose uuid is listed are reported; [] reports nothing.
    seiUUIDAllowlist?: string[] | null;
}

const UUID_LENGTH = 16;

// Accepts 32 hex digits, with or without dashes, in any case
export function parseUUID(uuid: string): Uint8Array | null {
    if (typeof uuid !== 'string') {
        return null;
    }
    const hex = uuid.replace(/-/g, '');
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
        return null;
    }
    const bytes = new Uint8Array(UUID_LENGTH);
    for (let i = 0; i < UUID_LENGTH; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function formatUUID(data: Uint8Array, offset: number): string {
    let str = '';
    for (let i = 0; i < UUID_LENGTH; i++) {
        const b = data[offset + i];
        str += (b < 16 ? '0' : '') + b.toString(16);
        if (i === 3 || i === 5 || i === 7 || i === 9) {
            str += '-';
        }
    }
    return str;
}

// Returns an error message, or null if the update is valid
export function validateSEIConfig(update: SEIConfig): string | null {
    if (update == null || typeof update !== 'object') {
        return 'SEI config must be an object';
    }
    if (update.enableSEIParsing !== undefined && typeof update.enableSEIParsing !== 'boolean') {
        return 'enableSEIParsing must be a boolean';
    }
    const allowlist = update.seiUUIDAllowlist;
    if (allowlist !== undefined && allowlist !== null) {
        if (!Array.isArray(allowlist)) {
            return 'seiUUIDAllowlist must be an array of uuid strings or null';
        }
        for (const uuid of allowlist) {
            if (parseUUID(uuid) == null) {
                return `seiUUIDAllowlist contains an invalid uuid: ${uuid}`;
            }
        }
    }
    return null;
}

// Copies only the SEI fields present in update into config (undefined leaves a field unchanged)
export function applySEIConfig(config: any, update: SEIConfig): void {
    if (update.enableSEIParsing !== undefined) {
        config.enableSEIParsing = update.enableSEIParsing;
    }
    if (update.seiUUIDAllowlist !== undefined) {
        config.seiUUIDAllowlist = update.seiUUIDAllowlist === null ? null : update.seiUUIDAllowlist.slice();
    }
}

// SEI settings of Config in the form used while demuxing; demuxers rebuild it on every update
export class SEIFilter {

    private readonly TAG: string = 'SEIFilter';

    // false: callers skip SEI NAL units without parsing them
    public readonly active: boolean;
    private readonly allowlist_: Uint8Array[] | null = null;

    public constructor(config?: SEIConfig) {
        const enabled = config == null || config.enableSEIParsing !== false;
        const allowlist = config != null ? config.seiUUIDAllowlist : null;

        if (allowlist != null) {
            this.allowlist_ = [];
            for (const uuid of allowlist) {
                const bytes = parseUUID(uuid);
                if (bytes == null) {
                    Log.w(this.TAG, `Ignored invalid uuid in seiUUIDAllowlist: ${uuid}`);
                } else {
                    this.allowlist_.push(bytes);
                }
            }
        }

        this.active = enabled && (this.allowlist_ == null || this.allowlist_.length > 0);
    }

    public get hasAllowlist(): boolean {
        return this.allowlist_ != null;
    }

    public allowsUUID(data: Uint8Array, offset: number): boolean {
        if (this.allowlist_ == null) {
            return true;
        }
        for (const uuid of this.allowlist_) {
            let i = 0;
            while (i < UUID_LENGTH && data[offset + i] === uuid[i]) {
                i++;
            }
            if (i === UUID_LENGTH) {
                return true;
            }
        }
        return false;
    }
}

// Removes emulation prevention bytes, returning the input itself when it has none
function ebsp2rbsp(src: Uint8Array): Uint8Array {
    const src_length = src.byteLength;
    let epb_found = false;
    for (let i = 2; i < src_length; i++) {
        if (src[i] === 0x03 && src[i - 1] === 0x00 && src[i - 2] === 0x00) {
            epb_found = true;
            break;
        }
    }
    if (!epb_found) {
        return src;
    }

    const dst = new Uint8Array(src_length);
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

// rbsp_trailing_bits: the stop bit, optionally followed by zero bytes
function isTrailingBits(data: Uint8Array, offset: number): boolean {
    if (data[offset] !== 0x80) {
        return false;
    }
    for (let i = offset + 1; i < data.byteLength; i++) {
        if (data[i] !== 0x00) {
            return false;
        }
    }
    return true;
}

// Parses every sei_message() in one SEI NAL unit (including its NALU header), like hls.js
// parseSEIMessageFromNALu. Reported uuid / user_data are copies that do not keep the NAL unit's buffer alive.
export function parseSEIMessages(data: Uint8Array, pts: number | undefined, codec: 'h264' | 'h265',
                                 filter: SEIFilter): SEIData[] {
    const messages: SEIData[] = [];
    const nalu_header_size = codec === 'h265' ? 2 : 1;

    if (!filter.active || !data || data.byteLength <= nalu_header_size) {
        return messages;
    }

    const rbsp = ebsp2rbsp(data.subarray(nalu_header_size));
    const length = rbsp.byteLength;
    let offset = 0;

    while (offset < length && !isTrailingBits(rbsp, offset)) {
        // payloadType and payloadSize use 0xFF continuation bytes
        let payload_type = 0;
        while (offset < length && rbsp[offset] === 0xFF) {
            payload_type += 255;
            offset++;
        }
        if (offset >= length) {
            break;
        }
        payload_type += rbsp[offset++];

        let payload_size = 0;
        while (offset < length && rbsp[offset] === 0xFF) {
            payload_size += 255;
            offset++;
        }
        if (offset >= length) {
            break;
        }
        payload_size += rbsp[offset++];

        if (offset + payload_size > length) {
            Log.w('SEIParser', `Malformed SEI payload: size ${payload_size}, only ${length - offset} bytes left`);
            break;
        }

        const payload_offset = offset;
        offset += payload_size;

        // SEI payload type 5 is user_data_unregistered (with UUID), the same for H.264 and H.265
        const has_uuid = payload_type === 5 && payload_size >= UUID_LENGTH;
        if (filter.hasAllowlist && !(has_uuid && filter.allowsUUID(rbsp, payload_offset))) {
            continue;
        }

        const sei_data: SEIData = {
            type: payload_type,
            size: payload_size,
        };
        if (has_uuid) {
            sei_data.uuid = rbsp.slice(payload_offset, payload_offset + UUID_LENGTH);
            sei_data.uuid_string = formatUUID(rbsp, payload_offset);
            sei_data.user_data = rbsp.slice(payload_offset + UUID_LENGTH, payload_offset + payload_size);
        }
        if (pts !== undefined) {
            sei_data.pts = pts;
        }
        messages.push(sei_data);
    }

    return messages;
}
