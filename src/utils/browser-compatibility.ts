/*
 * Copyright (C) 2016 zheng qian. All Rights Reserved.
 *
 * @author zheng qian <xqq@xqq.im>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { BrowserInfo } from './browser';

/**
 * Preserve the Chrome playback workaround scope, including Chromium Edge, which
 * the old parser identified as Chrome. Opera and iOS browsers are not included.
 */
export function usesChromeWorkarounds(browser: BrowserInfo): boolean {
    return (browser.engine === 'blink' || browser.chromiumVersion !== null) &&
        (browser.name === 'chrome' || browser.name === 'chromium' || browser.name === 'edge');
}

/** Chromium issue 229412: mark the first sample as an IDR before build 50.0.2661. */
export function needsChromeFirstIDR(browser: BrowserInfo): boolean {
    const version = browser.chromiumVersion;
    return usesChromeWorkarounds(browser) && version !== null &&
        (version.major < 50 ||
         (version.major === 50 && version.build !== null && version.build < 2661));
}
