/*
 * Licensed under the Apache License, Version 2.0.
 * See the repository LICENSE for the full license text.
 */

import { Mp3Encoder } from '@breezystack/lamejs';
import { decodeG711Sample, G711Codec } from './g711';
import { MP3Frame, MP3FrameParser } from './mp3';

export interface G711MP3Frame extends MP3Frame {
    dts: number;
}

// lamejs 1.2.7 uses LAME's 576-sample encoder delay and 528+1 decoder delay
// (Encoder.ENCDELAY / DECDELAY). Timestamp the priming samples before the input
// timeline so decoded speech, rather than the encoded silence, aligns to video.
const MP3_PRIMING_SAMPLES = 576 + 528 + 1;
const SAMPLE_RATE = 8000;

export default class G711Transcoder {
    public readonly codec: G711Codec;
    public readonly channelCount: number;

    private encoder_: Mp3Encoder | null;
    private first_dts_: number | null = null;
    private output_samples_: number = 0;
    private pending_data_: Uint8Array | null = null;

    public constructor(codec: G711Codec, channelCount: number) {
        if ((codec !== 7 && codec !== 8) || (channelCount !== 1 && channelCount !== 2)) {
            throw new Error('Invalid G.711 codec or channel count');
        }
        this.codec = codec;
        this.channelCount = channelCount;
        this.encoder_ = new Mp3Encoder(channelCount, SAMPLE_RATE, 64);
    }

    public transcode(data: Uint8Array, dts: number): G711MP3Frame[] {
        if (!this.encoder_) {
            throw new Error('G.711 encoder is closed');
        }
        if (!Number.isFinite(dts) || data.byteLength === 0 || data.byteLength % this.channelCount !== 0) {
            throw new Error('Invalid G.711 timestamp or interleaved audio payload');
        }
        if (this.first_dts_ === null) {
            this.first_dts_ = dts;
        }

        const samples = data.byteLength / this.channelCount;
        const left = new Int16Array(samples);
        const right = this.channelCount === 2 ? new Int16Array(samples) : undefined;
        for (let i = 0; i < samples; i++) {
            left[i] = decodeG711Sample(data[i * this.channelCount], this.codec);
            if (right) {
                right[i] = decodeG711Sample(data[i * this.channelCount + 1], this.codec);
            }
        }

        return this.parseOutput(this.encoder_.encodeBuffer(left, right));
    }

    public flush(): G711MP3Frame[] {
        if (!this.encoder_ || this.first_dts_ === null) {
            this.destroy();
            return [];
        }
        const frames = this.parseOutput(this.encoder_.flush());
        this.destroy();
        return frames;
    }

    public destroy(): void {
        this.encoder_ = null;
        this.pending_data_ = null;
    }

    private parseOutput(output: Uint8Array): G711MP3Frame[] {
        if (output.byteLength === 0) {
            return [];
        }
        // The encoder reuses its output buffer, and may return part of a frame.
        // Own the bytes and carry the incomplete suffix into the next call.
        const data = new Uint8Array((this.pending_data_?.byteLength || 0) + output.byteLength);
        if (this.pending_data_) {
            data.set(this.pending_data_);
        }
        data.set(output, this.pending_data_?.byteLength || 0);

        const parser = new MP3FrameParser(data);
        const frames: G711MP3Frame[] = [];
        let frame: MP3Frame | null;
        while ((frame = parser.readNextMP3Frame()) !== null) {
            frames.push({
                ...frame,
                dts: this.first_dts_! + (this.output_samples_ - MP3_PRIMING_SAMPLES) / SAMPLE_RATE * 1000
            });
            this.output_samples_ += frame.samples_per_frame;
        }
        this.pending_data_ = parser.getIncompleteData();
        return frames;
    }
}
