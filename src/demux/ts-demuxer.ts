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

import Log from '../utils/logger';
import DemuxErrors from './demux-errors';
import MediaInfo from '../core/media-info';
import {IllegalStateException} from '../utils/exception';
import BaseDemuxer from './base-demuxer';
import { PAT, PESData, PESSliceQueue, PIDToPESSliceQueues, PMT, ProgramToPMTMap, StreamType } from './pat-pmt-pes';
import { AVCDecoderConfigurationRecord, H264AnnexBParser, H264NaluAVC1, H264NaluPayload, H264NaluType } from './h264';
import SPSParser from './sps-parser';
import { AACADTSParser, AACFrame, AudioSpecificConfig } from './aac';
import { MPEG4AudioObjectTypes, MPEG4SamplingFrequencyIndex } from './mpeg4-audio';
import { PESPrivateData, PESPrivateDataDescriptor } from './pes-private-data';

class TSDemuxer extends BaseDemuxer {

    private readonly TAG: string = 'TSDemuxer';

    private config_: any;
    private ts_packet_size_: number;
    private sync_offset_: number;
    private first_parse_: boolean = true;

    private media_info_ = new MediaInfo();

    private timescale_ = 90;
    private duration_ = 0;

    private pat_: PAT;
    private current_program_: number;
    private current_pmt_pid_: number = -1;
    private pmt_: PMT;
    private program_pmt_map_: ProgramToPMTMap = {};

    private pes_slice_queues_: PIDToPESSliceQueues = {};

    private video_metadata_: {
        sps: H264NaluAVC1 | undefined,
        pps: H264NaluAVC1 | undefined,
        sps_details: any
    } = {
        sps: undefined,
        pps: undefined,
        sps_details: undefined
    };

    private audio_metadata_: {
        audio_object_type: MPEG4AudioObjectTypes;
        sampling_freq_index: MPEG4SamplingFrequencyIndex;
        sampling_frequency: number;
        channel_config: number;
    } = {
        audio_object_type: undefined,
        sampling_freq_index: undefined,
        sampling_frequency: undefined,
        channel_config: undefined
    };

    private aac_last_sample_pts_: number = undefined;
    private aac_last_incomplete_data_: Uint8Array = null;

    private has_video_ = false;
    private has_audio_ = false;
    private video_init_segment_dispatched_ = false;
    private audio_init_segment_dispatched_ = false;
    private video_metadata_changed_ = false;
    private audio_metadata_changed_ = false;

    private video_track_ = {type: 'video', id: 1, sequenceNumber: 0, samples: [], length: 0};
    private audio_track_ = {type: 'audio', id: 2, sequenceNumber: 0, samples: [], length: 0};

    public constructor(probe_data: any, config: any) {
        super();

        this.ts_packet_size_ = probe_data.ts_packet_size;
        this.sync_offset_ = probe_data.sync_offset;
        this.config_ = config;
    }

    public destroy() {
        this.media_info_ = null;
        this.pes_slice_queues_ = null;

        this.video_metadata_ = null;
        this.audio_metadata_ = null;
        this.aac_last_incomplete_data_ = null;

        this.video_track_ = null;
        this.audio_track_ = null;

        super.destroy();
    }

    public static probe(buffer: ArrayBuffer) {
        let data = new Uint8Array(buffer);
        let sync_offset = -1;
        let ts_packet_size = 188;

        if (data.byteLength <= 3 * ts_packet_size) {
            Log.e('TSDemuxer', `Probe data ${data.byteLength} bytes is too few for judging MPEG-TS stream format!`);
            return {match: false};
        }

        while (sync_offset === -1) {
            let scan_window = Math.min(1000, data.byteLength - 3 * ts_packet_size);

            for (let i = 0; i < scan_window; ) {
                // sync_byte should all be 0x47
                if (data[i] === 0x47
                        && data[i + ts_packet_size] === 0x47
                        && data[i + 2 * ts_packet_size] === 0x47) {
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
                } else if (ts_packet_size === 192) {
                    // try 204 packet size (European DVB, etc.)
                    ts_packet_size = 204;
                } else {
                    // 192, 204 also failed, exit
                    break;
                }
            }
        }

        if (sync_offset === -1) {
            // both 188, 192, 204 failed, Non MPEG-TS
            return {match: false};
        }

        if (ts_packet_size === 192 && sync_offset >= 4) {
            Log.v('TSDemuxer', `ts_packet_size = 192, m2ts mode`);
            sync_offset -= 4;
        } else if (ts_packet_size === 204) {
            Log.v('TSDemuxer', `ts_packet_size = 204, RS encoded MPEG2-TS stream`);
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

    public parseChunks(chunk: ArrayBuffer, byte_start: number): number {
        if (!this.onError
                || !this.onMediaInfo
                || !this.onTrackMetadata
                || !this.onDataAvailable) {
            throw new IllegalStateException('onError & onMediaInfo & onTrackMetadata & onDataAvailable callback must be specified');
        }

        let offset = 0;

        if (this.first_parse_) {
            this.first_parse_ = false;
            offset = this.sync_offset_;
        }

        while (offset + this.ts_packet_size_ <= chunk.byteLength) {
            let file_position = byte_start + offset;

            if (this.ts_packet_size_ === 192) {
                // skip ATS field (2-bits copy-control + 30-bits timestamp) for m2ts
                offset += 4;
            }

            let data = new Uint8Array(chunk, offset, 188);

            let sync_byte = data[0];
            if (sync_byte !== 0x47) {
                Log.e(this.TAG, `sync_byte = ${sync_byte}, not 0x47`);
                break;
            }

            let payload_unit_start_indicator = (data[1] & 0x40) >>> 6;
            let transport_priority = (data[1] & 0x20) >>> 5;
            let pid = ((data[1] & 0x1F) << 8) | data[2];
            let adaptation_field_control = (data[3] & 0x30) >>> 4;
            let continuity_conunter = (data[3] & 0x0F);

            let adaptation_field_info: {
                discontinuity_indicator?: number,
                random_access_indicator?: number,
                elementary_stream_priority_indicator?: number
            } = {};
            let ts_payload_start_index = 4;

            if (adaptation_field_control == 0x02 || adaptation_field_control == 0x03) {
                let adaptation_field_length = data[4];
                if (5 + adaptation_field_length === 188) {
                    // TS packet only has adaption field, jump to next
                    offset += 188;
                    if (this.ts_packet_size_ === 204) {
                        // skip parity word (16 bytes) for RS encoded TS
                        offset += 16;
                    }
                    continue;
                } else {
                    // parse leading adaptation_field if has payload
                    if (adaptation_field_length > 0) {
                        adaptation_field_info = this.parseAdaptationField(chunk,
                                                                          offset + 4,
                                                                          1 + adaptation_field_length);
                    }
                    ts_payload_start_index = 4 + 1 + adaptation_field_length;
                }
            }

            if (adaptation_field_control == 0x01 || adaptation_field_control == 0x03) {
                if (pid === 0 || pid === this.current_pmt_pid_) {  // PAT(pid === 0) or PMT
                    if (payload_unit_start_indicator) {
                        let pointer_field = data[ts_payload_start_index];
                        // skip pointer_field and strange data
                        ts_payload_start_index += 1 + pointer_field;
                    }
                    let ts_payload_length = 188 - ts_payload_start_index;

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
                    // PES
                    let ts_payload_length = 188 - ts_payload_start_index;
                    let stream_type = this.pmt_.pid_stream_type[pid];

                    // process PES only for known common_pids
                    if (pid === this.pmt_.common_pids.h264
                            || pid === this.pmt_.common_pids.adts_aac
                            || this.pmt_.pes_private_data_pids[pid] === true
                            || this.pmt_.timed_id3_pids[pid] === true) {
                        this.handlePESSlice(chunk,
                                            offset + ts_payload_start_index,
                                            ts_payload_length,
                                            {
                                                pid,
                                                stream_type,
                                                file_position,
                                                payload_unit_start_indicator,
                                                continuity_conunter,
                                                random_access_indicator: adaptation_field_info.random_access_indicator
                                            });
                    }
                }
            }

            offset += 188;

            if (this.ts_packet_size_ === 204) {
                // skip parity word (16 bytes) for RS encoded TS
                offset += 16;
            }
        }

        // dispatch parsed frames to the remuxer (consumer)
        this.dispatchAudioVideoMediaSegment();

        return offset;  // consumed bytes
    }

    private parseAdaptationField(buffer: ArrayBuffer, offset: number, length: number): {
        discontinuity_indicator?: number,
        random_access_indicator?: number,
        elementary_stream_priority_indicator?: number
    } {
        let data = new Uint8Array(buffer, offset, length);

        let adaptation_field_length = data[0];
        if (adaptation_field_length > 0) {
            if (adaptation_field_length > 183) {
                Log.w(this.TAG, `Illegal adaptation_field_length: ${adaptation_field_length}`);
                return {};
            }

            let discontinuity_indicator: number = (data[1] & 0x80) >>> 7;
            let random_access_indicator: number = (data[1] & 0x40) >>> 6;
            let elementary_stream_priority_indicator: number = (data[1] & 0x20) >>> 5;

            return {
                discontinuity_indicator,
                random_access_indicator,
                elementary_stream_priority_indicator
            };
        }

        return {};
    }

    private parsePAT(buffer: ArrayBuffer, offset: number, length: number, misc: any): void {
        let data = new Uint8Array(buffer, offset, length);

        let table_id = data[0];
        if (table_id !== 0x00) {
            Log.e(this.TAG, `parsePAT: table_id ${table_id} is not corresponded to PAT!`);
            return;
        }

        let section_length = ((data[1] & 0x0F) << 8) | data[2];

        let transport_stream_id = (data[3] << 8) | data[4];
        let version_number = (data[5] & 0x3E) >>> 1;
        let current_next_indicator = data[5] & 0x01;
        let section_number = data[6];
        let last_section_number = data[7];

        let pat: PAT = null;

        if (current_next_indicator === 1 && section_number === 0) {
            pat = new PAT();
            pat.version_number = version_number;
        } else {
            pat = this.pat_;
            if (pat == undefined) {
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
                pat.network_pid = pid;
            } else {
                // program_map_PID
                pat.program_pmt_pid[program_number] = pid;

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
            if (this.pat_ == undefined) {
                Log.v(this.TAG, `Parsed first PAT: ${JSON.stringify(pat)}`);
            }
            this.pat_ = pat;
            this.current_program_ = first_program_number;
            this.current_pmt_pid_ = first_pmt_pid;
        }
    }

    private parsePMT(buffer: ArrayBuffer, offset: number, length: number, misc: any): void {
        let data = new Uint8Array(buffer, offset, length);

        let table_id = data[0];
        if (table_id !== 0x02) {
            Log.e(this.TAG, `parsePMT: table_id ${table_id} is not corresponded to PMT!`);
            return;
        }

        let section_length = ((data[1] & 0x0F) << 8) | data[2];

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
            this.program_pmt_map_[program_number] = pmt;
        } else {
            pmt = this.program_pmt_map_[program_number];
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
            let ES_info_length = ((data[i + 3] & 0x0F) << 8) | data[i + 4];

            pmt.pid_stream_type[elementary_PID] = stream_type;

            if (stream_type === StreamType.kH264 && !pmt.common_pids.h264) {
                pmt.common_pids.h264 = elementary_PID;
            } else if (stream_type === StreamType.kADTSAAC && !pmt.common_pids.adts_aac) {
                pmt.common_pids.adts_aac = elementary_PID;
            } else if (stream_type === StreamType.kPESPrivateData) {
                pmt.pes_private_data_pids[elementary_PID] = true;
                if (ES_info_length > 0) {
                    // provide descriptor for PES private data via callback
                    let descriptor = data.subarray(i + 5, i + 5 + ES_info_length);
                    this.dispatchPESPrivateDataDescriptor(elementary_PID, stream_type, descriptor);
                }
            } else if (stream_type === StreamType.kID3) {
                pmt.timed_id3_pids[elementary_PID] = true;
            }

            i += 5 + ES_info_length;
        }

        if (program_number === this.current_program_) {
            if (this.pmt_ == undefined) {
                Log.v(this.TAG, `Parsed first PMT: ${JSON.stringify(pmt)}`);
            }
            this.pmt_ = pmt;
            if (pmt.common_pids.h264) {
                this.has_video_ = true;
            }
            if (pmt.common_pids.adts_aac) {
                this.has_audio_ = true;
            }
        }
    }

    private handlePESSlice(buffer: ArrayBuffer, offset: number, length: number, misc: any): void {
        let data = new Uint8Array(buffer, offset, length);

        let packet_start_code_prefix = (data[0] << 16) | (data[1] << 8) | (data[2]);
        let stream_id = data[3];
        let PES_packet_length = (data[4] << 8) | data[5];

        if (misc.payload_unit_start_indicator) {
            if (packet_start_code_prefix !== 1) {
                Log.e(this.TAG, `handlePESSlice: packet_start_code_prefix should be 1 but with value ${packet_start_code_prefix}`);
                return;
            }

            // handle queued PES slices:
            // Merge into a big Uint8Array then call parsePES()
            let slice_queue = this.pes_slice_queues_[misc.pid];
            if (slice_queue) {
                let data = new Uint8Array(slice_queue.total_length);
                for (let i = 0, offset = 0; i < slice_queue.slices.length; i++) {
                    let slice = slice_queue.slices[i];
                    data.set(slice, offset);
                    offset += slice.byteLength;
                }
                slice_queue.slices = [];
                slice_queue.total_length = 0;

                let pes_data = new PESData();
                pes_data.pid = misc.pid;
                pes_data.data = data;
                pes_data.stream_type = misc.stream_type;
                pes_data.file_position = slice_queue.file_position;
                pes_data.random_access_indicator = slice_queue.random_access_indicator;
                this.parsePES(pes_data);
            }

            // Make a new PES queue for new PES slices
            this.pes_slice_queues_[misc.pid] = new PESSliceQueue();
            this.pes_slice_queues_[misc.pid].file_position = misc.file_position;
            this.pes_slice_queues_[misc.pid].random_access_indicator = misc.random_access_indicator;
        }

        if (this.pes_slice_queues_[misc.pid] == undefined) {
            // ignore PES slices without [PES slice that has payload_unit_start_indicator]
            return;
        }

        // push subsequent PES slices into pes_queue
        let slice_queue = this.pes_slice_queues_[misc.pid];
        slice_queue.slices.push(data);
        slice_queue.total_length += data.byteLength;
    }

    private parsePES(pes_data: PESData): void {
        let data = pes_data.data;
        let packet_start_code_prefix = (data[0] << 16) | (data[1] << 8) | (data[2]);
        let stream_id = data[3];
        let PES_packet_length = (data[4] << 8) | data[5];

        if (packet_start_code_prefix !== 1) {
            Log.e(this.TAG, `parsePES: packet_start_code_prefix should be 1 but with value ${packet_start_code_prefix}`);
            return;
        }

        if (stream_id !== 0xBC  // program_stream_map
                && stream_id !== 0xBE  // padding_stream
                && stream_id !== 0xBF  // private_stream_2
                && stream_id !== 0xF0  // ECM
                && stream_id !== 0xF1  // EMM
                && stream_id !== 0xFF  // program_stream_directory
                && stream_id !== 0xF2  // DSMCC
                && stream_id !== 0xF8) {
            let PES_scrambling_control = (data[6] & 0x30) >>> 4;
            let PTS_DTS_flags = (data[7] & 0xC0) >>> 6;
            let PES_header_data_length = data[8];

            let pts: number | undefined;
            let dts: number | undefined;

            if (PTS_DTS_flags === 0x02 || PTS_DTS_flags === 0x03) {
                pts = (data[9] & 0x0E) * 536870912 + // 1 << 29
                      (data[10] & 0xFF) * 4194304 + // 1 << 22
                      (data[11] & 0xFE) * 16384 + // 1 << 14
                      (data[12] & 0xFF) * 128 + // 1 << 7
                      (data[13] & 0xFE) / 2;

                if (PTS_DTS_flags === 0x03) {
                    dts = (data[14] & 0x0E) * 536870912 + // 1 << 29
                          (data[15] & 0xFF) * 4194304 + // 1 << 22
                          (data[16] & 0xFE) * 16384 + // 1 << 14
                          (data[17] & 0xFF) * 128 + // 1 << 7
                          (data[18] & 0xFE) / 2;
                } else {
                    dts = pts;
                }
            }

            let payload_start_index = 6 + 3 + PES_header_data_length;
            let payload_length: number;

            if (PES_packet_length !== 0) {
                if (PES_packet_length < 3 + PES_header_data_length) {
                    Log.v(this.TAG, `Malformed PES: PES_packet_length < 3 + PES_header_data_length`);
                    return;
                }
                payload_length = PES_packet_length - 3 - PES_header_data_length;
            } else {  // PES_packet_length === 0
                payload_length = data.byteLength - payload_start_index;
            }

            let payload = data.subarray(payload_start_index, payload_start_index + payload_length);

            switch (pes_data.stream_type) {
                case StreamType.kMPEG1Audio:
                case StreamType.kMPEG2Audio:
                    break;
                case StreamType.kPESPrivateData:
                    this.parsePESPrivateDataPayload(payload, pts, dts, pes_data.pid, stream_id);
                    break;
                case StreamType.kADTSAAC:
                    this.parseAACPayload(payload, pts);
                    break;
                case StreamType.kID3:
                    this.parsePESTimedID3MetadataPayload(payload, pts, dts, pes_data.pid, stream_id);
                    break;
                case StreamType.kH264:
                    this.parseH264Payload(payload, pts, dts, pes_data.file_position, pes_data.random_access_indicator);
                    break;
                case StreamType.kH265:
                default:
                    break;
            }
        } else if (stream_id === 0xBC  // program_stream_map
                       || stream_id === 0xBF  // private_stream_2
                       || stream_id === 0xF0  // ECM
                       || stream_id === 0xF1  // EMM
                       || stream_id === 0xFF  // program_stream_directory
                       || stream_id === 0xF2  // DSMCC_stream
                       || stream_id === 0xF8) {  // ITU-T Rec. H.222.1 type E stream
            if (pes_data.stream_type === StreamType.kPESPrivateData) {
                let payload_start_index = 6;
                let payload_length: number;

                if (PES_packet_length !== 0) {
                    payload_length = PES_packet_length;
                } else {  // PES_packet_length === 0
                    payload_length = data.byteLength - payload_start_index;
                }

                let payload = data.subarray(payload_start_index, payload_start_index + payload_length);
                this.parsePESPrivateDataPayload(payload, undefined, undefined, pes_data.pid, stream_id);
            }
        }
    }

    private parseH264Payload(data: Uint8Array, pts: number, dts: number, file_position: number, random_access_indicator: number) {
        let annexb_parser = new H264AnnexBParser(data);
        let nalu_payload: H264NaluPayload = null;
        let units: {type: H264NaluType, data: Uint8Array}[] = [];
        let length = 0;
        let keyframe = false;

        while ((nalu_payload = annexb_parser.readNextNaluPayload()) != null) {
            let nalu_avc1 = new H264NaluAVC1(nalu_payload);

            if (nalu_avc1.type === H264NaluType.kSliceSPS) {
                // Notice: parseSPS requires Nalu without startcode or length-header
                let sps_details = SPSParser.parseSPS(nalu_payload.data);
                if (!this.video_init_segment_dispatched_) {
                    this.video_metadata_.sps = nalu_avc1;
                    this.video_metadata_.sps_details = sps_details;
                } else if (this.detectVideoMetadataChange(nalu_avc1, sps_details) === true) {
                    Log.v(this.TAG, `H264: Critical h264 metadata has been changed, attempt to re-generate InitSegment`);
                    this.video_metadata_changed_ = true;
                    this.video_metadata_ = {sps: nalu_avc1, pps: undefined, sps_details: sps_details};
                }
            } else if (nalu_avc1.type === H264NaluType.kSlicePPS) {
                if (!this.video_init_segment_dispatched_ || this.video_metadata_changed_) {
                    this.video_metadata_.pps = nalu_avc1;
                    if (this.video_metadata_.sps && this.video_metadata_.pps) {
                        if (this.video_metadata_changed_) {
                            // flush stashed frames before changing codec metadata
                            this.dispatchVideoMediaSegment();
                        }
                        // notify new codec metadata (maybe changed)
                        this.dispatchVideoInitSegment();
                    }
                }
            } else if (nalu_avc1.type === H264NaluType.kSliceIDR) {
                keyframe = true;
            } else if (nalu_avc1.type === H264NaluType.kSliceNonIDR && random_access_indicator === 1) {
                // For open-gop stream, use random_access_indicator to identify keyframe
                keyframe = true;
            }

            // Push samples to remuxer only if initialization metadata has been dispatched
            if (this.video_init_segment_dispatched_) {
                units.push(nalu_avc1);
                length += nalu_avc1.data.byteLength;
            }
        }

        let pts_ms = Math.floor(pts / this.timescale_);
        let dts_ms = Math.floor(dts / this.timescale_);

        if (units.length) {
            let track = this.video_track_;
            let avc_sample = {
                units,
                length,
                isKeyframe: keyframe,
                dts: dts_ms,
                pts: pts_ms,
                cts: pts_ms - dts_ms,
                file_position
            };
            track.samples.push(avc_sample);
            track.length += length;
        }
    }

    private detectVideoMetadataChange(new_sps: H264NaluAVC1, new_sps_details: any): boolean {
        if (new_sps.data.byteLength !== this.video_metadata_.sps.data.byteLength) {
            return true;
        }

        if (new_sps_details.codec_mimetype !== this.video_metadata_.sps_details.codec_mimetype) {
            Log.v(this.TAG, `H264: Codec mimeType changed from ` +
                            `${this.video_metadata_.sps_details.codec_mimetype} to ${new_sps_details.codec_mimetype}`);
            return true;
        }

        if (new_sps_details.codec_size.width !== this.video_metadata_.sps_details.codec_size.width
            || new_sps_details.codec_size.height !== this.video_metadata_.sps_details.codec_size.height) {
            let old_size = this.video_metadata_.sps_details.codec_size;
            let new_size = new_sps_details.codec_size;
            Log.v(this.TAG, `H264: Coded Resolution changed from ` +
                            `${old_size.width}x${old_size.height} to ${new_size.width}x${new_size.height}`);
            return true;
        }

        if (new_sps_details.present_size.width !== this.video_metadata_.sps_details.present_size.width) {
            Log.v(this.TAG, `H264: Present resolution width changed from ` +
                            `${this.video_metadata_.sps_details.present_size.width} to ${new_sps_details.present_size.width}`);
            return true;
        }

        return false;
    }

    private isInitSegmentDispatched(): boolean {
        if (this.has_video_ && this.has_audio_) {  // both video & audio
            return this.video_init_segment_dispatched_ && this.audio_init_segment_dispatched_;
        }
        if (this.has_video_ && !this.has_audio_) {  // video only
            return this.video_init_segment_dispatched_;
        }
        if (!this.has_video_ && this.has_audio_) {  // audio only
            return this.audio_init_segment_dispatched_;
        }
        return false;
    }

    private dispatchVideoInitSegment() {
        let sps_details = this.video_metadata_.sps_details;
        let meta: any = {};

        meta.type = 'video';
        meta.id = this.video_track_.id;
        meta.timescale = 1000;
        meta.duration = this.duration_;

        meta.codecWidth = sps_details.codec_size.width;
        meta.codecHeight = sps_details.codec_size.height;
        meta.presentWidth = sps_details.present_size.width;
        meta.presentHeight = sps_details.present_size.height;

        meta.profile = sps_details.profile_string;
        meta.level = sps_details.level_string;
        meta.bitDepth = sps_details.bit_depth;
        meta.chromaFormat = sps_details.chroma_format;
        meta.sarRatio = sps_details.sar_ratio;
        meta.frameRate = sps_details.frame_rate;

        let fps_den = meta.frameRate.fps_den;
        let fps_num = meta.frameRate.fps_num;
        meta.refSampleDuration = 1000 * (fps_den / fps_num);

        meta.codec = sps_details.codec_mimetype;

        let sps_without_header = this.video_metadata_.sps.data.subarray(4);
        let pps_without_header = this.video_metadata_.pps.data.subarray(4);

        let avcc = new AVCDecoderConfigurationRecord(sps_without_header, pps_without_header, sps_details);
        meta.avcc = avcc.getData();

        if (this.video_init_segment_dispatched_ == false) {
            Log.v(this.TAG, `Generated first AVCDecoderConfigurationRecord for mimeType: ${meta.codec}`);
        }

        this.onTrackMetadata('video', meta);
        this.video_init_segment_dispatched_ = true;
        this.video_metadata_changed_ = false;

        // notify new MediaInfo
        let mi = this.media_info_;
        mi.hasVideo = true;
        mi.width = meta.codecWidth;
        mi.height = meta.codecHeight;
        mi.fps = meta.frameRate.fps;
        mi.profile = meta.profile;
        mi.level = meta.level;
        mi.refFrames = sps_details.ref_frames;
        mi.chromaFormat = sps_details.chroma_format_string;
        mi.sarNum = meta.sarRatio.width;
        mi.sarDen = meta.sarRatio.height;
        mi.videoCodec = meta.codec;

        if (mi.hasAudio && mi.audioCodec) {
            mi.mimeType = `video/mp2t; codecs="${mi.videoCodec},${mi.audioCodec}"`;
        } else {
            mi.mimeType = `video/mp2t; codecs="${mi.videoCodec}"`;
        }

        if (mi.isComplete()) {
            this.onMediaInfo(mi);
        }
    }

    private dispatchVideoMediaSegment() {
        if (this.isInitSegmentDispatched()) {
            if (this.video_track_.length) {
                this.onDataAvailable(null, this.video_track_);
            }
        }
    }

    private dispatchAudioMediaSegment() {
        if (this.isInitSegmentDispatched()) {
            if (this.audio_track_.length) {
                this.onDataAvailable(this.audio_track_, null);
            }
        }
    }

    private dispatchAudioVideoMediaSegment() {
        if (this.isInitSegmentDispatched()) {
            if (this.audio_track_.length || this.video_track_.length) {
                this.onDataAvailable(this.audio_track_, this.video_track_);
            }
        }
    }

    private parseAACPayload(data: Uint8Array, pts: number) {
        if (this.has_video_ && !this.video_init_segment_dispatched_) {
            // If first video IDR frame hasn't been detected,
            // Wait for first IDR frame and video init segment being dispatched
            return;
        }

        if (this.aac_last_incomplete_data_) {
            let buf = new Uint8Array(data.byteLength + this.aac_last_incomplete_data_.byteLength);
            buf.set(this.aac_last_incomplete_data_, 0);
            buf.set(data, this.aac_last_incomplete_data_.byteLength);
            data = buf;
        }

        let ref_sample_duration: number;
        let base_pts_ms: number;

        if (pts != undefined) {
            base_pts_ms = pts / this.timescale_;
        } else if (this.aac_last_sample_pts_ != undefined) {
            ref_sample_duration = 1024 / this.audio_metadata_.sampling_frequency * 1000;
            base_pts_ms = this.aac_last_sample_pts_ + ref_sample_duration;
        } else {
            Log.w(this.TAG, `AAC: Unknown pts`);
            return;
        }

        if (this.aac_last_incomplete_data_ && this.aac_last_sample_pts_) {
            ref_sample_duration = 1024 / this.audio_metadata_.sampling_frequency * 1000;
            let new_pts_ms = this.aac_last_sample_pts_ + ref_sample_duration;

            if (Math.abs(new_pts_ms - base_pts_ms) > 1) {
                Log.w(this.TAG, `AAC: Detected pts overlapped, ` +
                                `expected: ${new_pts_ms}ms, PES pts: ${base_pts_ms}ms`);
                base_pts_ms = new_pts_ms;
            }
        }

        let adts_parser = new AACADTSParser(data);
        let aac_frame: AACFrame = null;
        let sample_pts_ms = base_pts_ms;
        let last_sample_pts_ms: number;

        while ((aac_frame = adts_parser.readNextAACFrame()) != null) {
            ref_sample_duration = 1024 / aac_frame.sampling_frequency * 1000;

            if (this.audio_init_segment_dispatched_ == false) {
                this.audio_metadata_.audio_object_type = aac_frame.audio_object_type;
                this.audio_metadata_.sampling_freq_index = aac_frame.sampling_freq_index;
                this.audio_metadata_.sampling_frequency = aac_frame.sampling_frequency;
                this.audio_metadata_.channel_config = aac_frame.channel_config;
                this.dispatchAudioInitSegment(aac_frame);
            } else if (this.detectAudioMetadataChange(aac_frame)) {
                // flush stashed frames before notify new AudioSpecificConfig
                this.dispatchAudioMediaSegment();
                // notify new AAC AudioSpecificConfig
                this.dispatchAudioInitSegment(aac_frame);
            }

            last_sample_pts_ms = sample_pts_ms;
            let sample_pts_ms_int = Math.floor(sample_pts_ms);

            let aac_sample = {
                unit: aac_frame.data,
                length: aac_frame.data.byteLength,
                pts: sample_pts_ms_int,
                dts: sample_pts_ms_int
            };
            this.audio_track_.samples.push(aac_sample);
            this.audio_track_.length += aac_frame.data.byteLength;

            sample_pts_ms += ref_sample_duration;
        }

        if (adts_parser.hasIncompleteData()) {
            this.aac_last_incomplete_data_ = adts_parser.getIncompleteData();
        }

        if (last_sample_pts_ms) {
            this.aac_last_sample_pts_ = last_sample_pts_ms;
        }
    }

    private detectAudioMetadataChange(frame: AACFrame): boolean {
        if (frame.audio_object_type !== this.audio_metadata_.audio_object_type) {
            Log.v(this.TAG, `AAC: AudioObjectType changed from ` +
                            `${this.audio_metadata_.audio_object_type} to ${frame.audio_object_type}`);
            return true;
        }

        if (frame.sampling_freq_index !== this.audio_metadata_.sampling_freq_index) {
            Log.v(this.TAG, `AAC: SamplingFrequencyIndex changed from ` +
                            `${this.audio_metadata_.sampling_freq_index} to ${frame.sampling_freq_index}`);
            return true;
        }

        if (frame.channel_config !== this.audio_metadata_.channel_config) {
            Log.v(this.TAG, `AAC: Channel configuration changed from ` +
                            `${this.audio_metadata_.channel_config} to ${frame.channel_config}`);
            return true;
        }

        return false;
    }

    private dispatchAudioInitSegment(aac_frame: AACFrame) {
        let audio_specific_config = new AudioSpecificConfig(aac_frame);
        let meta: any = {};

        meta.type = 'audio';
        meta.id = this.audio_track_.id;
        meta.timescale = 1000;
        meta.duration = this.duration_;

        meta.audioSampleRate = audio_specific_config.sampling_rate;
        meta.channelCount = audio_specific_config.channel_count;
        meta.codec = audio_specific_config.codec_mimetype;
        meta.originalCodec = audio_specific_config.original_codec_mimetype;
        meta.config = audio_specific_config.config;

        meta.refSampleDuration = 1024 / meta.audioSampleRate * meta.timescale;

        if (this.audio_init_segment_dispatched_ == false) {
            Log.v(this.TAG, `Generated first AudioSpecificConfig for mimeType: ${meta.codec}`);
        }

        this.onTrackMetadata('audio', meta);
        this.audio_init_segment_dispatched_ = true;
        this.video_metadata_changed_ = false;

        // notify new MediaInfo
        let mi = this.media_info_;
        mi.hasAudio = true;
        mi.audioCodec = meta.originalCodec;
        mi.audioSampleRate = meta.audioSampleRate;
        mi.audioChannelCount = meta.channelCount;

        if (mi.hasVideo && mi.videoCodec) {
            mi.mimeType = `video/mp2t; codecs="${mi.videoCodec},${mi.audioCodec}"`;
        } else {
            mi.mimeType = `video/mp2t; codecs="${mi.audioCodec}"`;
        }

        if (mi.isComplete()) {
            this.onMediaInfo(mi);
        }
    }

    private dispatchPESPrivateDataDescriptor(pid: number, stream_type: number, descriptor: Uint8Array) {
        let desc = new PESPrivateDataDescriptor();
        desc.pid = pid;
        desc.stream_type = stream_type;
        desc.descriptor = descriptor;

        if (this.onPESPrivateDataDescriptor) {
            this.onPESPrivateDataDescriptor(desc);
        }
    }

    private parsePESPrivateDataPayload(data: Uint8Array, pts: number, dts: number, pid: number, stream_id: number) {
        let private_data = new PESPrivateData();

        private_data.pid = pid;
        private_data.stream_id = stream_id;
        private_data.len = data.byteLength;
        private_data.data = data;

        if (pts != undefined) {
            let pts_ms = Math.floor(pts / this.timescale_);
            private_data.pts = pts_ms;
        } else {
            private_data.nearest_pts = this.aac_last_sample_pts_;
        }

        if (dts != undefined) {
            let dts_ms = Math.floor(dts / this.timescale_);
            private_data.dts = dts_ms;
        }

        if (this.onPESPrivateData) {
            this.onPESPrivateData(private_data);
        }
    }

    private parsePESTimedID3MetadataPayload(data: Uint8Array, pts: number, dts: number, pid: number, stream_id: number) {
        let timed_id3_metadata = new PESPrivateData();

        timed_id3_metadata.pid = pid;
        timed_id3_metadata.stream_id = stream_id;
        timed_id3_metadata.len = data.byteLength;
        timed_id3_metadata.data = data;

        if (pts != undefined) {
            let pts_ms = Math.floor(pts / this.timescale_);
            timed_id3_metadata.pts = pts_ms;
        } 

        if (dts != undefined) {
            let dts_ms = Math.floor(dts / this.timescale_);
            timed_id3_metadata.dts = dts_ms;
        }

        if (this.onTimedID3Metadata) {
            this.onTimedID3Metadata(timed_id3_metadata);
        }
    }
}

export default TSDemuxer;
