interface ProgramPMTPIDMap {
    [program: number]: number;
}
export declare class PAT {
    version_number: number;
    network_pid: number;
    program_pmt_pid: ProgramPMTPIDMap;
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
interface PIDStreamTypeMap {
    [pid: number]: StreamType;
}
export declare class PMT {
    program_number: number;
    version_number: number;
    pcr_pid: number;
    pid_stream_type: PIDStreamTypeMap;
    common_pids: {
        h264: number | undefined;
        adts_aac: number | undefined;
    };
    pes_private_data_pids: {
        [pid: number]: boolean;
    };
    timed_id3_pids: {
        [pid: number]: boolean;
    };
}
export interface ProgramPMTMap {
    [program: number]: PMT;
}
export {};
