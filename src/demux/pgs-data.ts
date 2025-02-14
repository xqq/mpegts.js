// ISO/IEC 13818-1 PES packets containing private data (stream_type=0x06)
export class PGSData {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    lang: string;
    data: Uint8Array;
    len: number;
}

