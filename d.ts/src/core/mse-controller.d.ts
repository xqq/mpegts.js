export default MSEController;
declare class MSEController {
    constructor(config: any);
    TAG: string;
    _config: any;
    _emitter: EventEmitter<any>;
    e: {
        onSourceOpen: () => void;
        onSourceEnded: () => void;
        onSourceClose: () => void;
        onStartStreaming: () => void;
        onEndStreaming: () => void;
        onQualityChange: () => void;
        onSourceBufferError: (e: any) => void;
        onSourceBufferUpdateEnd: () => void;
    };
    _useManagedMediaSource: boolean;
    _mediaSource: any;
    _mediaSourceObjectURL: string | null;
    _mediaElementProxy: any;
    _isBufferFull: boolean;
    _hasPendingEos: boolean;
    _requireSetMediaDuration: boolean;
    _pendingMediaDuration: number;
    _pendingSourceBufferInit: any[];
    _mimeTypes: {
        video: null;
        audio: null;
    };
    _sourceBuffers: {
        video: null;
        audio: null;
    };
    _lastInitSegments: {
        video: null;
        audio: null;
    };
    _pendingSegments: {
        video: never[];
        audio: never[];
    };
    _pendingRemoveRanges: {
        video: never[];
        audio: never[];
    };
    destroy(): void;
    on(event: any, listener: any): void;
    off(event: any, listener: any): void;
    initialize(mediaElementProxy: any): void;
    shutdown(): void;
    isManagedMediaSource(): boolean;
    getObject(): any;
    getHandle(): any;
    getObjectURL(): string;
    revokeObjectURL(): void;
    appendInitSegment(initSegment: any, deferred?: undefined): void;
    appendMediaSegment(mediaSegment: any): void;
    flush(): void;
    endOfStream(): void;
    _needCleanupSourceBuffer(): boolean;
    _doCleanupSourceBuffer(): void;
    _updateMediaSourceDuration(): void;
    _doRemoveRanges(): void;
    _doAppendSegments(): void;
    _onSourceOpen(): void;
    _onStartStreaming(): void;
    _onEndStreaming(): void;
    _onQualityChange(): void;
    _onSourceEnded(): void;
    _onSourceClose(): void;
    _hasPendingSegments(): boolean;
    _hasPendingRemoveRanges(): boolean;
    _onSourceBufferUpdateEnd(): void;
    _onSourceBufferError(e: any): void;
}
import EventEmitter from 'events';
