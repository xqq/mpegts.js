export default Log;
declare class Log {
    static e(tag: any, msg: any): void;
    static i(tag: any, msg: any): void;
    static w(tag: any, msg: any): void;
    static d(tag: any, msg: any): void;
    static v(tag: any, msg: any): void;
}
declare namespace Log {
    let GLOBAL_TAG: string;
    let FORCE_GLOBAL_TAG: boolean;
    let ENABLE_ERROR: boolean;
    let ENABLE_INFO: boolean;
    let ENABLE_WARN: boolean;
    let ENABLE_DEBUG: boolean;
    let ENABLE_VERBOSE: boolean;
    let ENABLE_CALLBACK: boolean;
    let emitter: EventEmitter<any>;
}
import EventEmitter from 'events';
