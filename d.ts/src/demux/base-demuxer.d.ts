import MediaInfo from '../core/media-info';
import { PESPrivateData, PESPrivateDataDescriptor } from './pes-private-data';
import { SMPTE2038Data } from './smpte2038';
import { SCTE35Data } from './scte35';
import { KLVData } from './klv';
import { PGSData } from './pgs-data';
type OnErrorCallback = (type: string, info: string) => void;
type OnMediaInfoCallback = (mediaInfo: MediaInfo) => void;
type OnMetaDataArrivedCallback = (metadata: any) => void;
type OnTrackMetadataCallback = (type: string, metadata: any) => void;
type OnDataAvailableCallback = (audioTrack: any, videoTrack: any) => void;
type OnTimedID3MetadataCallback = (timed_id3_data: PESPrivateData) => void;
type onPGSSubitleDataCallback = (pgs_data: PGSData) => void;
type OnSynchronousKLVMetadataCallback = (synchronous_klv_data: KLVData) => void;
type OnAsynchronousKLVMetadataCallback = (asynchronous_klv_data: PESPrivateData) => void;
type OnSMPTE2038MetadataCallback = (smpte2038_data: SMPTE2038Data) => void;
type OnSCTE35MetadataCallback = (scte35_data: SCTE35Data) => void;
type OnPESPrivateDataCallback = (private_data: PESPrivateData) => void;
type OnPESPrivateDataDescriptorCallback = (private_data_descriptor: PESPrivateDataDescriptor) => void;
export default abstract class BaseDemuxer {
    onError: OnErrorCallback;
    onMediaInfo: OnMediaInfoCallback;
    onMetaDataArrived: OnMetaDataArrivedCallback;
    onTrackMetadata: OnTrackMetadataCallback;
    onDataAvailable: OnDataAvailableCallback;
    onTimedID3Metadata: OnTimedID3MetadataCallback;
    onPGSSubtitleData: onPGSSubitleDataCallback;
    onSynchronousKLVMetadata: OnSynchronousKLVMetadataCallback;
    onAsynchronousKLVMetadata: OnAsynchronousKLVMetadataCallback;
    onSMPTE2038Metadata: OnSMPTE2038MetadataCallback;
    onSCTE35Metadata: OnSCTE35MetadataCallback;
    onPESPrivateData: OnPESPrivateDataCallback;
    onPESPrivateDataDescriptor: OnPESPrivateDataDescriptorCallback;
    constructor();
    destroy(): void;
    abstract parseChunks(chunk: ArrayBuffer, byteStart: number): number;
}
export {};
