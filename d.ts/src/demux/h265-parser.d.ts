export default H265NaluParser;
declare class H265NaluParser {
    static _ebsp2rbsp(uint8array: any): Uint8Array<any>;
    static parseVPS(uint8array: any): {
        num_temporal_layers: number;
        temporal_id_nested: boolean;
    };
    static parseSPS(uint8array: any): {
        codec_mimetype: string;
        profile_string: string;
        level_string: string;
        profile_idc: number;
        bit_depth: number;
        ref_frames: number;
        chroma_format: number;
        chroma_format_string: string;
        general_level_idc: number;
        general_profile_space: number;
        general_tier_flag: boolean;
        general_profile_idc: number;
        general_profile_compatibility_flags_1: number;
        general_profile_compatibility_flags_2: number;
        general_profile_compatibility_flags_3: number;
        general_profile_compatibility_flags_4: number;
        general_constraint_indicator_flags_1: number;
        general_constraint_indicator_flags_2: number;
        general_constraint_indicator_flags_3: number;
        general_constraint_indicator_flags_4: number;
        general_constraint_indicator_flags_5: number;
        general_constraint_indicator_flags_6: number;
        min_spatial_segmentation_idc: number;
        constant_frame_rate: number;
        chroma_format_idc: number;
        bit_depth_luma_minus8: number;
        bit_depth_chroma_minus8: number;
        colour_primaries: number;
        transfer_characteristics: number;
        matrix_coeffs: number;
        frame_rate: {
            fixed: boolean;
            fps: number;
            fps_den: number;
            fps_num: number;
        };
        sar_ratio: {
            width: number;
            height: number;
        };
        codec_size: {
            width: number;
            height: number;
        };
        present_size: {
            width: number;
            height: number;
        };
    };
    static parsePPS(uint8array: any): {
        parallelismType: number;
    };
    static getChromaFormatString(chroma_idc: any): "Unknown" | "4:2:0" | "4:2:2" | "4:4:4" | "4:0:0";
    static getProfileString(profile_idc: any): "Main" | "Unknown" | "Main10" | "MainSP" | "Rext" | "SCC";
    static getLevelString(level_idc: any): string;
}
