declare class LiveLatencySynchronizer {
    private _config;
    private _media_element;
    private e?;
    constructor(config: any, media_element: HTMLMediaElement);
    destroy(): void;
    private _onMediaTimeUpdate;
    private _getCurrentLatency;
}
export default LiveLatencySynchronizer;
