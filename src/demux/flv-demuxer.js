/*
 * Copyright (C) 2016 Bilibili. All Rights Reserved.
 *
 * @author zheng qian <xqq@xqq.im>
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

import Browser from '../utils/browser';
import Log from '../utils/logger.js';
import AMF from './amf-parser.js';
import SPSParser from './sps-parser.js';
import DemuxErrors from './demux-errors.js';
import MediaInfo from '../core/media-info.js';
import {IllegalStateException} from '../utils/exception.js';
import H265Parser from './h265-parser.js';
import buffersAreEqual from '../utils/typedarray-equality.ts';
import AV1OBUParser from './av1-parser.ts';
import ExpGolomb from './exp-golomb.js';
import { parseSEI } from './sei';

function Swap16(src) {
    return (((src >>> 8) & 0xFF) |
            ((src & 0xFF) << 8));
}

function Swap32(src) {
    return (((src & 0xFF000000) >>> 24) |
            ((src & 0x00FF0000) >>> 8)  |
            ((src & 0x0000FF00) << 8)   |
            ((src & 0x000000FF) << 24));
}

function ReadBig32(array, index) {
    return ((array[index] << 24)     |
            (array[index + 1] << 16) |
            (array[index + 2] << 8)  |
            (array[index + 3]));
}


class FLVDemuxer {

    constructor(probeData, config) {
        this.TAG = 'FLVDemuxer';

        this._config = config;

        this._onError = null;
        this._onMediaInfo = null;
        this._onMetaDataArrived = null;
        this._onScriptDataArrived = null;
        this._onTrackMetadata = null;
        this._onDataAvailable = null;
        this._onSeiArrived = null;

        this._dataOffset = probeData.dataOffset;
        this._firstParse = true;
        this._dispatch = false;

        this._hasAudio = probeData.hasAudioTrack;
        this._hasVideo = probeData.hasVideoTrack;

        this._hasAudioFlagOverrided = false;
        this._hasVideoFlagOverrided = false;

        this._audioInitialMetadataDispatched = false;
        this._videoInitialMetadataDispatched = false;

        this._mediaInfo = new MediaInfo();
        this._mediaInfo.hasAudio = this._hasAudio;
        this._mediaInfo.hasVideo = this._hasVideo;
        this._metadata = null;
        this._audioMetadata = null;
        this._videoMetadata = null;

        this._naluLengthSize = 4;
        this._timestampBase = 0;  // int32, in milliseconds
        this._timescale = 1000;
        this._duration = 0;  // int32, in milliseconds
        this._durationOverrided = false;
        this._referenceFrameRate = {
            fixed: true,
            fps: 23.976,
            fps_num: 23976,
            fps_den: 1000
        };

        this._flvSoundRateTable = [5500, 11025, 22050, 44100, 48000];

        this._mpegSamplingRates = [
            96000, 88200, 64000, 48000, 44100, 32000,
            24000, 22050, 16000, 12000, 11025, 8000, 7350
        ];

        this._mpegAudioV10SampleRateTable = [44100, 48000, 32000, 0];
        this._mpegAudioV20SampleRateTable = [22050, 24000, 16000, 0];
        this._mpegAudioV25SampleRateTable = [11025, 12000, 8000,  0];

        this._mpegAudioL1BitRateTable = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1];
        this._mpegAudioL2BitRateTable = [0, 32, 48, 56,  64,  80,  96, 112, 128, 160, 192, 224, 256, 320, 384, -1];
        this._mpegAudioL3BitRateTable = [0, 32, 40, 48,  56,  64,  80,  96, 112, 128, 160, 192, 224, 256, 320, -1];

        this._videoTrack = {type: 'video', id: 1, sequenceNumber: 0, samples: [], length: 0};
        this._audioTrack = {type: 'audio', id: 2, sequenceNumber: 0, samples: [], length: 0};

        this._littleEndian = (function () {
            const buf = new ArrayBuffer(2);
            (new DataView(buf)).setInt16(0, 256, true);  // little-endian write
            return (new Int16Array(buf))[0] === 256;  // platform-spec read, if equal then LE
        })();
    }

    destroy() {
        this._mediaInfo = null;
        this._metadata = null;
        this._audioMetadata = null;
        this._videoMetadata = null;
        this._videoTrack = null;
        this._audioTrack = null;

        this._onError = null;
        this._onMediaInfo = null;
        this._onMetaDataArrived = null;
        this._onScriptDataArrived = null;
        this._onTrackMetadata = null;
        this._onDataAvailable = null;
        this._onSeiArrived = null;
    }

    static probe(buffer) {
        const data = new Uint8Array(buffer);
        if (data.byteLength < 9) {
            return {needMoreData: true};
        }

        const mismatch = {match: false};

        if (data[0] !== 0x46 || data[1] !== 0x4C || data[2] !== 0x56 || data[3] !== 0x01) {
            return mismatch;
        }

        const hasAudio = ((data[4] & 4) >>> 2) !== 0;
        const hasVideo = (data[4] & 1) !== 0;

        const offset = ReadBig32(data, 5);

        if (offset < 9) {
            return mismatch;
        }

        return {
            match: true,
            consumed: offset,
            dataOffset: offset,
            hasAudioTrack: hasAudio,
            hasVideoTrack: hasVideo
        };
    }

    bindDataSource(loader) {
        loader.onDataArrival = this.parseChunks.bind(this);
        return this;
    }

    // prototype: function(type: string, metadata: any): void
    get onTrackMetadata() {
        return this._onTrackMetadata;
    }

    set onTrackMetadata(callback) {
        this._onTrackMetadata = callback;
    }

    // prototype: function(mediaInfo: MediaInfo): void
    get onMediaInfo() {
        return this._onMediaInfo;
    }

    set onMediaInfo(callback) {
        this._onMediaInfo = callback;
    }

    get onMetaDataArrived() {
        return this._onMetaDataArrived;
    }

    set onMetaDataArrived(callback) {
        this._onMetaDataArrived = callback;
    }

    get onScriptDataArrived() {
        return this._onScriptDataArrived;
    }

    set onScriptDataArrived(callback) {
        this._onScriptDataArrived = callback;
    }

    get onSeiArrived() {
        return this._onSeiArrived
    }

    set onSeiArrived(callback) {
        this._onSeiArrived = callback;
    }

    // prototype: function(type: number, info: string): void
    get onError() {
        return this._onError;
    }

    set onError(callback) {
        this._onError = callback;
    }

    // prototype: function(videoTrack: any, audioTrack: any): void
    get onDataAvailable() {
        return this._onDataAvailable;
    }

    set onDataAvailable(callback) {
        this._onDataAvailable = callback;
    }

    // timestamp base for output samples, must be in milliseconds
    get timestampBase() {
        return this._timestampBase;
    }

    set timestampBase(base) {
        this._timestampBase = base;
    }

    get overridedDuration() {
        return this._duration;
    }

    // Force-override media duration. Must be in milliseconds, int32
    set overridedDuration(duration) {
        this._durationOverrided = true;
        this._duration = duration;
        this._mediaInfo.duration = duration;
    }

    // Force-override audio track present flag, boolean
    set overridedHasAudio(hasAudio) {
        this._hasAudioFlagOverrided = true;
        this._hasAudio = hasAudio;
        this._mediaInfo.hasAudio = hasAudio;
    }

    // Force-override video track present flag, boolean
    set overridedHasVideo(hasVideo) {
        this._hasVideoFlagOverrided = true;
        this._hasVideo = hasVideo;
        this._mediaInfo.hasVideo = hasVideo;
    }

    resetMediaInfo() {
        this._mediaInfo = new MediaInfo();
    }

    _isInitialMetadataDispatched() {
        if (this._hasAudio && this._hasVideo) {  // both audio & video
            return this._audioInitialMetadataDispatched && this._videoInitialMetadataDispatched;
        }
        if (this._hasAudio && !this._hasVideo) {  // audio only
            return this._audioInitialMetadataDispatched;
        }
        if (!this._hasAudio && this._hasVideo) {  // video only
            return this._videoInitialMetadataDispatched;
        }
        return false;
    }

    // function parseChunks(chunk: ArrayBuffer, byteStart: number): number;
    parseChunks(chunk, byteStart) {
        if (!this._onError || !this._onMediaInfo || !this._onTrackMetadata || !this._onDataAvailable) {
            throw new IllegalStateException('Flv: onError & onMediaInfo & onTrackMetadata & onDataAvailable callback must be specified');
        }

        let offset = 0;
        const le = this._littleEndian;

        if (byteStart === 0) {  // buffer with FLV header
            if (chunk.byteLength > 13) {
                const probeData = FLVDemuxer.probe(chunk);
                offset = probeData.dataOffset;
            } else {
                return 0;
            }
        }

        if (this._firstParse) {  // handle PreviousTagSize0 before Tag1
            this._firstParse = false;
            if (byteStart + offset !== this._dataOffset) {
                Log.w(this.TAG, 'First time parsing but chunk byteStart invalid!');
            }

            const v = new DataView(chunk, offset);
            const prevTagSize0 = v.getUint32(0, !le);
            if (prevTagSize0 !== 0) {
                Log.w(this.TAG, 'PrevTagSize0 !== 0 !!!');
            }
            offset += 4;
        }

        while (offset < chunk.byteLength) {
            this._dispatch = true;

            const v = new DataView(chunk, offset);

            if (offset + 11 + 4 > chunk.byteLength) {
                // data not enough for parsing an flv tag
                break;
            }

            const tagType = v.getUint8(0);
            const dataSize = v.getUint32(0, !le) & 0x00FFFFFF;

            if (offset + 11 + dataSize + 4 > chunk.byteLength) {
                // data not enough for parsing actual data body
                break;
            }

            if (tagType !== 8 && tagType !== 9 && tagType !== 18) {
                Log.w(this.TAG, `Unsupported tag type ${tagType}, skipped`);
                // consume the whole tag (skip it)
                offset += 11 + dataSize + 4;
                continue;
            }

            const ts2 = v.getUint8(4);
            const ts1 = v.getUint8(5);
            const ts0 = v.getUint8(6);
            const ts3 = v.getUint8(7);

            const timestamp = ts0 | (ts1 << 8) | (ts2 << 16) | (ts3 << 24);

            const streamId = v.getUint32(7, !le) & 0x00FFFFFF;
            if (streamId !== 0) {
                Log.w(this.TAG, 'Meet tag which has StreamID != 0!');
            }

            const dataOffset = offset + 11;

            switch (tagType) {
                case 8:  // Audio
                    this._parseAudioData(chunk, dataOffset, dataSize, timestamp);
                    break;
                case 9:  // Video
                    this._parseVideoData(chunk, dataOffset, dataSize, timestamp, byteStart + offset);
                    break;
                case 18:  // ScriptDataObject
                    this._parseScriptData(chunk, dataOffset, dataSize);
                    break;
            }

            const prevTagSize = v.getUint32(11 + dataSize, !le);
            if (prevTagSize !== 11 + dataSize) {
                Log.w(this.TAG, `Invalid PrevTagSize ${prevTagSize}`);
            }

            offset += 11 + dataSize + 4;  // tagBody + dataSize + prevTagSize
        }

        // dispatch parsed frames to consumer (typically, the remuxer)
        if (this._isInitialMetadataDispatched()) {
            if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                this._onDataAvailable(this._audioTrack, this._videoTrack);
            }
        }

        return offset;  // consumed bytes, just equals latest offset index
    }

    _parseScriptData(arrayBuffer, dataOffset, dataSize) {
        const scriptData = AMF.parseScriptData(arrayBuffer, dataOffset, dataSize);

        if (scriptData.hasOwnProperty('onMetaData')) {
            if (scriptData.onMetaData == null || typeof scriptData.onMetaData !== 'object') {
                Log.w(this.TAG, 'Invalid onMetaData structure!');
                return;
            }
            if (this._metadata) {
                Log.w(this.TAG, 'Found another onMetaData tag!');
            }
            this._metadata = scriptData;
            const onMetaData = this._metadata.onMetaData;

            if (this._onMetaDataArrived) {
                this._onMetaDataArrived(Object.assign({}, onMetaData));
            }

            if (typeof onMetaData.hasAudio === 'boolean') {  // hasAudio
                if (this._hasAudioFlagOverrided === false) {
                    this._hasAudio = onMetaData.hasAudio;
                    this._mediaInfo.hasAudio = this._hasAudio;
                }
            }
            if (typeof onMetaData.hasVideo === 'boolean') {  // hasVideo
                if (this._hasVideoFlagOverrided === false) {
                    this._hasVideo = onMetaData.hasVideo;
                    this._mediaInfo.hasVideo = this._hasVideo;
                }
            }
            if (typeof onMetaData.audiodatarate === 'number') {  // audiodatarate
                this._mediaInfo.audioDataRate = onMetaData.audiodatarate;
            }
            if (typeof onMetaData.videodatarate === 'number') {  // videodatarate
                this._mediaInfo.videoDataRate = onMetaData.videodatarate;
            }
            if (typeof onMetaData.width === 'number') {  // width
                this._mediaInfo.width = onMetaData.width;
            }
            if (typeof onMetaData.height === 'number') {  // height
                this._mediaInfo.height = onMetaData.height;
            }
            if (typeof onMetaData.duration === 'number') {  // duration
                if (!this._durationOverrided) {
                    const duration = Math.floor(onMetaData.duration * this._timescale);
                    this._duration = duration;
                    this._mediaInfo.duration = duration;
                }
            } else {
                this._mediaInfo.duration = 0;
            }
            if (typeof onMetaData.framerate === 'number') {  // framerate
                const fps_num = Math.floor(onMetaData.framerate * 1000);
                if (fps_num > 0) {
                    const fps = fps_num / 1000;
                    this._referenceFrameRate.fixed = true;
                    this._referenceFrameRate.fps = fps;
                    this._referenceFrameRate.fps_num = fps_num;
                    this._referenceFrameRate.fps_den = 1000;
                    this._mediaInfo.fps = fps;
                }
            }
            if (typeof onMetaData.keyframes === 'object') {  // keyframes
                this._mediaInfo.hasKeyframesIndex = true;
                const keyframes = onMetaData.keyframes;
                this._mediaInfo.keyframesIndex = this._parseKeyframesIndex(keyframes);
                onMetaData.keyframes = null;  // keyframes has been extracted, remove it
            } else {
                this._mediaInfo.hasKeyframesIndex = false;
            }
            this._dispatch = false;
            this._mediaInfo.metadata = onMetaData;
            Log.v(this.TAG, 'Parsed onMetaData');
            if (this._mediaInfo.isComplete()) {
                this._onMediaInfo(this._mediaInfo);
            }
        }

        if (Object.keys(scriptData).length > 0) {
            if (this._onScriptDataArrived) {
                this._onScriptDataArrived(Object.assign({}, scriptData));
            }
        }
    }

    _parseSEIPayload(data, pts, codec) {
        const sei_data = parseSEI(data, pts, codec);

        if (sei_data && typeof this._onSeiArrived === 'function') {
            this._onSeiArrived(sei_data);
        }
    }

    _parseKeyframesIndex(keyframes) {
        const times = [];
        const filepositions = [];

        // ignore first keyframe which is actually AVC/HEVC Sequence Header (AVCDecoderConfigurationRecord or HEVCDecoderConfigurationRecord)
        for (let i = 1; i < keyframes.times.length; i++) {
            const time = this._timestampBase + Math.floor(keyframes.times[i] * 1000);
            times.push(time);
            filepositions.push(keyframes.filepositions[i]);
        }

        return {
            times: times,
            filepositions: filepositions
        };
    }

    _parseAudioData(arrayBuffer, dataOffset, dataSize, tagTimestamp) {
        if (dataSize <= 1) {
            Log.w(this.TAG, 'Flv: Invalid audio packet, missing SoundData payload!');
            return;
        }

        if (this._hasAudioFlagOverrided === true && this._hasAudio === false) {
            // If hasAudio: false indicated explicitly in MediaDataSource,
            // Ignore all the audio packets
            return;
        }

        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        const soundSpec = v.getUint8(0);

        const soundFormat = soundSpec >>> 4;
        if (soundFormat === 9) { // Enhanced FLV
            if (dataSize <= 5) {
                Log.w(this.TAG, 'Flv: Invalid audio packet, missing AudioFourCC in Ehnanced FLV payload!');
                return;
            }
            const packetType = soundSpec & 0x0F;
            const fourcc = String.fromCharCode(... (new Uint8Array(arrayBuffer, dataOffset, dataSize)).slice(1, 5));

            switch(fourcc){
            case 'Opus':
                this._parseOpusAudioPacket(arrayBuffer, dataOffset + 5, dataSize - 5, tagTimestamp, packetType);
                break;
            case 'fLaC':
                this._parseFlacAudioPacket(arrayBuffer, dataOffset + 5, dataSize - 5, tagTimestamp, packetType);
                break;
            default:
                this._onError(DemuxErrors.CODEC_UNSUPPORTED, 'Flv: Unsupported audio codec: ' + fourcc);
            }

            return;
        }
        // Legacy FLV

        if (soundFormat !== 2 && soundFormat !== 3 && soundFormat !== 10) {  // PCM or MP3 or AAC
            this._onError(DemuxErrors.CODEC_UNSUPPORTED, 'Flv: Unsupported audio codec idx: ' + soundFormat);
            return;
        }

        let soundRate = 0;
        const soundRateIndex = (soundSpec & 12) >>> 2;
        if (soundRateIndex >= 0 && soundRateIndex <= 4) {
            soundRate = this._flvSoundRateTable[soundRateIndex];
        } else {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid audio sample rate idx: ' + soundRateIndex);
            return;
        }

        const soundSize = (soundSpec & 2) >>> 1;  // unused
        const soundType = (soundSpec & 1);

        let meta = this._audioMetadata;
        const track = this._audioTrack;

        if (!meta) {
            if (this._hasAudio === false && this._hasAudioFlagOverrided === false) {
                this._hasAudio = true;
                this._mediaInfo.hasAudio = true;
            }

            // initial metadata
            meta = this._audioMetadata = {};
            meta.type = 'audio';
            meta.id = track.id;
            meta.timescale = this._timescale;
            meta.duration = this._duration;
            meta.audioSampleRate = soundRate;
            meta.channelCount = (soundType === 0 ? 1 : 2);
        }

        if (soundFormat === 10) {  // AAC
            const aacData = this._parseAACAudioData(arrayBuffer, dataOffset + 1, dataSize - 1);
            if (aacData == undefined) {
                return;
            }

            if (aacData.packetType === 0) {  // AAC sequence header (AudioSpecificConfig)
                if (meta.config) {
                    if (buffersAreEqual(aacData.data.config, meta.config)) {
                        // If AudioSpecificConfig is not changed, ignore it to avoid generating initialization segment repeatedly
                        return;
                    } else {
                        Log.w(this.TAG, 'AudioSpecificConfig has been changed, re-generate initialization segment');
                    }
                }
                const misc = aacData.data;
                meta.audioSampleRate = misc.samplingRate;
                meta.channelCount = misc.channelCount;
                meta.codec = misc.codec;
                meta.originalCodec = misc.originalCodec;
                meta.config = misc.config;
                // The decode result of an aac sample is 1024 PCM samples
                meta.refSampleDuration = 1024 / meta.audioSampleRate * meta.timescale;
                Log.v(this.TAG, 'Parsed AudioSpecificConfig');

                if (this._isInitialMetadataDispatched()) {
                    // Non-initial metadata, force dispatch (or flush) parsed frames to remuxer
                    if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                        this._onDataAvailable(this._audioTrack, this._videoTrack);
                    }
                } else {
                    this._audioInitialMetadataDispatched = true;
                }
                // then notify new metadata
                this._dispatch = false;
                this._onTrackMetadata('audio', meta);

                const mi = this._mediaInfo;
                mi.audioCodec = meta.originalCodec;
                mi.audioSampleRate = meta.audioSampleRate;
                mi.audioChannelCount = meta.channelCount;
                if (mi.hasVideo) {
                    if (mi.videoCodec != null) {
                        mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
                    }
                } else {
                    mi.mimeType = 'video/x-flv; codecs="' + mi.audioCodec + '"';
                }
                if (mi.isComplete()) {
                    this._onMediaInfo(mi);
                }
            } else if (aacData.packetType === 1) {  // AAC raw frame data
                const dts = this._timestampBase + tagTimestamp;
                const aacSample = {unit: aacData.data, length: aacData.data.byteLength, dts: dts, pts: dts};
                track.samples.push(aacSample);
                track.length += aacData.data.length;
            } else {
                Log.e(this.TAG, `Flv: Unsupported AAC data type ${aacData.packetType}`);
            }
        } else if (soundFormat === 2) {  // MP3
            if (!meta.codec) {
                // We need metadata for mp3 audio track, extract info from frame header
                const misc = this._parseMP3AudioData(arrayBuffer, dataOffset + 1, dataSize - 1, true);
                if (misc == undefined) {
                    return;
                }
                meta.audioSampleRate = misc.samplingRate;
                meta.channelCount = misc.channelCount;
                meta.codec = misc.codec;
                meta.originalCodec = misc.originalCodec;
                // The decode result of an mp3 sample is 1152 PCM samples
                meta.refSampleDuration = 1152 / meta.audioSampleRate * meta.timescale;
                Log.v(this.TAG, 'Parsed MPEG Audio Frame Header');

                this._audioInitialMetadataDispatched = true;
                this._onTrackMetadata('audio', meta);

                const mi = this._mediaInfo;
                mi.audioCodec = meta.codec;
                mi.audioSampleRate = meta.audioSampleRate;
                mi.audioChannelCount = meta.channelCount;
                mi.audioDataRate = misc.bitRate;
                if (mi.hasVideo) {
                    if (mi.videoCodec != null) {
                        mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
                    }
                } else {
                    mi.mimeType = 'video/x-flv; codecs="' + mi.audioCodec + '"';
                }
                if (mi.isComplete()) {
                    this._onMediaInfo(mi);
                }
            }

            // This packet is always a valid audio packet, extract it
            const data = this._parseMP3AudioData(arrayBuffer, dataOffset + 1, dataSize - 1, false);
            if (data == undefined) {
                return;
            }
            const dts = this._timestampBase + tagTimestamp;
            const mp3Sample = {unit: data, length: data.byteLength, dts: dts, pts: dts};
            track.samples.push(mp3Sample);
            track.length += data.length;
        } else if (soundFormat === 3) {
            if (!meta.codec) {
                meta.audioSampleRate = soundRate;
                meta.sampleSize = (soundSize + 1) * 8;
                meta.littleEndian = true;
                meta.codec = 'ipcm';
                meta.originalCodec = 'ipcm';

                this._audioInitialMetadataDispatched = true;
                this._onTrackMetadata('audio', meta);

                const mi = this._mediaInfo;
                mi.audioCodec = meta.codec;
                mi.audioSampleRate = meta.audioSampleRate;
                mi.audioChannelCount = meta.channelCount;
                mi.audioDataRate = meta.sampleSize * meta.audioSampleRate;
                if (mi.hasVideo) {
                    if (mi.videoCodec != null) {
                        mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
                    }
                } else {
                    mi.mimeType = 'video/x-flv; codecs="' + mi.audioCodec + '"';
                }
                if (mi.isComplete()) {
                    this._onMediaInfo(mi);
                }
            }

            const data = new Uint8Array(arrayBuffer, dataOffset + 1, dataSize - 1);
            const dts = this._timestampBase + tagTimestamp;
            const pcmSample = {unit: data, length: data.byteLength, dts: dts, pts: dts};
            track.samples.push(pcmSample);
            track.length += data.length;
        }
    }

    _parseAACAudioData(arrayBuffer, dataOffset, dataSize) {
        if (dataSize <= 1) {
            Log.w(this.TAG, 'Flv: Invalid AAC packet, missing AACPacketType or/and Data!');
            return;
        }

        const result = {};
        const array = new Uint8Array(arrayBuffer, dataOffset, dataSize);

        result.packetType = array[0];

        if (array[0] === 0) {
            result.data = this._parseAACAudioSpecificConfig(arrayBuffer, dataOffset + 1, dataSize - 1);
        } else {
            result.data = array.subarray(1);
        }

        return result;
    }

    _parseAACAudioSpecificConfig(arrayBuffer, dataOffset, dataSize) {
        const array = new Uint8Array(arrayBuffer, dataOffset, dataSize);
        let config = null;

        /* Audio Object Type:
           0: Null
           1: AAC Main
           2: AAC LC
           3: AAC SSR (Scalable Sample Rate)
           4: AAC LTP (Long Term Prediction)
           5: HE-AAC / SBR (Spectral Band Replication)
           6: AAC Scalable
        */

        let audioObjectType = 0;
        let originalAudioObjectType = 0;
        let audioExtensionObjectType = null;
        let samplingIndex = 0;
        let extensionSamplingIndex = null;

        // 5 bits
        audioObjectType = originalAudioObjectType = array[0] >>> 3;
        // 4 bits
        samplingIndex = ((array[0] & 0x07) << 1) | (array[1] >>> 7);
        if (samplingIndex < 0 || samplingIndex >= this._mpegSamplingRates.length) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: AAC invalid sampling frequency index!');
            return;
        }

        const samplingFrequence = this._mpegSamplingRates[samplingIndex];

        // 4 bits
        const channelConfig = (array[1] & 0x78) >>> 3;
        if (channelConfig < 0 || channelConfig >= 8) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: AAC invalid channel configuration');
            return;
        }

        if (audioObjectType === 5) {  // HE-AAC?
            // 4 bits
            extensionSamplingIndex = ((array[1] & 0x07) << 1) | (array[2] >>> 7);
            // 5 bits
            audioExtensionObjectType = (array[2] & 0x7C) >>> 2;
        }

        // workarounds for various browsers
        if (Browser.name === 'firefox' && Browser.engine === 'gecko') {
            // firefox: use SBR (HE-AAC) if freq less than 24kHz
            if (samplingIndex >= 6) {
                audioObjectType = 5;
                config = new Array(4);
                extensionSamplingIndex = samplingIndex - 3;
            } else {  // use LC-AAC
                audioObjectType = 2;
                config = new Array(2);
                extensionSamplingIndex = samplingIndex;
            }
        } else if (Browser.platform === 'android') {
            // android: always use LC-AAC
            audioObjectType = 2;
            config = new Array(2);
            extensionSamplingIndex = samplingIndex;
        } else {
            // for other browsers, e.g. chrome...
            // Always use HE-AAC to make it easier to switch aac codec profile
            audioObjectType = 5;
            extensionSamplingIndex = samplingIndex;
            config = new Array(4);

            if (samplingIndex >= 6) {
                extensionSamplingIndex = samplingIndex - 3;
            } else if (channelConfig === 1) {  // Mono channel
                audioObjectType = 2;
                config = new Array(2);
                extensionSamplingIndex = samplingIndex;
            }
        }

        config[0]  = audioObjectType << 3;
        config[0] |= (samplingIndex & 0x0F) >>> 1;
        config[1]  = (samplingIndex & 0x0F) << 7;
        config[1] |= (channelConfig & 0x0F) << 3;
        if (audioObjectType === 5) {
            config[1] |= ((extensionSamplingIndex & 0x0F) >>> 1);
            config[2]  = (extensionSamplingIndex & 0x01) << 7;
            // extended audio object type: force to 2 (LC-AAC)
            config[2] |= (2 << 2);
            config[3]  = 0;
        }

        return {
            config: config,
            samplingRate: samplingFrequence,
            channelCount: channelConfig,
            codec: 'mp4a.40.' + audioObjectType,
            originalCodec: 'mp4a.40.' + originalAudioObjectType
        };
    }

    _parseMP3AudioData(arrayBuffer, dataOffset, dataSize, requestHeader) {
        if (dataSize < 4) {
            Log.w(this.TAG, 'Flv: Invalid MP3 packet, header missing!');
            return;
        }

        const le = this._littleEndian;
        const array = new Uint8Array(arrayBuffer, dataOffset, dataSize);
        let result = null;

        if (requestHeader) {
            if (array[0] !== 0xFF) {
                return;
            }
            const ver = (array[1] >>> 3) & 0x03;
            const layer = (array[1] & 0x06) >> 1;

            const bitrate_index = (array[2] & 0xF0) >>> 4;
            const sampling_freq_index = (array[2] & 0x0C) >>> 2;

            const channel_mode = (array[3] >>> 6) & 0x03;
            const channel_count = channel_mode !== 3 ? 2 : 1;

            let sample_rate = 0;
            let bit_rate = 0;
            let object_type = 34;  // Layer-3, listed in MPEG-4 Audio Object Types

            const codec = 'mp3';

            switch (ver) {
                case 0:  // MPEG 2.5
                    sample_rate = this._mpegAudioV25SampleRateTable[sampling_freq_index];
                    break;
                case 2:  // MPEG 2
                    sample_rate = this._mpegAudioV20SampleRateTable[sampling_freq_index];
                    break;
                case 3:  // MPEG 1
                    sample_rate = this._mpegAudioV10SampleRateTable[sampling_freq_index];
                    break;
            }

            switch (layer) {
                case 1:  // Layer 3
                    object_type = 34;
                    if (bitrate_index < this._mpegAudioL3BitRateTable.length) {
                        bit_rate = this._mpegAudioL3BitRateTable[bitrate_index];
                    }
                    break;
                case 2:  // Layer 2
                    object_type = 33;
                    if (bitrate_index < this._mpegAudioL2BitRateTable.length) {
                        bit_rate = this._mpegAudioL2BitRateTable[bitrate_index];
                    }
                    break;
                case 3:  // Layer 1
                    object_type = 32;
                    if (bitrate_index < this._mpegAudioL1BitRateTable.length) {
                        bit_rate = this._mpegAudioL1BitRateTable[bitrate_index];
                    }
                    break;
            }

            result = {
                bitRate: bit_rate,
                samplingRate: sample_rate,
                channelCount: channel_count,
                codec: codec,
                originalCodec: codec
            };
        } else {
            result = array;
        }

        return result;
    }

    _parseOpusAudioPacket(arrayBuffer, dataOffset, dataSize, tagTimestamp, packetType) {
       if (packetType === 0) {  // OpusSequenceHeader
            this._parseOpusSequenceHeader(arrayBuffer, dataOffset, dataSize);
        } else if (packetType === 1) {  // OpusCodedData
            this._parseOpusAudioData(arrayBuffer, dataOffset, dataSize, tagTimestamp);
        } else if (packetType === 2) {
            // empty, Opus end of sequence
        } else {
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Invalid video packet type ${packetType}`);
            return;
        }
    }

    _parseOpusSequenceHeader(arrayBuffer, dataOffset, dataSize) {
        if (dataSize <= 16) {
            Log.w(this.TAG, 'Flv: Invalid OpusSequenceHeader, lack of data!');
            return;
        }
        let meta = this._audioMetadata;
        const track = this._audioTrack;

        if (!meta) {
            if (this._hasAudio === false && this._hasAudioFlagOverrided === false) {
                this._hasAudio = true;
                this._mediaInfo.hasAudio = true;
            }

            // initial metadata
            meta = this._audioMetadata = {};
            meta.type = 'audio';
            meta.id = track.id;
            meta.timescale = this._timescale;
            meta.duration = this._duration;
        }

        // Identification Header
        const v = new DataView(arrayBuffer, dataOffset, dataSize);
        v.setUint8(8 + 0, 0); // set version to 0
        const channelCount = v.getUint8(8 + 1); // Opus Header + 1
        v.setUint16(8 + 2, v.getUint16(8 + 2, true), false); // Big Endian to Little Endian for Pre-skip
        const samplingFrequence = v.getUint32(8 + 4, true); // Opus Header + 4
        v.setUint32(8 + 4, v.getUint32(8 + 4, true), false); // Big Endian to Little Endian for Input Sample Rate
        const config = new Uint8Array(arrayBuffer, dataOffset + 8, dataSize - 8);

        const misc = {
            config,
            channelCount,
            samplingFrequence,
            codec: 'opus',
            originalCodec: 'opus',
        };
        if (meta.config) {
            if (buffersAreEqual(misc.config, meta.config)) {
                // If OpusSequenceHeader is not changed, ignore it to avoid generating initialization segment repeatedly
                return;
            } else {
                Log.w(this.TAG, 'OpusSequenceHeader has been changed, re-generate initialization segment');
            }
        }
        meta.audioSampleRate = misc.samplingFrequence;
        meta.channelCount = misc.channelCount;
        meta.codec = misc.codec;
        meta.originalCodec = misc.originalCodec;
        meta.config = misc.config;
        // The decode result of an opus sample is 20ms
        meta.refSampleDuration = 20;
        Log.v(this.TAG, 'Parsed OpusSequenceHeader');

        if (this._isInitialMetadataDispatched()) {
            // Non-initial metadata, force dispatch (or flush) parsed frames to remuxer
            if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                this._onDataAvailable(this._audioTrack, this._videoTrack);
            }
        } else {
            this._audioInitialMetadataDispatched = true;
        }
        // then notify new metadata
        this._dispatch = false;
        this._onTrackMetadata('audio', meta);

        const mi = this._mediaInfo;
        mi.audioCodec = meta.originalCodec;
        mi.audioSampleRate = meta.audioSampleRate;
        mi.audioChannelCount = meta.channelCount;
        if (mi.hasVideo) {
            if (mi.videoCodec != null) {
                mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
            }
        } else {
            mi.mimeType = 'video/x-flv; codecs="' + mi.audioCodec + '"';
        }
        if (mi.isComplete()) {
            this._onMediaInfo(mi);
        }
    }

    _parseOpusAudioData(arrayBuffer, dataOffset, dataSize, tagTimestamp) {
        const track = this._audioTrack;

        const data = new Uint8Array(arrayBuffer, dataOffset, dataSize);
        const dts = this._timestampBase + tagTimestamp;
        const opusSample = {unit: data, length: data.byteLength, dts: dts, pts: dts};

        track.samples.push(opusSample);
        track.length += data.length;
    }

    _parseFlacAudioPacket(arrayBuffer, dataOffset, dataSize, tagTimestamp, packetType) {
        if (packetType === 0) {  // FlacSequenceHeader
            this._parseFlacSequenceHeader(arrayBuffer, dataOffset, dataSize);
        } else if (packetType === 1) {  // FlacCodedData
            this._parseFlacAudioData(arrayBuffer, dataOffset, dataSize, tagTimestamp);
        } else if (packetType === 2) {
            // empty, Flac end of sequence
        } else {
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Invalid Flac audio packet type ${packetType}`);
            return;
        }
    }

    _parseFlacSequenceHeader(arrayBuffer, dataOffset, dataSize) {
        let meta = this._audioMetadata;
        const track = this._audioTrack;

        if (!meta) {
            if (this._hasAudio === false && this._hasAudioFlagOverrided === false) {
                this._hasAudio = true;
                this._mediaInfo.hasAudio = true;
            }

            // initial metadata
            meta = this._audioMetadata = {};
            meta.type = 'audio';
            meta.id = track.id;
            meta.timescale = this._timescale;
            meta.duration = this._duration;
        }

        // METADATA_BLOCK_HEADER
        const header = new Uint8Array(arrayBuffer, dataOffset + 4, dataSize - 4);
        const gb = new ExpGolomb(header);
        const minimum_block_size = gb.readBits(16); // minimum_block_size
        const maximum_block_size = gb.readBits(16); // maximum_block_size
        const block_size = maximum_block_size === minimum_block_size ? maximum_block_size : null;
        gb.readBits(24); // minimum_frame_size
        gb.readBits(24); // maximum_frame_size
        const samplingFrequence = gb.readBits(20);
        const channelCount = gb.readBits(3) + 1;
        const sampleSize = gb.readBits(5) + 1;
        gb.destroy();

        const config = new Uint8Array(header.byteLength + 4);
        config.set(header, 4);
        config[0] = 1 << 7;
        config[1] = (header.byteLength >>> 16) & 0xFF;
        config[2] = (header.byteLength >>>  8) & 0xFF;
        config[3] = (header.byteLength >>>  0) & 0xFF;

        const misc = {
            config,
            channelCount,
            samplingFrequence,
            sampleSize,
            codec: 'flac',
            originalCodec: 'flac',
        };
        if (meta.config) {
            if (buffersAreEqual(misc.config, meta.config)) {
                // If FlacSequenceHeader is not changed, ignore it to avoid generating initialization segment repeatedly
                return;
            } else {
                Log.w(this.TAG, 'FlacSequenceHeader has been changed, re-generate initialization segment');
            }
        }
        meta.audioSampleRate = misc.samplingFrequence;
        meta.channelCount = misc.channelCount;
        meta.sampleSize = misc.sampleSize;
        meta.codec = misc.codec;
        meta.originalCodec = misc.originalCodec;
        meta.config = misc.config;
        meta.refSampleDuration = block_size != null ? block_size * 1000 / misc.samplingFrequence : null; // practical encoder sends 4608 blobksize (lower bound limitation)

        Log.v(this.TAG, 'Parsed FlacSequenceHeader');

        if (this._isInitialMetadataDispatched()) {
            // Non-initial metadata, force dispatch (or flush) parsed frames to remuxer
            if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                this._onDataAvailable(this._audioTrack, this._videoTrack);
            }
        } else {
            this._audioInitialMetadataDispatched = true;
        }
        // then notify new metadata
        this._dispatch = false;
        this._onTrackMetadata('audio', meta);

        const mi = this._mediaInfo;
        mi.audioCodec = meta.originalCodec;
        mi.audioSampleRate = meta.audioSampleRate;
        mi.audioChannelCount = meta.channelCount;
        if (mi.hasVideo) {
            if (mi.videoCodec != null) {
                mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
            }
        } else {
            mi.mimeType = 'video/x-flv; codecs="' + mi.audioCodec + '"';
        }
        if (mi.isComplete()) {
            this._onMediaInfo(mi);
        }
    }

    _parseFlacAudioData(arrayBuffer, dataOffset, dataSize, tagTimestamp) {
        const track = this._audioTrack;

        const data = new Uint8Array(arrayBuffer, dataOffset, dataSize);
        const dts = this._timestampBase + tagTimestamp;
        const flacSample = {unit: data, length: data.byteLength, dts: dts, pts: dts};

        track.samples.push(flacSample);
        track.length += data.length;
    }

    _parseVideoData(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition) {
        if (dataSize <= 1) {
            Log.w(this.TAG, 'Flv: Invalid video packet, missing VideoData payload!');
            return;
        }

        if (this._hasVideoFlagOverrided === true && this._hasVideo === false) {
            // If hasVideo: false indicated explicitly in MediaDataSource,
            // Ignore all the video packets
            return;
        }

        const spec = (new Uint8Array(arrayBuffer, dataOffset, dataSize))[0];

        const isExHeader = (spec & 0b10000000) !== 0;
        const frameType = (spec & 0b01110000) >>> 4;

        if (!isExHeader) {
            const codecId = spec & 0b00001111;
            if (codecId === 7) { // AVC
                this._parseAVCVideoPacket(arrayBuffer, dataOffset + 1, dataSize - 1, tagTimestamp, tagPosition, frameType);
            } else if (codecId === 12) { // HEVC
                this._parseHEVCVideoPacket(arrayBuffer, dataOffset + 1, dataSize - 1, tagTimestamp, tagPosition, frameType);
            } else {
                this._onError(DemuxErrors.CODEC_UNSUPPORTED, `Flv: Unsupported codec in video frame: ${codecId}`);
                return;
            }
        } else {
            const packetType = spec & 0b00001111;
            const fourcc = String.fromCharCode(... (new Uint8Array(arrayBuffer, dataOffset, dataSize)).slice(1, 5));

            if (fourcc === 'hvc1') { // HEVC
                this._parseEnhancedHEVCVideoPacket(arrayBuffer, dataOffset + 5, dataSize - 5, tagTimestamp, tagPosition, frameType, packetType);
            } else if (fourcc === 'av01') { // HEVC
                this._parseEnhancedAV1VideoPacket(arrayBuffer, dataOffset + 5, dataSize - 5, tagTimestamp, tagPosition, frameType, packetType);
            } else {
                this._onError(DemuxErrors.CODEC_UNSUPPORTED, `Flv: Unsupported codec in video frame: ${fourcc}`);
                return;
            }
        }
    }

    _parseAVCVideoPacket(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType) {
        if (dataSize < 4) {
            Log.w(this.TAG, 'Flv: Invalid AVC packet, missing AVCPacketType or/and CompositionTime');
            return;
        }

        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        const packetType = v.getUint8(0);
        const cts_unsigned = v.getUint32(0, !le) & 0x00FFFFFF;
        const cts = (cts_unsigned << 8) >> 8;  // convert to 24-bit signed int

        if (packetType === 0) {  // AVCDecoderConfigurationRecord
            this._parseAVCDecoderConfigurationRecord(arrayBuffer, dataOffset + 4, dataSize - 4);
        } else if (packetType === 1) {  // One or more Nalus
            this._parseAVCVideoData(arrayBuffer, dataOffset + 4, dataSize - 4, tagTimestamp, tagPosition, frameType, cts);
        } else if (packetType === 2) {
            // empty, AVC end of sequence
        } else {
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Invalid video packet type ${packetType}`);
            return;
        }
    }

    _parseHEVCVideoPacket(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType) {
        if (dataSize < 4) {
            Log.w(this.TAG, 'Flv: Invalid HEVC packet, missing HEVCPacketType or/and CompositionTime');
            return;
        }

        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        const packetType = v.getUint8(0);
        const cts_unsigned = v.getUint32(0, !le) & 0x00FFFFFF;
        const cts = (cts_unsigned << 8) >> 8;  // convert to 24-bit signed int

        if (packetType === 0) {  // HEVCDecoderConfigurationRecord
            this._parseHEVCDecoderConfigurationRecord(arrayBuffer, dataOffset + 4, dataSize - 4);
        } else if (packetType === 1) {  // One or more Nalus
            this._parseHEVCVideoData(arrayBuffer, dataOffset + 4, dataSize - 4, tagTimestamp, tagPosition, frameType, cts);
        } else if (packetType === 2) {
            // empty, HEVC end of sequence
        } else {
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Invalid video packet type ${packetType}`);
            return;
        }
    }

    _parseEnhancedHEVCVideoPacket(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, packetType) {
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        if (packetType === 0) {  // HEVCDecoderConfigurationRecord
            this._parseHEVCDecoderConfigurationRecord(arrayBuffer, dataOffset, dataSize);
        } else if (packetType === 1) {  // One or more Nalus
            const cts_unsigned = v.getUint32(0, !le) & 0xFFFFFF00;
            const cts = cts_unsigned >> 8;  // convert to 24-bit signed int

            this._parseHEVCVideoData(arrayBuffer, dataOffset + 3, dataSize - 3, tagTimestamp, tagPosition, frameType, cts);
        } else if (packetType === 3) {
            this._parseHEVCVideoData(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, 0);
        } else if (packetType === 2) {
            // empty, HEVC end of sequence
        } else {
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Invalid video packet type ${packetType}`);
            return;
        }
    }

    _parseEnhancedAV1VideoPacket(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, packetType) {
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        if (packetType === 0) {  // AV1CodecConfigurationRecord
            this._parseAV1CodecConfigurationRecord(arrayBuffer, dataOffset, dataSize);
        } else if (packetType === 1) {  // One or more OBUs
            this._parseAV1VideoData(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, 0);
        } else if (packetType === 5) {
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Not Supported MP2T AV1 video packet type ${packetType}`);
            return;
        } else if (packetType === 2) {
            // empty, AV1 end of sequence
        } else {
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Invalid video packet type ${packetType}`);
            return;
        }
    }

    _parseAVCDecoderConfigurationRecord(arrayBuffer, dataOffset, dataSize) {
        if (dataSize < 7) {
            Log.w(this.TAG, 'Flv: Invalid AVCDecoderConfigurationRecord, lack of data!');
            return;
        }

        let meta = this._videoMetadata;
        const track = this._videoTrack;
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        if (!meta) {
            if (this._hasVideo === false && this._hasVideoFlagOverrided === false) {
                this._hasVideo = true;
                this._mediaInfo.hasVideo = true;
            }

            meta = this._videoMetadata = {};
            meta.type = 'video';
            meta.id = track.id;
            meta.timescale = this._timescale;
            meta.duration = this._duration;
        } else {
            if (typeof meta.avcc !== 'undefined') {
                const new_avcc = new Uint8Array(arrayBuffer, dataOffset, dataSize);
                if (buffersAreEqual(new_avcc, meta.avcc)) {
                    // AVCDecoderConfigurationRecord is not changed, ignore it to avoid initialization segment re-generating
                    return;
                } else {
                    Log.w(this.TAG, 'AVCDecoderConfigurationRecord has been changed, re-generate initialization segment');
                }
            }
        }

        const version = v.getUint8(0);  // configurationVersion
        const avcProfile = v.getUint8(1);  // avcProfileIndication
        const profileCompatibility = v.getUint8(2);  // profile_compatibility
        const avcLevel = v.getUint8(3);  // AVCLevelIndication

        if (version !== 1 || avcProfile === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AVCDecoderConfigurationRecord');
            return;
        }

        this._naluLengthSize = (v.getUint8(4) & 3) + 1;  // lengthSizeMinusOne
        if (this._naluLengthSize !== 3 && this._naluLengthSize !== 4) {  // holy shit!!!
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Strange NaluLengthSizeMinusOne: ${this._naluLengthSize - 1}`);
            return;
        }

        const spsCount = v.getUint8(5) & 31;  // numOfSequenceParameterSets
        if (spsCount === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AVCDecoderConfigurationRecord: No SPS');
            return;
        } else if (spsCount > 1) {
            Log.w(this.TAG, `Flv: Strange AVCDecoderConfigurationRecord: SPS Count = ${spsCount}`);
        }

        let offset = 6;

        for (let i = 0; i < spsCount; i++) {
            const len = v.getUint16(offset, !le);  // sequenceParameterSetLength
            offset += 2;

            if (len === 0) {
                continue;
            }

            // Notice: Nalu without startcode header (00 00 00 01)
            const sps = new Uint8Array(arrayBuffer, dataOffset + offset, len);
            offset += len;

            const config = SPSParser.parseSPS(sps);
            if (i !== 0) {
                // ignore other sps's config
                continue;
            }

            meta.codecWidth = config.codec_size.width;
            meta.codecHeight = config.codec_size.height;
            meta.presentWidth = config.present_size.width;
            meta.presentHeight = config.present_size.height;

            meta.profile = config.profile_string;
            meta.level = config.level_string;
            meta.bitDepth = config.bit_depth;
            meta.chromaFormat = config.chroma_format;
            meta.sarRatio = config.sar_ratio;
            meta.frameRate = config.frame_rate;

            if (config.frame_rate.fixed === false ||
                config.frame_rate.fps_num === 0 ||
                config.frame_rate.fps_den === 0) {
                meta.frameRate = this._referenceFrameRate;
            }

            const fps_den = meta.frameRate.fps_den;
            const fps_num = meta.frameRate.fps_num;
            meta.refSampleDuration = meta.timescale * (fps_den / fps_num);

            const codecArray = sps.subarray(1, 4);
            let codecString = 'avc1.';
            for (let j = 0; j < 3; j++) {
                let h = codecArray[j].toString(16);
                if (h.length < 2) {
                    h = '0' + h;
                }
                codecString += h;
            }
            meta.codec = codecString;

            const mi = this._mediaInfo;
            mi.width = meta.codecWidth;
            mi.height = meta.codecHeight;
            mi.fps = meta.frameRate.fps;
            mi.profile = meta.profile;
            mi.level = meta.level;
            mi.refFrames = config.ref_frames;
            mi.chromaFormat = config.chroma_format_string;
            mi.sarNum = meta.sarRatio.width;
            mi.sarDen = meta.sarRatio.height;
            mi.videoCodec = codecString;

            if (mi.hasAudio) {
                if (mi.audioCodec != null) {
                    mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
                }
            } else {
                mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + '"';
            }
            if (mi.isComplete()) {
                this._onMediaInfo(mi);
            }
        }

        const ppsCount = v.getUint8(offset);  // numOfPictureParameterSets
        if (ppsCount === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AVCDecoderConfigurationRecord: No PPS');
            return;
        } else if (ppsCount > 1) {
            Log.w(this.TAG, `Flv: Strange AVCDecoderConfigurationRecord: PPS Count = ${ppsCount}`);
        }

        offset++;

        for (let i = 0; i < ppsCount; i++) {
            const len = v.getUint16(offset, !le);  // pictureParameterSetLength
            offset += 2;

            if (len === 0) {
                continue;
            }

            // pps is useless for extracting video information
            offset += len;
        }

        meta.avcc = new Uint8Array(dataSize);
        meta.avcc.set(new Uint8Array(arrayBuffer, dataOffset, dataSize), 0);
        Log.v(this.TAG, 'Parsed AVCDecoderConfigurationRecord');

        if (this._isInitialMetadataDispatched()) {
            // flush parsed frames
            if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                this._onDataAvailable(this._audioTrack, this._videoTrack);
            }
        } else {
            this._videoInitialMetadataDispatched = true;
        }
        // notify new metadata
        this._dispatch = false;
        this._onTrackMetadata('video', meta);
    }

    _parseHEVCDecoderConfigurationRecord(arrayBuffer, dataOffset, dataSize) {
        if (dataSize < 22) {
            Log.w(this.TAG, 'Flv: Invalid HEVCDecoderConfigurationRecord, lack of data!');
            return;
        }

        let meta = this._videoMetadata;
        const track = this._videoTrack;
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        if (!meta) {
            if (this._hasVideo === false && this._hasVideoFlagOverrided === false) {
                this._hasVideo = true;
                this._mediaInfo.hasVideo = true;
            }

            meta = this._videoMetadata = {};
            meta.type = 'video';
            meta.id = track.id;
            meta.timescale = this._timescale;
            meta.duration = this._duration;
        } else {
            if (typeof meta.hvcc !== 'undefined') {
                const new_hvcc = new Uint8Array(arrayBuffer, dataOffset, dataSize);
                if (buffersAreEqual(new_hvcc, meta.hvcc)) {
                    // HEVCDecoderConfigurationRecord not changed, ignore it to avoid initialization segment re-generating
                    return;
                } else {
                    Log.w(this.TAG, 'HEVCDecoderConfigurationRecord has been changed, re-generate initialization segment');
                }
            }
        }

        const version = v.getUint8(0);  // configurationVersion
        const hevcProfile = v.getUint8(1) & 0x1F;  // hevcProfileIndication

        if ((version !== 0 && version !== 1) || hevcProfile === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid HEVCDecoderConfigurationRecord');
            return;
        }

        this._naluLengthSize = (v.getUint8(21) & 3) + 1;  // lengthSizeMinusOne
        if (this._naluLengthSize !== 3 && this._naluLengthSize !== 4) {  // holy shit!!!
            this._onError(DemuxErrors.FORMAT_ERROR, `Flv: Strange NaluLengthSizeMinusOne: ${this._naluLengthSize - 1}`);
            return;
        }

        const numOfArrays = v.getUint8(22);
        for (let i = 0, offset = 23; i < numOfArrays; i++) {
            const nalUnitType = v.getUint8(offset + 0) & 0x3F;
            const numNalus = v.getUint16(offset + 1, !le);

            offset += 3;
            for (let j = 0; j < numNalus; j++) {
                const len = v.getUint16(offset + 0, !le);
                if (j !== 0) {
                    offset += 2 + len;
                    continue;
                }

                if (nalUnitType === 33) {
                    offset += 2;
                    const sps = new Uint8Array(arrayBuffer, dataOffset + offset, len);

                    const config = H265Parser.parseSPS(sps);
                    meta.codecWidth = config.codec_size.width;
                    meta.codecHeight = config.codec_size.height;
                    meta.presentWidth = config.present_size.width;
                    meta.presentHeight = config.present_size.height;

                    meta.profile = config.profile_string;
                    meta.level = config.level_string;
                    meta.bitDepth = config.bit_depth;
                    meta.chromaFormat = config.chroma_format;
                    meta.sarRatio = config.sar_ratio;
                    meta.frameRate = config.frame_rate;

                    if (config.frame_rate.fixed === false ||
                        config.frame_rate.fps_num === 0 ||
                        config.frame_rate.fps_den === 0) {
                        meta.frameRate = this._referenceFrameRate;
                    }

                    const fps_den = meta.frameRate.fps_den;
                    const fps_num = meta.frameRate.fps_num;
                    meta.refSampleDuration = meta.timescale * (fps_den / fps_num);
                    meta.codec = config.codec_mimetype;

                    const mi = this._mediaInfo;
                    mi.width = meta.codecWidth;
                    mi.height = meta.codecHeight;
                    mi.fps = meta.frameRate.fps;
                    mi.profile = meta.profile;
                    mi.level = meta.level;
                    mi.refFrames = config.ref_frames;
                    mi.chromaFormat = config.chroma_format_string;
                    mi.sarNum = meta.sarRatio.width;
                    mi.sarDen = meta.sarRatio.height;
                    mi.videoCodec = config.codec_mimetype;

                    if (mi.hasAudio) {
                        if (mi.audioCodec != null) {
                            mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
                        }
                    } else {
                        mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + '"';
                    }
                    if (mi.isComplete()) {
                        this._onMediaInfo(mi);
                    }

                    offset += len;
                } else {
                    offset += 2 + len;
                }
            }
        }

        meta.hvcc = new Uint8Array(dataSize);
        meta.hvcc.set(new Uint8Array(arrayBuffer, dataOffset, dataSize), 0);
        Log.v(this.TAG, 'Parsed HEVCDecoderConfigurationRecord');

        if (this._isInitialMetadataDispatched()) {
            // flush parsed frames
            if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                this._onDataAvailable(this._audioTrack, this._videoTrack);
            }
        } else {
            this._videoInitialMetadataDispatched = true;
        }
        // notify new metadata
        this._dispatch = false;
        this._onTrackMetadata('video', meta);
    }

    _parseAV1CodecConfigurationRecord(arrayBuffer, dataOffset, dataSize) {
        if (dataSize < 4) {
            Log.w(this.TAG, 'Flv: Invalid AV1CodecConfigurationRecord, lack of data!');
            return;
        }

        let meta = this._videoMetadata;
        const track = this._videoTrack;
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        if (!meta) {
            if (this._hasVideo === false && this._hasVideoFlagOverrided === false) {
                this._hasVideo = true;
                this._mediaInfo.hasVideo = true;
            }

            meta = this._videoMetadata = {};
            meta.type = 'video';
            meta.id = track.id;
            meta.timescale = this._timescale;
            meta.duration = this._duration;
        } else {
            if (typeof meta.av1c !== 'undefined') {
                Log.w(this.TAG, 'Found another AV1CodecConfigurationRecord!');
            }
        }

        const version = v.getUint8(0) & 0x7F;
        const seq_profile = (v.getUint8(1) & 0xE0) >> 5;
        const seq_level_idx = (v.getUint8(1) & 0x8F) >> 0;
        const seq_tier = (v.getUint8(2) & 0x80) >> 7;

        if (version !== 1) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AV1CodecConfigurationRecord');
            return;
        }

        const config = AV1OBUParser.parseOBUs(new Uint8Array(arrayBuffer, dataOffset + 4, dataSize - 4));
        if (config == null) {
            this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AV1CodecConfigurationRecord');
            return;
        }

        meta.profile = config.profile_string;
        meta.level = config.level_string;
        meta.bitDepth = config.bit_depth;
        meta.chromaFormat = config.chroma_format;
        meta.frameRate = config.frame_rate;
        if (config.frame_rate.fixed === false ||
            config.frame_rate.fps_num === 0 ||
            config.frame_rate.fps_den === 0) {
            meta.frameRate = this._referenceFrameRate;
        }
        const fps_den = meta.frameRate.fps_den;
        const fps_num = meta.frameRate.fps_num;
        meta.refSampleDuration = meta.timescale * (fps_den / fps_num);
        meta.codec = config.codec_mimetype;
        meta.extra = config;

        const mi = this._mediaInfo;
        mi.fps = meta.frameRate.fps;
        mi.profile = meta.profile;
        mi.level = meta.level;
        mi.refFrames = config.ref_frames;
        mi.chromaFormat = config.chroma_format_string;
        mi.videoCodec = config.codec_mimetype;

        if (mi.hasAudio) {
            if (mi.audioCodec != null) {
                mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + ',' + mi.audioCodec + '"';
            }
        } else {
            mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + '"';
        }
        if (mi.isComplete()) {
            this._onMediaInfo(mi);
        }
        meta.av1c = new Uint8Array(dataSize);
        meta.av1c.set(new Uint8Array(arrayBuffer, dataOffset, dataSize), 0);
        Log.v(this.TAG, 'Preparing AV1CodecConfigurationRecord');
    }

    _parseAVCVideoData(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, cts) {
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        const units = [];
        let length = 0;

        let offset = 0;
        const lengthSize = this._naluLengthSize;
        const dts = this._timestampBase + tagTimestamp;
        let keyframe = (frameType === 1);  // from FLV Frame Type constants

        while (offset < dataSize) {
            if (offset + 4 >= dataSize) {
                Log.w(this.TAG, `Malformed Nalu near timestamp ${dts}, offset = ${offset}, dataSize = ${dataSize}`);
                break;  // data not enough for next Nalu
            }
            // Nalu with length-header (AVC1)
            let naluSize = v.getUint32(offset, !le);  // Big-Endian read
            if (lengthSize === 3) {
                naluSize >>>= 8;
            }
            if (naluSize > dataSize - lengthSize) {
                Log.w(this.TAG, `Malformed Nalus near timestamp ${dts}, NaluSize > DataSize!`);
                return;
            }

            const unitType = v.getUint8(offset + lengthSize) & 0x1F;

            if (unitType === 5) {  // IDR
                keyframe = true;
            }

            const data = new Uint8Array(arrayBuffer, dataOffset + offset, lengthSize + naluSize);
            const unit = {type: unitType, data: data};
            units.push(unit);
            length += data.byteLength;

            if (unitType === 6) {  // SEI
                this._parseSEIPayload(data.subarray(lengthSize), dts + cts, 'h264');
            }

            offset += lengthSize + naluSize;
        }

        if (units.length) {
            const track = this._videoTrack;
            const avcSample = {
                units: units,
                length: length,
                isKeyframe: keyframe,
                dts: dts,
                cts: cts,
                pts: (dts + cts)
            };
            if (keyframe) {
                avcSample.fileposition = tagPosition;
            }
            track.samples.push(avcSample);
            track.length += length;
        }
    }

    _parseHEVCVideoData(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, cts) {
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        const units = [];
        let length = 0;

        let offset = 0;
        const lengthSize = this._naluLengthSize;
        const dts = this._timestampBase + tagTimestamp;
        let keyframe = (frameType === 1);  // from FLV Frame Type constants

        while (offset < dataSize) {
            if (offset + 4 >= dataSize) {
                Log.w(this.TAG, `Malformed Nalu near timestamp ${dts}, offset = ${offset}, dataSize = ${dataSize}`);
                break;  // data not enough for next Nalu
            }
            // Nalu with length-header (HVC1)
            let naluSize = v.getUint32(offset, !le);  // Big-Endian read
            if (lengthSize === 3) {
                naluSize >>>= 8;
            }
            if (naluSize > dataSize - lengthSize) {
                Log.w(this.TAG, `Malformed Nalus near timestamp ${dts}, NaluSize > DataSize!`);
                return;
            }

            const unitType = (v.getUint8(offset + lengthSize) >> 1) & 0x3F;

            if (unitType === 19 || unitType === 20 || unitType === 21) {  // IRAP
                keyframe = true;
            }

            const data = new Uint8Array(arrayBuffer, dataOffset + offset, lengthSize + naluSize);
            const unit = {type: unitType, data: data};
            units.push(unit);
            length += data.byteLength;

            if (unitType === 39 || unitType === 40) {  // Prefix / Suffix SEI
                this._parseSEIPayload(data.subarray(lengthSize), dts + cts, 'h265');
            }

            offset += lengthSize + naluSize;
        }

        if (units.length) {
            const track = this._videoTrack;
            const hevcSample = {
                units: units,
                length: length,
                isKeyframe: keyframe,
                dts: dts,
                cts: cts,
                pts: (dts + cts)
            };
            if (keyframe) {
                hevcSample.fileposition = tagPosition;
            }
            track.samples.push(hevcSample);
            track.length += length;
        }
    }

    _parseAV1VideoData(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, cts) {
        const le = this._littleEndian;
        const v = new DataView(arrayBuffer, dataOffset, dataSize);

        const units = [];
        let length = 0;

        const offset = 0;
        const dts = this._timestampBase + tagTimestamp;
        const keyframe = (frameType === 1);  // from FLV Frame Type constants

        if (keyframe) {
            const meta = this._videoMetadata;

            const config = AV1OBUParser.parseOBUs(new Uint8Array(arrayBuffer, dataOffset, dataSize), meta.extra);
            if (config == null) {
                this._onError(DemuxErrors.FORMAT_ERROR, 'Flv: Invalid AV1 VideoData');
                return;
            }
            console.log(config);
            meta.codecWidth = config.codec_size.width;
            meta.codecHeight = config.codec_size.height;
            meta.presentWidth = config.present_size.width;
            meta.presentHeight = config.present_size.height;
            meta.sarRatio = config.sar_ratio;

            const mi = this._mediaInfo;
            mi.width = meta.codecWidth;
            mi.height = meta.codecHeight;
            mi.sarNum = meta.sarRatio.width;
            mi.sarDen = meta.sarRatio.height;

            Log.v(this.TAG, 'Parsed AV1DecoderConfigurationRecord');

            if (this._isInitialMetadataDispatched()) {
                // flush parsed frames
                if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                    this._onDataAvailable(this._audioTrack, this._videoTrack);
                }
            } else {
                this._videoInitialMetadataDispatched = true;
            }
            // notify new metadata
            this._dispatch = false;
            this._onTrackMetadata('video', meta);
        }

        /* FIXME: NEEDS Inspect Per OBUs */
        length = dataSize;
        units.push({
            unitType: 0,
            data: new Uint8Array(arrayBuffer, dataOffset + offset, dataSize)
        });

        if (units.length) {
            const track = this._videoTrack;
            const av1Sample = {
                units: units,
                length: length,
                isKeyframe: keyframe,
                dts: dts,
                cts: cts,
                pts: (dts + cts)
            };
            if (keyframe) {
                av1Sample.fileposition = tagPosition;
            }
            track.samples.push(av1Sample);
            track.length += length;
        }
    }
}

export default FLVDemuxer;