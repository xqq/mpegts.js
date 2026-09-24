import { MPEG4AudioObjectTypes } from "./mpeg4-audio";
export interface MP3Frame {
    object_type: MPEG4AudioObjectTypes;
    sample_rate: number;
    channel_count: number;
    bit_rate: number;
    samples_per_frame: number;
    data: Uint8Array;
}
export declare class MP3FrameParser {
    private readonly TAG;
    private data_;
    private current_syncword_offset_;
    private eof_flag_;
    private has_last_incomplete_data_;
    constructor(data: Uint8Array);
    private findNextSyncwordOffset;
    private mayBeginSyncword;
    private parseFrameHeader;
    readNextMP3Frame(): MP3Frame | null;
    hasIncompleteData(): boolean;
    getIncompleteData(): Uint8Array | null;
}
