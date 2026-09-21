export default WebSocketLoader;
declare class WebSocketLoader extends BaseLoader {
    static isSupported(): boolean;
    constructor();
    TAG: string;
    _ws: WebSocket | null;
    _requestAbort: boolean;
    _receivedLength: number;
    open(dataSource: any): void;
    _onWebSocketOpen(e: any): void;
    _onWebSocketClose(e: any): void;
    _onWebSocketMessage(e: any): void;
    _dispatchArrayBuffer(arraybuffer: any): void;
    _onWebSocketError(e: any): void;
}
import { BaseLoader } from './loader.js';
