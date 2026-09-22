export default FetchStreamLoader;
declare class FetchStreamLoader extends BaseLoader {
    static isSupported(): boolean;
    constructor(seekHandler: any, config: any);
    TAG: string;
    _seekHandler: any;
    _config: any;
    _requestAbort: boolean;
    _abortController: AbortController | null;
    _contentLength: number | null;
    _receivedLength: number;
    _dataSource: any;
    _range: any;
    _pump(reader: any): any;
}
import { BaseLoader } from './loader.js';
