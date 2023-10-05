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

// Live buffer latency synchronizer by increasing HTMLMediaElement.playbackRate
class LiveLatencySynchronizer {

    private _config: any = null;
    private _media_element: HTMLMediaElement = null;

    private e?: any = null;

    public constructor(config: any, media_element: HTMLMediaElement) {
        this._config = config;
        this._media_element = media_element;

        this.e = {
            onMediaTimeUpdate: this._onMediaTimeUpdate.bind(this),
        };

        this._media_element.addEventListener('timeupdate', this.e.onMediaTimeUpdate);
    }

    public destroy(): void {
        this._media_element.removeEventListener('timeupdate', this.e.onMediaTimeUpdate);
        this._media_element = null;
        this._config = null;
    }

    private _onMediaTimeUpdate(e: Event): void {
        if (!this._config.isLive || !this._config.liveSync) {
            return;
        }

        const latency = this._getCurrentLatency();

        if (latency > this._config.liveSyncMaxLatency) {
            const playback_rate = Math.min(2, Math.max(1, this._config.liveSyncPlaybackRate));
            this._media_element.playbackRate = playback_rate;
        } else if (latency > this._config.liveSyncTargetLatency) {
            // do nothing, keep playbackRate
        } else if (this._media_element.playbackRate !== 1 && this._media_element.playbackRate !== 0) {
            this._media_element.playbackRate = 1;
        }
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

export default LiveLatencySynchronizer;
