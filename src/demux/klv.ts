export class KLVData {
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
}

export const klv_parse = (data: Uint8Array) => {
    let result: AccessUnit[] = [];

    let offset = 0;
    while (offset + 5 < data.byteLength) {
        let service_id = data[offset + 0];
        let sequence_number = data[offset + 1];
        let flags = data[offset + 2];
        let au_size = (data[offset + 3] << 8) | (data[offset + 4] << 0);
        let au_data = data.slice(offset + 5, offset + 5 + au_size);

        result.push({
            service_id,
            sequence_number,
            flags,
            data: au_data
        });

        offset += 5 + au_size;
    }

    return result;
}