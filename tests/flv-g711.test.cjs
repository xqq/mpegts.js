const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { mp3Frame, concatBytes } = require('./helpers/mp3.cjs');

// Golden PCM16 vectors for bytes 0..255 decoded by FFmpeg's pcm_alaw / pcm_mulaw.
// No FFmpeg installation is needed to run these conformance tests.
const vectors = {
    "alaw": "gOqA64DogOmA7oDvgOyA7YDigOOA4IDhgOaA54DkgOVA9cD1QPTA9ED3wPdA9sD2QPHA8UDwwPBA88DzQPLA8gCqAK4AogCmALoAvgCyALYAigCOAIIAhgCaAJ4AkgCWANUA1wDRANMA3QDfANkA2wDFAMcAwQDDAM0AzwDJAMuo/rj+iP6Y/uj++P7I/tj+KP44/gj+GP5o/nj+SP5Y/qj/uP+I/5j/6P/4/8j/2P8o/zj/CP8Y/2j/eP9I/1j/oPrg+iD6YPqg++D7IPtg+6D44Pgg+GD4oPng+SD5YPlQ/XD9EP0w/dD98P2Q/bD9UPxw/BD8MPzQ/PD8kPyw/IAVgBSAF4AWgBGAEIATgBKAHYAcgB+AHoAZgBiAG4AawApACsALQAvACEAIwAlACcAOQA7AD0APwAxADMANQA0AVgBSAF4AWgBGAEIATgBKAHYAcgB+AHoAZgBiAG4AagArACkALwAtACMAIQAnACUAOwA5AD8APQAzADEANwA1WAFIAXgBaAEYAQgBOAEoAdgByAH4AegBmAGIAbgBqAFYAEgAeABoABgACAA4ACgA2ADIAPgA6ACYAIgAuACoAGAFIAXgBaAFYAQgBOAEoARgByAH4AegB2AGIAbgBqAGsAKQAvAC0AIwAhACcAJQArADkAPwA9ADMAMQA3ADUAM=",
    "mulaw": "hIKEhoSKhI6EkoSWhJqEnoSihKaEqoSuhLKEtoS6hL6EwYTDhMWEx4TJhMuEzYTPhNGE04TVhNeE2YTbhN2E3wThBOIE4wTkBOUE5gTnBOgE6QTqBOsE7ATtBO4E7wTwxPBE8cTxRPLE8kTzxPNE9MT0RPXE9UT2xPZE98T3RPik+OT4JPlk+aT55Pkk+mT6pPrk+iT7ZPuk++T7JPxk/JT8tPzU/PT8FP00/VT9dP2U/bT91P30/RT+NP5U/nT+jP6c/qz+vP7M/tz+7P78/gz/HP8s/zz/TP9c/2z/fP+I/5D/mP+g/6j/sP+4/8D/yP/Q/9j/4P/o//D/+P8AAHx9fHl8dXxxfG18aXxlfGF8XXxZfFV8UXxNfEl8RXxBfD58PHw6fDh8Nnw0fDJ8MHwufCx8KnwofCZ8JHwifCD8Hvwd/Bz8G/wa/Bn8GPwX/Bb8FfwU/BP8EvwR/BD8DzwPvA48DrwNPA28DDwMvAs8C7wKPAq8CTwJvAg8CLwHXAccB9wGnAZcBhwG3AWcBVwFHAXcBJwEXAQcBNwDnANsA0wDLAMMA+wCzAKsAowCbAJMAiwCDALsAcwBrAGMAXQBZAFUAUQBNAEkARQBBAH0AOQA1ADEALQApACUAIQAeABwAGgAYABYAFAASABAADgAMAAoACAAGAAQAAgAAAA="
};
const load = loadSource();
const { decodeG711Sample } = load('demux/g711.ts');
const G711Transcoder = load('demux/g711-transcoder.ts').default;
const FLVDemuxer = load('demux/flv-demuxer.js').default;

for (const [codec, law] of [[7, 'alaw'], [8, 'mulaw']]) {
    test(`G.711 ${law} reconstructs all 256 codewords`, () => {
        const pcm = Buffer.from(vectors[law], 'base64');
        for (let i = 0; i < 256; i++) {
            assert.equal(decodeG711Sample(i, codec), pcm.readInt16LE(i * 2), `codeword ${i}`);
        }
    });

    for (const channels of [1, 2]) {
        test(`G.711 ${law}, ${channels} channels transcodes real MP3 frames with a sample-based clock`, () => {
            const transcoder = new G711Transcoder(codec, channels);
            const frames = [];
            let inputSamples = 0;
            for (const size of [1, 159, 333, 7, 160, 1000, 1540]) {
                const data = new Uint8Array(size * channels).fill(codec === 7 ? 0xD5 : 0xFF);
                frames.push(...transcoder.transcode(data, 1000 + inputSamples / 8));
                inputSamples += size;
            }
            const beforeFlush = frames.length;
            frames.push(...transcoder.flush());
            assert.ok(frames.length > beforeFlush, 'EOF includes the buffered encoder tail');
            assert.deepEqual(Array.from(transcoder.flush()), [], 'flush is idempotent');
            assert.ok(frames.length > 1);
            let samples = 0;
            for (const frame of frames) {
                assert.equal(frame.sample_rate, 8000);
                assert.equal(frame.channel_count, channels);
                assert.equal(frame.samples_per_frame, 576);
                assert.equal(frame.dts, 1000 + (samples - 1105) / 8);
                samples += frame.samples_per_frame;
            }
            assert.ok(samples >= inputSamples + 1105);
            assert.ok(samples < inputSamples + 1105 + 1152, 'bounded end padding');
        });
    }
}

test('G.711 stereo deinterleaves independent left and right samples', () => {
    const transcoder = new G711Transcoder(7, 2);
    let channels;
    transcoder.encoder_ = { encodeBuffer(left, right) { channels = [Array.from(left), Array.from(right)]; return new Uint8Array(); } };
    transcoder.transcode(Uint8Array.of(0xD5, 0x55, 0xAA, 0x2A), 0);
    assert.deepEqual(channels, [[8, 32256], [-8, -32256]]);
});

test('G.711 encoder output retains partial MP3 frames and owns reused bytes', () => {
    const frame = mp3Frame([0xFF, 0xE3, 0x18, 0xC0], 72);
    const pieces = [frame.subarray(0, 2), frame.subarray(2, 31), concatBytes(frame.subarray(31), frame)];
    const transcoder = new G711Transcoder(7, 1);
    transcoder.encoder_ = { encodeBuffer() { return pieces.shift(); } };
    assert.equal(transcoder.transcode(Uint8Array.of(0xD5), 1000).length, 0);
    assert.equal(transcoder.transcode(Uint8Array.of(0xD5), 1000).length, 0);
    const frames = transcoder.transcode(Uint8Array.of(0xD5), 1000);
    assert.equal(frames.length, 2);
    frame.fill(0);
    assert.equal(frames[0].data[0], 0xFF);
    assert.equal(frames[1].dts - frames[0].dts, 72);
});

test('G.711 rejects malformed channel payloads and invalid timestamps', () => {
    assert.throws(() => new G711Transcoder(9, 1), /Invalid G.711/);
    assert.throws(() => new G711Transcoder(7, 3), /Invalid G.711/);
    const transcoder = new G711Transcoder(8, 2);
    assert.throws(() => transcoder.transcode(Uint8Array.of(0xFF), 0), /interleaved/);
    assert.throws(() => transcoder.transcode(new Uint8Array(2), NaN), /timestamp/);
    assert.throws(() => transcoder.transcode(new Uint8Array(), 0), /payload/);
    transcoder.destroy();
    assert.throws(() => transcoder.transcode(new Uint8Array(2), 0), /closed/);
});

function createDemuxer() {
    const metadata = [];
    const errors = [];
    const demuxer = new FLVDemuxer({ dataOffset: 9, hasAudioTrack: true, hasVideoTrack: false }, {});
    demuxer.onError = (type, info) => errors.push({ type, info });
    demuxer.onMediaInfo = () => {};
    demuxer.onTrackMetadata = (type, meta) => metadata.push({ codec: meta.codec, rate: meta.audioSampleRate, channels: meta.channelCount, duration: meta.refSampleDuration });
    demuxer.onDataAvailable = () => {};
    return { demuxer, metadata, errors };
}

function parseTag(demuxer, codec, channels, size, dts) {
    const body = new Uint8Array(1 + size * channels);
    body[0] = codec << 4 | (channels === 2 ? 1 : 0);
    body.fill(codec === 7 ? 0xD5 : 0xFF, 1);
    demuxer._parseAudioData(body.buffer, 0, body.byteLength, dts);
}

for (const codec of [7, 8]) {
    test(`FLV codec ${codec} publishes MP3 metadata from the actual output header and flushes short input`, () => {
        const { demuxer, metadata, errors } = createDemuxer();
        parseTag(demuxer, codec, 1, 160, 1000);
        assert.equal(metadata.length, 0, 'metadata waits for an actual MP3 frame');
        demuxer.flushAudio();
        assert.deepEqual(errors, []);
        assert.deepEqual(metadata, [{ codec: 'mp3', rate: 8000, channels: 1, duration: 72 }]);
        assert.ok(demuxer._audioTrack.samples.length > 0);
        assert.equal(demuxer._audioTrack.samples[0].dts, 861);
    });

    test(`FLV codec ${codec} with hasAudio:false skips decoding and encoder creation`, () => {
        const { demuxer, errors } = createDemuxer();
        demuxer.overridedHasAudio = false;
        parseTag(demuxer, codec, 1, 1000, 0);
        demuxer.flushAudio();
        assert.equal(demuxer._g711Transcoder, null);
        assert.equal(demuxer._audioTrack.samples.length, 0);
        assert.deepEqual(errors, []);
    });
}

test('FLV G.711 reset discards encoder tail and starts the new timeline at seek position', () => {
    const { demuxer } = createDemuxer();
    parseTag(demuxer, 7, 1, 2000, 0);
    assert.ok(demuxer._audioTrack.samples.length);
    demuxer.resetAudio();
    assert.equal(demuxer._audioTrack.samples.length, 0);
    parseTag(demuxer, 8, 1, 160, 10000);
    demuxer.flushAudio();
    assert.equal(demuxer._audioTrack.samples[0].dts, 9861);
    assert.ok(demuxer._audioTrack.samples.every(sample => sample.dts >= 9861));
});

test('FLV G.711 reports malformed stereo input through onError', () => {
    const { demuxer, errors } = createDemuxer();
    const body = Uint8Array.of(0x71, 0xD5);
    demuxer._parseAudioData(body.buffer, 0, body.byteLength, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].info, /Invalid G.711/);
    assert.equal(demuxer._g711Transcoder, null);
});

test('controller flushes G.711 before remuxer flush and loading-complete, including segment boundaries', () => {
    const Controller = load('core/transmuxing-controller.js').default;
    for (const segments of [[{}], [{}, {}]]) {
        const calls = [];
        const controller = Object.create(Controller.prototype);
        controller._mediaDataSource = { segments };
        controller._demuxer = { flushAudio() { calls.push('encoder'); } };
        controller._remuxer = { flushStashedSamples() { calls.push('remuxer'); } };
        controller._emitter = { emit() { calls.push('complete'); } };
        controller._disableStatisticsReporter = () => {};
        controller._loadSegment = () => calls.push('next-segment');
        controller._onIOComplete(0);
        assert.deepEqual(calls, ['encoder', 'remuxer', segments.length === 1 ? 'complete' : 'next-segment']);
    }
});

test('controller discards G.711 state before inserting seek discontinuity', () => {
    const Controller = load('core/transmuxing-controller.js').default;
    const calls = [];
    const controller = Object.create(Controller.prototype);
    controller._demuxer = { resetAudio() { calls.push('reset'); } };
    controller._remuxer = { insertDiscontinuity() { calls.push('discontinuity'); } };
    controller._onIOSeeked();
    assert.deepEqual(calls, ['reset', 'discontinuity']);
});
