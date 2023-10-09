declare class LoadingController {
    private readonly TAG;
    private _config;
    private _media_element;
    private _on_pause_transmuxer;
    private _on_resume_transmuxer;
    private _paused;
    private e?;
    constructor(config: any, media_element: HTMLMediaElement, on_pause_transmuxer: () => void, on_resume_transmuxer: () => void);
    destroy(): void;
    notifyBufferedPositionChanged(buffered_position?: number): void;
    private _onMediaTimeUpdate;
    private _suspendTransmuxerIfNeeded;
    private _suspendTransmuxerIfBufferedPositionExceeded;
    suspendTransmuxer(): void;
    private _resumeTransmuxerIfNeeded;
    resumeTransmuxer(): void;
}
export default LoadingController;
