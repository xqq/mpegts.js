interface ProgramPmtPidMap {
    [program: number]: number;
}

export class PAT {
    network_pid: number;
    program_pmt_pid: ProgramPmtPidMap = {};
}
