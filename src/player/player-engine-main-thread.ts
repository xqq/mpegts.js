/*
 * Copyright (C) 2023 zheng qian. All Rights Reserved.
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

import * as EventEmitter from 'events';
import type PlayerEngine from './player-engine';
import Log from '../utils/logger';
import { createDefaultConfig } from '../config';
import MSEController from '../core/mse-controller';
import PlayerEvents from './player-events';
import Transmuxer from '../core/transmuxer';
import MediaInfo from '../core/media-info';
import MSEEvents from '../core/mse-events';
import { ErrorTypes, ErrorDetails } from './player-errors';
import { IllegalStateException } from '../utils/exception';
import TransmuxingEvents from '../core/transmuxing-events';
import SeekingHandler from './seeking-handler';
import LoadingController from './loading-controller';
import StartupStallJumper from './startup-stall-jumper';
import LiveLatencyChaser from './live-latency-chaser';
import LiveLatencySynchronizer from './live-latency-synchronizer';

class PlayerEngineMainThread implements PlayerEngine {

    private readonly TAG: string = 'PlayerEngineMainThread';

    private _emitter: EventEmitter = new EventEmitter();
    private _media_data_source: any;
    private _config: any;

    private _media_element?: HTMLMediaElement = null;

    private _mse_controller?: MSEController = null;
    private _transmuxer?: Transmuxer = null;

    private _pending_seek_time?: number = null;

    private _seeking_handler?: SeekingHandler = null;
    private _loading_controller?: LoadingController = null;
    private _startup_stall_jumper?: StartupStallJumper = null;
    private _live_latency_chaser?: LiveLatencyChaser = null;
    private _live_latency_synchronizer?: LiveLatencySynchronizer = null;

    private _mse_source_opened: boolean = false;
    private _has_pending_load: boolean = false;
    private _loaded_metadata_received: boolean = false;

    private _media_info?: MediaInfo = null;
    private _statistics_info?: any = null;

    private e?: any = null;

    public constructor(mediaDataSource: any, config: any) {
        this._media_data_source = mediaDataSource;
        this._config = createDefaultConfig();

        if (typeof config === 'object') {
            Object.assign(this._config, config);
        }

        if (mediaDataSource.isLive === true) {
            this._config.isLive = true;
        }

        this.e = {
            onMediaLoadedMetadata: this._onMediaLoadedMetadata.bind(this),
        };
    }

    public destroy(): void {
        this._emitter.emit(PlayerEvents.DESTROYING);
        if (this._transmuxer) {
            this.unload();
        }
        if (this._media_element) {
            this.detachMediaElement();
        }
        this.e = null;
        this._media_data_source = null;

        this._emitter.removeAllListeners();
        this._emitter = null;
    }

    public on(event: string, listener: (...args: any[]) => void): void {
        this._emitter.addListener(event, listener);
        // For media_info / statistics_info event, trigger it immediately
        if (event === PlayerEvents.MEDIA_INFO && this._media_info) {
            Promise.resolve().then(() => this._emitter.emit(PlayerEvents.MEDIA_INFO, this.mediaInfo));
        } else if (event == PlayerEvents.STATISTICS_INFO && this._statistics_info) {
            Promise.resolve().then(() => this._emitter.emit(PlayerEvents.STATISTICS_INFO, this.statisticsInfo));
        }
    }

    public off(event: string, listener: (...args: any[]) => void): void {
        this._emitter.removeListener(event, listener);
    }

    public attachMediaElement(mediaElement: HTMLMediaElement): void {
        this._media_element = mediaElement;

        // Remove src / srcObject of HTMLMediaElement for cleanup
        mediaElement.src = '';
        mediaElement.removeAttribute('src');
        mediaElement.srcObject = null;
        mediaElement.load();

        mediaElement.addEventListener('loadedmetadata', this.e.onMediaLoadedMetadata);

        this._mse_controller = new MSEController(this._config);
        this._mse_controller.on(MSEEvents.UPDATE_END, this._onMSEUpdateEnd.bind(this));
        this._mse_controller.on(MSEEvents.BUFFER_FULL, this._onMSEBufferFull.bind(this));
        this._mse_controller.on(MSEEvents.SOURCE_OPEN, this._onMSESourceOpen.bind(this));
        this._mse_controller.on(MSEEvents.ERROR, this._onMSEError.bind(this));
        this._mse_controller.on(MSEEvents.START_STREAMING, this._onMSEStartStreaming.bind(this));
        this._mse_controller.on(MSEEvents.END_STREAMING, this._onMSEEndStreaming.bind(this));

        this._mse_controller.initialize({
            getCurrentTime: () => this._media_element.currentTime,
            getReadyState: () => this._media_element.readyState,
        });

        // Attach media source into media element
        if (this._mse_controller.isManagedMediaSource()) {
            // Apple ManagedMediaSource
            mediaElement['disableRemotePlayback'] = true;
            mediaElement.srcObject = this._mse_controller.getObject();
        } else {
            // w3c MediaSource
            mediaElement.src = this._mse_controller.getObjectURL();
        }
    }

    public detachMediaElement(): void {
        if (this._media_element) {
            this._mse_controller.shutdown();

            // Remove all appended event listeners
            this._media_element.removeEventListener('loadedmetadata', this.e.onMediaLoadedMetadata);

            // Detach media source from media element
            this._media_element.src = '';
            this._media_element.removeAttribute('src');
            this._media_element.srcObject = null;
            this._media_element.load();
            this._media_element = null;

            this._mse_controller.revokeObjectURL();
        }
        if (this._mse_controller) {
            this._mse_controller.destroy();
            this._mse_controller = null;
        }
    }

    public load(): void {
        if (!this._media_element) {
            throw new IllegalStateException('HTMLMediaElement must be attached before load()!');
        }
        if (this._transmuxer) {
            throw new IllegalStateException('load() has been called, please call unload() first!');
        }
        if (this._has_pending_load) {
            // Defer load operation until MSE source open
            return;
        }

        if (this._config.deferLoadAfterSourceOpen && !this._mse_source_opened) {
            this._has_pending_load = true;
            return;
        }

        this._transmuxer = new Transmuxer(this._media_data_source, this._config);

        this._transmuxer.on(TransmuxingEvents.INIT_SEGMENT, (type: string, is: any) => {
            this._mse_controller.appendInitSegment(is);
        });
        this._transmuxer.on(TransmuxingEvents.MEDIA_SEGMENT, (type: string, ms: any) => {
            this._mse_controller.appendMediaSegment(ms);
            if (!this._config.isLive && type === 'video' && ms.data && ms.data.byteLength > 0 && ('info' in ms)) {
                this._seeking_handler.appendSyncPoints(ms.info.syncPoints);
            }
            this._loading_controller.notifyBufferedPositionChanged(ms.info.endDts / 1000);
        });
        this._transmuxer.on(TransmuxingEvents.LOADING_COMPLETE, () => {
            this._mse_controller.endOfStream();
            this._emitter.emit(PlayerEvents.LOADING_COMPLETE);
        });
        this._transmuxer.on(TransmuxingEvents.RECOVERED_EARLY_EOF, () => {
            this._emitter.emit(PlayerEvents.RECOVERED_EARLY_EOF);
        });
        this._transmuxer.on(TransmuxingEvents.IO_ERROR, (detail: any, info: any) => {
            this._emitter.emit(PlayerEvents.ERROR, ErrorTypes.NETWORK_ERROR, detail, info);
        });
        this._transmuxer.on(TransmuxingEvents.DEMUX_ERROR, (detail: any, info: any) => {
            this._emitter.emit(PlayerEvents.ERROR, ErrorTypes.MEDIA_ERROR, detail, info);
        });
        this._transmuxer.on(TransmuxingEvents.MEDIA_INFO, (mediaInfo: MediaInfo) => {
            this._media_info = mediaInfo;
            this._emitter.emit(PlayerEvents.MEDIA_INFO, Object.assign({}, mediaInfo));
        });
        this._transmuxer.on(TransmuxingEvents.STATISTICS_INFO, (statInfo: any) => {
            this._statistics_info = this._fillStatisticsInfo(statInfo);
            this._emitter.emit(PlayerEvents.STATISTICS_INFO, Object.assign({}, statInfo));
        });
        this._transmuxer.on(TransmuxingEvents.RECOMMEND_SEEKPOINT, (milliseconds: number) => {
            if (this._media_element && !this._config.accurateSeek) {
                this._seeking_handler.directSeek(milliseconds / 1000);
            }
        });
        this._transmuxer.on(TransmuxingEvents.METADATA_ARRIVED, (metadata: any) => {
            this._emitter.emit(PlayerEvents.METADATA_ARRIVED, metadata);
        });
        this._transmuxer.on(TransmuxingEvents.SCRIPTDATA_ARRIVED, (data: any) => {
            this._emitter.emit(PlayerEvents.SCRIPTDATA_ARRIVED, data);
        });
        this._transmuxer.on(TransmuxingEvents.TIMED_ID3_METADATA_ARRIVED, (timed_id3_metadata: any) => {
            this._emitter.emit(PlayerEvents.TIMED_ID3_METADATA_ARRIVED, timed_id3_metadata);
        });
        this._transmuxer.on(TransmuxingEvents.PGS_SUBTITLE_ARRIVED, (pgs_data: any) => {
            this._emitter.emit(PlayerEvents.PGS_SUBTITLE_ARRIVED, pgs_data);
        });
        this._transmuxer.on(TransmuxingEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, (synchronous_klv_metadata: any) => {
            this._emitter.emit(PlayerEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, synchronous_klv_metadata);
        });
        this._transmuxer.on(TransmuxingEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, (asynchronous_klv_metadata: any) => {
            this._emitter.emit(PlayerEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, asynchronous_klv_metadata);
        });
        this._transmuxer.on(TransmuxingEvents.SMPTE2038_METADATA_ARRIVED, (smpte2038_metadata: any) => {
            this._emitter.emit(PlayerEvents.SMPTE2038_METADATA_ARRIVED, smpte2038_metadata);
        });
        this._transmuxer.on(TransmuxingEvents.SCTE35_METADATA_ARRIVED, (scte35_metadata: any) => {
            this._emitter.emit(PlayerEvents.SCTE35_METADATA_ARRIVED, scte35_metadata);
        });
        this._transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_DESCRIPTOR, (descriptor: any) => {
            this._emitter.emit(PlayerEvents.PES_PRIVATE_DATA_DESCRIPTOR, descriptor);
        });
        this._transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_ARRIVED, (private_data: any) => {
            this._emitter.emit(PlayerEvents.PES_PRIVATE_DATA_ARRIVED, private_data);
        });

        this._seeking_handler = new SeekingHandler(
            this._config,
            this._media_element,
            this._onRequiredUnbufferedSeek.bind(this)
        );

        this._loading_controller = new LoadingController(
            this._config,
            this._media_element,
            this._onRequestPauseTransmuxer.bind(this),
            this._onRequestResumeTransmuxer.bind(this)
        );

        this._startup_stall_jumper = new StartupStallJumper(
            this._media_element,
            this._onRequestDirectSeek.bind(this)
        );

        if (this._config.isLive && this._config.liveBufferLatencyChasing) {
            this._live_latency_chaser = new LiveLatencyChaser(
                this._config,
                this._media_element,
                this._onRequestDirectSeek.bind(this)
            );
        }

        if (this._config.isLive && this._config.liveSync) {
            this._live_latency_synchronizer = new LiveLatencySynchronizer(
                this._config,
                this._media_element
            );
        }

        // Reset currentTime to 0
        if (this._media_element.readyState > 0) {
            // IE11 may throw InvalidStateError if readyState === 0
            this._seeking_handler.directSeek(0);
        }

        this._transmuxer.open();
    }

    public unload(): void {
        this._media_element?.pause();

        this._live_latency_synchronizer?.destroy();
        this._live_latency_synchronizer = null;

        this._live_latency_chaser?.destroy();
        this._live_latency_chaser = null;

        this._startup_stall_jumper?.destroy();
        this._startup_stall_jumper = null;

        this._loading_controller?.destroy();
        this._loading_controller = null;

        this._seeking_handler?.destroy();
        this._seeking_handler = null;

        this._mse_controller?.flush();

        this._transmuxer?.close();
        this._transmuxer?.destroy();
        this._transmuxer = null;
    }

    public play(): Promise<void> {
        return this._media_element.play();
    }

    public pause(): void {
        this._media_element.pause();
    }

    public seek(seconds: number): void {
        if (this._media_element && this._seeking_handler) {
            this._seeking_handler.seek(seconds);
        } else {
            this._pending_seek_time = seconds;
        }
    }

    public get mediaInfo(): MediaInfo {
        return Object.assign({}, this._media_info);
    }

    public get statisticsInfo(): any {
        return Object.assign({}, this._statistics_info);
    }

    private _onMSESourceOpen(): void {
        this._mse_source_opened = true;
        if (this._has_pending_load) {
            this._has_pending_load = false;
            this.load();
        }
    }

    private _onMSEUpdateEnd(): void {
        if (this._config.isLive && this._config.liveBufferLatencyChasing && this._live_latency_chaser) {
            this._live_latency_chaser.notifyBufferedRangeUpdate();
        }

        this._loading_controller.notifyBufferedPositionChanged();
    }

    private _onMSEBufferFull(): void {
        Log.v(this.TAG, 'MSE SourceBuffer is full, suspend transmuxing task');
        this._loading_controller.suspendTransmuxer();
    }

    private _onMSEError(info: any): void {
        this._emitter.emit(PlayerEvents.ERROR, ErrorTypes.MEDIA_ERROR, ErrorDetails.MEDIA_MSE_ERROR, info);
    }

    private _onMSEStartStreaming(): void {
        if (!this._loaded_metadata_received) {
            // Ignore initial startstreaming event since we have started loading data
            return;
        }
        if (this._config.isLive) {
            // For live stream, we do not suspend / resume transmuxer
            return;
        }
        Log.v(this.TAG, 'Resume transmuxing task due to ManagedMediaSource onStartStreaming');
        this._loading_controller.resumeTransmuxer();
    }

    private _onMSEEndStreaming(): void {
        if (this._config.isLive) {
            // For live stream, we do not suspend / resume transmuxer
            return;
        }
        Log.v(this.TAG, 'Suspend transmuxing task due to ManagedMediaSource onEndStreaming');
        this._loading_controller.suspendTransmuxer();
    }

    private _onMediaLoadedMetadata(e: any): void {
        this._loaded_metadata_received = true;
        if (this._pending_seek_time != null) {
            this._seeking_handler.seek(this._pending_seek_time);
            this._pending_seek_time = null;
        }
    }

    private _onRequestDirectSeek(target: number): void {
        this._seeking_handler.directSeek(target);
    }

    private _onRequiredUnbufferedSeek(milliseconds: number): void {
        this._mse_controller.flush();
        this._transmuxer.seek(milliseconds);
    }

    private _onRequestPauseTransmuxer(): void {
        this._transmuxer.pause();
    }

    private _onRequestResumeTransmuxer(): void {
        this._transmuxer.resume();
    }

    private _fillStatisticsInfo(stat_info: any): any {
        stat_info.playerType = 'MSEPlayer';

        if (!(this._media_element instanceof HTMLVideoElement)) {
            return stat_info;
        }

        let has_quality_info = true;
        let decoded = 0;
        let dropped = 0;

        if (this._media_element.getVideoPlaybackQuality) {
            const quality = this._media_element.getVideoPlaybackQuality();
            decoded = quality.totalVideoFrames;
            dropped = quality.droppedVideoFrames;
        } else if (this._media_element['webkitDecodedFrameCount'] != undefined) {
            decoded = this._media_element['webkitDecodedFrameCount'];
            dropped = this._media_element['webkitDroppedFrameCount'];
        } else {
            has_quality_info = false;
        }

        if (has_quality_info) {
            stat_info.decodedFrames = decoded;
            stat_info.droppedFrames = dropped;
        }

        return stat_info;
    }

}

export default PlayerEngineMainThread;
