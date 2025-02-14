interface ProgramToPMTPIDMap {
    [program: number]: number;
}

export class PAT {
    version_number: number;
    network_pid: number;
    // program_number -> pmt_pid
    program_pmt_pid: ProgramToPMTPIDMap = {};
}

export enum StreamType {
    kMPEG1Audio = 0x03,
    kMPEG2Audio = 0x04,
    kPESPrivateData = 0x06,
    kADTSAAC = 0x0F,
    kLOASAAC = 0x11,
    kAC3 = 0x81,
    kEAC3 = 0x87,
    kMetadata = 0x15,
    kSCTE35 = 0x86,
    kPGS = 0x90,
    kH264 = 0x1b,
    kH265 = 0x24
}

interface PIDToStreamTypeMap {
    [pid: number]: StreamType;
}

export class PMT {
    program_number: number;
    version_number: number;
    pcr_pid: number;
    // pid -> stream_type
    pid_stream_type: PIDToStreamTypeMap = {};

    common_pids: {
        h264: number | undefined,
        h265: number | undefined,
        av1: number | undefined,
        adts_aac: number | undefined,
        loas_aac: number | undefined,
        opus: number | undefined,
        ac3: number | undefined,
        eac3: number | undefined,
        mp3: number | undefined
    } = {
        h264: undefined,
        h265: undefined,
        av1: undefined,
        adts_aac: undefined,
        loas_aac: undefined,
        opus: undefined,
        ac3: undefined,
        eac3: undefined,
        mp3: undefined
    };

    pes_private_data_pids: {
        [pid: number]: boolean
    } = {};

    timed_id3_pids: {
        [pid: number]: boolean
    } = {};

    pgs_pids: {
        [pid: number]: boolean;
    } = {};
    pgs_langs: {
        [pid: number]: string;
    } = {};

    synchronous_klv_pids: {
        [pid: number]: boolean
    } = {};

    asynchronous_klv_pids: {
        [pid: number]: boolean
    } = {};

    scte_35_pids: {
        [pid: number]: boolean
    } = {};

    smpte2038_pids: {
        [oid: number]: boolean
    } = {};
}

export interface ProgramToPMTMap {
    [program: number]: PMT;
}

export class PESData {
    pid: number;
    data: Uint8Array;
    stream_type: StreamType;
    file_position: number;
    random_access_indicator: number;
}

export class SectionData {
    pid: number;
    data: Uint8Array;
    file_position: number;
    random_access_indicator: number;
}

export class SliceQueue {
    slices: Uint8Array[] = [];
    total_length: number = 0;
    expected_length: number = 0;
    file_position: number = 0;
    random_access_indicator: 0;
}

export interface PIDToSliceQueues {
    [pid: number]: SliceQueue;
}
