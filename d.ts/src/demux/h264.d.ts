export declare enum H264NaluType {
    kUnspecified = 0,
    kSliceNonIDR = 1,
    kSliceDPA = 2,
    kSliceDPB = 3,
    kSliceDPC = 4,
    kSliceIDR = 5,
    kSliceSEI = 6,
    kSliceSPS = 7,
    kSlicePPS = 8,
    kSliceAUD = 9,
    kEndOfSequence = 10,
    kEndOfStream = 11,
    kFiller = 12,
    kSPSExt = 13,
    kReserved0 = 14
}
export declare class H264NaluPayload {
    type: H264NaluType;
    data: Uint8Array;
}
export declare class H264NaluAVC1 {
    type: H264NaluType;
    data: Uint8Array;
    constructor(nalu: H264NaluPayload);
}
export declare class H264AnnexBParser {
    private readonly TAG;
    private data_;
    private current_startcode_offset_;
    private eof_flag_;
    constructor(data: Uint8Array);
    private findNextStartCodeOffset;
    readNextNaluPayload(): H264NaluPayload | null;
}
export declare class AVCDecoderConfigurationRecord {
    private data;
    constructor(sps: Uint8Array, pps: Uint8Array, sps_details: any);
    getData(): Uint8Array;
}
