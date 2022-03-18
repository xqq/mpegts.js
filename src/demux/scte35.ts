import ExpGolomb from './exp-golomb.js';

export class SCTE35Data {
    pts?: number
    splice_command_type?: number
    auto_return?: boolean
    duration?: number
    nearest_pts?: number
    data: Uint8Array
}

export enum SCTE35CommandType {
    kSpliceNull = 0x0,
    kSpliceSchedule = 0x4,
    kSpliceInsert = 0x5,
    kTimeSignal = 0x6,
    kBandwidthReservation = 0x07,
    kPrivateCommand = 0xff
}

type SpliceTime = {
    time_specified_flag: boolean,
    pts_time?: number
}

const readSpliceTime = (reader: ExpGolomb): SpliceTime => {
    const time_specified_flag = reader.readBool();
    if (time_specified_flag === false) {
        return { time_specified_flag }
    }
    reader.readBits(6);
    const pts_time = (reader.readBits(31) * 4 + reader.readBits(2))

    return {
        time_specified_flag,
        pts_time
    }
}

type BreakDuration = {
    auto_return: boolean
    duration: number
}

const readBreakDuration = (reader: ExpGolomb): BreakDuration => {
    const auto_return = reader.readBool();
    reader.readBits(6);
    const duration = (reader.readBits(31) * 4 + reader.readBits(2))

    return {
        auto_return,
        duration
    }
}

type SpliceInsert = {
    splice_event_id: number
    splice_event_cancel_indicator: boolean
    out_of_network_indicator?: boolean
    program_splice_flag?: boolean
    duration_flag?: boolean
    splice_immediate_flag?: boolean
    splice_time?: SpliceTime,
    component_count?: number,
    // component
    break_duration?: BreakDuration,
    unique_program_id?: number,
    avail_num?: number,
    avails_expected?: number
}

const readSpliceInsert = (reader: ExpGolomb): SpliceInsert => {
    const splice_event_id = (reader.readBits(31) * 2 + reader.readBits(1))
    const splice_event_cancel_indicator = reader.readBool()
    if (splice_event_cancel_indicator) {
        return { splice_event_id, splice_event_cancel_indicator }
    }
    reader.readBits(7)

    const out_of_network_indicator = reader.readBool()
    const program_splice_flag = reader.readBool()
    const duration_flag = reader.readBool()
    const splice_immediate_flag = reader.readBool()
    reader.readBits(4);

    let splice_time = undefined;
    if (program_splice_flag && !splice_immediate_flag) {
        splice_time = readSpliceTime(reader);
    }

    let component_count = undefined
    if (!program_splice_flag) {
        component_count = reader.readBits(8)
        // TODO: 
    }

    let break_duration = undefined
    if (duration_flag) {
        break_duration = readBreakDuration(reader)
    }

    const unique_program_id = reader.readBits(16)
    const avail_num = reader.readBits(8)
    const avails_expected = reader.readBits(8)
    
    return {
        splice_event_id,
        splice_event_cancel_indicator,
        out_of_network_indicator,
        program_splice_flag,
        duration_flag,
        splice_immediate_flag,
        splice_time,
        component_count,
        // conponent
        break_duration,
        unique_program_id,
        avail_num,
        avails_expected
    };
}

const readTimeSignal = (reader: ExpGolomb): SpliceTime => {
    return readSpliceTime(reader);
}

export const readSCTE35 = (data: Uint8Array): SCTE35Data => {
    const reader = new ExpGolomb(data);
    reader.readBits(24); // for Section Header
    const protocol_version = reader.readBits(8)
    const encrypted_packet = reader.readBool()
    const encryption_algorithm = reader.readBits(6)
    const pts_adjustment = (reader.readBits(31) * 4 + reader.readBits(2))
    const cw_index = reader.readBits(8)
    const tier = reader.readBits(12)
    const splice_command_length = reader.readBits(12)
    const splice_command_type = reader.readBits(8)

    let pts: number | undefined = undefined
    let auto_return: boolean | undefined = undefined
    let duration: number | undefined = undefined
    if (splice_command_type === SCTE35CommandType.kSpliceInsert) {
        const { splice_time, break_duration } = readSpliceInsert(reader);
        if (splice_time != undefined) {
            pts = (pts_adjustment + splice_time.pts_time) % (2 ** 33);
        }
        if (break_duration) {
            auto_return = break_duration.auto_return
            duration = break_duration.duration
        }
    } else if (splice_command_type === SCTE35CommandType.kTimeSignal) {
        const { pts_time } = readTimeSignal(reader);
        if (pts_time != undefined) {
            pts = (pts_adjustment + pts_time) % (2 ** 33);
        }
    }

    return {
        pts,
        splice_command_type,
        auto_return,
        duration,
        data
    }
}