/*
 * Copyright (C) 2021 magicxqq. All Rights Reserved.
 *
 * @author magicxqq <xqq@xqq.im>
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

import Log from '../utils/logger.js';
import DemuxErrors from './demux-errors.js';
import MediaInfo from '../core/media-info';
import {IllegalStateException} from '../utils/exception.js';
import BaseDemuxer from './base-demuxer';
import { PAT, PMT, ProgramPMTMap, StreamType } from './patpmt';

class TSDemuxer extends BaseDemuxer {

    private TAG: string = "TSDemuxer";

    private config_: any;
    private ts_packet_size_: number;
    private sync_offset_: number;
    private first_parse_: boolean = true;
    private do_dispatch_: boolean;

    private media_info_ = new MediaInfo();

    private pat_: PAT;
    private current_program_: number;
    private current_pmt_pid_: number = -1;
    private pmt_: PMT;
    private program_pmt_map: ProgramPMTMap = {};

    private video_track_ = {type: 'video', id: 1, sequenceNumber: 0, samples: [], length: 0};
    private audio_track_ = {type: 'audio', id: 2, sequenceNumber: 0, samples: [], length: 0};

    public constructor(probe_data: any, config: any) {
        super();

        this.ts_packet_size_ = probe_data.ts_packet_size;
        this.sync_offset_ = probe_data.sync_offset;
        this.config_ = config;
    }

    public destroy() {
        super.destroy();
    }

    public static probe(buffer: ArrayBuffer) {
        let data = new Uint8Array(buffer);
        let sync_offset = -1;
        let ts_packet_size = 188;

        if (data.byteLength <= 3 * ts_packet_size) {
            Log.e("TSDemuxer", `Probe data ${data.byteLength} bytes is too few for judging MPEG-TS stream format!`);
            return {match: false};
        }

        while (sync_offset === -1) {
            let scan_window = Math.min(1000, data.byteLength - 3 * ts_packet_size);

            for (let i = 0; i < scan_window; ) {
                // sync_byte should all be 0x47
                if (data[i] === 0x47 && data[i + ts_packet_size] === 0x47 && data[i + 2 * ts_packet_size] === 0x47) {
                    sync_offset = i;
                    break;
                } else {
                    i++;
                }
            }

            // find sync_offset failed in previous ts_packet_size
            if (sync_offset === -1) {
                if (ts_packet_size === 188) {
                    // try 192 packet size (BDAV, etc.)
                    ts_packet_size = 192;
                } else {
                    // 192 also failed, exit
                    break;
                }
            }
        }

        if (sync_offset === -1) {
            // both 188 / 192 failed, Non MPEG-TS
            return {match: false};
        }

        return {
            match: true,
            consumed: 0,
            ts_packet_size,
            sync_offset
        };
    }

    public bindDataSource(loader) {
        loader.onDataArrival = this.parseChunks.bind(this);
        return this;
    }

    public resetMediaInfo() {
        this.media_info_ = new MediaInfo();
    }

    private isInitialMetadataDispatched() {
        return false;
    }

    public parseChunks(chunk: ArrayBuffer, byteStart: number): number {
        if (!this.onError || !this.onMediaInfo ||
            !this.onTrackMetadata || !this.onDataAvailable) {
            throw new IllegalStateException('onError & onMediaInfo & onTrackMetadata & onDataAvailable callback must be specified');
        }

        let offset = this.sync_offset_;

        while (offset + this.ts_packet_size_ <= chunk.byteLength) {
            let v = new DataView(chunk, offset, this.ts_packet_size_);

            let sync_byte = v.getUint8(0);
            if (sync_byte !== 0x47) {
                Log.e(this.TAG, `sync_byte = ${sync_byte}, not 0x47`);
                break;
            }

            let payload_unit_start_indicator = (v.getUint8(1) & 0x40) >>> 6;
            let transport_priority = (v.getUint8(1) & 0x20) >>> 5;

            let pid_part1 = (v.getUint8(1) & 0x1F);
            let pid_part2 = (v.getUint8(2));
            let pid = (pid_part1 << 8) | pid_part2;

            let adaptation_field_control = (v.getUint8(3) & 0x30) >>> 4;
            let continuity_conunter = (v.getUint8(3) & 0x0F);

            let ts_payload_start_index = 4;

            if (adaptation_field_control == 0x02 || adaptation_field_control == 0x03) {
                let adaptation_field_length = v.getUint8(4);
                if (5 + adaptation_field_length === this.ts_packet_size_) {
                    // TS packet only has adaption field, jump to next
                    offset += this.ts_packet_size_;
                    continue;
                } else {
                    ts_payload_start_index = 4 + 1 + adaptation_field_length;
                }
            }

            if (adaptation_field_control == 0x01 || adaptation_field_control == 0x03) {
                if (pid === 0 || pid === this.current_pmt_pid_) {  // PAT(pid === 0) or PMT
                    if (payload_unit_start_indicator) {
                        let pointer_field = v.getUint8(ts_payload_start_index);
                        // skip pointer_field and strange data
                        ts_payload_start_index += 1 + pointer_field;
                    }
                    let ts_payload_length = this.ts_packet_size_ - ts_payload_start_index;

                    if (pid === 0) {
                        this.parsePAT(chunk,
                                      offset + ts_payload_start_index,
                                      ts_payload_length,
                                      {payload_unit_start_indicator, continuity_conunter});
                    } else {
                        this.parsePMT(chunk,
                                      offset + ts_payload_start_index,
                                      ts_payload_length,
                                      {payload_unit_start_indicator, continuity_conunter});
                    }
                } else if (this.pmt_ != undefined && this.pmt_.pid_stream_type[pid] != undefined) {
                    // parse PES
                    let stream_type = this.pmt_.pid_stream_type[pid];
                    switch (stream_type) {
                        case StreamType.kMPEG1Audio:
                        case StreamType.kMPEG2Audio:
                            break;
                        case StreamType.kPESPrivateData:
                            break;
                        case StreamType.kADTSAAC:
                            // Log.v(this.TAG, `AAC PES: pid = ${pid}, type = ${stream_type}`);
                            break;
                        case StreamType.kID3:
                            // Log.v(this.TAG, `ID3 PES: pid = ${pid}, type = ${stream_type}`);
                            break;
                        case StreamType.kH264:
                            // Log.v(this.TAG, `H264 PES: pid = ${pid}, type = ${stream_type}`);
                            break;
                        case StreamType.kH265:
                            break;
                        default:
                            break;
                    }
                }
            }

            offset += this.ts_packet_size_;
        }

        // dispatch parsed frames to the remuxer (consumer)
        if (this.isInitialMetadataDispatched()) {
            if (this.do_dispatch_ && (this.audio_track_.length || this.video_track_.length)) {
                this.onDataAvailable(this.audio_track_, this.video_track_);
            }
        }

        return offset;  // consumed bytes
    }

    private parsePAT(buffer: ArrayBuffer, offset: number, length: number, misc: object): void {
        let data = new Uint8Array(buffer, offset, length);

        let table_id = data[0];
        if (table_id !== 0x00) {
            Log.e(this.TAG, `parsePAT: table_id ${table_id} is not corresponded to PAT!`);
            return;
        }

        let section_length_part1 = data[1] & 0x0F;
        let section_length_part2 = data[2];
        let section_length = (section_length_part1 << 8) | section_length_part2;

        let transport_stream_id = (data[3] << 8) | data[4];
        let version_number = (data[5] & 0x3E) >>> 1;
        let current_next_indicator = data[5] & 0x01;
        let section_number = data[6];
        let last_section_number = data[7];

        if (current_next_indicator === 1 && section_number === 0) {
            this.pat_ = new PAT();
            this.pat_.version_number = version_number;
        } else {
            if (this.pat_ == undefined) {
                return;
            }
        }

        let program_start_index = 8;
        let program_bytes = section_length - 5 - 4;  // section_length - (headers + crc)
        let first_program_number = -1;
        let first_pmt_pid = -1;

        for (let i = program_start_index; i < program_start_index + program_bytes; i += 4) {
            let program_number = (data[i] << 8) | data[i + 1];
            let pid = ((data[i + 2] & 0x1F) << 8) | data[i + 3];

            if (program_number === 0) {
                // network_PID
                this.pat_.network_pid = pid;
            } else {
                // program_map_PID
                this.pat_.program_pmt_pid[program_number] = pid;

                if (first_program_number === -1) {
                    first_program_number = program_number;
                }

                if (first_pmt_pid === -1) {
                    first_pmt_pid = pid;
                }
            }
        }

        // Currently we only deal with first appeared PMT pid
        if (current_next_indicator === 1 && section_number === 0) {
            this.current_program_ = first_program_number;
            this.current_pmt_pid_ = first_pmt_pid;
            Log.v(this.TAG, `PAT: ${JSON.stringify(this.pat_)}`);
        }
    }

    private parsePMT(buffer: ArrayBuffer, offset: number, length: number, misc: object): void {
        let data = new Uint8Array(buffer, offset, length);

        let table_id = data[0];
        if (table_id !== 0x02) {
            Log.e(this.TAG, `parsePMT: table_id ${table_id} is not corresponded to PMT!`);
            return;
        }

        let section_length_part1 = data[1] & 0x0F;
        let section_length_part2 = data[2];
        let section_length = (section_length_part1 << 8) | section_length_part2;

        let program_number = (data[3] << 8) | data[4];
        let version_number = (data[5] & 0x3E) >>> 1;
        let current_next_indicator = data[5] & 0x01;
        let section_number = data[6];
        let last_section_number = data[7];

        let pmt: PMT = null;

        if (current_next_indicator === 1 && section_number === 0) {
            pmt = new PMT();
            pmt.program_number = program_number;
            pmt.version_number = version_number;
            this.program_pmt_map[program_number] = pmt;
        } else {
            pmt = this.program_pmt_map[program_number];
            if (pmt == undefined) {
                return;
            }
        }

        let PCR_PID = ((data[8] & 0x1F) << 8) | data[9];
        let program_info_length = ((data[10] & 0x0F) << 8) | data[11];

        let info_start_index = 12 + program_info_length;
        let info_bytes = section_length - 9 - program_info_length - 4;

        for (let i = info_start_index; i < info_start_index + info_bytes; ) {
            let stream_type = data[i] as StreamType;
            let elementary_PID = ((data[i + 1] & 0x1F) << 8) | data[i + 2];

            pmt.pid_stream_type[elementary_PID] = stream_type;

            let ES_info_length = ((data[i + 3] & 0x0F) << 8) | data[i + 4];
            i += 5 + ES_info_length;
        }

        if (program_number === this.current_program_) {
            this.pmt_ = pmt;
            Log.v(this.TAG, `PMT: ${JSON.stringify(pmt)}`);
        }
    }

}

export default TSDemuxer;
