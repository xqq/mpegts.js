export default LoggingControl;
declare class LoggingControl {
    static set forceGlobalTag(enable: boolean);
    static get forceGlobalTag(): boolean;
    static set globalTag(tag: string);
    static get globalTag(): string;
    static set enableAll(enable: boolean);
    static get enableAll(): boolean;
    static set enableDebug(enable: boolean);
    static get enableDebug(): boolean;
    static set enableVerbose(enable: boolean);
    static get enableVerbose(): boolean;
    static set enableInfo(enable: boolean);
    static get enableInfo(): boolean;
    static set enableWarn(enable: boolean);
    static get enableWarn(): boolean;
    static set enableError(enable: boolean);
    static get enableError(): boolean;
    static getConfig(): {
        globalTag: string;
        forceGlobalTag: boolean;
        enableVerbose: boolean;
        enableDebug: boolean;
        enableInfo: boolean;
        enableWarn: boolean;
        enableError: boolean;
        enableCallback: boolean;
    };
    static applyConfig(config: any): void;
    static _notifyChange(): void;
    static registerListener(listener: any): void;
    static removeListener(listener: any): void;
    static addLogListener(listener: any): void;
    static removeLogListener(listener: any): void;
}
declare namespace LoggingControl {
    let emitter: EventEmitter<any>;
}
import EventEmitter from 'events';
