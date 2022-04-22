export declare type SCTE35Data = {
    splice_command_type: SCTE35CommandType.kSpliceInsert;
    pts?: number;
    nearest_pts?: number;
    auto_return?: boolean;
    duraiton?: number;
    detail: SCTE35Detail;
    data: Uint8Array;
} | {
    splice_command_type: SCTE35CommandType.kTimeSignal;
    pts?: number;
    nearest_pts?: number;
    detail: SCTE35Detail;
    data: Uint8Array;
} | {
    splice_command_type: SCTE35CommandType.kSpliceNull | SCTE35CommandType.kBandwidthReservation | SCTE35CommandType.kSpliceSchedule | SCTE35CommandType.kPrivateCommand;
    pts: undefined;
    nearest_pts?: number;
    detail: SCTE35Detail;
    data: Uint8Array;
};
declare type SCTE35Detail = {
    table_id: number;
    section_syntax_indicator: boolean;
    private_indicator: boolean;
    section_length: number;
    protocol_version: number;
    encrypted_packet: boolean;
    encryption_algorithm: number;
    pts_adjustment: number;
    cw_index: number;
    tier: number;
    splice_command_length: number;
    splice_command_type: SCTE35CommandType.kSpliceNull;
    splice_command: SpliceNull;
    descriptor_loop_length: number;
    splice_descriptors: SpliceDescriptor[];
    E_CRC32?: number;
    CRC32: number;
} | {
    table_id: number;
    section_syntax_indicator: boolean;
    private_indicator: boolean;
    section_length: number;
    protocol_version: number;
    encrypted_packet: boolean;
    encryption_algorithm: number;
    pts_adjustment: number;
    cw_index: number;
    tier: number;
    splice_command_length: number;
    splice_command_type: SCTE35CommandType.kSpliceSchedule;
    splice_command: SpliceSchedule;
    descriptor_loop_length: number;
    splice_descriptors: SpliceDescriptor[];
    E_CRC32?: number;
    CRC32: number;
} | {
    table_id: number;
    section_syntax_indicator: boolean;
    private_indicator: boolean;
    section_length: number;
    protocol_version: number;
    encrypted_packet: boolean;
    encryption_algorithm: number;
    pts_adjustment: number;
    cw_index: number;
    tier: number;
    splice_command_length: number;
    splice_command_type: SCTE35CommandType.kSpliceInsert;
    splice_command: SpliceInsert;
    descriptor_loop_length: number;
    splice_descriptors: SpliceDescriptor[];
    E_CRC32?: number;
    CRC32: number;
} | {
    table_id: number;
    section_syntax_indicator: boolean;
    private_indicator: boolean;
    section_length: number;
    protocol_version: number;
    encrypted_packet: boolean;
    encryption_algorithm: number;
    pts_adjustment: number;
    cw_index: number;
    tier: number;
    splice_command_length: number;
    splice_command_type: SCTE35CommandType.kTimeSignal;
    splice_command: TimeSignal;
    descriptor_loop_length: number;
    splice_descriptors: SpliceDescriptor[];
    E_CRC32?: number;
    CRC32: number;
} | {
    table_id: number;
    section_syntax_indicator: boolean;
    private_indicator: boolean;
    section_length: number;
    protocol_version: number;
    encrypted_packet: boolean;
    encryption_algorithm: number;
    pts_adjustment: number;
    cw_index: number;
    tier: number;
    splice_command_length: number;
    splice_command_type: SCTE35CommandType.kBandwidthReservation;
    splice_command: BandwidthReservation;
    descriptor_loop_length: number;
    splice_descriptors: SpliceDescriptor[];
    E_CRC32?: number;
    CRC32: number;
} | {
    table_id: number;
    section_syntax_indicator: boolean;
    private_indicator: boolean;
    section_length: number;
    protocol_version: number;
    encrypted_packet: boolean;
    encryption_algorithm: number;
    pts_adjustment: number;
    cw_index: number;
    tier: number;
    splice_command_length: number;
    splice_command_type: SCTE35CommandType.kPrivateCommand;
    splice_command: PrivateCommand;
    descriptor_loop_length: number;
    splice_descriptors: SpliceDescriptor[];
    E_CRC32?: number;
    CRC32: number;
};
export declare enum SCTE35CommandType {
    kSpliceNull = 0,
    kSpliceSchedule = 4,
    kSpliceInsert = 5,
    kTimeSignal = 6,
    kBandwidthReservation = 7,
    kPrivateCommand = 255
}
declare type SpliceTime = {
    time_specified_flag: boolean;
    pts_time?: number;
};
declare type BreakDuration = {
    auto_return: boolean;
    duration: number;
};
declare type SpliceInsertComponent = {
    component_tag: number;
    splice_time?: SpliceTime;
};
declare type SpliceScheduleEventComponent = {
    component_tag: number;
    utc_splice_time: number;
};
declare type SpliceScheduleEvent = {
    splice_event_id: number;
    splice_event_cancel_indicator: boolean;
    out_of_network_indicator?: boolean;
    program_splice_flag?: boolean;
    duration_flag?: boolean;
    utc_splice_time?: number;
    component_count?: number;
    components?: SpliceScheduleEventComponent[];
    break_duration?: BreakDuration;
    unique_program_id?: number;
    avail_num?: number;
    avails_expected?: number;
};
declare type SpliceNull = {};
declare type SpliceSchedule = {
    splice_count: number;
    events: SpliceScheduleEvent[];
};
declare type SpliceInsert = {
    splice_event_id: number;
    splice_event_cancel_indicator: boolean;
    out_of_network_indicator?: boolean;
    program_splice_flag?: boolean;
    duration_flag?: boolean;
    splice_immediate_flag?: boolean;
    splice_time?: SpliceTime;
    component_count?: number;
    components?: SpliceInsertComponent[];
    break_duration?: BreakDuration;
    unique_program_id?: number;
    avail_num?: number;
    avails_expected?: number;
};
declare type TimeSignal = {
    splice_time: SpliceTime;
};
declare type BandwidthReservation = {};
declare type PrivateCommand = {
    identifier: string;
    private_data: ArrayBuffer;
};
declare type Descriptor = {
    descriptor_tag: number;
    descriptor_length: number;
    identifier: string;
};
declare type AvailDescriptor = Descriptor & {
    provider_avail_id: number;
};
declare type DTMFDescriptor = Descriptor & {
    preroll: number;
    dtmf_count: number;
    DTMF_char: string;
};
declare type SegmentationDescriptor = Descriptor & {
    segmentation_event_id: number;
    segmentation_event_cancel_indicator: boolean;
    program_segmentation_flag?: boolean;
    segmentation_duration_flag?: boolean;
    delivery_not_restricted_flag?: boolean;
    web_delivery_allowed_flag?: boolean;
    no_regional_blackout_flag?: boolean;
    archive_allowed_flag?: boolean;
    device_restrictions?: number;
    component_count?: number;
    components?: any[];
    segmentation_duration?: number;
    segmentation_upid_type?: number;
    segmentation_upid_length?: number;
    segmentation_upid?: ArrayBuffer;
    segmentation_type_id?: number;
    segment_num?: number;
    segments_expected?: number;
    sub_segment_num?: number;
    sub_segments_expected?: number;
};
declare type TimeDescriptor = Descriptor & {
    TAI_seconds: number;
    TAI_ns: number;
    UTC_offset: number;
};
declare type AudioDescriptorComponent = {
    component_tag: number;
    ISO_code: string;
    Bit_Stream_Mode: number;
    Num_Channels: number;
    Full_Srvc_Audio: boolean;
};
declare type AudioDescriptor = Descriptor & {
    audio_count: number;
    components: AudioDescriptorComponent[];
};
declare type SpliceDescriptor = AvailDescriptor | DTMFDescriptor | SegmentationDescriptor | TimeDescriptor | AudioDescriptor;
export declare const readSCTE35: (data: Uint8Array) => SCTE35Data;
export {};
