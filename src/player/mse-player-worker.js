/*
 * Copyright (C) 2023 もにょてっく. All Rights Reserved.
 *
 * @author もにょ〜ん <monyone.teihen@gmail.com>
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
import {IllegalStateException} from '../utils/exception.js';

import Polyfill from '../utils/polyfill.js';
import LoggingControl from '../utils/logging-control.js';
import PlayerEvents from './player-events.js'
import { ErrorTypes } from './player-errors.js';
import MSEEvents from '../core/mse-events.js';
import MSEController from '../core/mse-controller.js';
import Transmuxer from '../core/transmuxer.js';
import TransmuxingEvents from '../core/transmuxing-events.js';

class MSEControllerForWorker extends MSEController {
    constructor(config) {
        super(config);
        this.currentTime = 0;
        this.readyState = 0;
    }

    attachMediaElement() {
        if (this._mediaSource) {
            throw new IllegalStateException('MediaSource has been attached to an HTMLMediaElement!');
        }
        let ms = this._mediaSource = new self.MediaSource();
        ms.addEventListener('sourceopen', this.e.onSourceOpen);
        ms.addEventListener('sourceended', this.e.onSourceEnded);
        ms.addEventListener('sourceclose', this.e.onSourceClose);

        this._mediaSourceObjectURL = null
        return this._mediaSource.handle;
    }

    _needCleanupSourceBuffer() {
        if (!this._config.autoCleanupSourceBuffer) {
            return false;
        }

        for (let type in this._sourceBuffers) {
            let sb = this._sourceBuffers[type];
            if (sb) {
                let buffered = sb.buffered;
                if (buffered.length >= 1) {
                    if (this.currentTime - buffered.start(0) >= this._config.autoCleanupMaxBackwardDuration) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    _doCleanupSourceBuffer() {
        for (let type in this._sourceBuffers) {
            let sb = this._sourceBuffers[type];
            if (sb) {
                let buffered = sb.buffered;
                let doRemove = false;

                for (let i = 0; i < buffered.length; i++) {
                    let start = buffered.start(i);
                    let end = buffered.end(i);

                    if (start <= this.currentTime && this.currentTime < end + 3) {  // padding 3 seconds
                        if (this.currentTime - start >= this._config.autoCleanupMaxBackwardDuration) {
                            doRemove = true;
                            let removeEnd = this.currentTime - this._config.autoCleanupMinBackwardDuration;
                            this._pendingRemoveRanges[type].push({start: start, end: removeEnd});
                        }
                    } else if (end < this.currentTime) {
                        doRemove = true;
                        this._pendingRemoveRanges[type].push({start: start, end: end});
                    }
                }

                if (doRemove && !sb.updating) {
                    this._doRemoveRanges();
                }
            }
        }
    }

    _updateMediaSourceDuration() {
        let sb = this._sourceBuffers;
        if (this.readyState === HTMLMediaElement.HAVE_NOTHING || this._mediaSource.readyState !== 'open') {
            return;
        }
        if ((sb.video && sb.video.updating) || (sb.audio && sb.audio.updating)) {
            return;
        }

        let current = this._mediaSource.duration;
        let target = this._pendingMediaDuration;

        if (target > 0 && (isNaN(current) || target > current)) {
            Log.v(this.TAG, `Update MediaSource duration from ${current} to ${target}`);
            this._mediaSource.duration = target;
        }

        this._requireSetMediaDuration = false;
        this._pendingMediaDuration = 0;
    }
}

// Media Source Extensions controller
let MSEWorker = function (self) {
    let _msectl = null;
    let _transmuxer = null;
    let currentTime = 0;
    let logcatListener = onLogcatCallback.bind(this);

    Polyfill.install();
    self.addEventListener('message', function (e) {
        switch (e.data.cmd) {
            case 'init': {
                let mediaDataSource = e.data.param[0];
                let config = e.data.param[1];
                _msectl = new MSEControllerForWorker(config);
                _transmuxer = new Transmuxer(mediaDataSource, { ... config, enableWorker: false });

                _msectl.on(MSEEvents.UPDATE_END, () => {
                    self.postMessage({ cmd: MSEEvents.UPDATE_END });
                });
                _msectl.on(MSEEvents.BUFFER_FULL, () => {
                    self.postMessage({ cmd: MSEEvents.BUFFER_FULL });
                });
                _msectl.on(MSEEvents.SOURCE_OPEN, () => {
                    self.postMessage({ cmd: MSEEvents.SOURCE_OPEN })
                });
                _msectl.on(MSEEvents.ERROR, (info) => {
                    self.postMessage({ cmd: PlayerEvents.ERROR, type: ErrorTypes.MEDIA_ERROR, detail: ErrorDetails.MEDIA_MSE_ERROR, info })
                });

                _transmuxer.on(TransmuxingEvents.INIT_SEGMENT, (type, is) => {
                    if (_msectl == null) { return; }
                    _msectl.appendInitSegment(is);
                });
                _transmuxer.on(TransmuxingEvents.MEDIA_SEGMENT, (type, ms) => {
                    if (_msectl == null) { return; }
                    _msectl.appendMediaSegment(ms);

                    // lazyLoad check
                    if (config.lazyLoad && !config.isLive) {
                        if (ms.info.endDts >= (currentTime + config.lazyLoadMaxDuration) * 1000) {
                            self.postMessage('suspendTransmuxer');
                        }
                    }
                });
                _transmuxer.on(TransmuxingEvents.LOADING_COMPLETE, () => {
                    if (_msectl == null) { return; }
                    _msectl.endOfStream();
                    self.postMessage({ cmd: PlayerEvents.LOADING_COMPLETE });
                });
                _transmuxer.on(TransmuxingEvents.RECOVERED_EARLY_EOF, () => {
                    self.postMessage({ cmd: PlayerEvents.RECOVERED_EARLY_EOF });
                });
                _transmuxer.on(TransmuxingEvents.IO_ERROR, (detail, info) => {
                    self.postMessage({ cmd: PlayerEvents.ERROR, type: ErrorTypes.NETWORK_ERROR, detail, info });
                });
                _transmuxer.on(TransmuxingEvents.DEMUX_ERROR, (detail, info) => {
                    self.postMessage({ cmd: PlayerEvents.ERROR, type: ErrorTypes.MEDIA_ERROR, detail, info: {code: -1, msg: info} });
                });
                _transmuxer.on(TransmuxingEvents.MEDIA_INFO, (mediaInfo) => {
                    self.postMessage({ cmd: PlayerEvents.MEDIA_INFO, mediaInfo });
                });
                _transmuxer.on(TransmuxingEvents.METADATA_ARRIVED, (metadata) => {
                    self.postMessage({ cmd: PlayerEvents.METADATA_ARRIVED, data: metadata });
                });
                _transmuxer.on(TransmuxingEvents.SCRIPTDATA_ARRIVED, (data) => {
                    self.postMessage({ cmd: PlayerEvents.SCRIPTDATA_ARRIVED, data });
                });
                _transmuxer.on(TransmuxingEvents.TIMED_ID3_METADATA_ARRIVED, (timed_id3_metadata) => {
                    self.postMessage({ cmd: PlayerEvents.TIMED_ID3_METADATA_ARRIVED, data: timed_id3_metadata });
                });
                _transmuxer.on(TransmuxingEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, (synchronous_klv_metadata) => {
                    self.postMessage({ cmd: PlayerEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, data: synchronous_klv_metadata });
                });
                _transmuxer.on(TransmuxingEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, (asynchronous_klv_metadata) => {
                    self.postMessage({ cmd: PlayerEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, data: asynchronous_klv_metadata });
                });
                _transmuxer.on(TransmuxingEvents.SMPTE2038_METADATA_ARRIVED, (smpte2038_metadata) => {
                    self.postMessage({ cmd: PlayerEvents.SMPTE2038_METADATA_ARRIVED, data: smpte2038_metadata });
                });
                _transmuxer.on(TransmuxingEvents.SCTE35_METADATA_ARRIVED, (scte35_metadata) => {
                    self.postMessage({ cmd: PlayerEvents.SCTE35_METADATA_ARRIVED, data: scte35_metadata });
                });
                _transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_DESCRIPTOR, (descriptor) => {
                    self.postMessage({ cmd: PlayerEvents.PES_PRIVATE_DATA_DESCRIPTOR, data: descriptor });
                });
                _transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_ARRIVED, (private_data) => {
                    self.postMessage({ cmd: PlayerEvents.PES_PRIVATE_DATA_ARRIVED, data: private_data });
                });
                _transmuxer.on(TransmuxingEvents.STATISTICS_INFO, (statInfo) => {
                    self.postMessage({ cmd: TransmuxingEvents.STATISTICS_INFO, statInfo });
                });
                _transmuxer.on(TransmuxingEvents.RECOMMEND_SEEKPOINT, (milliseconds) => {
                    self.postMessage({ cmd: TransmuxingEvents.RECOMMEND_SEEKPOINT, milliseconds });
                });

                _transmuxer.open();
                break;
            }
            case 'attachMediaElement': {
                if (_msectl == null) { throw new IllegalStateException('MSEController not Initialized!'); }
                const handle = _msectl.attachMediaElement()
                self.postMessage({
                    cmd: 'attachMediaElement',
                    handle,
                }, [handle]);
                break;
            }
            case 'detachMediaElement':
                if (_msectl != null) {
                    _msectl.detachMediaElement();
                    _msectl.destroy();
                    _msectl = null;
                }
                self.postMessage({
                    cmd: 'detachMediaElement',
                });
                break;
            case 'unload':
                currentTime = 0;
                if (_msectl) {
                    _msectl.seek(0);
                }
                if (_transmuxer) {
                    _transmuxer.close();
                    _transmuxer.destroy();
                    _transmuxer = null;
                }
                self.postMessage({
                    cmd: 'unload',
                });
                break;
            case 'timeupdate':
                if (_msectl == null) { throw new IllegalStateException('MSEController not Initialized!'); }
                _msectl.currentTime = e.data.currentTime;
                break;
            case 'readystatechange':
                if (_msectl == null) { throw new IllegalStateException('MSEController not Initialized!'); }
                _msectl.readyState = e.data.readyState;
                break;
            case 'seek':
                if (_msectl == null) { { throw new IllegalStateException('MSEController not Initialized!'); } }
                if (_transmuxer == null) { { throw new IllegalStateException('Transmuxser not Initialized!'); } }
                _msectl.seek(e.data.seconds);
                _transmuxer.seek(Math.floor(e.data.seconds * 1000));  // in milliseconds
                break;
            case 'directSeek': {
                let idr = _msectl.getNearestKeyframe(Math.floor(e.data.seconds * 1000));
                if (idr != null) {
                    self.postMessage({ cmd: 'currentTime', seconds: idr.dts / 1000 })
                } else if (!e.data.alwaysSeekKeyframe) {
                    self.postMessage({ cmd: 'currentTime', seconds: e.data.seconds })
                }
                break;
            }
            case 'suspendTransmuxer':
                if (_transmuxer == null) { throw new IllegalStateException('Transmuxer not Initialized!'); }
                _transmuxer.pause();
                break;
            case 'resumeTransmuxer':
                if (_transmuxer == null) { throw new IllegalStateException('Transmuxer not Initialized!'); }
                _transmuxer.resume();
                break;
            case 'logging_config': {
                let config = e.data.param;
                LoggingControl.applyConfig(config);

                if (config.enableCallback === true) {
                    LoggingControl.addLogListener(logcatListener);
                } else {
                    LoggingControl.removeLogListener(logcatListener);
                }
                break;
            }
            case 'destroy':
                if (_msectl) {
                    _msectl.destroy();
                    _msectl = null;
                }
                if (_transmuxer) {
                    _transmuxer.destroy();
                    _transmuxer = null;
                }
                self.postMessage({ cmd: 'destroyed'});
                break;
        }
    });

    function onLogcatCallback(type, str) {
        self.postMessage({
            cmd: 'logcat_callback',
            data: {
                type: type,
                logcat: str
            }
        });
    };
};

export default MSEWorker;
