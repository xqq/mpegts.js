mpegts.js API
==========
This document use TypeScript-like definitions to describe interfaces.

## Interfaces

mpegts.js exports all the interfaces through `mpegts` object which exposed in global context `window`.

`mpegts` object can also be accessed by require or ES6 import.


Functions:
- [mpegts.createPlayer()](#mpegtscreateplayer)
- [mpegts.isSupported()](#mpegtsissupported)
- [mpegts.getFeatureList()](#mpegtsgetfeaturelist)

Classes:
- [mpegts.MSEPlayer](#mpegtsmseplayer)
- [mpegts.NativePlayer](#mpegtsnativeplayer)
- [mpegts.LoggingControl](#mpegtsloggingcontrol)

Enums:
- [mpegts.Events](#mpegtsevents)
- [mpegts.ErrorTypes](#mpegtserrortypes)
- [mpegts.ErrorDetails](#mpegtserrordetails)




### mpegts.createPlayer()
```js
function createPlayer(mediaDataSource: MediaDataSource, config?: Config): Player;
```

Create a player instance according to `type` field indicated in `mediaDataSource`, with optional `config`.


### MediaDataSource

| Field              | Type                  | Description                              |
| ------------------ | --------------------- | ---------------------------------------- |
| `type`             | `string`              | Indicates media type, `'mse'`, `'mpegts'`, `'m2ts'`, `'flv'` or `'mp4'` |
| `isLive?`          | `boolean`             | Indicates whether the data source is a **live stream** |
| `cors?`            | `boolean`             | Indicates whether to enable CORS for http fetching |
| `withCredentials?` | `boolean`             | Indicates whether to do http fetching with cookies |
| `hasAudio?`        | `boolean`             | Indicates whether the stream has audio track |
| `hasVideo?`        | `boolean`             | Indicates whether the stream has video track |
| `duration?`        | `number`              | Indicates total media duration, in **milliseconds** |
| `filesize?`        | `number`              | Indicates total file size of media file, in bytes |
| `url?`             | `string`              | Indicates media URL, can be starts with `'https(s)'` or `'ws(s)'` (WebSocket) |
| `segments?`        | `Array<MediaSegment>` | Optional field for multipart playback, see **MediaSegment** |

If `segments` field exists, transmuxer will treat this `MediaDataSource` as a **multipart** source.

In multipart mode, `duration` `filesize` `url` field in `MediaDataSource` structure will be ignored.

### MediaSegment

| Field       | Type     | Description                              |
| ----------- | -------- | ---------------------------------------- |
| `duration`  | `number` | Required field, indicates segment duration in **milliseconds** |
| `filesize?` | `number` | Optional field, indicates segment file size in bytes |
| `url`       | `string` | Required field, indicates segment file URL |


### Config

| Field                            | Type      | Default                      | Description                              |
| -------------------------------- | --------- | ---------------------------- | ---------------------------------------- |
| `enableWorker?`                  | `boolean` | `false`                      | Enable separated thread (DedicatedWorker) for transmuxing |
| `enableWorkerForMSE?`            | `boolean` | `false`                      | Enable separated thread (DedicatedWorker) for MediaSource |
| `enableStashBuffer?`             | `boolean` | `true`                       | Enable IO stash buffer. Set to false if you need realtime (minimal latency) for live stream playback, but may stalled if there's network jittering. |
| `stashInitialSize?`              | `number`  | `384KB`                      | Indicates IO stash buffer initial size. Default is `384KB`. Indicate a suitable size can improve video load/seek time. |
| `isLive?`                        | `boolean` | `false`                      | Same to `isLive` in **MediaDataSource**, ignored if has been set in MediaDataSource structure. |
| `liveBufferLatencyChasing?`      | `boolean` | `false`                      | Chasing the live stream latency caused by the internal buffer in HTMLMediaElement. `isLive` should also be set to `true` |
| `liveBufferLatencyChasingOnPaused?` | `boolean` | `false`                      | Chasing the live stream latency caused by the internal buffer in HTMLMediaElement even if HTMLMediaElement is paused. Effective only if `isLive: true` and `liveBufferLatencyChasing: true` |
| `liveBufferLatencyMaxLatency?`   | `number`  | `1.5`                        | Maximum acceptable buffer latency in HTMLMediaElement, in seconds. Effective only if `isLive: true` and `liveBufferLatencyChasing: true` |
| `liveBufferLatencyMinRemain?`    | `number`  | `0.5`                        | Minimum buffer latency to be keeped in HTMLMediaElement, in seconds. Effective only if `isLive: true` and `liveBufferLatencyChasing: true` |
| `liveSync?`                      | `boolean` | `false`                      | Chasing the live stream latency caused by the internal buffer in HTMLMediaElement by changing the playbackRate. `isLive` should also be set to `true` |
| `liveSyncMaxLatency?`            | `number`  | `1.2`                        | Maximum acceptable buffer latency in HTMLMediaElement, in seconds. Effective only if `isLive: true` and `liveSync: true` |
| `liveSyncTargetLatency?`         | `number`  | `0.8`                        | Target latency in HTMLMediaElement to be chased to when latency exceeds `liveSyncMaxLatency`, in seconds. Effective only if `isLive: true` and `liveSync: true` |
| `liveSyncPlaybackRate?`          | `number`  | `1.2`                        | PlaybackRate limited between [1, 2] will be used for latency chasing. Effective only if `isLive: true` and `liveSync: true` |
| `lazyLoad?`                      | `boolean` | `true`                       | Abort the http connection if there's enough data for playback. |
| `lazyLoadMaxDuration?`           | `number`  | `3 * 60`                     | Indicates how many seconds of data to be kept for `lazyLoad`. |
| `lazyLoadRecoverDuration?`       | `number`  | `30`                         | Indicates the `lazyLoad` recover time boundary in seconds. |
| `deferLoadAfterSourceOpen?`      | `boolean` | `true`                       | Do load after MediaSource `sourceopen` event triggered. On Chrome, tabs which be opened in background may not trigger `sourceopen` event until switched to that tab. |
| `autoCleanupSourceBuffer`        | `boolean` | `false`                      | Do auto cleanup for SourceBuffer         |
| `autoCleanupMaxBackwardDuration` | `number`  | `3 * 60`                     | When backward buffer duration exceeded this value (in seconds), do auto cleanup for SourceBuffer |
| `autoCleanupMinBackwardDuration` | `number`  | `2 * 60`                     | Indicates the duration in seconds to reserve for backward buffer when doing auto cleanup. |
| `fixAudioTimestampGap`           | `boolean` | `true`                       | Fill silent audio frames to avoid a/v unsync when detect large audio timestamp gap. |
| `accurateSeek?`                  | `boolean` | `false`                      | Accurate seek to any frame, not limited to video IDR frame, but may a bit slower. Available on `Chrome > 50`, `FireFox` and `Safari`. |
| `seekType?`                      | `string`  | `'range'`                    | `'range'` use range request to seek, or `'param'` add params into url to indicate request range. |
| `seekParamStart?`                | `string`  | `'bstart'`                   | Indicates seek start parameter name for `seekType = 'param'` |
| `seekParamEnd?`                  | `string`  | `'bend'`                     | Indicates seek end parameter name for `seekType = 'param'` |
| `rangeLoadZeroStart?`            | `boolean` | `false`                      | Send `Range: bytes=0-` for first time load if use Range seek |
| `customSeekHandler?`             | `object`  | `undefined`                  | Indicates a custom seek handler          |
| `reuseRedirectedURL?`            | `boolean` | `false`                      | Reuse 301/302 redirected url for subsequence request like seek, reconnect, etc. |
| `referrerPolicy?`                | `string`  | `no-referrer-when-downgrade` | Indicates the [Referrer Policy][] when using FetchStreamLoader |
| `headers?`                       | `object`  | `undefined`                  | Indicates additional headers that will be added to request |


[Referrer Policy]: https://w3c.github.io/webappsec-referrer-policy/#referrer-policy

### mpegts.isSupported()
```js
function isSupported(): boolean;
```
Return `true` if basic playback can works on your browser.



### mpegts.getFeatureList()
```js
function getFeatureList(): FeatureList;
```
Return a `FeatureList` object which has following details:
#### FeatureList
| Field                   | Type      | Description                              |
| ----------------------- | --------- | ---------------------------------------- |
| `msePlayback`           | `boolean` | Same to `mpegts.isSupported()`, indicates whether basic playback works on your browser. |
| `mseLivePlayback`       | `boolean` | Indicates whether HTTP MPEG2-TS/FLV live stream can work on your browser. |
| `mseH265Playback`       | `boolean` | Indicates whether H265 over MPEG2-TS/FLV stream can work on your browser. |
| `networkStreamIO`       | `boolean` | Indicates whether the network loader is streaming. |
| `networkLoaderName`     | `string`  | Indicates the network loader type name.  |
| `nativeMP4H264Playback` | `boolean` | Indicates whether your browser support H.264 MP4 video file natively. |
| `nativeMP4H265Playback` | `boolean` | Indicates whether your browser support H.265 MP4 video file natively. |
| `nativeWebmVP8Playback` | `boolean` | Indicates whether your browser support WebM VP8 video file natively. |
| `nativeWebmVP9Playback` | `boolean` | Indicates whether your browser support WebM VP9 video file natively. |



### mpegts.MSEPlayer
```typescript
interface MSEPlayer extends Player {}
```

MSE player which implements the `Player` interface. Can be created by `new` operator directly.

### mpegts.NativePlayer

```typescript
interface NativePlayer extends Player {}
```

Player wrapper for browser's native player (HTMLVideoElement) without MediaSource src, which implements the `Player` interface. Useful for singlepart **MP4** file playback.

### interface Player (abstract)

```typescript
interface Player {
    constructor(mediaDataSource: MediaDataSource, config?: Config): Player;
    destroy(): void;
    on(event: string, listener: Function): void;
    off(event: string, listener: Function): void;
    attachMediaElement(mediaElement: HTMLMediaElement): void;
    detachMediaElement(): void;
    load(): void;
    unload(): void;
    play(): Promise<void>;
    pause(): void;
    type: string;
    buffered: TimeRanges;
    duration: number;
    volume: number;
    muted: boolean;
    currentTime: number;
    mediaInfo: Object;
    statisticsInfo: Object;
}
```

### mpegts.LoggingControl

A global interface which include several static getter/setter to set mpegts.js logcat verbose level.

```typescript
interface LoggingControl {
    forceGlobalTag: boolean;
    globalTag: string;
    enableAll: boolean;
    enableDebug: boolean;
    enableVerbose: boolean;
    enableInfo: boolean;
    enableWarn: boolean;
    enableError: boolean;
    getConfig(): Object;
    applyConfig(config: Object): void;
    addLogListener(listener: Function): void;
    removeLogListener(listener: Function): void;
}
```

### mpegts.Events

A series of constants that can be used with `Player.on()` / `Player.off()`. They require the prefix `mpegts.Events`.

| Event                      | Description                              |
| -------------------------- | ---------------------------------------- |
| ERROR                      | An error occurred by any cause during the playback |
| LOADING_COMPLETE           | The input MediaDataSource has been completely buffered to end |
| RECOVERED_EARLY_EOF        | An unexpected network EOF occurred during buffering but automatically recovered |
| MEDIA_INFO                 | Provides technical information of the media like video/audio codec, bitrate, etc. |
| METADATA_ARRIVED           | Provides metadata which FLV file(stream) can contain with an "onMetaData" marker.  |
| SCRIPTDATA_ARRIVED         | Provides scriptdata (OnCuePoint / OnTextData) which FLV file(stream) can contain. |
| TIMED_ID3_METADATA_ARRIVED | Provides Timed ID3 Metadata packets containing private data (stream_type=0x15) callback |
| PGS_SUBTITLE_ARRIVED       | Provides PGS Subtitle data (stream_type=0x90) callback |
| SYNCHRONOUS_KLV_METADATA_ARRIVED  |  Provides Synchronous KLV Metadata packets containing private data (stream_type=0x15) callback |
| ASYNCHRONOUS_KLV_METADATA_ARRIVED |  Provides Asynchronous KLV Metadata packets containing private data (stream_type=0x06) callback |
| SMPTE2038_METADATA_ARRIVED | Provides SMPTE2038 Metadata packets containing private data callback |
| SCTE35_METADATA_ARRIVED    | Provides SCTE35 Metadata packets containing section (stream_type=0x86) callback |
| PES_PRIVATE_DATA_ARRIVED   | Provides ISO/IEC 13818-1 PES packets containing private data (stream_type=0x06) callback |
| STATISTICS_INFO            | Provides playback statistics information like dropped frames, current speed, etc. |
| DESTROYING                 | Fired when the player begins teardown |

### mpegts.ErrorTypes

The possible errors that can come up during playback. They require the prefix `mpegts.ErrorTypes`.

| Error         | Description                              |
| ------------- | ---------------------------------------- |
| NETWORK_ERROR | Errors related to the network            |
| MEDIA_ERROR   | Errors related to the media (format error, decode issue, etc) |
| OTHER_ERROR   | Any other unspecified error              |


### mpegts.ErrorDetails

Provide more verbose explanation for Network and Media errors. They require the prefix `mpegts.ErrorDetails`.

| Error                           | Description                              |
| ------------------------------- | ---------------------------------------- |
| NETWORK_EXCEPTION               | Related to any other issues with the network; contains a `message` |
| NETWORK_STATUS_CODE_INVALID     | Related to an invalid HTTP status code, such as 403, 404, etc. |
| NETWORK_TIMEOUT                 | Related to timeout request issues        |
| NETWORK_UNRECOVERABLE_EARLY_EOF | Related to unexpected network EOF which cannot be recovered |
| MEDIA_MSE_ERROR                 | Related to MediaSource's error such as decode issue |
| MEDIA_FORMAT_ERROR              | Related to any invalid parameters in the media stream |
| MEDIA_FORMAT_UNSUPPORTED        | The input MediaDataSource format is not supported by mpegts.js |
| MEDIA_CODEC_UNSUPPORTED         | The media stream contains video/audio codec which is not supported |
