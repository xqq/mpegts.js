import Log from "../utils/logger";
import ExpGolomb from "./exp-golomb";
import { MPEG4AudioObjectTypes, MPEG4SamplingFrequencies, MPEG4SamplingFrequencyIndex } from "./mpeg4-audio";

export class AC3Frame {
    sampling_frequency: number;
    sampling_rate_code: number;
    bit_stream_identification: number;
    bit_stream_mode: number;
    low_frequency_effects_channel_on: number;
    frame_size_code: number;
    channel_count: number;
    channel_mode: number;

    data: Uint8Array;
}

const frame_size_code_table = [
    [
         64,  64,   80,   80,   96,   96,  112,  112, 128, 128,
        160, 160,  192,  192,  224,  224,  256,  256, 320, 320,
        384, 384,  448,  448,  512,  512,  640,  640, 768, 768,
        896, 896, 1024, 1024, 1152, 1152, 1280, 1280,
    ],
    [
         69,  70,   87,   88,  104,  105,  121,  122, 139, 140,
        174, 175,  208,  209,  243,  244,  278,  279, 348, 349,
        417, 418,  487,  488,  557,  558,  696,  697, 835, 836,
        975, 976, 1114, 1115, 1253, 1254, 1393, 1394
    ],
    [
          96,   96,  120,  120,  144,  144,  168,  168,  192,  192,
         240,  240,  288,  288,  336,  336,  384,  384,  480,  480,
         576,  576,  672,  672,  768,  768,  960,  960, 1152, 1152,
        1344, 1344, 1536, 1536, 1728, 1728, 1920, 1920,
    ],
]

export class AC3Parser {

    private readonly TAG: string = "AC3Parser";

    private data_: Uint8Array;
    private current_syncword_offset_: number;
    private eof_flag_: boolean;
    private has_last_incomplete_data: boolean;

    public constructor(data: Uint8Array) {
        this.data_ = data;
        this.current_syncword_offset_ = this.findNextSyncwordOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, `Could not found AC3 syncword until payload end`);
        }
    }

    private findNextSyncwordOffset(syncword_offset: number): number {
        let i = syncword_offset;
        let data = this.data_;

        while (true) {
            if (i + 7 >= data.byteLength) {
                this.eof_flag_ = true;
                return data.byteLength;
            }

            // search 16-bit 0x0B77 syncword
            let syncword = (data[i + 0] << 8) | (data[i + 1] << 0)
            if (syncword === 0x0B77) {
                return i;
            } else {
                i++;
            }
        }
    }

    public readNextAC3Frame(): AC3Frame | null {
        let data = this.data_;
        let ac3_frame: AC3Frame = null;

        while (ac3_frame == null) {
            if (this.eof_flag_) {
                break;
            }

            let syncword_offset = this.current_syncword_offset_;
            let offset = syncword_offset;

            let sampling_rate_code = data[offset + 4] >> 6;
            let sampling_frequency = [48000, 44200, 33000][sampling_rate_code];

            let frame_size_code = data[offset + 4] & 0x3F;
            let frame_size = frame_size_code_table[sampling_rate_code][frame_size_code] * 2;

            if (offset + frame_size > this.data_.byteLength) {
                // data not enough for extracting last sample
                this.eof_flag_ = true;
                this.has_last_incomplete_data = true;
                break;
            }

            let next_syncword_offset = this.findNextSyncwordOffset(offset + frame_size);
            this.current_syncword_offset_ = next_syncword_offset;

            let bit_stream_identification = data[offset + 5] >> 3;
            let bit_stream_mode = data[offset + 5] & 0x07;

            let channel_mode = data[offset + 6] >> 5;

            let lfe_skip = 0;
            if ((channel_mode & 0x01) !== 0 && channel_mode !== 1) { lfe_skip += 2; }
            if ((channel_mode & 0x04) !== 0) { lfe_skip += 2; }
            if (channel_mode === 0x02) { lfe_skip += 2; }

            let low_frequency_effects_channel_on = (((data[offset + 6] << 8) | (data[offset + 7] << 0)) >> (12 - lfe_skip)) & 0x01;

            let channel_count = [2, 1, 2, 3, 3, 4, 4, 5][channel_mode] + low_frequency_effects_channel_on;

            ac3_frame = new AC3Frame();
            ac3_frame.sampling_frequency = sampling_frequency;
            ac3_frame.channel_count = channel_count;
            ac3_frame.channel_mode = channel_mode;
            ac3_frame.bit_stream_identification = bit_stream_identification;
            ac3_frame.low_frequency_effects_channel_on = low_frequency_effects_channel_on;
            ac3_frame.bit_stream_mode = bit_stream_mode;
            ac3_frame.frame_size_code = frame_size_code;
            ac3_frame.data = data.subarray(offset, offset + frame_size);
        }

        return ac3_frame;
    }

    public hasIncompleteData(): boolean {
        return this.has_last_incomplete_data;
    }

    public getIncompleteData(): Uint8Array {
        if (!this.has_last_incomplete_data) {
            return null;
        }

        return this.data_.subarray(this.current_syncword_offset_);
    }
}


export class AC3Config {

    public config: Array<number>;
    public sampling_rate: number;
    public bit_stream_identification: number;
    public bit_stream_mode: number;
    public low_frequency_effects_channel_on: number;
    public channel_count: number;
    public channel_mode: number;
    public codec_mimetype: string;
    public original_codec_mimetype: string;

    public constructor(frame: AC3Frame) {
        let config: Array<number> = null;

        config = [
            (frame.sampling_rate_code << 6) | (frame.bit_stream_identification << 1) | (frame.bit_stream_mode >> 2),
            ((frame.bit_stream_mode & 0x03) << 6) | (frame.channel_mode << 3) | (frame.low_frequency_effects_channel_on << 2) | (frame.frame_size_code >> 4),
            (frame.frame_size_code  << 4) & 0xE0,
        ]

        this.config = config;
        this.sampling_rate = frame.sampling_frequency;
        this.bit_stream_identification = frame.bit_stream_identification;
        this.bit_stream_mode = frame.bit_stream_mode;
        this.low_frequency_effects_channel_on = frame.low_frequency_effects_channel_on;
        this.channel_count = frame.channel_count;
        this.channel_mode = frame.channel_mode;
        this.codec_mimetype = 'ac-3';
        this.original_codec_mimetype = 'ac-3';
    }
}
