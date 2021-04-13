export declare class PESPrivateData {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    nearest_pts?: number;
    data: Uint8Array;
    len: number;
}
export declare class PESPrivateDataDescriptor {
    pid: number;
    stream_type: number;
    descriptor: Uint8Array;
}
