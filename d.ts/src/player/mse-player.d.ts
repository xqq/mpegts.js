import MediaInfo from '../core/media-info';
declare class MSEPlayer {
    private readonly TAG;
    private _type;
    private _media_element;
    private _player_engine;
    constructor(mediaDataSource: any, config?: any);
    destroy(): void;
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
    attachMediaElement(mediaElement: HTMLMediaElement): void;
    detachMediaElement(): void;
    load(): void;
    unload(): void;
    play(): Promise<void>;
    pause(): void;
    get type(): string;
    get buffered(): TimeRanges;
    get duration(): number;
    get volume(): number;
    set volume(value: number);
    get muted(): boolean;
    set muted(muted: boolean);
    get currentTime(): number;
    set currentTime(seconds: number);
    get mediaInfo(): MediaInfo;
    get statisticsInfo(): any;
}
export default MSEPlayer;
