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
import * as work from 'webworkify-webpack';
import type PlayerEngine from './player-engine';
import Log from '../utils/logger';
import LoggingControl from '../utils/logging-control.js';
import { createDefaultConfig } from '../config';
import MediaInfo from '../core/media-info';
import MSEEvents from '../core/mse-events';
import PlayerEvents from './player-events';
import TransmuxingEvents from '../core/transmuxing-events';
import SeekingHandler from './seeking-handler';
import LoadingController from './loading-controller';
import StartupStallJumper from './startup-stall-jumper';
import LiveLatencyChaser from './live-latency-chaser';
import LiveLatencySynchronizer from './live-latency-synchronizer';
import {
    WorkerCommandPacket,
    WorkerCommandPacketInit,
    WorkerCommandPacketLoggingConfig,
    WorkerCommandPacketTimeUpdate,
    WorkerCommandPacketReadyStateChange,
    WorkerCommandPacketUnbufferedSeek
} from './player-engine-worker-cmd-def.js';
import {
    WorkerMessagePacket,
    WorkerMessagePacketBufferedPositionChanged,
    WorkerMessagePacketLogcatCallback,
    WorkerMessagePacketMSEEvent,
    WorkerMessagePacketMSEInit,
    WorkerMessagePacketPlayerEvent,
    WorkerMessagePacketPlayerEventError,
    WorkerMessagePacketPlayerEventExtraData,
    WorkerMessagePacketTransmuxingEvent,
    WorkerMessagePacketTransmuxingEventInfo,
    WorkerMessagePacketTransmuxingEventRecommendSeekpoint,
} from './player-engine-worker-msg-def.js';

class PlayerEngineDedicatedThread implements PlayerEngine {

    private readonly TAG: string = 'PlayerEngineDedicatedThread';

    private _emitter: EventEmitter = new EventEmitter();
    private _media_data_source: any;
    private _config: any;

    private _media_element?: HTMLMediaElement = null;

    private _worker: Worker;
    private _worker_destroying: boolean = false;

    private _seeking_handler?: SeekingHandler = null;
    private _loading_controller?: LoadingController = null;
    private _startup_stall_jumper?: StartupStallJumper = null;
    private _live_latency_chaser?: LiveLatencyChaser = null;
    private _live_latency_synchronizer?: LiveLatencySynchronizer = null;

    private _pending_seek_time?: number = null;

    private _media_info?: MediaInfo = null;
    private _statistics_info?: any = null;

    private e?: any = null;

    public static isSupported(): boolean {
        if (!self.Worker) {
            return false;
        }
        if (self.MediaSource &&
            ('canConstructInDedicatedWorker' in self.MediaSource) &&
            (self.MediaSource['canConstructInDedicatedWorker'] === true)) {
            return true;
        }
        if ((self as any).ManagedMediaSource &&
            ('canConstructInDedicatedWorker' in (self as any).ManagedMediaSource) &&
            ((self as any).ManagedMediaSource['canConstructInDedicatedWorker'] === true)) {
            return true;
        }
        return false;
    }

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
            onLoggingConfigChanged: this._onLoggingConfigChanged.bind(this),
            onMediaLoadedMetadata: this._onMediaLoadedMetadata.bind(this),
            onMediaTimeUpdate: this._onMediaTimeUpdate.bind(this),
            onMediaReadyStateChanged: this._onMediaReadyStateChange.bind(this),
        };

        LoggingControl.registerListener(this.e.onLoggingConfigChanged);

        this._worker = work(require.resolve('./player-engine-worker'), {all: true}) as Worker;
        this._worker.addEventListener('message', this._onWorkerMessage.bind(this));

        this._worker.postMessage({
            cmd: 'init',
            media_data_source: this._media_data_source,
            config: this._config
        } as WorkerCommandPacketInit);

        this._worker.postMessage({
            cmd: 'logging_config',
            logging_config: LoggingControl.getConfig()
        } as WorkerCommandPacketLoggingConfig);
    }

    public destroy(): void {
        this._emitter.emit(PlayerEvents.DESTROYING);
        this.unload();
        this.detachMediaElement();

        this._worker_destroying = true;
        this._worker.postMessage({
            cmd: 'destroy'
        } as WorkerCommandPacket);

        LoggingControl.removeListener(this.e.onLoggingConfigChanged);
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
        this._media_element.src = '';
        this._media_element.removeAttribute('src');
        this._media_element.srcObject = null;
        this._media_element.load();

        this._media_element.addEventListener('loadedmetadata', this.e.onMediaLoadedMetadata);
        this._media_element.addEventListener('timeupdate', this.e.onMediaTimeUpdate);
        this._media_element.addEventListener('readystatechange', this.e.onMediaReadyStateChanged);

        this._worker.postMessage({
            cmd: 'initialize_mse',
        })

        // Then wait for 'mse_init' message from worker to receive MediaSource handle
    }

    public detachMediaElement(): void {
        this._worker.postMessage({
            cmd: 'shutdown_mse',
        });

        if (this._media_element) {
            // Remove all appended event listeners
            this._media_element.removeEventListener('loadedmetadata', this.e.onMediaLoadedMetadata);
            this._media_element.removeEventListener('timeupdate', this.e.onMediaTimeUpdate);
            this._media_element.removeEventListener('readystatechange', this.e.onMediaReadyStateChanged);

            // Detach media source from media element
            this._media_element.src = '';
            this._media_element.removeAttribute('src');
            this._media_element.srcObject = null;
            this._media_element.load();
            this._media_element = null;
        }
    }

    public load(): void {
        this._worker.postMessage({
            cmd: 'load',
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
    }

    public unload(): void {
        this._media_element?.pause();

        this._worker.postMessage({
            cmd: 'unload',
        } as WorkerCommandPacket);

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

    public _onLoggingConfigChanged(config: any): void {
        this._worker?.postMessage({
            cmd: 'logging_config',
            logging_config: config,
        } as WorkerCommandPacketLoggingConfig);
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

    private _onMediaLoadedMetadata(e: any): void {
        if (this._pending_seek_time != null) {
            this._seeking_handler.seek(this._pending_seek_time);
            this._pending_seek_time = null;
        }
    }

    private _onRequestDirectSeek(target: number): void {
        this._seeking_handler.directSeek(target);
    }

    private _onRequiredUnbufferedSeek(milliseconds: number): void {
        this._worker.postMessage({
            cmd: 'unbuffered_seek',
            milliseconds: milliseconds
        } as WorkerCommandPacketUnbufferedSeek);
    }

    private _onRequestPauseTransmuxer(): void {
        this._worker.postMessage({
            cmd: 'pause_transmuxer'
        } as WorkerCommandPacket);
    }

    private _onRequestResumeTransmuxer(): void {
        this._worker.postMessage({
            cmd: 'resume_transmuxer'
        } as WorkerCommandPacket);
    }

    private _onMediaTimeUpdate(e: any): void {
        this._worker.postMessage({
            cmd: 'timeupdate',
            current_time: e.target.currentTime,
        } as WorkerCommandPacketTimeUpdate);
    }

    private _onMediaReadyStateChange(e: any): void {
        this._worker.postMessage({
            cmd: 'readystatechange',
            ready_state: e.target.readyState,
        } as WorkerCommandPacketReadyStateChange);
    }

    private _onWorkerMessage(e: MessageEvent): void {
        const message_packet = e.data as WorkerMessagePacket;
        const msg = message_packet.msg;

        if (msg == 'destroyed' || this._worker_destroying) {
            this._worker_destroying = false;
            this._worker?.terminate();
            this._worker = null;
            return;
        }

        switch (msg) {
            case 'mse_init': {
                const packet = message_packet as WorkerMessagePacketMSEInit;
                // Use ManagedMediaSource only if w3c MediaSource is not available (e.g. iOS Safari)
                const use_managed_media_source = ('ManagedMediaSource' in self) && !('MediaSource' in self);
                if (use_managed_media_source) {
                    // When using ManagedMediaSource, MediaSource will not open unless disableRemotePlayback is set to true
                    this._media_element['disableRemotePlayback'] = true;
                }
                // Attach to HTMLMediaElement by using MediaSource Handle
                this._media_element.srcObject = packet.handle;
                break;
            }
            case 'mse_event': {
                const packet = message_packet as WorkerMessagePacketMSEEvent;
                if (packet.event == MSEEvents.UPDATE_END) {
                    this._onMSEUpdateEnd();
                } else if (packet.event == MSEEvents.BUFFER_FULL) {
                    this._onMSEBufferFull();
                }
                break;
            }
            case 'transmuxing_event': {
                const packet = message_packet as WorkerMessagePacketTransmuxingEvent;
                if (packet.event == TransmuxingEvents.MEDIA_INFO) {
                    const packet = message_packet as WorkerMessagePacketTransmuxingEventInfo;
                    this._media_info = packet.info;
                    this._emitter.emit(PlayerEvents.MEDIA_INFO, Object.assign({}, packet.info));
                } else if (packet.event == TransmuxingEvents.STATISTICS_INFO) {
                    const packet = message_packet as WorkerMessagePacketTransmuxingEventInfo;
                    this._statistics_info = this._fillStatisticsInfo(packet.info);
                    this._emitter.emit(PlayerEvents.STATISTICS_INFO, Object.assign({}, packet.info));
                } else if (packet.event == TransmuxingEvents.RECOMMEND_SEEKPOINT) {
                    const packet = message_packet as WorkerMessagePacketTransmuxingEventRecommendSeekpoint;
                    if (this._media_element && !this._config.accurateSeek) {
                        this._seeking_handler.directSeek(packet.milliseconds / 1000);
                    }
                }
                break;
            }
            case 'player_event': {
                const packet = message_packet as WorkerMessagePacketPlayerEvent;
                if (packet.event == PlayerEvents.ERROR) {
                    const packet = message_packet as WorkerMessagePacketPlayerEventError;
                    this._emitter.emit(PlayerEvents.ERROR, packet.error_type, packet.error_detail, packet.info);
                } else if ('extraData' in packet) {
                    const packet = message_packet as WorkerMessagePacketPlayerEventExtraData;
                    this._emitter.emit(packet.event, packet.extraData);
                }
                break;
            }
            case 'logcat_callback': {
                const packet = message_packet as WorkerMessagePacketLogcatCallback;
                Log.emitter.emit('log', packet.type, packet.logcat);
                break;
            }
            case 'buffered_position_changed': {
                const packet = message_packet as WorkerMessagePacketBufferedPositionChanged;
                this._loading_controller.notifyBufferedPositionChanged(packet.buffered_position_milliseconds / 1000);
                break;
            }
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

}

export default PlayerEngineDedicatedThread;
