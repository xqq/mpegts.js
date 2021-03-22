import MediaInfo from '../core/media-info';
import { PESPrivateData } from './pes-private-data';
declare type OnErrorCallback = (type: string, info: string) => void;
declare type OnMediaInfoCallback = (mediaInfo: MediaInfo) => void;
declare type OnMetaDataArrivedCallback = (metadata: any) => void;
declare type OnTrackMetadataCallback = (type: string, metadata: any) => void;
declare type OnDataAvailableCallback = (videoTrack: any, audioTrack: any) => void;
declare type OnPESPrivateDataCallback = (private_data: PESPrivateData) => void;
export default abstract class BaseDemuxer {
    onError: OnErrorCallback;
    onMediaInfo: OnMediaInfoCallback;
    onMetaDataArrived: OnMetaDataArrivedCallback;
    onTrackMetadata: OnTrackMetadataCallback;
    onDataAvailable: OnDataAvailableCallback;
    onPESPrivateData: OnPESPrivateDataCallback;
    constructor();
    destroy(): void;
    abstract parseChunks(chunk: ArrayBuffer, byteStart: number): number;
}
export {};
