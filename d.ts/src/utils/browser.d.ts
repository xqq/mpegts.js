export type BrowserName = 'chrome' | 'chromium' | 'firefox' | 'safari' | 'edge' | 'opera' | 'ie' | 'android' | 'unknown';
export type BrowserEngine = 'blink' | 'webkit' | 'gecko' | 'edgehtml' | 'trident' | 'presto' | 'unknown';
export type BrowserPlatform = 'ios' | 'windows-phone' | 'kindle' | 'android' | 'windows' | 'macos' | 'linux' | 'chromeos' | 'unknown';
export interface BrowserVersion {
    readonly string: string;
    readonly major: number;
    readonly minor: number | null;
    readonly build: number | null;
    readonly patch: number | null;
}
export interface BrowserInfo {
    readonly name: BrowserName;
    readonly engine: BrowserEngine;
    readonly platform: BrowserPlatform;
    readonly version: BrowserVersion | null;
    readonly chromiumVersion: BrowserVersion | null;
}
export declare function parseUserAgent(ua: string): BrowserInfo;
declare const Browser: BrowserInfo;
export default Browser;
