import Browser, { parseUserAgent } from '../src/utils/browser';
import type { BrowserInfo, BrowserName, BrowserEngine, BrowserPlatform, BrowserVersion } from '../src/utils/browser';

const info: BrowserInfo = parseUserAgent('Chrome/50');
const name: BrowserName = info.name;
const engine: BrowserEngine = info.engine;
const platform: BrowserPlatform = info.platform;
const version: BrowserVersion | null = Browser.version;
if (version !== null && version.build !== null) {
    const build: number = version.build;
}

// @ts-expect-error Results cannot be reassigned by consumers.
info.name = 'firefox';
if (info.version) {
    // @ts-expect-error Version components are readonly too.
    info.version.major = 50;
    // @ts-expect-error Missing components require narrowing.
    const build: number = info.version.build;
}
// @ts-expect-error Unknown/malformed UAs can have no version.
const major: number = info.version.major;
// @ts-expect-error Dynamic browser flags are not part of the new API.
info.chrome;
// @ts-expect-error Browser names are a closed union.
const invalidName: BrowserName = 'arbitrary';
