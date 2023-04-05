interface ProgramToPMTPIDMap {
    [program: number]: number;
}
export declare class PAT {
    version_number: number;
    network_pid: number;
    program_pmt_pid: ProgramToPMTPIDMap;
}
export declare enum StreamType {
    kMPEG1Audio = 3,
    kMPEG2Audio = 4,
    kPESPrivateData = 6,
    kADTSAAC = 15,
    kLOASAAC = 17,
    kAC3 = 129,
    kID3 = 21,
    kSCTE35 = 134,
    kH264 = 27,
    kH265 = 36
}
interface PIDToStreamTypeMap {
    [pid: number]: StreamType;
}
export declare class PMT {
    program_number: number;
    version_number: number;
    pcr_pid: number;
    pid_stream_type: PIDToStreamTypeMap;
    common_pids: {
        h264: number | undefined;
        h265: number | undefined;
        adts_aac: number | undefined;
        loas_aac: number | undefined;
        opus: number | undefined;
        ac3: number | undefined;
        mp3: number | undefined;
    };
    pes_private_data_pids: {
        [pid: number]: boolean;
    };
    timed_id3_pids: {
        [pid: number]: boolean;
    };
    scte_35_pids: {
        [pid: number]: boolean;
    };
    smpte2038_pids: {
        [oid: number]: boolean;
    };
}
export interface ProgramToPMTMap {
    [program: number]: PMT;
}
export declare class PESData {
    pid: number;
    data: Uint8Array;
    stream_type: StreamType;
    file_position: number;
    random_access_indicator: number;
}
export declare class SectionData {
    pid: number;
    data: Uint8Array;
    file_position: number;
    random_access_indicator: number;
}
export declare class SliceQueue {
    slices: Uint8Array[];
    total_length: number;
    expected_length: number;
    file_position: number;
    random_access_indicator: 0;
}
export interface PIDToSliceQueues {
    [pid: number]: SliceQueue;
}
export {};
