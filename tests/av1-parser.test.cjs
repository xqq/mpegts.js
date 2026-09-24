const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { hex, av1 } = require('./helpers/video.cjs');

const AV1OBUParser = loadSource()('demux/av1-parser.ts').default;

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
