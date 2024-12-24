import ExpGolomb from './exp-golomb.js';
type OperatingPoint = {
    operating_point_idc: number;
    level: number;
    tier: number;
    decoder_model_present_for_this_op?: boolean;
};
type SequenceHeaderDetails = {
    frame_id_numbers_present_flag: boolean;
    additional_frame_id_length_minus_1?: number;
    delta_frame_id_length_minus_2?: number;
    reduced_still_picture_header: boolean;
    decoder_model_info_present_flag: boolean;
    operating_points_cnt_minus_1?: number;
    operating_points: OperatingPoint[];
    buffer_removal_time_length_minus_1: number;
    equal_picture_interval: boolean;
    seq_force_screen_content_tools: number;
    seq_force_integer_mv: number;
    enable_order_hint: boolean;
    order_hint_bits: number;
    enable_superres: boolean;
    frame_width_bit: number;
    frame_height_bit: number;
    max_frame_width: number;
    max_frame_height: number;
};
type FrameResolutions = {
    UpscaledWidth: number;
    FrameWidth: number;
    FrameHeight: number;
    RenderWidth: number;
    RenderHeight: number;
};
type AV1Metadata = {
    codec_mimetype: string;
    level: number;
    level_string: string;
    tier: number;
    profile_idc: number;
    profile_string: string;
    bit_depth: number;
    ref_frames: number;
    chroma_format: number;
    chroma_format_string: string;
    sequence_header: SequenceHeaderDetails;
    sequence_header_data: Uint8Array;
    keyframe?: boolean;
    frame_rate: {
        fixed: boolean;
        fps: number;
        fps_den: number;
        fps_num: number;
    };
    sar_ratio?: {
        width: number;
        height: number;
    };
    codec_size?: {
        width: number;
        height: number;
    };
    present_size?: {
        width: number;
        height: number;
    };
};
declare class AV1OBUParser {
    static parseOBUs(uint8array: Uint8Array, meta?: AV1Metadata | null): AV1Metadata;
    static parseSeuqneceHeader(uint8array: Uint8Array): Omit<AV1Metadata, 'sequence_header_data'>;
    static parseOBUFrameHeader(uint8array: Uint8Array, temporal_id: number, spatial_id: number, meta: AV1Metadata): AV1Metadata;
    static frameSizeAndRenderSize(gb: ExpGolomb, frame_size_override_flag: boolean, sequence_header: SequenceHeaderDetails): FrameResolutions;
    static getLevelString(level: number, tier: number): string;
    static getChromaFormat(mono_chrome: boolean, subsampling_x: number, subsampling_y: number): number;
    static getChromaFormatString(mono_chrome: boolean, subsampling_x: number, subsampling_y: number): string;
}
export default AV1OBUParser;
