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

import MSEEvents from '../core/mse-events';
import PlayerEvents from './player-events';
import TransmuxingEvents from '../core/transmuxing-events';

export type WorkerMessageType =
    | 'destroyed'
    | 'mse_init'
    | 'mse_event'
    | 'player_event'
    | 'transmuxing_event'
    | 'buffered_position_changed'
    | 'logcat_callback';

export type WorkerMessagePacket = {
    msg: WorkerMessageType,
};

export type WorkerMessagePacketMSEInit = WorkerMessagePacket & {
    msg: 'mse_init',
    handle: any,
};

export type WorkerMessagePacketMSEEvent = WorkerMessagePacket & {
    msg: 'mse_event',
    event: MSEEvents,
};

export type WorkerMessagePacketPlayerEvent = WorkerMessagePacket & {
    msg: 'player_event',
    event: PlayerEvents,
};

export type WorkerMessagePacketPlayerEventError = WorkerMessagePacketPlayerEvent & {
    msg: 'player_event',
    event: PlayerEvents.ERROR,
    error_type: string,
    error_detail: string,
    info: any,
};

export type WorkerMessagePacketPlayerEventExtraData = WorkerMessagePacketPlayerEvent & {
    msg: 'player_event',
    event:
        | PlayerEvents.METADATA_ARRIVED
        | PlayerEvents.SCRIPTDATA_ARRIVED
        | PlayerEvents.TIMED_ID3_METADATA_ARRIVED
        | PlayerEvents.PGS_SUBTITLE_ARRIVED
        | PlayerEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED
        | PlayerEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED
        | PlayerEvents.SMPTE2038_METADATA_ARRIVED
        | PlayerEvents.SCTE35_METADATA_ARRIVED
        | PlayerEvents.PES_PRIVATE_DATA_DESCRIPTOR
        | PlayerEvents.PES_PRIVATE_DATA_ARRIVED,
    extraData: any,
};

export type WorkerMessagePacketTransmuxingEvent = WorkerMessagePacket & {
    msg: 'transmuxing_event',
    event: TransmuxingEvents,
};

export type WorkerMessagePacketTransmuxingEventInfo = WorkerMessagePacketTransmuxingEvent & {
    msg: 'transmuxing_event',
    event: TransmuxingEvents.MEDIA_INFO | TransmuxingEvents.STATISTICS_INFO,
    info: any,
};

export type WorkerMessagePacketTransmuxingEventRecommendSeekpoint = WorkerMessagePacketTransmuxingEvent & {
    msg: 'transmuxing_event',
    event: TransmuxingEvents.RECOMMEND_SEEKPOINT,
    milliseconds: number,
};

export type WorkerMessagePacketBufferedPositionChanged = WorkerMessagePacket & {
    msg: 'buffered_position_changed',
    buffered_position_milliseconds: number,
};

export type WorkerMessagePacketLogcatCallback = WorkerMessagePacket & {
    msg: 'logcat_callback',
    type: string,
    logcat: string,
};
