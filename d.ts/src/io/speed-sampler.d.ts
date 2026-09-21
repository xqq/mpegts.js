export default SpeedSampler;
declare class SpeedSampler {
    _firstCheckpoint: number;
    _lastCheckpoint: number;
    _intervalBytes: number;
    _totalBytes: number;
    _lastSecondBytes: number;
    _now: {
        (): DOMHighResTimeStamp;
        (): DOMHighResTimeStamp;
    };
    reset(): void;
    addBytes(bytes: any): void;
    get currentKBps(): number;
    get lastSecondKBps(): number;
    get averageKBps(): number;
}
