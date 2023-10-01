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
import Browser from '../utils/browser';
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

    private _resume_transmuxer_checker_id?: number = null;

    private _mse_source_opened: boolean = false;
    private _has_pending_load: boolean = false;
    private _canplay_received: boolean = false;

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
            onMediaCanPlay: this._onMediaCanPlay.bind(this),
            onMediaStalled: this._onMediaStalled.bind(this),
            onMediaProgress: this._onMediaProgress.bind(this),
            onMediaTimeUpdate: this._onMediaTimeUpdate.bind(this),
        };
    }

    public destroy(): void {
        this._emitter.emit(PlayerEvents.DESTROYING);
        if (this._resume_transmuxer_checker_id != null) {
            window.clearInterval(this._resume_transmuxer_checker_id);
            this._resume_transmuxer_checker_id = null;
        }
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
        mediaElement.addEventListener('canplay', this.e.onMediaCanPlay);
        mediaElement.addEventListener('stalled', this.e.onMediaStalled);
        mediaElement.addEventListener('progress', this.e.onMediaProgress);
        mediaElement.addEventListener('timeupdate', this.e.onMediaTimeUpdate);

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
            this._media_element.removeEventListener('canplay', this.e.onMediaCanPlay);
            this._media_element.removeEventListener('stalled', this.e.onMediaStalled);
            this._media_element.removeEventListener('progress', this.e.onMediaProgress);
            this._media_element.removeEventListener('timeupdate', this.e.onMediaTimeUpdate);

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
            if (type === 'video' && ms.data && ms.data.byteLength > 0 && ('info' in ms)) {
                this._seeking_handler.appendSyncPoints(ms.info.syncPoints);
            }
            // Lazyload check
            if (this._config.lazyLoad && !this._config.isLive) {
                const current_time = this._media_element.currentTime;
                if (ms.info.endDts >= (current_time + this._config.lazyLoadMaxDuration) * 1000) {
                    if (this._resume_transmuxer_checker_id == null) {
                        Log.v(this.TAG, 'Maximum buffering duration exceeded, suspend transmuxing task');
                        this._suspendTransmuxer();
                    }
                }
            }
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
            this._transmuxer,
            this._onRequestFlushMSE.bind(this)
        );

        // Reset currentTime to 0
        if (this._media_element.readyState > 0) {
            // IE11 may throw InvalidStateError if readyState === 0
            this._seeking_handler.directSeek(0);
        }

        this._transmuxer.open();
    }

    public unload(): void {
        this._media_element?.pause();

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
        if (this._config.isLive && this._config.liveBufferLatencyChasing) {
            this._chaseLiveLatency();
        }

        if (!this._config.isLive && this._config.lazyLoad) {
            this._suspendTransmuxerIfNeeded();
        }
    }

    private _onMSEBufferFull(): void {
        Log.v(this.TAG, 'MSE SourceBuffer is full, suspend transmuxing task');
        if (this._resume_transmuxer_checker_id == null) {
            this._suspendTransmuxer();
        }
    }

    private _onMSEError(info: any): void {
        this._emitter.emit(PlayerEvents.ERROR, ErrorTypes.MEDIA_ERROR, ErrorDetails.MEDIA_MSE_ERROR, info);
    }

    private _onMSEStartStreaming(): void {
        if (!this._canplay_received) {
            // Ignore initial startstreaming event since we have started loading data
            return;
        }
        if (this._config.isLive) {
            // For live stream, we do not suspend / resume transmuxer
            return;
        }
        Log.v(this.TAG, 'Resume transmuxing task due to ManagedMediaSource onStartStreaming');
        if (this._transmuxer) {
            // TODO: Add a function into transmuxer for checking whether it's paused
            this._transmuxer.resume();
        }
        // TODO: Remove this dirty code
        if (this._resume_transmuxer_checker_id != null) {
            window.clearInterval(this._resume_transmuxer_checker_id);
            this._resume_transmuxer_checker_id = null;
        }
    }

    private _onMSEEndStreaming(): void {
        if (this._config.isLive) {
            // For live stream, we do not suspend / resume transmuxer
            return;
        }
        Log.v(this.TAG, 'Suspend transmuxing task due to ManagedMediaSource onEndStreaming');
        if (this._transmuxer) {
            // TODO: Add a function into transmuxer for checking whether it's paused
            this._transmuxer.pause();
        }
        // TODO: Remove this dirty code
        if (this._resume_transmuxer_checker_id != null) {
            window.clearInterval(this._resume_transmuxer_checker_id);
            this._resume_transmuxer_checker_id = null;
        }
    }

    private _onMediaLoadedMetadata(e: any): void {
        if (this._pending_seek_time != null) {
            this._seeking_handler.seek(this._pending_seek_time);
            this._pending_seek_time = null;
        }
    }

    private _onMediaCanPlay(e: any): void {
        this._canplay_received = true;
        // TODO: Remove canplay listener since it will be fired multiple times?
    }

    private _onMediaStalled(e: any): void {
        this._detectAndFixStuckPlayback(true);
    }

    private _onMediaProgress(e: any): void {
        this._detectAndFixStuckPlayback();
    }

    private _onMediaTimeUpdate(e: any): void {
        if (this._config.isLive && this._config.liveSync) {
            this._syncLiveLatency();
        }
    }

    private _onRequestFlushMSE(): void {
        this._mse_controller.flush();
    }

    private _isPositionBuffered(seconds: number): boolean {
        const buffered = this._media_element.buffered;

        for (let i = 0; i < buffered.length; i++) {
            const from = buffered.start(i);
            const to = buffered.end(i);
            if (seconds >= from && seconds < to) {
                return true;
            }
        }

        return false;
    }

    private _detectAndFixStuckPlayback(is_stalled?: boolean): void {
        const media = this._media_element;
        const buffered = media.buffered;

        if (is_stalled || !this._canplay_received || media.readyState < 2) {
            if (buffered.length > 0 && media.currentTime < buffered.start(0)) {
                Log.w(this.TAG,
                    `Playback seems stuck at ${media.currentTime}, seek to ${buffered.start(0)}`);
                this._seeking_handler.directSeek(buffered.start(0));
                this._media_element.removeEventListener('progress', this.e.onMediaProgress);
            }
        } else {
            this._media_element.removeEventListener('progress', this.e.onMediaProgress);
        }
    }

    private _syncLiveLatency(): void {
        if (!this._config.isLive || !this._config.liveSync) {
            return;
        }

        const latency = this._getCurrentLatency();

        if (latency > this._config.liveSyncMaxLatency) {
            const playbackRate = Math.min(2, Math.max(1, this._config.liveSyncPlaybackRate));
            this._media_element.playbackRate = playbackRate;
        } else if (latency > this._config.liveSyncTargetLatency) {
            // do nothing, keep playbackRate
        } else if (this._media_element.playbackRate !== 1 && this._media_element.playbackRate !== 0) {
            this._media_element.playbackRate = 1;
        }
    }

    private _chaseLiveLatency(): void {
        const buffered: TimeRanges = this._media_element.buffered;
        const current_time: number = this._media_element.currentTime;

        if (!this._config.isLive ||
            !this._config.liveBufferLatencyChasing ||
            buffered.length == 0 ||
            this._media_element.paused) {
            return;
        }

        const buffered_end = buffered.end(buffered.length - 1);
        if (buffered_end > this._config.liveBufferLatencyMaxLatency) {
            if (buffered_end - current_time > this._config.liveBufferLatencyMaxLatency) {
                let target_time = buffered_end - this._config.liveBufferLatencyMinRemain;
                this._seeking_handler.directSeek(target_time);
            }
        }
    }

    private _suspendTransmuxerIfNeeded(): void {
        if (!this._config.lazyLoad || this._config.isLive) {
            return;
        }

        const buffered: TimeRanges = this._media_element.buffered;
        const current_time: number = this._media_element.currentTime;
        let current_range_end = 0;

        for (let i = 0; i < buffered.length; i++) {
            const start = buffered.start(i);
            const end = buffered.end(i);
            if (start <= current_time && current_time < end) {
                current_range_end = end;
                break;
            }
        }

        if (current_range_end >= current_time + this._config.lazyLoadMaxDuration &&
            this._resume_transmuxer_checker_id == null) {
            Log.v(this.TAG, 'Maximum buffering duration exceeded, suspend transmuxing task');
            this._suspendTransmuxer();
        }
    }

    private _suspendTransmuxer(): void {
        if (this._transmuxer) {
            this._transmuxer.pause();

            if (this._resume_transmuxer_checker_id == null) {
                this._resume_transmuxer_checker_id = window.setInterval(
                    this._resumeTransmuxerIfNeeded.bind(this),
                    1000
                );
            }
        }
    }

    private _resumeTransmuxerIfNeeded(): void {
        const buffered: TimeRanges = this._media_element.buffered;
        const current_time: number = this._media_element.currentTime;

        let should_resume = false;

        for (let i = 0; i < buffered.length; i++) {
            const from = buffered.start(i);
            const to = buffered.end(i);
            if (current_time >= from && current_time < to) {
                if (current_time >= to - this._config.lazyLoadRecoverDuration) {
                    should_resume = true;
                }
                break;
            }
        }

        if (should_resume) {
            window.clearInterval(this._resume_transmuxer_checker_id);
            this._resume_transmuxer_checker_id = null;
            Log.v(this.TAG,  'Continue loading from paused position');
            this._transmuxer.resume();
        }
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

    private _getCurrentLatency(): number {
        if (!this._media_element) {
            return 0;
        }

        const buffered = this._media_element.buffered;
        const current_time = this._media_element.currentTime;

        if (buffered.length == 0) {
            return 0;
        }

        const buffered_end = buffered.end(buffered.length - 1);
        return buffered_end - current_time;
    }


}

export default PlayerEngineMainThread;
