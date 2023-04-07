mpegts.js  [![npm](https://img.shields.io/npm/v/mpegts.js.svg?style=flat)](https://www.npmjs.com/package/mpegts.js)
======
[日本語](README_ja.md)  [中文说明](README_zh.md)

HTML5 MPEG2-TS stream player written in TypeScript & JavaScript.

mpegts.js is optimized for low-latency live stream playback, such as DVB/ISDB television or surveillance cameras.

This project is based on [flv.js](https://github.com/bilibili/flv.js).

## Overview
mpegts.js works by transmuxing MPEG2-TS stream into ISO BMFF (Fragmented MP4) segments, followed by feeding mp4 segments into an HTML5 `<video>` element through [Media Source Extensions][] API.

[Media Source Extensions]: https://w3c.github.io/media-source/

## News
- v1.7.3

    Introduced [Enhanced RTMP] with HEVC support for FLV.

    Introduced Opus and ATSC AC-3 audio codec support for MPEG-TS.

    Introduced LOAS AAC support for MPEG-TS.

- v1.7.0

    Introduced H.265/HEVC over MPEG-TS/FLV support.

[Enhanced RTMP]: https://github.com/veovera/enhanced-rtmp
## Demo
[http://xqq.github.io/mpegts.js/demo/](http://xqq.github.io/mpegts.js/demo/)

[demo with aribb24.js](http://xqq.github.io/mpegts.js/demo/arib.html)

## Features
- Playback for MPEG2-TS stream with H.264/H.265 + AAC codec transported in http(s) or WebSocket
- Playback for FLV stream with H.264/H.265 + AAC codec transported in http(s) or WebSocket
- Extremely low latency of less than 1 second in the best case
- Playback for `.m2ts` file like BDAV/BDMV with 192 bytes TS packet, or 204 bytes TS packet
- Support handling dynamic codec parameters change (e.g. video resolution change)
- Support Chrome, FireFox, Safari, Edge (Old or Chromium) or any Chromium-based browsers
- Support chasing latency automatically for internal buffer of HTMLMediaElement
- Low CPU overhead and low memory usage (JS heap takes about 10MiB for each instance)
- Support extracting PES private data (stream_type=0x06) like ARIB B24 subtitles (with [aribb24.js][])
- Support Timed ID3 Metadata (stream_type=0x15) callback (TIMED_ID3_METADATA_ARRIVED)

[aribb24.js]: https://github.com/monyone/aribb24.js

## CORS
If you use standalone video server for MPEG2-TS stream, `Access-Control-Allow-Origin` header must be configured correctly on video server for cross-origin resource fetching.

See [cors.md](docs/cors.md) for more details.

## Installation
```bash
npm install --save mpegts.js
```

## Build
```bash
npm install                 # install dev-dependences
npm install -g webpack-cli  # install build tool
npm run build               # packaged & minimized js will be emitted in dist folder
```

[cnpm](https://github.com/cnpm/cnpm) mirror is recommended if you are in Mainland China.

## Getting Started
```html
<script src="mpegts.js"></script>
<video id="videoElement"></video>
<script>
    if (mpegts.getFeatureList().mseLivePlayback) {
        var videoElement = document.getElementById('videoElement');
        var player = mpegts.createPlayer({
            type: 'mse',  // could also be mpegts, m2ts, flv
            isLive: true,
            url: 'http://example.com/live/livestream.ts'
        });
        player.attachMediaElement(videoElement);
        player.load();
        player.play();
    }
</script>
```
mpegts.js could be tested with [Simple Realtime Server](https://github.com/ossrs/srs/).

## TODO
- MPEG2-TS static file playback (seeking is not supported now)
- MP3/AC3 audio codec support
- AV1/OPUS codec over MPEG2-TS stream support (?)

## Limitations
- mpeg2video is not supported
- HTTP MPEG2-TS live stream could not work on old browsers like IE11
- mpegts.js is not usable on iOS caused by the banning of [Media Source Extensions][] (available on iPadOS)

## Features inherited from flv.js
- FLV container with H.264 + AAC / MP3 codec playback
- Multipart segmented video playback
- HTTP FLV low latency live stream playback
- FLV over WebSocket live stream playback
- Compatible with Chrome, FireFox, Safari 10, IE11 and Edge
- Extremely low overhead, and hardware accelerated by your browser!

## FLV playback limitations
- MP3 audio codec is currently not working on IE11 / Edge
- HTTP FLV live stream is not currently working on all browsers, see [livestream.md](docs/livestream.md)

## FLV Multipart playback
You only have to provide a playlist for `MediaDataSource`. See [multipart.md](docs/multipart.md)

## Livestream playback
See [livestream.md](docs/livestream.md)

## API and Configuration
See [api.md](docs/api.md)

## Debug
```bash
npm install                 # install dev-dependences
npm install -g webpack-cli  # install build tool
npm run build:debug         # packaged & minimized js will be emitted in dist folder
```

## Design
See [design.md](docs/design.md)

## License
```
Copyright (C) 2021 magicxqq. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
