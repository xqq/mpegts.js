declare class SeekingHandler {
    private readonly TAG;
    private _config;
    private _media_element;
    private _always_seek_keyframe;
    private _on_unbuffered_seek;
    private _request_set_current_time;
    private _seek_request_record_clocktime?;
    private _idr_sample_list;
    private e?;
    constructor(config: any, media_element: HTMLMediaElement, on_unbuffered_seek: (milliseconds: number) => void);
    destroy(): void;
    seek(seconds: number): void;
    directSeek(seconds: number): void;
    appendSyncPoints(syncpoints: any[]): void;
    private _onMediaSeeking;
    private _pollAndApplyUnbufferedSeek;
    private _isPositionBuffered;
    private _getNearestKeyframe;
    private static _getClockTime;
}
export default SeekingHandler;
