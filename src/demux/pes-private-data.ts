// ISO/IEC 13818-1 PES packets containing private data (stream_type=0x06)
export class PESPrivateData {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    nearest_pts?: number;
    data: Uint8Array;
    len: number;
}

export class PESPrivateDataDescriptor {
    pid: number;
    stream_type: number;
    descriptor: Uint8Array;
}
