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

import Log from '../utils/logger';
import LoggingControl from '../utils/logging-control';
import { IllegalStateException } from '../utils/exception';
import MediaInfo from '../core/media-info';
import MSEEvents from '../core/mse-events';
import MSEController from '../core/mse-controller';
import Transmuxer from "../core/transmuxer";
import TransmuxingEvents from '../core/transmuxing-events';
import PlayerEvents from './player-events';
import { ErrorTypes } from './player-errors';
import {
    WorkerCommandPacket,
    WorkerCommandPacketInit,
    WorkerCommandPacketLoggingConfig,
    WorkerCommandPacketUnbufferedSeek,
    WorkerCommandPacketTimeUpdate,
    WorkerCommandPacketReadyStateChange,
} from './player-engine-worker-cmd-def.js';
import {
    WorkerMessagePacket,
    WorkerMessagePacketMSEInit,
    WorkerMessagePacketMSEEvent,
    WorkerMessagePacketPlayerEvent,
    WorkerMessagePacketPlayerEventError,
    WorkerMessagePacketPlayerEventExtraData,
    WorkerMessagePacketTransmuxingEventInfo,
    WorkerMessagePacketTransmuxingEventRecommendSeekpoint,
    WorkerMessagePacketBufferedPositionChanged,
    WorkerMessagePacketLogcatCallback,
} from './player-engine-worker-msg-def.js';

const PlayerEngineWorker = (self: DedicatedWorkerGlobalScope) => {
    const TAG: string = 'PlayerEngineWorker';

    const logcat_callback: (type: string, str: string) => void = onLogcatCallback.bind(this);

    let media_data_source: any = null;
    let config: any = null;

    let mse_controller: MSEController = null;
    let transmuxer: Transmuxer = null;

    let mse_source_opened: boolean = false;
    let has_pending_load: boolean = false;

    let media_element_current_time: number = 0;
    let media_element_ready_state: number = 0;

    let destroyed = false;

    self.addEventListener('message', (e: MessageEvent) => {
        if (destroyed) {
            return;
        }

        const command_packet = e.data as WorkerCommandPacket;
        const cmd = command_packet.cmd;

        switch (cmd) {
            case 'logging_config': {
                const packet = command_packet as WorkerCommandPacketLoggingConfig;
                LoggingControl.applyConfig(packet.logging_config);

                if (packet.logging_config.enableCallback === true) {
                    LoggingControl.addLogListener(logcat_callback);
                } else {
                    LoggingControl.removeLogListener(logcat_callback);
                }
                break;
            }
            case 'init': {
                const packet = command_packet as WorkerCommandPacketInit;
                media_data_source = packet.media_data_source;
                config = packet.config;
                break;
            }
            case 'destroy':
                destroy();
                break;
            case 'initialize_mse':
                initializeMSE();
                break;
            case 'shutdown_mse':
                shutdownMSE();
                break;
            case 'load':
                load();
                break;
            case 'unload':
                unload();
                break;
            case 'unbuffered_seek': {
                const packet = command_packet as WorkerCommandPacketUnbufferedSeek;
                mse_controller.flush();
                transmuxer.seek(packet.milliseconds);
                break;
            }
            case 'timeupdate': {
                const packet = command_packet as WorkerCommandPacketTimeUpdate;
                media_element_current_time = packet.current_time;
                break;
            }
            case 'readystatechange': {
                const packet = command_packet as WorkerCommandPacketReadyStateChange;
                media_element_ready_state = packet.ready_state;
                break;
            }
            case 'pause_transmuxer':
                transmuxer.pause();
                break;
            case 'resume_transmuxer':
                transmuxer.resume();
                break;
        }
    });

    function destroy(): void {
        if (transmuxer) {
            unload();
        }
        if (mse_controller) {
            shutdownMSE();
        }
        destroyed = true;

        self.postMessage({
            msg: 'destroyed',
        } as WorkerMessagePacket);
    }

    function initializeMSE(): void {
        Log.v(TAG, 'Initializing MediaSource in DedicatedWorker');
        mse_controller = new MSEController(config);
        mse_controller.on(MSEEvents.SOURCE_OPEN, onMSESourceOpen.bind(this));
        mse_controller.on(MSEEvents.UPDATE_END, onMSEUpdateEnd.bind(this));
        mse_controller.on(MSEEvents.BUFFER_FULL, onMSEBufferFull.bind(this));
        mse_controller.on(MSEEvents.ERROR, onMSEError.bind(this));
        mse_controller.initialize({
            getCurrentTime: () => media_element_current_time,
            getReadyState: () => media_element_ready_state,
        });

        let handle = mse_controller.getHandle();
        self.postMessage({
            msg: 'mse_init',
            handle: handle,
        } as WorkerMessagePacketMSEInit, [handle]);
    }

    function shutdownMSE(): void {
        if (mse_controller) {
            mse_controller.shutdown();
            mse_controller.destroy();
            mse_controller = null;
        }
    }

    function load(): void {
        if (media_data_source == null || config == null) {
            throw new IllegalStateException('Worker not initialized');
        }
        if (transmuxer) {
            throw new IllegalStateException('Transmuxer has been initialized');
        }
        if (has_pending_load) {
            return;
        }
        if (config.deferLoadAfterSourceOpen && !mse_source_opened) {
            has_pending_load = true;
            return;
        }

        transmuxer = new Transmuxer(media_data_source, config);

        transmuxer.on(TransmuxingEvents.INIT_SEGMENT, (type: string, is: any) => {
            mse_controller.appendInitSegment(is);
        });
        transmuxer.on(TransmuxingEvents.MEDIA_SEGMENT, (type: string, ms: any) => {
            mse_controller.appendMediaSegment(ms);
            self.postMessage({
                msg: 'buffered_position_changed',
                buffered_position_milliseconds: ms.info.endDts,
            } as WorkerMessagePacketBufferedPositionChanged);
        });
        transmuxer.on(TransmuxingEvents.LOADING_COMPLETE, () => {
            mse_controller.endOfStream();
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.LOADING_COMPLETE,
            } as WorkerMessagePacketPlayerEvent);
        });
        transmuxer.on(TransmuxingEvents.RECOVERED_EARLY_EOF, () => {
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.RECOVERED_EARLY_EOF,
            } as WorkerMessagePacketPlayerEvent);
        });
        transmuxer.on(TransmuxingEvents.IO_ERROR, (detail: any, info: any) => {
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.ERROR,
                error_type: ErrorTypes.NETWORK_ERROR,
                error_detail: detail,
                info: info,
            } as WorkerMessagePacketPlayerEventError);
        });
        transmuxer.on(TransmuxingEvents.DEMUX_ERROR, (detail: any, info: any) => {
            self.postMessage({
                msg: 'player_event',
                event: PlayerEvents.ERROR,
                error_type: ErrorTypes.MEDIA_ERROR,
                error_detail: detail,
                info: info,
            } as WorkerMessagePacketPlayerEventError);
        });

        transmuxer.on(TransmuxingEvents.MEDIA_INFO, (mediaInfo: MediaInfo) => {
            emitTransmuxingEventsInfo(TransmuxingEvents.MEDIA_INFO, mediaInfo);
        });
        transmuxer.on(TransmuxingEvents.STATISTICS_INFO, (statInfo: any) => {
            emitTransmuxingEventsInfo(TransmuxingEvents.STATISTICS_INFO, statInfo);
        });

        transmuxer.on(TransmuxingEvents.RECOMMEND_SEEKPOINT, (milliseconds: number) => {
            emitTransmuxingEventsRecommendSeekpoint(milliseconds);
        });

        transmuxer.on(TransmuxingEvents.METADATA_ARRIVED, (metadata: any) => {
            emitPlayerEventsExtraData(PlayerEvents.METADATA_ARRIVED, metadata);
        });
        transmuxer.on(TransmuxingEvents.SCRIPTDATA_ARRIVED, (data: any) => {
            emitPlayerEventsExtraData(PlayerEvents.SCRIPTDATA_ARRIVED, data);
        });
        transmuxer.on(TransmuxingEvents.TIMED_ID3_METADATA_ARRIVED, (timed_id3_metadata: any) => {
            emitPlayerEventsExtraData(PlayerEvents.TIMED_ID3_METADATA_ARRIVED, timed_id3_metadata);
        });
        transmuxer.on(TransmuxingEvents.PGS_SUBTITLE_ARRIVED, (pgs_data: any) => {
            emitPlayerEventsExtraData(PlayerEvents.PGS_SUBTITLE_ARRIVED, pgs_data);
        });
        transmuxer.on(TransmuxingEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, (synchronous_klv_metadata: any) => {
            emitPlayerEventsExtraData(PlayerEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, synchronous_klv_metadata);
        });
        transmuxer.on(TransmuxingEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, (asynchronous_klv_metadata: any) => {
            emitPlayerEventsExtraData(PlayerEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, asynchronous_klv_metadata);
        });
        transmuxer.on(TransmuxingEvents.SMPTE2038_METADATA_ARRIVED, (smpte2038_metadata: any) => {
            emitPlayerEventsExtraData(PlayerEvents.SMPTE2038_METADATA_ARRIVED, smpte2038_metadata);
        });
        transmuxer.on(TransmuxingEvents.SCTE35_METADATA_ARRIVED, (scte35_metadata: any) => {
            emitPlayerEventsExtraData(PlayerEvents.SCTE35_METADATA_ARRIVED, scte35_metadata);
        });
        transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_DESCRIPTOR, (descriptor: any) => {
            emitPlayerEventsExtraData(PlayerEvents.PES_PRIVATE_DATA_DESCRIPTOR, descriptor);
        });
        transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_ARRIVED, (private_data: any) => {
            emitPlayerEventsExtraData(PlayerEvents.PES_PRIVATE_DATA_ARRIVED, private_data);
        });

        transmuxer.open();
    }

    function unload(): void {
        if (mse_controller) {
            mse_controller.flush();
        }
        if (transmuxer) {
            transmuxer.close();
            transmuxer.destroy();
            transmuxer = null;
        }
    }

    function onMSESourceOpen(): void {
        mse_source_opened = true;
        if (has_pending_load) {
            has_pending_load = false;
            load();
        }
    }

    function onMSEUpdateEnd(): void {
        self.postMessage({
            msg: 'mse_event',
            event: MSEEvents.UPDATE_END,
        } as WorkerMessagePacketMSEEvent);
    }

    function onMSEBufferFull(): void {
        Log.v(TAG, 'MSE SourceBuffer is full, report to main thread');
        self.postMessage({
            msg: 'mse_event',
            event: MSEEvents.BUFFER_FULL,
        } as WorkerMessagePacketMSEEvent);
    }

    function onMSEError(info: any): void {
        self.postMessage({
            msg: 'player_event',
            event: PlayerEvents.ERROR,
            error_type: ErrorTypes.MEDIA_ERROR,
            error_detail: ErrorTypes.MEDIA_MSE_ERROR,
            info: info,
        } as WorkerMessagePacketPlayerEventError);
    }

    function emitTransmuxingEventsRecommendSeekpoint(milliseconds: number) {
        self.postMessage({
            msg: 'transmuxing_event',
            event: TransmuxingEvents.RECOMMEND_SEEKPOINT,
            milliseconds: milliseconds,
        } as WorkerMessagePacketTransmuxingEventRecommendSeekpoint);
    }

    function emitTransmuxingEventsInfo(event: TransmuxingEvents, info: any) {
        self.postMessage({
            msg: 'transmuxing_event',
            event: event,
            info: info,
        } as WorkerMessagePacketTransmuxingEventInfo);
    }

    function emitPlayerEventsExtraData(event: PlayerEvents, extraData: any) {
        self.postMessage({
            msg: 'player_event',
            event: event,
            extraData: extraData,
        } as WorkerMessagePacketPlayerEventExtraData);
    }

    function onLogcatCallback(type: string, str: string): void {
        self.postMessage({
            msg: 'logcat_callback',
            type: type,
            logcat: str,
        } as WorkerMessagePacketLogcatCallback);
    }

};

export default PlayerEngineWorker;
