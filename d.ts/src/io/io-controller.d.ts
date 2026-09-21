export default IOController;
/**
 * DataSource: {
 *     url: string,
 *     filesize: number,
 *     cors: boolean,
 *     withCredentials: boolean
 * }
 *
 */
declare class IOController {
    constructor(dataSource: any, config: any, extraData: any);
    TAG: string;
    _config: any;
    _extraData: any;
    _stashInitialSize: any;
    _stashUsed: number;
    _stashSize: any;
    _bufferSize: number;
    _stashBuffer: ArrayBuffer;
    _stashByteStart: number;
    _enableStash: boolean;
    _loader: any;
    _loaderClass: any;
    _seekHandler: any;
    _dataSource: any;
    _isWebSocketURL: boolean;
    _refTotalLength: any;
    _totalLength: any;
    _fullRequestFlag: boolean;
    _currentRange: {
        from: number;
        to: number;
    } | {
        from: any;
        to: number;
    } | null;
    _redirectedURL: any;
    _speedNormalized: number;
    _speedSampler: SpeedSampler;
    _speedNormalizeList: number[];
    _isEarlyEofReconnecting: boolean;
    _paused: boolean;
    _resumeFrom: number;
    _onDataArrival: any;
    _onSeeked: any;
    _onError: any;
    _onComplete: any;
    _onRedirect: any;
    _onRecoveredEarlyEof: any;
    destroy(): void;
    isWorking(): any;
    isPaused(): boolean;
    get status(): any;
    set extraData(data: any);
    get extraData(): any;
    set onDataArrival(callback: any);
    get onDataArrival(): any;
    set onSeeked(callback: any);
    get onSeeked(): any;
    set onError(callback: any);
    get onError(): any;
    set onComplete(callback: any);
    get onComplete(): any;
    set onRedirect(callback: any);
    get onRedirect(): any;
    set onRecoveredEarlyEof(callback: any);
    get onRecoveredEarlyEof(): any;
    get currentURL(): any;
    get hasRedirect(): boolean;
    get currentRedirectedURL(): any;
    get currentSpeed(): any;
    get loaderType(): any;
    _selectSeekHandler(): void;
    _selectLoader(): void;
    _createLoader(): void;
    open(optionalFrom: any): void;
    abort(): void;
    pause(): void;
    resume(): void;
    seek(bytes: any): void;
    /**
     * When seeking request is from media seeking, unconsumed stash data should be dropped
     * However, stash data shouldn't be dropped if seeking requested from http reconnection
     *
     * @dropUnconsumed: Ignore and discard all unconsumed data in stash buffer
     */
    _internalSeek(bytes: any, dropUnconsumed: any): void;
    updateUrl(url: any): void;
    _expandBuffer(expectedBytes: any): void;
    _normalizeSpeed(input: any): number | undefined;
    _adjustStashSize(normalized: any): void;
    _dispatchChunks(chunks: any, byteStart: any): any;
    _onURLRedirect(redirectedURL: any): void;
    _onContentLengthKnown(contentLength: any): void;
    _onLoaderChunkArrival(chunk: any, byteStart: any, receivedLength: any): void;
    _flushStashBuffer(dropUnconsumed: any): number;
    _onLoaderComplete(from: any, to: any): void;
    _onLoaderError(type: any, data: any): void;
}
import SpeedSampler from './speed-sampler.js';
