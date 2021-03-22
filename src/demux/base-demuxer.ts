import MediaInfo from '../core/media-info';
import { PESPrivateData } from './pes-private-data';

type OnErrorCallback = (type: string, info: string) => void;
type OnMediaInfoCallback = (mediaInfo: MediaInfo) => void;
type OnMetaDataArrivedCallback = (metadata: any) => void;
type OnTrackMetadataCallback = (type: string, metadata: any) => void;
type OnDataAvailableCallback = (videoTrack: any, audioTrack: any) => void;
type OnPESPrivateDataCallback = (private_data: PESPrivateData) => void;

export default abstract class BaseDemuxer {

    public onError: OnErrorCallback;
    public onMediaInfo: OnMediaInfoCallback;
    public onMetaDataArrived: OnMetaDataArrivedCallback;
    public onTrackMetadata: OnTrackMetadataCallback;
    public onDataAvailable: OnDataAvailableCallback;
    public onPESPrivateData: OnPESPrivateDataCallback;

    public constructor() {}

    public destroy(): void {
        this.onError = null;
        this.onMediaInfo = null;
        this.onMetaDataArrived = null;
        this.onTrackMetadata = null;
        this.onDataAvailable = null;
        this.onPESPrivateData = null;
    }

    abstract parseChunks(chunk: ArrayBuffer, byteStart: number): number;

}
