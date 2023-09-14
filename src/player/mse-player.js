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

import EventEmitter from 'events';
import work from 'webworkify-webpack';
import Log from '../utils/logger.js';
import Browser from '../utils/browser.js';
import PlayerEvents from './player-events.js';
import Transmuxer from '../core/transmuxer.js';
import TransmuxingEvents from '../core/transmuxing-events.js';
import MSEController from '../core/mse-controller.js';
import MSEEvents from '../core/mse-events.js';
import LoggingControl from '../utils/logging-control.js';
import {ErrorTypes, ErrorDetails} from './player-errors.js';
import {createDefaultConfig} from '../config.js';
import {InvalidArgumentException, IllegalStateException} from '../utils/exception.js';

class MSEPlayer {

    constructor(mediaDataSource, config) {
        this.TAG = 'MSEPlayer';
        this._type = 'MSEPlayer';
        this._emitter = new EventEmitter();

        this._config = createDefaultConfig();
        if (typeof config === 'object') {
            Object.assign(this._config, config);
        }

        let typeLowerCase = mediaDataSource.type.toLowerCase();
        if (typeLowerCase !== 'mse'
                && typeLowerCase !== 'mpegts'
                && typeLowerCase !== 'm2ts'
                && typeLowerCase !== 'flv') {
            throw new InvalidArgumentException('MSEPlayer requires an mpegts/m2ts/flv MediaDataSource input!');
        }

        if (mediaDataSource.isLive === true) {
            this._config.isLive = true;
        }

        this.e = {
            onvLoadedMetadata: this._onvLoadedMetadata.bind(this),
            onvSeeking: this._onvSeeking.bind(this),
            onvCanPlay: this._onvCanPlay.bind(this),
            onvStalled: this._onvStalled.bind(this),
            onvProgress: this._onvProgress.bind(this),
            onTimeupdate: this._onTimeupdateForWorker.bind(this),
            onReadystatechange: this._onReadystateChangeForWorker.bind(this),
        };
        this.onLoggingConfigChangedHandler = this._onLoggingConfigChanged.bind(this);

        if (self.performance && self.performance.now) {
            this._now = self.performance.now.bind(self.performance);
        } else {
            this._now = Date.now;
        }

        this._pendingSeekTime = null;  // in seconds
        this._requestSetTime = false;
        this._seekpointRecord = null;
        this._progressChecker = null;

        this._mediaDataSource = mediaDataSource;
        this._mediaElement = null;
        this._msectl = null;
        this._transmuxer = null;
        this._mseworker = null;
        this._mseworkerDestroying = false;
        this._mseworkerAttaching = false;

        this._mseSourceOpened = false;
        this._hasPendingLoad = false;
        this._receivedCanPlay = false;

        this._mediaInfo = null;
        this._statisticsInfo = null;

        let chromeNeedIDRFix = (Browser.chrome &&
                               (Browser.version.major < 50 ||
                               (Browser.version.major === 50 && Browser.version.build < 2661)));
        this._alwaysSeekKeyframe = (chromeNeedIDRFix || Browser.msedge || Browser.msie) ? true : false;

        if (this._alwaysSeekKeyframe) {
            this._config.accurateSeek = false;
        }
    }

    destroy() {
        this._emitter.emit(PlayerEvents.DESTROYING);
        if (this._progressChecker != null) {
            window.clearInterval(this._progressChecker);
            this._progressChecker = null;
        }
        if (this._mseworker) {
            if (!this._mseworkerDestroying) {
                this._mseworkerDestroying = true;
                this._mseworker.postMessage({cmd: 'destroy'});
                LoggingControl.removeListener(this.onLoggingConfigChangedHandler);
            }
        }
        if (this._transmuxer) {
            this.unload();
        }
        if (this._mediaElement) {
            this.detachMediaElement();
        }
        this.e = null;
        this._mediaDataSource = null;

        if (!this._mseworker) {
            this._emitter.removeAllListeners();
            this._emitter = null;
        }
    }

    on(event, listener) {
        if (event === PlayerEvents.MEDIA_INFO) {
            if (this._mediaInfo != null) {
                Promise.resolve().then(() => {
                    this._emitter.emit(PlayerEvents.MEDIA_INFO, this.mediaInfo);
                });
            }
        } else if (event === PlayerEvents.STATISTICS_INFO) {
            if (this._statisticsInfo != null) {
                Promise.resolve().then(() => {
                    this._emitter.emit(PlayerEvents.STATISTICS_INFO, this.statisticsInfo);
                });
            }
        }
        this._emitter.addListener(event, listener);
    }

    off(event, listener) {
        this._emitter.removeListener(event, listener);
    }

    attachMediaElement(mediaElement) {
        this._mediaElement = mediaElement;

        if (this._config.enableMSEWorker) {
            this._constructMSEWorkerIfNeeded(false);
            if (this._mseworker) {
                this._mseworkerAttaching = true;

                this._mseworker.postMessage({ cmd: 'attachMediaElement' });
                let cb = (e) => {
                    if (e.data.cmd !== 'attachMediaElement') { return; }

                    mediaElement.removeAttribute('src');
                    mediaElement.srcObject = null;
                    mediaElement.load();
                    this._mseworkerAttaching = false;

                    mediaElement.addEventListener('loadedmetadata', this.e.onvLoadedMetadata);
                    mediaElement.addEventListener('seeking', this.e.onvSeeking);
                    mediaElement.addEventListener('canplay', this.e.onvCanPlay);
                    mediaElement.addEventListener('stalled', this.e.onvStalled);
                    mediaElement.addEventListener('progress', this.e.onvProgress);
                    mediaElement.addEventListener('timeupdate', this.e.onTimeupdate);
                    mediaElement.addEventListener('readystatechange', this.e.onReadystatechange);

                    this._mediaElement.srcObject = e.data.handle;

                    if (this._mseworker == null) { return; }
                    this._mseworker.removeEventListener('message', cb);
                };
                this._mseworker.addEventListener('message', cb);
            }
        } else {
            mediaElement.addEventListener('loadedmetadata', this.e.onvLoadedMetadata);
            mediaElement.addEventListener('seeking', this.e.onvSeeking);
            mediaElement.addEventListener('canplay', this.e.onvCanPlay);
            mediaElement.addEventListener('stalled', this.e.onvStalled);
            mediaElement.addEventListener('progress', this.e.onvProgress);
            mediaElement.addEventListener('timeupdate', this.e.onTimeupdate);
            mediaElement.addEventListener('readystatechange', this.e.onReadystatechange);

            this._msectl = new MSEController(this._config);

            this._msectl.on(MSEEvents.UPDATE_END, this._onmseUpdateEnd.bind(this));
            this._msectl.on(MSEEvents.BUFFER_FULL, this._onmseBufferFull.bind(this));
            this._msectl.on(MSEEvents.SOURCE_OPEN, () => {
                this._mseSourceOpened = true;
                if (this._hasPendingLoad) {
                    this._hasPendingLoad = false;
                    this.load();
                }
            });
            this._msectl.on(MSEEvents.ERROR, (info) => {
                this._emitter.emit(PlayerEvents.ERROR,
                                ErrorTypes.MEDIA_ERROR,
                                ErrorDetails.MEDIA_MSE_ERROR,
                                info
                );
            });

            this._msectl.attachMediaElement(mediaElement);
        }

        if (this._pendingSeekTime != null) {
            try {
                mediaElement.currentTime = this._pendingSeekTime;
                this._pendingSeekTime = null;
            } catch (e) {
                // IE11 may throw InvalidStateError if readyState === 0
                // We can defer set currentTime operation after loadedmetadata
            }
        }
    }

    detachMediaElement() {
        if (this._mediaElement) {
            this._mediaElement.removeEventListener('loadedmetadata', this.e.onvLoadedMetadata);
            this._mediaElement.removeEventListener('seeking', this.e.onvSeeking);
            this._mediaElement.removeEventListener('canplay', this.e.onvCanPlay);
            this._mediaElement.removeEventListener('stalled', this.e.onvStalled);
            this._mediaElement.removeEventListener('progress', this.e.onvProgress);
            this._mediaElement.removeEventListener('timeupdate', this.e.onTimeupdate);
            this._mediaElement.removeEventListener('readystatechange', this.e.onReadystatechange);
            if (this._mseworker == null) {
                this._mediaElement = null;
            }
        }
        if (this._mseworker) {
            this._mseworker.postMessage({ cmd: 'detachMediaElement' })
        }
        if (this._msectl) {
            this._msectl.destroy();
            this._msectl = null;
        }
    }

    load() {
        if (!this._mediaElement) {
            throw new IllegalStateException('HTMLMediaElement must be attached before load()!');
        }
        if (this._transmuxer) {
            throw new IllegalStateException('MSEPlayer.load() has been called, please call unload() first!');
        }
        if (this._hasPendingLoad) {
            return;
        }

        if (this._config.deferLoadAfterSourceOpen && this._mseSourceOpened === false) {
            this._hasPendingLoad = true;
            return;
        }

        if (this._mediaElement.readyState > 0) {
            if (!this._mseworkerAttaching) {
                this._requestSetTime = true;
                // IE11 may throw InvalidStateError if readyState === 0
                this._mediaElement.currentTime = 0;
            }
        }

        if (this._config.enableMSEWorker) {
            this._constructMSEWorkerIfNeeded(false);
        } else {
            this._transmuxer = new Transmuxer(this._mediaDataSource, this._config);

            this._transmuxer.on(TransmuxingEvents.INIT_SEGMENT, (type, is) => {
                this._msectl.appendInitSegment(is);
            });
            this._transmuxer.on(TransmuxingEvents.MEDIA_SEGMENT, (type, ms) => {
                this._msectl.appendMediaSegment(ms);

                // lazyLoad check
                if (this._config.lazyLoad && !this._config.isLive) {
                    let currentTime = this._mediaElement.currentTime;
                    if (ms.info.endDts >= (currentTime + this._config.lazyLoadMaxDuration) * 1000) {
                        if (this._progressChecker == null) {
                            Log.v(this.TAG, 'Maximum buffering duration exceeded, suspend transmuxing task');
                            this._suspendTransmuxer();
                        }
                    }
                }
            });
            this._transmuxer.on(TransmuxingEvents.LOADING_COMPLETE, () => {
                this._msectl.endOfStream();
                this._emitter.emit(PlayerEvents.LOADING_COMPLETE);
            });
            this._transmuxer.on(TransmuxingEvents.RECOVERED_EARLY_EOF, () => {
                this._emitter.emit(PlayerEvents.RECOVERED_EARLY_EOF);
            });
            this._transmuxer.on(TransmuxingEvents.IO_ERROR, (detail, info) => {
                this._emitter.emit(PlayerEvents.ERROR, ErrorTypes.NETWORK_ERROR, detail, info);
            });
            this._transmuxer.on(TransmuxingEvents.DEMUX_ERROR, (detail, info) => {
                this._emitter.emit(PlayerEvents.ERROR, ErrorTypes.MEDIA_ERROR, detail, {code: -1, msg: info});
            });
            this._transmuxer.on(TransmuxingEvents.MEDIA_INFO, (mediaInfo) => {
                this._mediaInfo = mediaInfo;
                this._emitter.emit(PlayerEvents.MEDIA_INFO, Object.assign({}, mediaInfo));
            });
            this._transmuxer.on(TransmuxingEvents.METADATA_ARRIVED, (metadata) => {
                this._emitter.emit(PlayerEvents.METADATA_ARRIVED, metadata);
            });
            this._transmuxer.on(TransmuxingEvents.SCRIPTDATA_ARRIVED, (data) => {
                this._emitter.emit(PlayerEvents.SCRIPTDATA_ARRIVED, data);
            });
            this._transmuxer.on(TransmuxingEvents.TIMED_ID3_METADATA_ARRIVED, (timed_id3_metadata) => {
                this._emitter.emit(PlayerEvents.TIMED_ID3_METADATA_ARRIVED, timed_id3_metadata);
            });
            this._transmuxer.on(TransmuxingEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, (synchronous_klv_metadata) => {
                this._emitter.emit(PlayerEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED, synchronous_klv_metadata);
            });
            this._transmuxer.on(TransmuxingEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, (asynchronous_klv_metadata) => {
                this._emitter.emit(PlayerEvents.ASYNCHRONOUS_KLV_METADATA_ARRIVED, asynchronous_klv_metadata);
            });
            this._transmuxer.on(TransmuxingEvents.SMPTE2038_METADATA_ARRIVED, (smpte2038_metadata) => {
                this._emitter.emit(PlayerEvents.SMPTE2038_METADATA_ARRIVED, smpte2038_metadata);
            });
            this._transmuxer.on(TransmuxingEvents.SCTE35_METADATA_ARRIVED, (scte35_metadata) => {
                this._emitter.emit(PlayerEvents.SCTE35_METADATA_ARRIVED, scte35_metadata);
            });
            this._transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_DESCRIPTOR, (descriptor) => {
                this._emitter.emit(PlayerEvents.PES_PRIVATE_DATA_DESCRIPTOR, descriptor);
            });
            this._transmuxer.on(TransmuxingEvents.PES_PRIVATE_DATA_ARRIVED, (private_data) => {
                this._emitter.emit(PlayerEvents.PES_PRIVATE_DATA_ARRIVED, private_data);
            });
            this._transmuxer.on(TransmuxingEvents.STATISTICS_INFO, (statInfo) => {
                this._statisticsInfo = this._fillStatisticsInfo(statInfo);
                this._emitter.emit(PlayerEvents.STATISTICS_INFO, Object.assign({}, this._statisticsInfo));
            });
            this._transmuxer.on(TransmuxingEvents.RECOMMEND_SEEKPOINT, (milliseconds) => {
                if (this._mediaElement && !this._config.accurateSeek) {
                    this._requestSetTime = true;
                    this._mediaElement.currentTime = milliseconds / 1000;
                }
            });

            this._transmuxer.open();
        }
    }

    unload() {
        if (this._mediaElement) {
            this._mediaElement.pause();
        }
        if (this._mseworker) {
            this._mseworker.postMessage({ cmd: 'unload' })
        }
        if (this._msectl) {
            this._msectl.seek(0);
        }
        if (this._transmuxer) {
            this._transmuxer.close();
            this._transmuxer.destroy();
            this._transmuxer = null;
        }
    }

    play() {
        return this._mediaElement.play();
    }

    pause() {
        this._mediaElement.pause();
    }

    get type() {
        return this._type;
    }

    get buffered() {
        return this._mediaElement.buffered;
    }

    get duration() {
        return this._mediaElement.duration;
    }

    get volume() {
        return this._mediaElement.volume;
    }

    set volume(value) {
        this._mediaElement.volume = value;
    }

    get muted() {
        return this._mediaElement.muted;
    }

    set muted(muted) {
        this._mediaElement.muted = muted;
    }

    get currentTime() {
        if (this._mediaElement) {
            return this._mediaElement.currentTime;
        }
        return 0;
    }

    set currentTime(seconds) {
        if (this._mediaElement) {
            this._internalSeek(seconds);
        } else {
            this._pendingSeekTime = seconds;
        }
    }

    get mediaInfo() {
        return Object.assign({}, this._mediaInfo);
    }

    get statisticsInfo() {
        if (this._statisticsInfo == null) {
            this._statisticsInfo = {};
        }
        this._statisticsInfo = this._fillStatisticsInfo(this._statisticsInfo);
        return Object.assign({}, this._statisticsInfo);
    }

    _fillStatisticsInfo(statInfo) {
        statInfo.playerType = this._type;

        if (!(this._mediaElement instanceof HTMLVideoElement)) {
            return statInfo;
        }

        let hasQualityInfo = true;
        let decoded = 0;
        let dropped = 0;

        if (this._mediaElement.getVideoPlaybackQuality) {
            let quality = this._mediaElement.getVideoPlaybackQuality();
            decoded = quality.totalVideoFrames;
            dropped = quality.droppedVideoFrames;
        } else if (this._mediaElement.webkitDecodedFrameCount != undefined) {
            decoded = this._mediaElement.webkitDecodedFrameCount;
            dropped = this._mediaElement.webkitDroppedFrameCount;
        } else {
            hasQualityInfo = false;
        }

        if (hasQualityInfo) {
            statInfo.decodedFrames = decoded;
            statInfo.droppedFrames = dropped;
        }

        return statInfo;
    }

    _onmseUpdateEnd() {
        let buffered = this._mediaElement.buffered;
        let currentTime = this._mediaElement.currentTime;

        if (this._config.isLive
                && this._config.liveBufferLatencyChasing
                && buffered.length > 0
                && !this._mediaElement.paused) {
            let buffered_end = buffered.end(buffered.length - 1);
            if (buffered_end > this._config.liveBufferLatencyMaxLatency) {
                // Ensure there's enough buffered data
                if (buffered_end - currentTime > this._config.liveBufferLatencyMaxLatency) {
                    // if remained data duration has larger than config.liveBufferLatencyMaxLatency
                    let target_time = buffered_end - this._config.liveBufferLatencyMinRemain;
                    this.currentTime = target_time;
                }
            }
        }

        if (!this._config.lazyLoad || this._config.isLive) {
            return;
        }

        let currentRangeStart = 0;
        let currentRangeEnd = 0;

        for (let i = 0; i < buffered.length; i++) {
            let start = buffered.start(i);
            let end = buffered.end(i);
            if (start <= currentTime && currentTime < end) {
                currentRangeStart = start;
                currentRangeEnd = end;
                break;
            }
        }

        if (currentRangeEnd >= currentTime + this._config.lazyLoadMaxDuration && this._progressChecker == null) {
            Log.v(this.TAG, 'Maximum buffering duration exceeded, suspend transmuxing task');
            this._suspendTransmuxer();
        }
    }

    _onmseBufferFull() {
        Log.v(this.TAG, 'MSE SourceBuffer is full, suspend transmuxing task');
        if (this._progressChecker == null) {
            this._suspendTransmuxer();
        }
    }

    _suspendTransmuxer() {
        if (this._mseworker) {
            this._mseworker.postMessage({ cmd: 'suspendTransmuxer' });
        }

        if (this._transmuxer) {
            this._transmuxer.pause();
        }

        if (this._progressChecker == null) {
            this._progressChecker = window.setInterval(this._checkProgressAndResume.bind(this), 1000);
        }
    }

    _checkProgressAndResume() {
        let currentTime = this._mediaElement.currentTime;
        let buffered = this._mediaElement.buffered;

        let needResume = false;

        for (let i = 0; i < buffered.length; i++) {
            let from = buffered.start(i);
            let to = buffered.end(i);
            if (currentTime >= from && currentTime < to) {
                if (currentTime >= to - this._config.lazyLoadRecoverDuration) {
                    console.log(needResume);
                    needResume = true;
                }
                break;
            }
        }

        if (needResume) {
            window.clearInterval(this._progressChecker);
            this._progressChecker = null;
            if (needResume) {
                Log.v(this.TAG, 'Continue loading from paused position');
                if (this._mseworker) {
                    this._mseworker.postMessage({ cmd: 'resumeTransmuxer' });
                } else {
                    this._transmuxer.resume();
                }
            }
        }
    }

    _isTimepointBuffered(seconds) {
        let buffered = this._mediaElement.buffered;

        for (let i = 0; i < buffered.length; i++) {
            let from = buffered.start(i);
            let to = buffered.end(i);
            if (seconds >= from && seconds < to) {
                return true;
            }
        }
        return false;
    }

    _internalSeek(seconds) {
        let directSeek = this._isTimepointBuffered(seconds);

        let directSeekBegin = false;
        let directSeekBeginTime = 0;

        if (seconds < 1.0 && this._mediaElement.buffered.length > 0) {
            let videoBeginTime = this._mediaElement.buffered.start(0);
            if ((videoBeginTime < 1.0 && seconds < videoBeginTime) || Browser.safari) {
                directSeekBegin = true;
                // also workaround for Safari: Seek to 0 may cause video stuck, use 0.1 to avoid
                directSeekBeginTime = Browser.safari ? 0.1 : videoBeginTime;
            }
        }

        if (directSeekBegin) {  // seek to video begin, set currentTime directly if beginPTS buffered
            this._requestSetTime = true;
            this._mediaElement.currentTime = directSeekBeginTime;
        }  else if (directSeek) {  // buffered position
            if (!this._alwaysSeekKeyframe) {
                this._requestSetTime = true;
                this._mediaElement.currentTime = seconds;
            } else {
                if (this._mseworker) {
                    this._mseworker.postMessage({ cmd: 'directSeek', seconds })
                } else {
                    let idr = this._msectl.getNearestKeyframe(Math.floor(seconds * 1000));
                    this._requestSetTime = true;
                    if (idr != null) {
                        this._mediaElement.currentTime = idr.dts / 1000;
                    } else {
                        this._mediaElement.currentTime = seconds;
                    }
                }
            }

            if (this._progressChecker != null) {
                this._checkProgressAndResume();
            }
        } else {
            if (this._progressChecker != null) {
                window.clearInterval(this._progressChecker);
                this._progressChecker = null;
            }
            if (this._mseworker) {
                this._mseworker.postMessage({ cmd: 'seek', seconds });
            } else {
                this._msectl.seek(seconds);
                this._transmuxer.seek(Math.floor(seconds * 1000));  // in milliseconds
            }

            // no need to set mediaElement.currentTime if non-accurateSeek,
            // just wait for the recommend_seekpoint callback
            if (this._config.accurateSeek) {
                this._requestSetTime = true;
                this._mediaElement.currentTime = seconds;
            }
        }
    }

    _checkAndApplyUnbufferedSeekpoint() {
        if (this._seekpointRecord) {
            if (this._seekpointRecord.recordTime <= this._now() - 100) {
                let target = this._mediaElement.currentTime;
                this._seekpointRecord = null;
                if (!this._isTimepointBuffered(target)) {
                    if (this._progressChecker != null) {
                        window.clearTimeout(this._progressChecker);
                        this._progressChecker = null;
                    }
                    // .currentTime is consists with .buffered timestamp
                    // Chrome/Edge use DTS, while FireFox/Safari use PTS
                    if (this._mseworker) {
                        this._mseworker.postMessage({ cmd: 'seek', seconds: target });
                    } else {
                        this._msectl.seek(target);
                        this._transmuxer.seek(Math.floor(target * 1000));
                    }
                    // set currentTime if accurateSeek, or wait for recommend_seekpoint callback
                    if (this._config.accurateSeek) {
                        this._requestSetTime = true;
                        this._mediaElement.currentTime = target;
                    }
                }
            } else {
                window.setTimeout(this._checkAndApplyUnbufferedSeekpoint.bind(this), 50);
            }
        }
    }

    _checkAndResumeStuckPlayback(stalled) {
        let media = this._mediaElement;
        if (stalled || !this._receivedCanPlay || media.readyState < 2) {  // HAVE_CURRENT_DATA
            let buffered = media.buffered;
            if (buffered.length > 0 && media.currentTime < buffered.start(0)) {
                Log.w(this.TAG, `Playback seems stuck at ${media.currentTime}, seek to ${buffered.start(0)}`);
                this._requestSetTime = true;
                this._mediaElement.currentTime = buffered.start(0);
                this._mediaElement.removeEventListener('progress', this.e.onvProgress);
            }
        } else {
            // Playback didn't stuck, remove progress event listener
            this._mediaElement.removeEventListener('progress', this.e.onvProgress);
        }
    }

    _constructMSEWorkerIfNeeded(replace) {
        if (this._config.enableMSEWorker && typeof (Worker) !== 'undefined') {
            if (this._mseworker && !replace) { return; }

            if (this._mseworker) {
                this._mseworker.terminate();
                this._mseworker = null;
            }

            try {
                this._mseworker = work(require.resolve('./mse-player-worker'));
                this._mseworkerDestroying = false;
                this._mseworker.addEventListener('message', this._onWorkerMessage.bind(this));
                this._mseworker.postMessage({ cmd: 'init', param: [this._mediaDataSource, this._config] });

                LoggingControl.registerListener(this.onLoggingConfigChangedHandler);
                this._mseworker.postMessage({ cmd: 'logging_config', param: LoggingControl.getConfig() });
            } catch (error) {
                console.error(error)
                Log.e(this.TAG, 'Error while initialize MSE worker, fallback to inline MSE');
                this._mseworker = null;
            }
        } else {
            this._mseworker = null;
        }
    }

    _onvLoadedMetadata(e) {
        if (this._pendingSeekTime != null) {
            this._mediaElement.currentTime = this._pendingSeekTime;
            this._pendingSeekTime = null;
        }
    }

    _onvSeeking(e) {  // handle seeking request from browser's progress bar
        let target = this._mediaElement.currentTime;
        let buffered = this._mediaElement.buffered;

        if (this._requestSetTime) {
            this._requestSetTime = false;
            return;
        }

        if (target < 1.0 && buffered.length > 0) {
            // seek to video begin, set currentTime directly if beginPTS buffered
            let videoBeginTime = buffered.start(0);
            if ((videoBeginTime < 1.0 && target < videoBeginTime) || Browser.safari) {
                this._requestSetTime = true;
                // also workaround for Safari: Seek to 0 may cause video stuck, use 0.1 to avoid
                this._mediaElement.currentTime = Browser.safari ? 0.1 : videoBeginTime;
                return;
            }
        }

        if (this._isTimepointBuffered(target)) {
            if (this._alwaysSeekKeyframe) {
                if (this._mseworker) {
                    this._mseworker.postMessage({ cmd: 'directSeek', seconds: target, alwaysSeekKeyframe: this._alwaysSeekKeyframe });
                } else {
                    let idr = this._msectl.getNearestKeyframe(Math.floor(target * 1000));
                    if (idr != null) {
                        this._requestSetTime = true;
                        this._mediaElement.currentTime = idr.dts / 1000;
                    }
                }
            }
            if (this._progressChecker != null) {
                this._checkProgressAndResume();
            }
            return;
        }

        this._seekpointRecord = {
            seekPoint: target,
            recordTime: this._now()
        };
        window.setTimeout(this._checkAndApplyUnbufferedSeekpoint.bind(this), 50);
    }

    _onvCanPlay(e) {
        this._receivedCanPlay = true;
        this._mediaElement.removeEventListener('canplay', this.e.onvCanPlay);
    }

    _onvStalled(e) {
        this._checkAndResumeStuckPlayback(true);
    }

    _onvProgress(e) {
        this._checkAndResumeStuckPlayback();
    }

    _onWorkerMessage(e) {
        if (e.data.cmd === 'destroyed' || this._workerDestroying) {
            this._mseworkerDestroying = false;
            this._mseworker.terminate();
            this._mseworker = null;
            this._emitter.removeAllListeners();
            this._emitter = null;
            if (this._mediaElement) {
                this._mediaElement.removeAttribute('src');
                this._mediaElement.srcObject = null;
                this._mediaElement.load();
                this._mediaElement = null;
            }
            return;
        }

        switch (e.data.cmd) {
            case 'attachMediaElement':
                break;
            case 'detachMediaElement':
                if (this._mediaElement) {
                    this._mediaElement.removeAttribute('src');
                    this._mediaElement.srcObject = null;
                    this._mediaElement.load();
                    this._mediaElement = null;
                }
                break;
            case 'unload':
                break;
            case 'suspendTransmuxer':
                this._suspendTransmuxer();
                break;
            case 'currentTime':
                if (this._mediaElement) {
                    this._mediaElement.currentTime = e.data.seconds;
                }
            case 'logcat_callback':
                Log.emitter.emit('log', e.data.data.type, e.data.data.logcat);
                break;
            case TransmuxingEvents.RECOMMEND_SEEKPOINT:
                if (this._mediaElement && !this._config.accurateSeek) {
                    this._requestSetTime = true;
                    this._mediaElement.currentTime = e.data.milliseconds / 1000;
                }
                break;
            case TransmuxingEvents.STATISTICS_INFO:
                this._statisticsInfo = this._fillStatisticsInfo(e.data.statInfo);
                this._emitter.emit(PlayerEvents.STATISTICS_INFO, Object.assign({}, this._statisticsInfo));
                break;
            case MSEEvents.UPDATE_END:
                this._onmseUpdateEnd();
                break;
            case MSEEvents.BUFFER_FULL:
                this._onmseBufferFull();
                break;
            case MSEEvents.SOURCE_OPEN:
                this._mseSourceOpened = true;
                if (this._hasPendingLoad) {
                    this._hasPendingLoad = false;
                    this.load();
                }
                break;
            case PlayerEvents.LOADING_COMPLETE:
                this._emitter.emit(PlayerEvents.LOADING_COMPLETE);
                break;
            case PlayerEvents.RECOVERED_EARLY_EOF:
                this._emitter.emit(PlayerEvents.RECOVERED_EARLY_EOF);
                break;
            case PlayerEvents.ERROR:
                this._emitter.emit(PlayerEvents.ERROR, e.data.type, e.data.detail, e.data.info);
                break;
            case PlayerEvents.MEDIA_INFO:
                this._emitter.emit(PlayerEvents.MEDIA_INFO, e.data.mediaInfo);
                break;
            case PlayerEvents.METADATA_ARRIVED:
            case PlayerEvents.SCRIPTDATA_ARRIVED:
            case PlayerEvents.TIMED_ID3_METADATA_ARRIVED:
            case PlayerEvents.SYNCHRONOUS_KLV_METADATA_ARRIVED:
            case PlayerEvents.SMPTE2038_METADATA_ARRIVED:
            case PlayerEvents.SCTE35_METADATA_ARRIVED:
            case PlayerEvents.PES_PRIVATE_DATA_DESCRIPTOR:
            case PlayerEvents.PES_PRIVATE_DATA_ARRIVED:
                this._emitter.emit(e.data.cmd, e.data.data);
                break;
        }
    }

    _onTimeupdateForWorker(e) {
        if (!this._mseworker) { return; }
        this._mseworker.postMessage({ cmd: 'timeupdate', currentTime: e.target.currentTime });
    }

    _onReadystateChangeForWorker(e) {
        if (!this._mseworker) { return; }
        this._mseworker.postMessage({ cmd: 'readystatechange', readyState: e.target.readyState });
    }

    _onLoggingConfigChanged(config) {
        if (this._mseworker) {
            this._mseworker.postMessage({ cmd: 'logging_config', param: config });
        }
    }

}

export default MSEPlayer;