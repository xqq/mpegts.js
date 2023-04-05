declare class AV1OBUParser {
    static parseOBUs(uint8array: Uint8Array): any;
    static parseSeuqneceHeader(uint8array: Uint8Array): {
        codec_mimetype: string;
        level: number;
        tier: number;
        level_string: string;
        profile_idc: number;
        profile_string: string;
        bit_depth: number;
        ref_frames: number;
        chroma_format: number;
        chroma_format_string: string;
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
    static getLevelString(level: number, tier: number): string;
    static getChromaFormat(mono_chrome: boolean, subsampling_x: number, subsampling_y: number): number;
    static getChromaFormatString(mono_chrome: boolean, subsampling_x: number, subsampling_y: number): "4:0:0" | "4:4:4" | "4:2:2" | "4:2:0" | "Unknown";
}
export default AV1OBUParser;
