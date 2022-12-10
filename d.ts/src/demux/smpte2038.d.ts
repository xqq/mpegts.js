export declare class SMPTE2038Data {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    nearest_pts?: number;
    ancillaries: AncillaryData[];
    data: Uint8Array;
    len: number;
}
declare type AncillaryData = {
    yc_indicator: boolean;
    line_number: number;
    horizontal_offset: number;
    did: number;
    sdid: number;
    user_data: Uint8Array;
    description: string;
    information: any;
};
export declare const smpte2038parse: (data: Uint8Array) => AncillaryData[];
export {};
