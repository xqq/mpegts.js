export declare type WorkerCommandOp = 'logging_config' | 'init' | 'destroy' | 'initialize_mse' | 'shutdown_mse' | 'load' | 'unload' | 'unbuffered_seek' | 'timeupdate' | 'readystatechange' | 'pause_transmuxer' | 'resume_transmuxer';
export declare type WorkerCommandPacket = {
    cmd: WorkerCommandOp;
};
export declare type WorkerCommandPacketInit = WorkerCommandPacket & {
    cmd: 'init';
    media_data_source: any;
    config: any;
};
export declare type WorkerCommandPacketLoggingConfig = WorkerCommandPacket & {
    cmd: 'logging_config';
    logging_config: any;
};
export declare type WorkerCommandPacketUnbufferedSeek = WorkerCommandPacket & {
    cmd: 'unbuffered_seek';
    milliseconds: number;
};
export declare type WorkerCommandPacketTimeUpdate = WorkerCommandPacket & {
    cmd: 'timeupdate';
    current_time: number;
};
export declare type WorkerCommandPacketReadyStateChange = WorkerCommandPacket & {
    cmd: 'readystatechange';
    ready_state: number;
};
