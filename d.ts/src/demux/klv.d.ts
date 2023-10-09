export declare class KLVData {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    access_units: AccessUnit[];
    data: Uint8Array;
    len: number;
}
type AccessUnit = {
    service_id: number;
    sequence_number: number;
    flags: number;
    data: Uint8Array;
};
export declare const klv_parse: (data: Uint8Array) => AccessUnit[];
export {};
