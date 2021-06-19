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
    kID3 = 21,
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
        adts_aac: number | undefined;
    };
    pes_private_data_pids: {
        [pid: number]: boolean;
    };
    pes_timed_id3_pids: {
        [pid: number]: boolean;
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
export declare class PESSliceQueue {
    slices: Uint8Array[];
    total_length: number;
    file_position: number;
    random_access_indicator: 0;
}
export interface PIDToPESSliceQueues {
    [pid: number]: PESSliceQueue;
}
export {};
