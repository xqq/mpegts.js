import type { BrowserInfo } from './browser';
/**
 * Preserve the Chrome playback workaround scope, including Chromium Edge, which
 * the old parser identified as Chrome. Opera and iOS browsers are not included.
 */
export declare function usesChromeWorkarounds(browser: BrowserInfo): boolean;
/** Chromium issue 229412: mark the first sample as an IDR before build 50.0.2661. */
export declare function needsChromeFirstIDR(browser: BrowserInfo): boolean;
