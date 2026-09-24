const { concatBytes } = require('./bytes.cjs');

function hex(string) {
    return Uint8Array.from(Buffer.from(string, 'hex'));
}

// Annex B byte stream: a start code before each NAL unit
function annexB(...nalus) {
    return concatBytes(...nalus.flatMap(nalu => [Uint8Array.of(0, 0, 0, 1), nalu]));
}

// AV1 in MPEG-2 TS: a start code before each OBU, with emulation prevention bytes
function av1InTs(...obus) {
    const bytes = [];
    for (const obu of obus) {
        bytes.push(0, 0, 1);
        let zeros = 0;
        for (const byte of obu) {
            if (zeros >= 2 && byte <= 3) {
                bytes.push(3);
                zeros = 0;
            }
            bytes.push(byte);
            zeros = byte === 0 ? zeros + 1 : 0;
        }
    }
    return Uint8Array.from(bytes);
}

// Unless stated otherwise, the parameter sets and OBUs below are real encoder output of
// ffmpeg 9.0.1 for `-f lavfi -i color=black:s=64x64:r=25 -frames:v 1`. Slice and frame
// data is never decoded by the demuxers, so dummy slices are enough.

const h264 = {
    // Hand-built Baseline SPS of 320x240 without VUI parameters (FFmpeg's trace_headers BSF
    // agrees): profile_idc 66, constraint_set0/1, level_idc, then seq_parameter_set_id 0,
    // log2_max_frame_num_minus4 0, pic_order_cnt_type 2, max_num_ref_frames 1,
    // gaps_in_frame_num_value_allowed_flag 0, pic_width_in_mbs_minus1 19,
    // pic_height_in_map_units_minus1 14, frame_mbs_only_flag 1, direct_8x8_inference_flag 1,
    // frame_cropping_flag 0, vui_parameters_present_flag 0
    handBuiltSps: (levelIdc = 30) => Uint8Array.of(0x67, 0x42, 0xc0, levelIdc, 0xda, 0x05, 0x07, 0xe4),
    pps: hex('68ce3880'),
    idr: hex('65888400'),
    nonIdr: hex('419a0000'),

    // -c:v h264_videotoolbox -f h264: no VUI parameters at all
    videotoolboxSps: hex('2764000bac56830de0418450'),
    videotoolboxPps: hex('28ee3cb0'),

    // -c:v libx264 -f h264 (core 165): VUI timing 1/50 s per tick, fixed_frame_rate_flag 0
    x264Sps: hex('6764000aacd94426c044000003000400000300c83c489658'),
    x264Pps: hex('68ebe3cb22c0')
};

const h265 = {
    // -c:v libx265 -f hevc (4.3): the VPS and PPS are the same for every SPS below,
    // except that temporal sub-layers come with a VPS of their own
    vps: hex('40010c01ffff01600000030090000003000003001e959809'),
    // VUI timing 1/25 s per tick
    sps25: hex('42010101600000030090000003000003001ea020810596566924caf0168080000003008000000c84'),
    // r=30000/1001: VUI timing 1001/30000 s per tick
    sps30000: hex('42010101600000030090000003000003001ea020810596566924caf01680800001f480003a9804'),
    // -x265-params vui-timing-info=0: VUI without timing info
    spsNoTiming: hex('42010101600000030090000003000003001ea020810596566924caf0168010'),
    // s=128x64
    sps128x64: hex('42010101600000030090000003000003001ea010204165959a4932bc05a02000000300200000030321'),
    // s=128x64 -x265-params temporal-layers=2: two temporal sub-layers, so
    // max_sub_layers_minus1 1 and temporal_id_nesting_flag 0 in the VPS and the SPS
    vpsTemporalLayers: hex('40010c02ffff01600000030090000003000003001e00009598acc048'),
    spsTemporalLayers: hex('42010201600000030090000003000003001e0000a0102041659598acd24995e02d010000030001000003001908'),
    pps: hex('4401c172b42240'),
    idr: hex('2601af00'),    // IDR_W_RADL
    trail: hex('0201d000')   // TRAIL_R
};

const av1 = {
    // r=30000/1001 -c:v libsvtav1 -f obu (SVT-AV1 4.2.0): the temporal delimiter starting
    // the temporal unit, then the sequence header, without timing_info
    temporalDelimiter: hex('1200'),
    sequenceHeader: hex('0a0b02000005557ffc6af98040'),
    // The same after -bsf:v av1_metadata=tick_rate=60000/1001:num_ticks_per_picture=1, =2, and
    // tick_rate=90000/1:num_ticks_per_picture=3000
    sequenceHeader1Tick: hex('0a130400000fa40003a983400000aaafff8d5f3008'),
    sequenceHeader2Ticks: hex('0a130400000fa40003a9829000002aabffe357cc02'),
    sequenceHeader3000Ticks: hex('0a16040000000400057e42002ee1000002aabffe357cc020'),
    // The key frame (OBU_FRAME) after the sequence header
    keyFrame: hex('32101000ba02082041010000080095d00180'),
    // With -frames:v 4 (same sequence header), the temporal unit after the key frame holds a
    // hidden and a shown inter frame (OBU_FRAME), and the next one only an OBU_FRAME_HEADER
    // with show_existing_frame, which shows the hidden frame
    hiddenInterFrame: hex('32112802004000001d8c00000200000c009c10'),
    interFrame: hex('32113002000000493b1800000200000c009b70'),
    showExistingFrame: hex('1a0198'),
    // -i testsrc2=s=64x64:r=30000/1001 -g 16 -svtav1-params irefresh-type=1 (same sequence
    // header): the key frame, and the hidden intra-only frame (open GOP) of the next temporal
    // unit, cut after 16 bytes (obu_size adjusted), as the parsers stop within the frame header
    testsrc2KeyFrame: hex('32101400a9e090d91e892935385b2da4fb02'),
    testsrc2IntraOnlyFrame: hex('321049080129c824d926385b9eab6df6e05c'),
    // Hand-built OBU_FRAME_HEADER of a shown key frame up to render_size(), then zero padding:
    // show_existing_frame 0, frame_type 0 (KEY_FRAME), show_frame 1, disable_cdf_update 0,
    // allow_screen_content_tools 0, frame_size_override_flag 0, order_hint 0,
    // render_and_frame_size_different 1, render_width_minus_1 47, render_height_minus_1 35
    renderSizeKeyFrameHeader: hex('1a061002005e0046'),
    // Body of the AV1 video descriptor in the PMT: the first 4 bytes of an
    // AV1CodecConfigurationRecord (version 1, profile 0, level 0, 8-bit 4:2:0)
    configRecord: Uint8Array.of(0x81, 0x00, 0x0c, 0x00)
};

module.exports = { hex, annexB, av1InTs, h264, h265, av1 };
