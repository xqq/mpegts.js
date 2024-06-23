export declare class AV1OBUInMpegTsParser {
    private readonly TAG;
    private data_;
    private current_startcode_offset_;
    private eof_flag_;
    static _ebsp2rbsp(uint8array: Uint8Array): Uint8Array;
    constructor(data: Uint8Array);
    private findNextStartCodeOffset;
    readNextOBUPayload(): Uint8Array | null;
}
export default AV1OBUInMpegTsParser;
