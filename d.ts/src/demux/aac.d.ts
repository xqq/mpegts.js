import { MPEG4AudioObjectTypes, MPEG4SamplingFrequencyIndex } from "./mpeg4-audio";
export declare class AACFrame {
    audio_object_type: MPEG4AudioObjectTypes;
    sampling_freq_index: MPEG4SamplingFrequencyIndex;
    sampling_frequency: number;
    channel_config: number;
    data: Uint8Array;
}
export declare class LOASAACFrame extends AACFrame {
    other_data_present: boolean;
}
export declare class AACADTSParser {
    private readonly TAG;
    private data_;
    private current_syncword_offset_;
    private eof_flag_;
    private has_last_incomplete_data;
    constructor(data: Uint8Array);
    private findNextSyncwordOffset;
    readNextAACFrame(): AACFrame | null;
    hasIncompleteData(): boolean;
    getIncompleteData(): Uint8Array;
}
export declare class AACLOASParser {
    private readonly TAG;
    private data_;
    private current_syncword_offset_;
    private eof_flag_;
    private has_last_incomplete_data;
    constructor(data: Uint8Array);
    private findNextSyncwordOffset;
    private getLATMValue;
    readNextAACFrame(privious?: LOASAACFrame): LOASAACFrame | null;
    hasIncompleteData(): boolean;
    getIncompleteData(): Uint8Array;
}
export declare class AudioSpecificConfig {
    config: Array<number>;
    sampling_rate: number;
    channel_count: number;
    codec_mimetype: string;
    original_codec_mimetype: string;
    constructor(frame: AACFrame);
}
