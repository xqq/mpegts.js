mpegts.js  [![npm](https://img.shields.io/npm/v/mpegts.js.svg?style=flat)](https://www.npmjs.com/package/mpegts.js)
======
[日本語](README_ja.md)

mpegts.js 是在 HTML5 上直接播放 MPEG2-TS 流的播放器，针对低延迟直播优化，可用于 DVB/ISDB 数字电视流或监控摄像头等的低延迟回放。

mpegts.js 基于 [flv.js](https://github.com/bilibili/flv.js) 改造而来。

## Overview
mpegts.js 通过在 JavaScript 中渐进化解析 MPEG2-TS 流并实时转封装为 ISO BMFF (Fragmented MP4)，然后通过 [Media Source Extensions][] 把音视频数据喂入 HTML5 `<video>` 元素。

[Media Source Extensions]: https://w3c.github.io/media-source/

## News
H.265/HEVC 播放支持（FLV 或 MPEG-TS 均已支持）已在 v1.7.0 版本登场！

## Demo
[http://xqq.github.io/mpegts.js/demo/](http://xqq.github.io/mpegts.js/demo/)

## Features
- 回放 http(s) 或 WebSocket 上承载的 H.264 + AAC 编码的 MPEG2-TS 流
- 超低延迟，最佳情况延迟可低达 1 秒以内
- 回放 TS packet 为 192 字节的 `.m2ts` 文件（BDAV/BDMV）或 204 字节的 TS 流
- 支持动态编码参数切换，如视频分辨率动态变化
- 支持 Chrome, FireFox, Safari, Edge (Old or Chromium) 或任何基于 Chromium 的浏览器
- 支持对 HTMLMediaElement 内部缓冲的自动延迟追赶
- 极低的 CPU 使用率和内存使用量（单个实例约使用 JS 堆 10MiB）
- 支持 PES private data 回调 (stream_type=0x06)，如 ARIB B24 字幕 （可配合 [aribb24.js][]）
- 支持 Timed ID3 Metadata (stream_type=0x15) 回调 (TIMED_ID3_METADATA_ARRIVED)

[aribb24.js]: https://github.com/monyone/aribb24.js

## CORS
若在与页面不同的独立的服务器串流，必须设置 CORS 的 `Access-Control-Allow-Origin` 头。

参阅 [cors.md](docs/cors.md)。

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

若在中国大陆可尝试 [cnpm](https://github.com/cnpm/cnpm) 镜像。

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
可使用 [Simple Realtime Server](https://github.com/ossrs/srs/) 来测试 mpegts.js。

## TODO
- MPEG2-TS 静态文件回放 （目前还不支持 seek）
- MP3/AC3 音频编码支持
- AV1/OPUS codec over MPEG2-TS stream support (?)

## Limitations
- 不支持 mpeg2video
- IE11 等旧浏览器不支持 HTTP MPEG2-TS/FLV 直播流回放
- iOS 由于屏蔽了 [Media Source Extensions][] 因而无法使用，但在 iPadOS 上可用

## Features inherited from flv.js
- H.264 + AAC / MP3 编码的 FLV 文件回放
- 多分段 FLV 视频无缝播放
- HTTP FLV 低延迟直播流回放
- FLV over WebSocket 直播流回放
- 兼容 Chrome, FireFox, Safari 10, IE11, Edge
- 超低开销并且由你的浏览器硬件加速

## FLV playback limitations
- MP3 编码在 IE11 和旧版 Edge 上不受支持
- HTTP FLV 直播不支持部分旧浏览器，参阅 [livestream.md](docs/livestream.md)

## FLV Multipart playback
多段播放需要在 `MediaDataSource` 中提供文件列表。参阅 [multipart.md](docs/multipart.md)

## Livestream playback
参阅 [livestream.md](docs/livestream.md)

## API and Configuration
参阅 [api.md](docs/api.md)

## Debug
```bash
npm install                 # install dev-dependences
npm install -g webpack-cli  # install build tool
npm run build:debug         # packaged & minimized js will be emitted in dist folder
```

## Design
参阅 [design.md](docs/design.md)

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
