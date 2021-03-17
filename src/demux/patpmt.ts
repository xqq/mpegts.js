interface ProgramPMTPIDMap {
    [program: number]: number;
}

export class PAT {
    version_number: number;
    network_pid: number;
    // program_number -> pmt_pid
    program_pmt_pid: ProgramPMTPIDMap = {};
}

export enum StreamType {
    kMPEG1Audio = 0x03,
    kMPEG2Audio = 0x04,
    kPESPrivateData = 0x06,
    kADTSAAC = 0x0F,
    kID3 = 0x15,
    kH264 = 0x1b,
    kH265 = 0x24
}

interface PIDStreamTypeMap {
    [pid: number]: StreamType;
}

export class PMT {
    program_number: number;
    version_number: number;
    pcr_pid: number;
    // pid -> stream_type
    pid_stream_type: PIDStreamTypeMap = {};
}

export interface ProgramPMTMap {
    [program: number]: PMT;
}
