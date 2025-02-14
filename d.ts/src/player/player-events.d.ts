declare enum PlayerEvents {
    ERROR = "error",
    LOADING_COMPLETE = "loading_complete",
    RECOVERED_EARLY_EOF = "recovered_early_eof",
    MEDIA_INFO = "media_info",
    METADATA_ARRIVED = "metadata_arrived",
    SCRIPTDATA_ARRIVED = "scriptdata_arrived",
    TIMED_ID3_METADATA_ARRIVED = "timed_id3_metadata_arrived",
    PGS_SUBTITLE_ARRIVED = "pgs_subtitle_arrived",
    SYNCHRONOUS_KLV_METADATA_ARRIVED = "synchronous_klv_metadata_arrived",
    ASYNCHRONOUS_KLV_METADATA_ARRIVED = "asynchronous_klv_metadata_arrived",
    SMPTE2038_METADATA_ARRIVED = "smpte2038_metadata_arrived",
    SCTE35_METADATA_ARRIVED = "scte35_metadata_arrived",
    PES_PRIVATE_DATA_DESCRIPTOR = "pes_private_data_descriptor",
    PES_PRIVATE_DATA_ARRIVED = "pes_private_data_arrived",
    STATISTICS_INFO = "statistics_info",
    DESTROYING = "destroying"
}
export default PlayerEvents;
