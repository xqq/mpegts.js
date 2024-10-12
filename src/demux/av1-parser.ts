/*
 * Copyright (C) 2022 もにょてっく. All Rights Reserved.
 *
 * @author もにょ〜ん <monyone.teihen@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import ExpGolomb from './exp-golomb.js';

type OperatingPoint = {
    operating_point_idc: number,
    level: number,
    tier: number,
    decoder_model_present_for_this_op?: boolean
};

type SequenceHeaderDetails = {
    frame_id_numbers_present_flag: boolean,
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
}

type FrameResolutions = {
    UpscaledWidth: number;
    FrameWidth: number;
    FrameHeight: number;
    RenderWidth: number;
    RenderHeight: number;
}

type AV1Metadata = {
    codec_mimetype: string,
    level: number,
    level_string: string,
    tier: number,
    profile_idc: number,
    profile_string: string,
    bit_depth: number,
    ref_frames: number;
    chroma_format: number;
    chroma_format_string: string;

    sequence_header: SequenceHeaderDetails;
    sequence_header_data: Uint8Array;
    keyframe?: boolean;

    frame_rate: {
        fixed: boolean
        fps: number;
        fps_den: number;
        fps_num: number;
    },

    sar_ratio?: {
        width: number;
        height: number;
    },

    codec_size?: {
        width: number,
        height: number;
    },

    present_size?: {
        width: number,
        height: number,
    }
}

class AV1OBUParser {

    static parseOBUs(uint8array: Uint8Array, meta?: AV1Metadata | null) {
        for (let i = 0; i < uint8array.byteLength; ) {
            let first = i;
            let forbidden_bit = (uint8array[i] & 0x80) >> 7;
            let type = (uint8array[i] & 0x78) >> 3;
            let extension_flag = (uint8array[i] & 0x04) !== 0;
            let has_size_field = (uint8array[i] & 0x02) !== 0;
            let reserved_1bit = (uint8array[i] & 0x01) !== 0;

            i += 1;
            let temporal_id = 0, spatial_id = 0;
            if (extension_flag) { i += 1; }

            let size = Number.POSITIVE_INFINITY;
            if (has_size_field) {
                size = 0;
                for (let j = 0; ; j++) {
                    let value = uint8array[i++]
                    size |= (value & 0x7F) << (j * 7);
                    if ((value & 0x80) === 0) { break; }
                }
            }
            console.log(type);

            if (type === 1) { // OBU_SEQUENCE_HEADER
                meta = {
                    ... AV1OBUParser.parseSeuqneceHeader(uint8array.subarray(i, i + size)),
                    sequence_header_data: uint8array.subarray(first, i + size),
                }
            } else if (type == 3 && meta) { // OBU_FRAME_HEADER
                meta = AV1OBUParser.parseOBUFrameHeader(uint8array.subarray(i, i + size), temporal_id, spatial_id, meta);
            } else if (type == 6 && meta) { // OBU_FRAME
                meta = AV1OBUParser.parseOBUFrameHeader(uint8array.subarray(i, i + size), temporal_id, spatial_id, meta);
            }

            i += size;
        }

        return meta;
    }

    static parseSeuqneceHeader(uint8array: Uint8Array): Omit<AV1Metadata, 'sequence_header_data'> {
        let gb = new ExpGolomb(uint8array);

        let seq_profile = gb.readBits(3);
        let still_picture = gb.readBool();
        let reduced_still_picture_header = gb.readBool();

        let fps = 0, fps_fixed = true, fps_num = 0, fps_den = 1;
        let decoder_model_info_present_flag = false;
        let decoder_model_present_for_this_op = false;
        let buffer_delay_length_minus_1: number | undefined = undefined;
        let buffer_removal_time_length_minus_1: number | undefined = undefined;
        let operating_points: OperatingPoint[] = [];
        if (reduced_still_picture_header) {
            operating_points.push({
                operating_point_idc: 0,
                level: gb.readBits(5),
                tier: 0,
            });
        } else {
            let timing_info_present_flag = gb.readBool();
            if (timing_info_present_flag) {
                // timing_info
                let num_units_in_display_tick = gb.readBits(32);
                let time_scale = gb.readBits(32);
                let equal_picture_interval = gb.readBool();
                let num_ticks_per_picture_minus_1 = 0;
                if (equal_picture_interval) {
                    let leading = 0;
                    while (true) {
                        let value = gb.readBits(1);
                        if (value !== 0) { break; }
                        leading += 1;
                    }
                    if (leading >= 32) {
                        num_ticks_per_picture_minus_1 = 0xFFFFFFFF;
                    } else {
                        num_ticks_per_picture_minus_1 = ((1 << leading) - 1) + gb.readBits(leading);
                    }
                }
                fps_den = num_units_in_display_tick;
                fps_num = time_scale;
                fps = fps_num / fps_den;
                fps_fixed = equal_picture_interval;

                let decoder_model_info_present_flag = gb.readBool();
                if (decoder_model_info_present_flag) {
                    // decoder_model_info
                    buffer_delay_length_minus_1 = gb.readBits(5);
                    let num_units_in_decoding_tick = gb.readBits(32);
                    buffer_removal_time_length_minus_1 = gb.readBits(5);
                    let frame_presentation_time_length_minus_1 = gb.readBits(5);
                }
            }

            let initial_display_delay_present_flag = gb.readBool();
            let operating_points_cnt_minus_1 = gb.readBits(5);
            for (let i = 0; i <= operating_points_cnt_minus_1; i++) {
                let operating_point_idc = gb.readBits(12);
                let level = gb.readBits(5);
                let tier = level > 7 ? gb.readBits(1) : 0;

                operating_points.push({
                    operating_point_idc,
                    level,
                    tier
                });

                if (decoder_model_info_present_flag) {
                    let decoder_model_present_for_this_op = gb.readBool();
                    operating_points[operating_points.length - 1].decoder_model_present_for_this_op = decoder_model_present_for_this_op;
                    if (decoder_model_present_for_this_op) {
                        // operating_parameters_info
                        let decoder_buffer_delay = gb.readBits(buffer_delay_length_minus_1 + 1);
                        let encoder_buffer_delay = gb.readBits(buffer_delay_length_minus_1 + 1);
                        let low_delay_mode_flag = gb.readBool();
                    }
                }

                if (initial_display_delay_present_flag) {
                    let initial_display_delay_present_for_this_op = gb.readBool();
                    if (initial_display_delay_present_for_this_op) {
                        let initial_display_delay_minus_1 = gb.readBits(4);
                    }
                }
            }
        }

        let operating_point = 0;
        let { level, tier } = operating_points[operating_point];

        let frame_width_bits_minus_1 = gb.readBits(4);
        let frame_height_bits_minus_1 = gb.readBits(4);

        let max_frame_width = gb.readBits(frame_width_bits_minus_1 + 1) + 1;
        let max_frame_height = gb.readBits(frame_height_bits_minus_1 + 1) + 1;

        let frame_id_numbers_present_flag = false;
        if (!reduced_still_picture_header) {
            frame_id_numbers_present_flag = gb.readBool();
        }
        let delta_frame_id_length_minus_2: number | undefined = undefined;
        let additional_frame_id_length_minus_1: number | undefined = undefined;
        if (frame_id_numbers_present_flag) {
            let delta_frame_id_length_minus_2 = gb.readBits(4);
            let additional_frame_id_length_minus_1 = gb.readBits(4);
        }

        let SELECT_SCREEN_CONTENT_TOOLS = 2;
        let SELECT_INTEGER_MV = 2;

        let use_128x128_superblock = gb.readBool();
        let enable_filter_intra = gb.readBool();
        let enable_intra_edge_filter = gb.readBool();
        let enable_interintra_compound = false;
        let enable_masked_compound = false;
        let enable_warped_motion = false;
        let enable_dual_filter = false;
        let enable_order_hint = false;
        let enable_jnt_comp = false;
        let enable_ref_frame_mvs = false;
        let seq_force_screen_content_tools = SELECT_SCREEN_CONTENT_TOOLS;
        let seq_force_integer_mv = SELECT_INTEGER_MV;
        let OrderHintBits = 0;
        if (!reduced_still_picture_header) {
            enable_interintra_compound = gb.readBool();
            enable_masked_compound = gb.readBool();
            enable_warped_motion = gb.readBool();
            enable_dual_filter = gb.readBool();
            enable_order_hint = gb.readBool();
            if (enable_order_hint) {
                let enable_jnt_comp = gb.readBool();
                let enable_ref_frame_mvs = gb.readBool();
            }
            let seq_choose_screen_content_tools = gb.readBool();
            if (seq_choose_screen_content_tools) {
                seq_force_screen_content_tools = SELECT_SCREEN_CONTENT_TOOLS;
            } else {
                seq_force_screen_content_tools = gb.readBits(1);
            }
            if (seq_force_screen_content_tools) {
                let seq_choose_integer_mv = gb.readBool();
                if (seq_choose_integer_mv) {
                    seq_force_integer_mv = SELECT_INTEGER_MV;
                } else {
                    seq_force_integer_mv = gb.readBits(1);
                }
            } else {
                seq_force_integer_mv = SELECT_INTEGER_MV;
            }
            if (enable_order_hint) {
                let order_hint_bits_minus_1 = gb.readBits(3);
                OrderHintBits = order_hint_bits_minus_1 + 1;
            } else {
                OrderHintBits = 0;
            }
        }

        let enable_superres = gb.readBool();
        let enable_cdef = gb.readBool();
        let enable_restoration = gb.readBool();
        // color_config
        let high_bitdepth = gb.readBool();
        let bitDepth = 8;
        if (seq_profile === 2 && high_bitdepth) {
            let twelve_bit = gb.readBool();
            bitDepth = twelve_bit ? 12 : 10;
        } else {
            bitDepth = high_bitdepth ? 10 : 8;
        }
        let mono_chrome = false;
        if (seq_profile !== 1) {
            mono_chrome = gb.readBool();
        }
        let numPlanes = mono_chrome ? 1 : 3;
        let color_description_present_flag = gb.readBool();
        let CP_BT_709 = 1, CP_UNSPECIFIED = 2;
        let TC_UNSPECIFIED = 2, TC_SRGB = 13;
        let MC_UNSPECIFIED = 2, MC_IDENTITY = 0;
        let color_primaries = CP_UNSPECIFIED;
        let transfer_characteristics = TC_UNSPECIFIED;
        let matrix_coefficients = MC_UNSPECIFIED;
        if (color_description_present_flag) {
            let color_primaries = gb.readBits(8);
            let transfer_characteristics = gb.readBits(8);
            let matrix_coefficients = gb.readBits(8);
        }
        let color_range = 1;
        let subsampling_x = 1
        let subsampling_y = 1;
        if (mono_chrome) {
            color_range = gb.readBits(1);
            subsampling_x = 1
            subsampling_y = 1;
            let chroma_sample_position = 0; /* CSP_UNKNOWN */
            let separate_uv_delta_q = 0
        } else {
            let color_range = 1;
            if (color_primaries === CP_BT_709 && transfer_characteristics === TC_SRGB && matrix_coefficients === MC_IDENTITY) {
                color_range = 1;
                subsampling_x = 1
                subsampling_y = 1
            } else {
                color_range = gb.readBits(1);
                if (seq_profile == 0) {
                    subsampling_x = 1
                    subsampling_y = 1
                } else if (seq_profile == 1) {
                    subsampling_x = 0
                    subsampling_y = 0
                } else {
                    if (bitDepth == 12) {
                        let subsampling_x = gb.readBits(1);
                        if (subsampling_x) {
                            let subsampling_y = gb.readBits(1);
                        } else {
                            let subsampling_y = 0;
                        }
                    } else {
                        subsampling_x = 1
                        subsampling_y = 0
                    }
                }
                if (subsampling_x && subsampling_y) {
                    let chroma_sample_position = gb.readBits(2)
                }
                let separate_uv_delta_q = gb.readBits(1);
            }
        }
        //
        let film_grain_params_present = gb.readBool();

        gb.destroy();
        gb = null;

        let codec_mimetype = `av01.${seq_profile}.${AV1OBUParser.getLevelString(level, tier)}.${bitDepth.toString(10).padStart(2, '0')}`;
        let sar_width = 1, sar_height = 1, sar_scale = 1;

        return {
            codec_mimetype,
            level: level,
            tier: tier,
            level_string: AV1OBUParser.getLevelString(level, tier),
            profile_idc: seq_profile,
            profile_string: `${seq_profile}`,
            bit_depth: bitDepth,
            ref_frames: 1, // FIXME!!!
            chroma_format: AV1OBUParser.getChromaFormat(mono_chrome, subsampling_x, subsampling_y),
            chroma_format_string: AV1OBUParser.getChromaFormatString(mono_chrome, subsampling_x, subsampling_y),

            sequence_header: {
                frame_id_numbers_present_flag,
                additional_frame_id_length_minus_1,
                delta_frame_id_length_minus_2,
                reduced_still_picture_header,
                decoder_model_info_present_flag,
                operating_points,
                buffer_removal_time_length_minus_1,
                equal_picture_interval: fps_fixed,
                seq_force_screen_content_tools,
                seq_force_integer_mv,
                enable_order_hint,
                order_hint_bits: OrderHintBits,
                enable_superres,
                frame_width_bit: frame_width_bits_minus_1 + 1,
                frame_height_bit: frame_height_bits_minus_1 + 1,
                max_frame_width,
                max_frame_height,
            },

            keyframe: undefined,

            frame_rate: {
                fixed: fps_fixed,
                fps: fps_num / fps_den,
                fps_den: fps_den,
                fps_num: fps_num,
            },
        };
    }

    static parseOBUFrameHeader(uint8array: Uint8Array, temporal_id: number, spatial_id: number, meta: AV1Metadata) {
        let { sequence_header } = meta;

        let gb = new ExpGolomb(uint8array);
        // obu_type is OBU_FRAME_HEADER, SeenFrameHeader = 0, OBU_REDUNDANT_FRAME_HEADER 1
        let NUM_REF_FRAMES = 8;
        let KEY_FRAME = 0;
        let INTER_FRAME = 1;
        let INTRA_ONLY_FRAME = 2;
        let SWITCH_FRAME = 3;
        let SELECT_SCREEN_CONTENT_TOOLS = 2;
        let SELECT_INTEGER_MV = 2;
        let PRIMARY_REF_NONE = 7;

        let FrameWidth = sequence_header.max_frame_width;
        let FrameHeight = sequence_header.max_frame_height;
        let RenderWidth = FrameWidth; // Stub
        let RenderHeight = FrameHeight; // Stub

        let idLen = 0;
        if (sequence_header.frame_id_numbers_present_flag) {
            idLen = sequence_header.additional_frame_id_length_minus_1! + sequence_header.delta_frame_id_length_minus_2! + 3;
        }
        let allFrames = (1 << NUM_REF_FRAMES) - 1;

        let show_existing_frame = false;
        let frame_type = 0;
        let keyframe = true;
        let show_frame = true;
        let showable_frame = false;
        let error_resilient_mode = false;
        if (!sequence_header.reduced_still_picture_header) {
            show_existing_frame = gb.readBool();
            if (show_existing_frame) {
                // it does not contain frame data. ignored
                return meta;
            }

            frame_type = gb.readBits(2);
            keyframe = frame_type === INTRA_ONLY_FRAME || frame_type === KEY_FRAME;
            show_frame = gb.readBool();
            if (show_frame && sequence_header.decoder_model_info_present_flag && !sequence_header.equal_picture_interval) {
                // decoder model info
            }
            if (!show_frame) {
                showable_frame = frame_type !== KEY_FRAME;
            } else {
                showable_frame = gb.readBool();
            }
            if (frame_type === SWITCH_FRAME || (frame_type === KEY_FRAME && show_frame)) {
                error_resilient_mode = true;
            } else {
                error_resilient_mode = gb.readBool();
            }
        }
        meta.keyframe = keyframe;

        let disable_cdf_update = gb.readBool();
        let allow_screen_content_tools = sequence_header.seq_force_screen_content_tools;
        if (sequence_header.seq_force_screen_content_tools === SELECT_SCREEN_CONTENT_TOOLS) {
            allow_screen_content_tools = gb.readBits(1);
        }
        let force_integer_mv = keyframe ? 1 : 0;
        if (allow_screen_content_tools) {
            force_integer_mv = sequence_header.seq_force_integer_mv;
            if (sequence_header.seq_force_integer_mv == SELECT_INTEGER_MV) {
                force_integer_mv = gb.readBits(1);
            }
        }
        let current_frame_id = 0;
        if (sequence_header.frame_id_numbers_present_flag) {
            current_frame_id = gb.readBits(idLen);
        }
        let frame_size_override_flag = false;
        if (frame_type == SWITCH_FRAME) {
            frame_size_override_flag = true;
        } else if (sequence_header.reduced_still_picture_header) {
            frame_size_override_flag = false;
        } else {
            frame_size_override_flag = gb.readBool();
        }
        let order_hint = gb.readBits(sequence_header.order_hint_bits);
        let primary_ref_frame = PRIMARY_REF_NONE;
        if (!(keyframe || error_resilient_mode)) {
            primary_ref_frame = gb.readBits(3);
        }
        if (sequence_header.decoder_model_info_present_flag) {
            let buffer_removal_time_present_flag = gb.readBool();
            if (buffer_removal_time_present_flag) {
                for (let opNum = 0; opNum <= sequence_header.operating_points_cnt_minus_1; opNum++) {
                    if (sequence_header.operating_points[opNum].decoder_model_present_for_this_op[opNum]) {
                        let opPtIdc = sequence_header.operating_points[opNum].operating_point_idc;
                        let inTemporalLayer = (opPtIdc >> temporal_id ) & 1
                        let inSpatialLayer = (opPtIdc >> (spatial_id + 8)) & 1
                        if (opPtIdc === 0 || (inTemporalLayer && inSpatialLayer)) {
                            gb.readBits(sequence_header.buffer_removal_time_length_minus_1 + 1);
                        }
                    }
                }
            }
        }
        let allow_high_precision_mv = 0;
        let use_ref_frame_mvs = 0;
        let allow_intrabc = 0;
        let refresh_frame_flags = allFrames;
        if (!(frame_type === SWITCH_FRAME || (frame_type == KEY_FRAME && show_frame))) {
            refresh_frame_flags = gb.readBits(8);
        }
        if (keyframe || refresh_frame_flags !== allFrames) {
            if (error_resilient_mode && sequence_header.enable_order_hint) {
                for (let i = 0; i < NUM_REF_FRAMES; i++) {
                    gb.readBits(sequence_header.order_hint_bits);
                }
            }
        }
        if (keyframe){
            const resolution = AV1OBUParser.frameSizeAndRenderSize(gb, frame_size_override_flag, sequence_header);
            meta.codec_size = {
                width: resolution.FrameWidth,
                height: resolution.FrameHeight,
            }
            meta.present_size = {
                width: resolution.RenderWidth,
                height: resolution.RenderHeight,
            }
            meta.sar_ratio = {
                width: resolution.RenderWidth / resolution.FrameWidth,
                height: resolution.RenderHeight / resolution.FrameHeight,
            }
        }
        // fmp4 can't support reference frame resolution change, so ignored

        gb.destroy();
        gb = null;
        return meta;
    }

    static frameSizeAndRenderSize(gb: ExpGolomb, frame_size_override_flag: boolean, sequence_header: SequenceHeaderDetails): FrameResolutions {
        let FrameWidth = sequence_header.max_frame_width;
        let FrameHeight = sequence_header.max_frame_height;
        if (frame_size_override_flag) {
            FrameWidth = gb.readBits(sequence_header.frame_width_bit) + 1;
            FrameHeight = gb.readBits(sequence_header.frame_height_bit) + 1;
        }

        let use_superress = false;
        if (sequence_header.enable_superres) {
            use_superress = gb.readBool();
        }
        let SuperresDenom = 8 /* SUPERRES_NUM */;
        if (use_superress) {
            let coded_denom = gb.readBits(3 /* SUPERRES_DENOM_BITS */);
            SuperresDenom = coded_denom + 9; /* SUPERRES_DENOM_MIN */
        }
        let UpscaledWidth = FrameWidth;
        FrameWidth = Math.floor((UpscaledWidth * 8 /* SUPERRES_NUM */ + (SuperresDenom / 2)) / SuperresDenom)

        let render_and_frame_size_different = gb.readBool();
        let RenderWidth = UpscaledWidth;
        let RenderHeight = FrameHeight;
        if (render_and_frame_size_different) {
            let render_width_bits = gb.readBits(16) + 1;
            let render_height_bits = gb.readBits(16) + 1;
            RenderWidth = gb.readBits(render_width_bits) + 1;
            RenderHeight = gb.readBits(render_height_bits) + 1;
        }

        return {
            UpscaledWidth,
            FrameWidth,
            FrameHeight,
            RenderWidth,
            RenderHeight
        };
    }

    static getLevelString(level: number, tier: number): string {
        return `${level.toString(10).padStart(2, '0')}${tier === 0 ? 'M' : 'H'}`;
    }

    static getChromaFormat(mono_chrome: boolean, subsampling_x: number, subsampling_y: number): number {
        if (mono_chrome) {
            return 0;
        } else if (subsampling_x === 0 && subsampling_y === 0) {
            return 3;
        } else if (subsampling_x === 1 && subsampling_y === 0) {
            return 2;
        } else if (subsampling_x === 1 && subsampling_y === 1) {
            return 1;
        } else {
            return Number.NaN;
        }
    }

    static getChromaFormatString(mono_chrome: boolean, subsampling_x: number, subsampling_y: number): string {
        if (mono_chrome) {
            return '4:0:0';
        } else if (subsampling_x === 0 && subsampling_y === 0) {
            return '4:4:4';
        } else if (subsampling_x === 1 && subsampling_y === 0) {
            return '4:2:2';
        } else if (subsampling_x === 1 && subsampling_y === 1) {
            return '4:2:0';
        } else {
            return 'Unknown';
        }
    }
}

export default AV1OBUParser;