/*
 * Copyright (C) 2023 もにょてっく. All Rights Reserved.
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

import Log from "../utils/logger";

export class AV1OBUInMpegTsParser {

    private readonly TAG: string = "AV1OBUInMpegTsParser";

    private data_: Uint8Array;
    private current_startcode_offset_: number = 0;
    private eof_flag_: boolean = false;

    static _ebsp2rbsp(uint8array: Uint8Array) {
        let src = uint8array;
        let src_length = src.byteLength;
        let dst = new Uint8Array(src_length);
        let dst_idx = 0;

        for (let i = 0; i < src_length; i++) {
            if (i >= 2) {
                // Unescape: Skip 0x03 after 00 00
                if (src[i] === 0x03 && src[i - 1] === 0x00 && src[i - 2] === 0x00) {
                    continue;
                }
            }
            dst[dst_idx] = src[i];
            dst_idx++;
        }

        return new Uint8Array(dst.buffer, 0, dst_idx);
    }

    public constructor(data: Uint8Array) {
        this.data_ = data;
        this.current_startcode_offset_ = this.findNextStartCodeOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, "Could not find AV1 startcode until payload end!");
        }
    }

    private findNextStartCodeOffset(start_offset: number) {
        let i = start_offset;
        let data = this.data_;

        while (true) {
            if (i + 2 >= data.byteLength) {
                this.eof_flag_ = true;
                return data.byteLength;
            }

            // search 00 00 01
            let uint24 = (data[i + 0] << 16)
                        | (data[i + 1] << 8)
                        | (data[i + 2]);
            if (uint24 === 0x000001) {
                return i;
            } else {
                i++;
            }
        }
    }

    public readNextOBUPayload(): Uint8Array | null {
        let data = this.data_;
        let payload: Uint8Array | null = null;

        while (payload == null) {
            if (this.eof_flag_) {
                break;
            }
            // offset pointed to start code
            let startcode_offset = this.current_startcode_offset_;

            // nalu payload start offset
            let offset = startcode_offset + 3;
            let next_startcode_offset = this.findNextStartCodeOffset(offset);
            this.current_startcode_offset_ = next_startcode_offset;

            payload = AV1OBUInMpegTsParser._ebsp2rbsp(data.subarray(offset, next_startcode_offset));
        }

        return payload;
    }

}

export default AV1OBUInMpegTsParser;