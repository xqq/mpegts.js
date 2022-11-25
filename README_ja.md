mpegts.js  [![npm](https://img.shields.io/npm/v/mpegts.js.svg?style=flat)](https://www.npmjs.com/package/mpegts.js)
======
MPEG2-TS ストリームを HTML5 上で再生するビデオプレーヤーです。

mpegts.js はライブ配信に対し、低遅延再生のために最適化しています。DVB/ISDB のテレビチャンネルや監視カメラの映像等を低遅延で再生可能になります。

mpegts.js は [flv.js](https://github.com/bilibili/flv.js) を基づいて作ってきたものです。

## Overview
mpegts.js は、JavaScript で MPEG2-TS ストリームを解析しながら、映像と音声のデータを ISO BMFF (fmp4) フォーマットのフラグメントにリマックスして、[Media Source Extensions][] を通じて `<video>` 要素に提供することで再生することにしています。

[Media Source Extensions]: https://w3c.github.io/media-source/

## News
H.265/HEVC 再生支援（over FLV/MPEG-TS）は v1.7.0 から導入されています。

## Demo
[http://xqq.github.io/mpegts.js/demo/](http://xqq.github.io/mpegts.js/demo/)

[demo with aribb24.js](http://xqq.github.io/mpegts.js/demo/arib.html)

## Features
- http(s) または WebSocket で伝送する H.264 + AAC の MPEG2-TS ストリームが再生可能
- 最良の場合は 1 秒以内の低遅延が達成可能
- TS packet が 192 bytes の `.m2ts` ファイル（BDAV/BDMV）、または 204 bytes も再生可能
- 動的パラメータ切り替えが可能 （例えば、映像解像度が途中に切り替わっても再生します）
- Chrome, FireFox, Safari, Edge (Old or Chromium) または Chromium-based ブラウザで実行可能
- HTMLMediaElement 内部バッファーの遅延を追いかける機能
- 低い CPU 使用率とメモリ使用量 （1つのインスタンスが概ね 10MiB のメモリかかります）
- ARIB-B24 字幕等の PES private data (stream_type=0x06) が抽出可能 （[aribb24.js][] と共同運用可能）
- Timed ID3 Metadata (stream_type=0x15) のコールバック支援 (TIMED_ID3_METADATA_ARRIVED)

[aribb24.js]: https://github.com/monyone/aribb24.js

## CORS
MPEG2-TS ストリームが別のサーバー上にある場合、`Access-Control-Allow-Origin` は必須です。

[cors.md](docs/cors.md) を参照してください。

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
[Simple Realtime Server](https://github.com/ossrs/srs/) を用いて mpegts.js をテストすることができます。

## TODO
- 静的 MPEG2-TS ファイルの再生 （現時点ではシークできません）
- MP3/AC3 audio codec の支援
- AV1/OPUS codec over MPEG2-TS stream support (?)

## Limitations
- mpeg2video はサポートしていません。映像は H.264 であることが求められます
- IE11 などの古いブラウザでは、HTTP MPEG2-TS がライブ視聴できません
- iOS では、[Media Source Extensions][] が禁じられたため使えませんが、iPadOS では使用可能

## Features inherited from flv.js
- H.264 + AAC/MP3 codec の FLV ファイルが再生可能
- マルチパットな複数の FLV ファイルも一緒に再生可能
- HTTP FLV のライブストリームが低遅延で再生可能
- WebSocket で伝送する FLV ストリームも再生可能
- Chrome, FireFox, Safari 10, IE11 and Edge のブラウザで実行可能
- ブラウザによる hardware accelerated があるためコストは非常に低い

## FLV playback limitations
- MP3 audio codec は IE11 / Edge でサポートされていません
- HTTP FLV のライブストリームは一部のブラウザで再生できません。[livestream.md](docs/livestream.md) を参照

## FLV Multipart playback
[multipart.md](docs/multipart.md) を参照

## Livestream playback
[livestream.md](docs/livestream.md) を参照

## API and Configuration
[api.md](docs/api.md) を参照

## Debug
```bash
npm install                 # install dev-dependences
npm install -g webpack-cli  # install build tool
npm run build:debug         # packaged & minimized js will be emitted in dist folder
```

## Design
[design.md](docs/design.md) を参照

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
