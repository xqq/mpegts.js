export interface SEIData {
    type: number;
    size: number;
    uuid?: Uint8Array;
    user_data?: Uint8Array;
    pts?: number;
}
export declare function parseSEI(data: Uint8Array, pts?: number, codec?: 'h264' | 'h265'): SEIData | null;
