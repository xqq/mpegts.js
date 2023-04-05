export declare class AC3Frame {
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
export declare class AC3Parser {
    private readonly TAG;
    private data_;
    private current_syncword_offset_;
    private eof_flag_;
    private has_last_incomplete_data;
    constructor(data: Uint8Array);
    private findNextSyncwordOffset;
    readNextAC3Frame(): AC3Frame | null;
    hasIncompleteData(): boolean;
    getIncompleteData(): Uint8Array;
}
export declare class AC3Config {
    config: Array<number>;
    sampling_rate: number;
    bit_stream_identification: number;
    bit_stream_mode: number;
    low_frequency_effects_channel_on: number;
    channel_count: number;
    channel_mode: number;
    codec_mimetype: string;
    original_codec_mimetype: string;
    constructor(frame: AC3Frame);
}
