export default Transmuxer;
declare class Transmuxer {
    constructor(mediaDataSource: any, config: any);
    TAG: string;
    _emitter: EventEmitter<any>;
    /** @type {Blob | Worker | null | undefined} */
    _worker: Blob | Worker | null | undefined;
    _workerDestroying: boolean | undefined;
    e: {
        onLoggingConfigChanged: (config: any) => void;
    } | undefined;
    _controller: TransmuxingController | undefined;
    destroy(): void;
    on(event: any, listener: any): void;
    off(event: any, listener: any): void;
    hasWorker(): boolean;
    open(): void;
    close(): void;
    seek(milliseconds: any): void;
    pause(): void;
    resume(): void;
    _onInitSegment(type: any, initSegment: any): void;
    _onMediaSegment(type: any, mediaSegment: any): void;
    _onLoadingComplete(): void;
    _onRecoveredEarlyEof(): void;
    _onMediaInfo(mediaInfo: any): void;
    _onMetaDataArrived(metadata: any): void;
    _onScriptDataArrived(data: any): void;
    _onTimedID3MetadataArrived(data: any): void;
    _onPGSSubtitleArrived(data: any): void;
    _onSynchronousKLVMetadataArrived(data: any): void;
    _onAsynchronousKLVMetadataArrived(data: any): void;
    _onSMPTE2038MetadataArrived(data: any): void;
    _onSEIArrived(data: any): void;
    _onSCTE35MetadataArrived(data: any): void;
    _onPESPrivateDataDescriptor(data: any): void;
    _onPESPrivateDataArrived(data: any): void;
    _onStatisticsInfo(statisticsInfo: any): void;
    _onIOError(type: any, info: any): void;
    _onDemuxError(type: any, info: any): void;
    _onRecommendSeekpoint(milliseconds: any): void;
    _onG711AudioData(pcmaData: any, dts: any, channelCount: any): void;
    _onLoggingConfigChanged(config: any): void;
    _onWorkerMessage(e: any): void;
}
import EventEmitter from 'events';
import TransmuxingController from './transmuxing-controller.js';
