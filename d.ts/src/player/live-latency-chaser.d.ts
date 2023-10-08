declare class LiveLatencyChaser {
    private _config;
    private _media_element;
    private _on_direct_seek;
    constructor(config: any, media_element: HTMLMediaElement, on_direct_seek: (target: number) => void);
    destroy(): void;
    notifyBufferedRangeUpdate(): void;
    private _chaseLiveLatency;
}
export default LiveLatencyChaser;
