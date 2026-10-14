import { G711Codec } from './g711';
import { MP3Frame } from './mp3';
export interface G711MP3Frame extends MP3Frame {
    dts: number;
}
export default class G711Transcoder {
    readonly codec: G711Codec;
    readonly channelCount: number;
    private encoder_;
    private first_dts_;
    private output_samples_;
    private pending_data_;
    constructor(codec: G711Codec, channelCount: number);
    transcode(data: Uint8Array, dts: number): G711MP3Frame[];
    flush(): G711MP3Frame[];
    destroy(): void;
    private parseOutput;
}
