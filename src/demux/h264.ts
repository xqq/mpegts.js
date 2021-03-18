import Log from "../utils/logger";

export enum H264NaluType {
    kUnspecified = 0,
	kSliceNonIDR,
	kSliceDPA,
	kSliceDPB,
	kSliceDPC,
	kSliceIDR,
	kSliceSEI,
	kSliceSPS,
	kSlicePPS,
	kSliceAUD,
	kEndOfSequence,
	kEndOfStream,
	kFiller,
	kSPSExt,
	kReserved0
}

export class H264NaluPayload {
    type: H264NaluType;
    data: Uint8Array;
}

export class H264NaluAVC1 {
    type: H264NaluType;
    data: Uint8Array;

    constructor(nalu: H264NaluPayload) {
        let nalu_size = nalu.data.byteLength;

        this.type = nalu.type;
        this.data = new Uint8Array(4 + nalu_size);  // 4 byte length-header + nalu payload

        let v = new DataView(this.data);
        // Fill 4 byte length-header
        v.setUint32(0, nalu_size);
        // Copy payload
        this.data.set(nalu.data, 4);
    }
}

export class H264AnnexBParser {

    private readonly TAG: string = "H264AnnexBParser";

    private data_: Uint8Array;
    private current_startcode_offset_: number = 0;
    private eof_flag_: boolean = false;

    public constructor(data: Uint8Array) {
        this.data_ = data;
        this.current_startcode_offset_ = this.findNextStartCodeOffset(0);
        if (this.eof_flag_) {
            Log.e(this.TAG, "Could not found H264 startcode until payload end!");
        }
    }

    private findNextStartCodeOffset(start_offset: number) {
        let i = start_offset;
        let data = this.data_;

        while (true) {
            if (i + 3 >= data.byteLength) {
                this.eof_flag_ = true;
                return data.byteLength;
            }

            // search 00 00 00 01 or 00 00 01
            let uint32 = (data[i + 0] << 24)
                        | (data[i + 1] << 16)
                        | (data[i + 2] << 8)
                        | (data[i + 3]);
            let uint24 = (data[i + 0] << 24)
                        | (data[i + 1] << 16)
                        | (data[i + 2] << 8);
            if (uint32 === 0x00000001 || uint24 === 0x000001) {
                return i;
            } else {
                i++;
            }
        }
    }

    public readNextNaluPayload(): H264NaluPayload | null {
        let data = this.data_;
        let nalu_payload: H264NaluPayload = null;

        while (nalu_payload == null) {
            if (this.eof_flag_) {
                break;
            }
            // offset pointed to start code
            let startcode_offset = this.current_startcode_offset_;

            // nalu payload start offset
            let offset = startcode_offset;
            let u32 = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | (data[offset + 3]);
            if (u32 === 0x00000001) {
                offset += 4;
            } else {
                offset += 3;
            }

            let nalu_type: H264NaluType = data[offset] & 0x1F;
            let forbidden_bit = (data[offset] & 0x80) >>> 7;

            let next_startcode_offset = this.findNextStartCodeOffset(offset);
            this.current_startcode_offset_ = next_startcode_offset;

            if (nalu_type >= H264NaluType.kReserved0) {
                continue;
            }
            if (forbidden_bit !== 0) {
                Log.e(this.TAG, `forbidden_bit near offset ${offset} should be 0 but has value ${forbidden_bit}`);
                continue;
            }

            let payload_data = data.subarray(offset, next_startcode_offset);

            nalu_payload = new H264NaluPayload();
            nalu_payload.type = nalu_type;
            nalu_payload.data = payload_data;
        }

        return nalu_payload;
    }

}
