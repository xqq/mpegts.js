export default MozChunkedLoader;
declare class MozChunkedLoader extends BaseLoader {
    static isSupported(): boolean;
    constructor(seekHandler: any, config: any);
    TAG: string;
    _seekHandler: any;
    _config: any;
    _xhr: XMLHttpRequest | null;
    _requestAbort: boolean;
    _contentLength: any;
    _receivedLength: number;
    _dataSource: any;
    _range: any;
    _requestURL: any;
    _onReadyStateChange(e: any): void;
    _onProgress(e: any): void;
    _onLoadEnd(e: any): void;
    _onXhrError(e: any): void;
}
import { BaseLoader } from './loader.js';
