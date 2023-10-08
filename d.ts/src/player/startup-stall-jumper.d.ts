declare class StartupStallJumper {
    private readonly TAG;
    private _media_element;
    private _on_direct_seek;
    private _canplay_received;
    private e;
    constructor(media_element: HTMLMediaElement, on_direct_seek: (target: number) => void);
    destroy(): void;
    private _onMediaCanPlay;
    private _onMediaStalled;
    private _onMediaProgress;
    private _detectAndFixStuckPlayback;
}
export default StartupStallJumper;
