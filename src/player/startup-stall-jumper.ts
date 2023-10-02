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

class StartupStallJumper {

    private readonly TAG: string = 'StartupStallJumper';

    private _media_element: HTMLMediaElement = null;
    private _on_direct_seek: (target: number) => void = null;
    private _canplay_received: boolean = false;

    private e: any = null;

    public constructor(media_element: HTMLMediaElement, on_direct_seek: (target: number) => void) {
        this._media_element = media_element;
        this._on_direct_seek = on_direct_seek;

        this.e = {
            onMediaCanPlay: this._onMediaCanPlay.bind(this),
            onMediaStalled: this._onMediaStalled.bind(this),
            onMediaProgress: this._onMediaProgress.bind(this),
        };

        this._media_element.addEventListener('canplay', this.e.onMediaCanPlay);
        this._media_element.addEventListener('stalled', this.e.onMediaStalled);
        this._media_element.addEventListener('progress', this.e.onMediaProgress);
    }

    public destroy(): void {
        this._media_element.removeEventListener('canplay', this.e.onMediaCanPlay);
        this._media_element.removeEventListener('stalled', this.e.onMediaStalled);
        this._media_element.removeEventListener('progress', this.e.onMediaProgress);
        this._media_element = null;
        this._on_direct_seek = null;
    }

    private _onMediaCanPlay(e: Event): void {
        this._canplay_received = true;
        // Remove canplay listener since it will be fired multiple times
        this._media_element.removeEventListener('canplay', this.e.onMediaCanPlay);
    }

    private _onMediaStalled(e: Event): void {
        this._detectAndFixStuckPlayback(true);
    }

    private _onMediaProgress(e: Event): void {
        this._detectAndFixStuckPlayback();
    }

    private _detectAndFixStuckPlayback(is_stalled?: boolean): void {
        const media = this._media_element;
        const buffered = media.buffered;

        if (is_stalled || !this._canplay_received || media.readyState < 2) {  // HAVE_CURRENT_DATA
            if (buffered.length > 0 && media.currentTime < buffered.start(0)) {
                Log.w(this.TAG, `Playback seems stuck at ${media.currentTime}, seek to ${buffered.start(0)}`);
                this._on_direct_seek(buffered.start(0));
                this._media_element.removeEventListener('progress', this.e.onMediaProgress);
            }
        } else {
            // Playback doesn't stuck, remove progress event listener
            this._media_element.removeEventListener('progress', this.e.onMediaProgress);
        }
    }

}

export default StartupStallJumper;
