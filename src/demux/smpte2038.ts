import ExpGolomb from "./exp-golomb";

export class SMPTE2038Data {
    pid: number;
    stream_id: number;
    pts?: number;
    dts?: number;
    nearest_pts?: number;
    ancillaries: AncillaryData[];
    data: Uint8Array;
    len: number;
}

type AncillaryData = {
    yc_indicator: boolean;
    line_number: number;
    horizontal_offset: number;
    did: number;
    sdid: number;
    user_data: Uint8Array;
    description: string;
    information: any;
}


export const smpte2038parse = (data: Uint8Array) => {
    let gb = new ExpGolomb(data);
    let readBits = 0;

    let ancillaries: AncillaryData[] = [];
    while (true) {
        let zero = gb.readBits(6); readBits += 6;
        if (zero !== 0) { break; }
        let YC_indicator = gb.readBool(); readBits += 1;
        let line_number = gb.readBits(11); readBits += 11;
        let horizontal_offset = gb.readBits(12); readBits += 12;
        let data_ID = gb.readBits(10) & 0xFF; readBits += 10;
        let data_SDID = gb.readBits(10) & 0xFF; readBits += 10;
        let data_count = gb.readBits(10) & 0xFF; readBits += 10;
        let user_data = new Uint8Array(data_count);
        for (let i = 0; i < data_count; i++) {
            let user_data_word = gb.readBits(10) & 0xFF; readBits += 10;
            user_data[i] = user_data_word;
        }
        let checksum_word = gb.readBits(10); readBits += 10;

        let description = 'User Defined';
        let information: any = {};
        if (data_ID === 0x41) {
            if (data_SDID === 0x07) {
                description = 'SCTE-104'
            }
        } else if (data_ID === 0x5F) {
            if (data_SDID === 0xDC) {
                description = 'ARIB STD-B37 (1SEG)';
            } else if (data_SDID === 0xDD) {
                description = 'ARIB STD-B37 (ANALOG)';
            } else if (data_SDID === 0xDE) {
                description = 'ARIB STD-B37 (SD)';
            } else if (data_SDID === 0xDF) {
                description = 'ARIB STD-B37 (HD)';
            }
        } else if (data_ID === 0x61) {
            if (data_SDID === 0x01) {
                description = 'EIA-708';
            } else if (data_SDID === 0x02) {
                description = 'EIA-608';
            }
        }

        ancillaries.push({
            yc_indicator: YC_indicator,
            line_number,
            horizontal_offset,
            did: data_ID,
            sdid: data_SDID,
            user_data,
            description,
            information
        });
        gb.readBits(8 - (readBits - Math.floor(readBits / 8)) % 8);
        readBits += (8 - (readBits - Math.floor(readBits / 8))) % 8;
    }

    gb.destroy();
    gb = null;

    return ancillaries;
}