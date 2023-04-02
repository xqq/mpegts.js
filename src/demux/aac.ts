import Log from "../utils/logger";
import ExpGolomb from "./exp-golomb";
import { MPEG4AudioObjectTypes, MPEG4SamplingFrequencies, MPEG4SamplingFrequencyIndex } from "./mpeg4-audio";

export class AACFrame {
    audio_object_type: MPEG4AudioObjectTypes;
    sampling_freq_index: MPEG4SamplingFrequencyIndex;
    sampling_frequency: number;
    channel_config: number;

    data: Uint8Array;
}

export class LOASAACFrame extends AACFrame {
    other_data_present: boolean;
}

export class AACADTSParser {

    private readonly TAG: string = "AACADTSParser";

    private data_: Uint8Array;
    private current_syncword_offset_: number;
    private eof_flag_: boolean;
    private has_last_incomplete_data: boolean;

    public constructor(data: Uint8Array) {
        this.data_ = data;
        this.current_syncword_offset_ = this.findNextSyncwordOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, `Could not found ADTS syncword until payload end`);
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

            // search 12-bit 0xFFF syncword
            let syncword = ((data[i + 0] << 8) | data[i + 1]) >>> 4;
            if (syncword === 0xFFF) {
                return i;
            } else {
                i++;
            }
        }
    }

    public readNextAACFrame(): AACFrame | null {
        let data = this.data_;
        let aac_frame: AACFrame = null;

        while (aac_frame == null) {
            if (this.eof_flag_) {
                break;
            }

            let syncword_offset = this.current_syncword_offset_;
            let offset = syncword_offset;

            // adts_fixed_header()
            // syncword 0xFFF: 12-bit
            let ID = (data[offset + 1] & 0x08) >>> 3;
            let layer = (data[offset + 1] & 0x06) >>> 1;
            let protection_absent = data[offset + 1] & 0x01;
            let profile = (data[offset + 2] & 0xC0) >>> 6;
            let sampling_frequency_index = (data[offset + 2] & 0x3C) >>> 2;
            let channel_configuration = ((data[offset + 2] & 0x01) << 2)
                                        | ((data[offset + 3] & 0xC0) >>> 6);

            // adts_variable_header()
            let aac_frame_length = ((data[offset + 3] & 0x03) << 11)
                                    | (data[offset + 4] << 3)
                                    | ((data[offset + 5] & 0xE0) >>> 5);
            let number_of_raw_data_blocks_in_frame = data[offset + 6] & 0x03;

            if (offset + aac_frame_length > this.data_.byteLength) {
                // data not enough for extracting last sample
                this.eof_flag_ = true;
                this.has_last_incomplete_data = true;
                break;
            }

            let adts_header_length = (protection_absent === 1) ? 7 : 9;
            let adts_frame_payload_length = aac_frame_length - adts_header_length;

            offset += adts_header_length;

            let next_syncword_offset = this.findNextSyncwordOffset(offset + adts_frame_payload_length);
            this.current_syncword_offset_ = next_syncword_offset;

            if ((ID !== 0 && ID !== 1) || layer !== 0) {
                // invalid adts frame ?
                continue;
            }

            let frame_data = data.subarray(offset, offset + adts_frame_payload_length);

            aac_frame = new AACFrame();
            aac_frame.audio_object_type = (profile + 1) as MPEG4AudioObjectTypes;
            aac_frame.sampling_freq_index = sampling_frequency_index as MPEG4SamplingFrequencyIndex;
            aac_frame.sampling_frequency = MPEG4SamplingFrequencies[sampling_frequency_index];
            aac_frame.channel_config = channel_configuration;
            aac_frame.data = frame_data;
        }

        return aac_frame;
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

export class AACLOASParser {

    private readonly TAG: string = "AACLOASParser";

    private data_: Uint8Array;
    private current_syncword_offset_: number;
    private eof_flag_: boolean;
    private has_last_incomplete_data: boolean;

    public constructor(data: Uint8Array) {
        this.data_ = data;
        this.current_syncword_offset_ = this.findNextSyncwordOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, `Could not found LOAS syncword until payload end`);
        }
    }

    private findNextSyncwordOffset(syncword_offset: number): number {
        let i = syncword_offset;
        let data = this.data_;

        while (true) {
            if (i + 1 >= data.byteLength) {
                this.eof_flag_ = true;
                return data.byteLength;
            }

            // search 12-bit 0xFFF syncword
            let syncword = (data[i + 0] << 3) | (data[i + 1] >>> 5);
            if (syncword === 0x2B7) {
                return i;
            } else {
                i++;
            }
        }
    }

    private getLATMValue(gb: ExpGolomb) {
        let bytesForValue = gb.readBits(2);
        let value = 0;
        for (let i = 0; i <= bytesForValue; i++) {
            value = value << 8;
            value = value | gb.readByte();
        }
        return value;
    }

    public readNextAACFrame(privious?: LOASAACFrame): LOASAACFrame | null {
        let data = this.data_;
        let aac_frame: LOASAACFrame = null;

        while (aac_frame == null) {
            if (this.eof_flag_) {
                break;
            }

            let syncword_offset = this.current_syncword_offset_;
            let offset = syncword_offset;

            let audioMuxLengthBytes = ((data[offset + 1] & 0x1F) << 8) | data[offset + 2];
            if (offset + 3 + audioMuxLengthBytes >= this.data_.byteLength) {
                // data not enough for extracting last sample
                this.eof_flag_ = true;
                this.has_last_incomplete_data = true;
                break;
            }

            // AudioMuxElement(1)
            let gb = new ExpGolomb(data.subarray(offset + 3, offset + 3 + audioMuxLengthBytes));
            let useSameStreamMux = gb.readBool();
            let streamMuxConfig: LOASAACFrame | null = null;
            if (!useSameStreamMux) {
                let audioMuxVersion = gb.readBool();
                let audioMuxVersionA = audioMuxVersion && gb.readBool();
                if (audioMuxVersionA) {
                    Log.e(this.TAG, 'audioMuxVersionA is Not Supported');
                    gb.destroy();
                    break;
                }
                if (audioMuxVersion) {
                    this.getLATMValue(gb);
                }
                let allStreamsSameTimeFraming = gb.readBool();
                if (!allStreamsSameTimeFraming) {
                    Log.e(this.TAG, 'allStreamsSameTimeFraming zero is Not Supported');
                    gb.destroy();
                    break;
                }
                let numSubFrames = gb.readBits(6);
                if (numSubFrames !== 0) {
                    Log.e(this.TAG, 'more than 2 numSubFrames Not Supported');
                    gb.destroy();
                    break;
                }
                let numProgram = gb.readBits(4);
                if (numProgram !== 0) {
                    Log.e(this.TAG, 'more than 2 numProgram Not Supported');
                    gb.destroy();
                    break;
                }
                let numLayer = gb.readBits(3);
                if (numLayer !== 0) {
                    Log.e(this.TAG, 'more than 2 numLayer Not Supported');
                    gb.destroy();
                    break;
                }

                let fillBits = audioMuxVersion ? this.getLATMValue(gb) : 0;
                let audio_object_type = gb.readBits(5); fillBits -= 5;
                let sampling_freq_index = gb.readBits(4);fillBits -= 4;
                let channel_config = gb.readBits(4); fillBits -= 4;
                gb.readBits(3); fillBits -= 3; // GA Specfic Config
                if (fillBits > 0) { gb.readBits(fillBits); }

                let frameLengthType = gb.readBits(3);
                if (frameLengthType === 0) {
                    gb.readByte();
                } else {
                    Log.e(this.TAG, `frameLengthType = ${frameLengthType}. Only frameLengthType = 0 Supported`);
                    gb.destroy();
                    break;
                }

                let otherDataPresent = gb.readBool();
                if (otherDataPresent) {
                    if (audioMuxVersion) {
                        this.getLATMValue(gb);
                    } else {
                        let otherDataLenBits = 0;
                        while (true) {
                            otherDataLenBits = otherDataLenBits << 8;
                            let otherDataLenEsc = gb.readBool();
                            let otherDataLenTmp = gb.readByte();
                            otherDataLenBits += otherDataLenTmp
                            if (!otherDataLenEsc) { break; }
                        }
                        console.log(otherDataLenBits)
                    }
                }

                let crcCheckPresent = gb.readBool();
                if (crcCheckPresent) {
                    gb.readByte();
                }

                streamMuxConfig = new LOASAACFrame();
                streamMuxConfig.audio_object_type = audio_object_type;
                streamMuxConfig.sampling_freq_index = sampling_freq_index;
                streamMuxConfig.sampling_frequency = MPEG4SamplingFrequencies[streamMuxConfig.sampling_freq_index];
                streamMuxConfig.channel_config = channel_config;
                streamMuxConfig.other_data_present = otherDataPresent;
            } else if (privious == null) {
                Log.w(this.TAG, 'StreamMuxConfig Missing')
                this.current_syncword_offset_ = this.findNextSyncwordOffset(offset + 3 + audioMuxLengthBytes);
                gb.destroy();
                continue;
            } else {
                streamMuxConfig = privious;
            }

            let length = 0;
            while (true) {
                let tmp = gb.readByte();
                length += tmp;
                if (tmp !== 0xFF) { break; }
            }

            let aac_data = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                aac_data[i] = gb.readByte();
            }

            aac_frame = new LOASAACFrame();
            aac_frame.audio_object_type = (streamMuxConfig.audio_object_type) as MPEG4AudioObjectTypes;
            aac_frame.sampling_freq_index = (streamMuxConfig.sampling_freq_index) as MPEG4SamplingFrequencyIndex;
            aac_frame.sampling_frequency = MPEG4SamplingFrequencies[streamMuxConfig.sampling_freq_index];
            aac_frame.channel_config = streamMuxConfig.channel_config;
            aac_frame.other_data_present = streamMuxConfig.other_data_present;
            aac_frame.data = aac_data;

            this.current_syncword_offset_ = this.findNextSyncwordOffset(offset + 3 + audioMuxLengthBytes);
        }

        return aac_frame;
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

export class AudioSpecificConfig {

    public config: Array<number>;
    public sampling_rate: number;
    public channel_count: number;
    public codec_mimetype: string;
    public original_codec_mimetype: string;

    public constructor(frame: AACFrame) {
        let config: Array<number> = null;

        let original_audio_object_type = frame.audio_object_type;
        let audio_object_type = frame.audio_object_type;
        let sampling_index = frame.sampling_freq_index;
        let channel_config = frame.channel_config;
        let extension_sampling_index = 0;

        let userAgent = navigator.userAgent.toLowerCase();

        if (userAgent.indexOf('firefox') !== -1) {
            // firefox: use SBR (HE-AAC) if freq less than 24kHz
            if (sampling_index >= 6) {
                audio_object_type = 5;
                config = new Array(4);
                extension_sampling_index = sampling_index - 3;
            } else {  // use LC-AAC
                audio_object_type = 2;
                config = new Array(2);
                extension_sampling_index = sampling_index;
            }
        } else if (userAgent.indexOf('android') !== -1) {
            // android: always use LC-AAC
            audio_object_type = 2;
            config = new Array(2);
            extension_sampling_index = sampling_index;
        } else {
            // for other browsers, e.g. chrome...
            // Always use HE-AAC to make it easier to switch aac codec profile
            audio_object_type = 5;
            extension_sampling_index = sampling_index;
            config = new Array(4);

            if (sampling_index >= 6) {
                extension_sampling_index = sampling_index - 3;
            } else if (channel_config === 1) {  // Mono channel
                audio_object_type = 2;
                config = new Array(2);
                extension_sampling_index = sampling_index;
            }
        }

        config[0]  = audio_object_type << 3;
        config[0] |= (sampling_index & 0x0F) >>> 1;
        config[1]  = (sampling_index & 0x0F) << 7;
        config[1] |= (channel_config & 0x0F) << 3;
        if (audio_object_type === 5) {
            config[1] |= ((extension_sampling_index & 0x0F) >>> 1);
            config[2]  = (extension_sampling_index & 0x01) << 7;
            // extended audio object type: force to 2 (LC-AAC)
            config[2] |= (2 << 2);
            config[3]  = 0;
        }

        this.config = config;
        this.sampling_rate = MPEG4SamplingFrequencies[sampling_index];
        this.channel_count = channel_config;
        this.codec_mimetype = 'mp4a.40.' + audio_object_type;
        this.original_codec_mimetype = 'mp4a.40.' + original_audio_object_type;
    }
}
