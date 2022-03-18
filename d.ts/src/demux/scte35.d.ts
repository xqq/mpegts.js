export declare class SCTE35Data {
    pts?: number;
    splice_command_type?: number;
    auto_return?: boolean;
    duration?: number;
    nearest_pts?: number;
    data: Uint8Array;
}
export declare enum SCTE35CommandType {
    kSpliceNull = 0,
    kSpliceSchedule = 4,
    kSpliceInsert = 5,
    kTimeSignal = 6,
    kBandwidthReservation = 7,
    kPrivateCommand = 255
}
export declare const readSCTE35: (data: Uint8Array) => SCTE35Data;
