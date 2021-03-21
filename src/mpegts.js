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

import Polyfill from './utils/polyfill.js';
import Features from './core/features.js';
import {BaseLoader, LoaderStatus, LoaderErrors} from './io/loader.js';
import MSEPlayer from './player/mse-player.js';
import NativePlayer from './player/native-player.js';
import PlayerEvents from './player/player-events.js';
import {ErrorTypes, ErrorDetails} from './player/player-errors.js';
import LoggingControl from './utils/logging-control.js';
import {InvalidArgumentException} from './utils/exception.js';

// here are all the interfaces

// install polyfills
Polyfill.install();


// factory method
function createPlayer(mediaDataSource, optionalConfig) {
    let mds = mediaDataSource;
    if (mds == null || typeof mds !== 'object') {
        throw new InvalidArgumentException('MediaDataSource must be an javascript object!');
    }

    if (!mds.hasOwnProperty('type')) {
        throw new InvalidArgumentException('MediaDataSource must has type field to indicate video file type!');
    }

    switch (mds.type) {
        case 'mse':
        case 'mpegts':
        case 'm2ts':
        case 'flv':
            return new MSEPlayer(mds, optionalConfig);
        default:
            return new NativePlayer(mds, optionalConfig);
    }
}


// feature detection
function isSupported() {
    return Features.supportMSEH264Playback();
}

function getFeatureList() {
    return Features.getFeatureList();
}


// interfaces
let mpegts = {};

mpegts.createPlayer = createPlayer;
mpegts.isSupported = isSupported;
mpegts.getFeatureList = getFeatureList;

mpegts.BaseLoader = BaseLoader;
mpegts.LoaderStatus = LoaderStatus;
mpegts.LoaderErrors = LoaderErrors;

mpegts.Events = PlayerEvents;
mpegts.ErrorTypes = ErrorTypes;
mpegts.ErrorDetails = ErrorDetails;

mpegts.MSEPlayer = MSEPlayer;
mpegts.NativePlayer = NativePlayer;
mpegts.LoggingControl = LoggingControl;

Object.defineProperty(mpegts, 'version', {
    enumerable: true,
    get: function () {
        // replaced by webpack.DefinePlugin
        return __VERSION__;
    }
});

export default mpegts;
