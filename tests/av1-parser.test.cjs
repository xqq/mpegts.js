const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { hex, av1 } = require('./helpers/video.cjs');

const AV1OBUParser = loadSource()('demux/av1-parser.ts').default;

// Copies the given fields into a plain object of this realm, the parser runs in its own vm context
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));

// Real encoder output of ffmpeg 9.0.1 with SVT-AV1 4.2.0 for `-f lavfi -i testsrc2=s=320x240:r=25
// -c:v libsvtav1 -svtav1-params log-level=0 -f obu`, with the options given for each key frame
// below. Each key frame (OBU_FRAME) is cut after 16 payload bytes, which hold its whole
// uncompressed header, with its obu_size set to 16. FFmpeg's trace_headers BSF gives the
// reference values.

// The same for all of them: enable_order_hint 1 with 7-bit order hints,
// seq_choose_screen_content_tools 1 and seq_choose_integer_mv 1
const sequenceHeader = hex('0a0b0200000561e7fde357cc02');

for (const { label, frame, codecSize, presentSize } of [
    {
        // -t 2 -g 25, the first key frame: allow_screen_content_tools 1, force_integer_mv 0. A shown
        // key frame codes no ref_order_hint[]; the parser used to read 56 bits of them, then threw
        // on the render size.
        label: 'the first key frame of an SVT-AV1 stream',
        frame: hex('32101400a17024db2a81d3d01f553afde6a0'),
        codecSize: { width: 320, height: 240 },
        presentSize: { width: 320, height: 240 }
    },
    {
        // -t 4 -g 25 with scm=0, the key frame of picture 75: allow_screen_content_tools 0 and
        // order_hint 75. A shown frame codes no showable_frame; reading one took the top bit of
        // order_hint for frame_size_override_flag.
        label: 'a key frame without screen content tools',
        frame: hex('3210112c8620808204102fbc0bc000f80020'),
        codecSize: { width: 320, height: 240 },
        presentSize: { width: 320, height: 240 }
    },
    {
        // -frames:v 1 with resize-mode=1:resize-denom=16:resize-kf-denom=16: frame_size_override_flag 1
        // for 160x120, and render_and_frame_size_different 1 with the same render size, whose
        // render_width_minus_1 and render_height_minus_1 used to be taken for bit counts
        label: 'a resized key frame with a render size',
        frame: hex('321015009f77804f803bd0bc08d94aee05a8'),
        codecSize: { width: 160, height: 120 },
        presentSize: { width: 160, height: 120 }
    }
]) {
    test(`AV1OBUParser parses ${label}`, () => {
        let details = null;
        for (const obu of [sequenceHeader, frame]) {
            details = AV1OBUParser.parseOBUs(obu, details);
        }
        assert.equal(details.keyframe, true);
        // Copy into plain objects of this realm, the parser runs in its own vm context
        assert.deepEqual({ ...details.codec_size }, codecSize);
        assert.deepEqual({ ...details.present_size }, presentSize);
    });
}

// The 64x64 fixtures of the TS AV1 tests cover what the key frames above do not: a hidden frame,
// and a render size other than the frame size. The sizes are decoded by hand in the syntax order
// of uncompressed_header() in the AV1 specification, not from the parser's arithmetic.
for (const { label, frame, presentSize } of [
    {
        // Used to be 52x54: the parser skipped the showable_frame of hidden frames
        label: 'a hidden intra-only frame of an SVT-AV1 open GOP',
        frame: av1.testsrc2IntraOnlyFrame,
        presentSize: { width: 64, height: 64 }
    },
    {
        // render_width_minus_1 and render_height_minus_1 are 16-bit values, the parser used to
        // read that many bits instead
        label: 'a key frame header with a render size other than its frame size',
        frame: av1.renderSizeKeyFrameHeader,
        presentSize: { width: 48, height: 36 }
    }
]) {
    test(`AV1OBUParser parses ${label}`, () => {
        const details = AV1OBUParser.parseOBUs(frame, AV1OBUParser.parseOBUs(av1.sequenceHeader));
        // Copy into plain objects of this realm, the parser runs in its own vm context
        assert.deepEqual({ ...details.codec_size }, { width: 64, height: 64 });
        assert.deepEqual({ ...details.present_size }, presentSize);
    });
}

// Real encoder output of aomenc (libaom 3.14.1) with a decoder model, see tests/helpers/video.cjs.
// Its key frames are resized to 32x32, so their frame size comes after everything the decoder
// model adds to the frame header. FFmpeg's trace_headers BSF gives the reference values.
for (const { label, sequenceHeader, frame, equalPictureInterval } of [
    {
        // frame_presentation_time after show_frame, and buffer_removal_time[0] after order_hint
        label: 'a key frame of libaom with a decoder model',
        sequenceHeader: av1.decoderModelSequenceHeader,
        frame: av1.decoderModelKeyFrame,
        equalPictureInterval: false
    },
    {
        // After av1_metadata: only buffer_removal_time[0], no frame_presentation_time
        label: 'a key frame of libaom with a decoder model and equal_picture_interval',
        sequenceHeader: av1.decoderModelSequenceHeader1Tick,
        frame: av1.decoderModelKeyFrame1Tick,
        equalPictureInterval: true
    }
]) {
    test(`AV1OBUParser parses ${label}`, () => {
        // Used to throw "ExpGolomb: _fillCurrentWord() but no bytes available": the operating point
        // loop saw a shadowed decoder_model_info_present_flag of false, and skipped
        // decoder_model_present_for_this_op and operating_parameters_info()
        const details = AV1OBUParser.parseOBUs(sequenceHeader);
        const sequence_header = details.sequence_header;
        assert.equal(details.codec_mimetype, 'av01.0.00M.08');
        assert.deepEqual(Array.from(sequence_header.operating_points, point => ({ ...point })), [
            { operating_point_idc: 0, level: 0, tier: 0, decoder_model_present_for_this_op: true }
        ]);
        const expected = {
            decoder_model_info_present_flag: true,
            operating_points_cnt_minus_1: 0,
            buffer_removal_time_length_minus_1: 9,
            frame_presentation_time_length_minus_1: 9,
            equal_picture_interval: equalPictureInterval,
            // Coded after the operating points
            max_frame_width: 64,
            max_frame_height: 64,
            order_hint_bits: 7
        };
        assert.deepEqual(pick(sequence_header, Object.keys(expected)), expected);

        const frameDetails = AV1OBUParser.parseOBUs(frame, details);
        assert.equal(frameDetails.keyframe, true);
        assert.deepEqual({ ...frameDetails.codec_size }, { width: 32, height: 32 });
        assert.deepEqual({ ...frameDetails.present_size }, { width: 64, height: 64 });
    });
}

// The same encode with frame ids (--error-resilient=1) instead of a decoder model
test('AV1OBUParser parses a key frame of libaom with frame ids', () => {
    // additional_frame_id_length_minus_1 is f(3): reading 4 bits made the 7-bit order hints 5 bits
    // and turned enable_superres on
    const details = AV1OBUParser.parseOBUs(av1.frameIdSequenceHeader);
    const expected = {
        frame_id_numbers_present_flag: true,
        delta_frame_id_length_minus_2: 12,
        additional_frame_id_length_minus_1: 0,
        // Coded after the frame id lengths
        order_hint_bits: 7,
        enable_superres: false
    };
    assert.deepEqual(pick(details.sequence_header, Object.keys(expected)), expected);

    // Used to throw "ExpGolomb: _fillCurrentWord() but no bytes available": the two lengths were
    // shadowed, so current_frame_id was read with an idLen of NaN
    const frameDetails = AV1OBUParser.parseOBUs(av1.frameIdKeyFrame, details);
    assert.equal(frameDetails.keyframe, true);
    assert.deepEqual({ ...frameDetails.codec_size }, { width: 32, height: 32 });
    assert.deepEqual({ ...frameDetails.present_size }, { width: 64, height: 64 });
});

// Real encoder output of rav1e and aomenc with other chroma formats than 4:2:0, and with the sRGB
// color description, see tests/helpers/video.cjs. FFmpeg's trace_headers BSF gives the reference
// values.
for (const { label, sequenceHeader, expected } of [
    {
        // Used to throw "ExpGolomb: _fillCurrentWord() but no bytes available": subsampling_x and
        // subsampling_y were shadowed, so the parser kept 4:2:0 and read 2 bits of
        // chroma_sample_position, past the one trailing bit (with more of them, it reported 4:2:0)
        label: 'a 12-bit 4:4:4 sequence header',
        sequenceHeader: av1.sequenceHeader12Bit444,
        expected: { chroma_format: 3, chroma_format_string: '4:4:4' }
    },
    {
        // The same, with a subsampling_y of 0 after subsampling_x
        label: 'a 12-bit 4:2:2 sequence header',
        sequenceHeader: av1.sequenceHeader12Bit422,
        expected: { chroma_format: 2, chroma_format_string: '4:2:2' }
    },
    {
        // Used to throw too: the color description was shadowed, so the parser missed the sRGB
        // branch, and read color_range, subsampling_x and chroma_sample_position, 4 bits that are
        // not coded, past the 3 trailing bits
        label: 'a 12-bit sRGB sequence header',
        sequenceHeader: av1.sequenceHeader12BitSrgb,
        expected: { chroma_format: 3, chroma_format_string: '4:4:4' }
    },
    {
        // Came out as 4:4:4 only because the parser missed the sRGB branch, which inferred 4:2:0,
        // and took the profile 1 branch, reading a color_range that is not coded
        label: 'a profile 1 sRGB sequence header',
        sequenceHeader: av1.sequenceHeaderSrgb,
        expected: { chroma_format: 3, chroma_format_string: '4:4:4' }
    }
]) {
    test(`AV1OBUParser parses the chroma format of ${label}`, () => {
        const details = AV1OBUParser.parseOBUs(sequenceHeader);
        assert.deepEqual(pick(details, Object.keys(expected)), expected);
    });
}
