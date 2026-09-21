/*
 * Copyright (C) 2026 magicxqq. All Rights Reserved.
 *
 * @author magicxqq <xqq@xqq.im>
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

// Hand-written companion declaration for browser.js. That module builds its export by
// Object.assign()-ing a dynamically detected object onto an empty literal, so TypeScript
// infers `{}` and every property access from a .ts consumer fails. Declaring the shape
// here types all consumers from one place and leaves browser.js untouched.

interface BrowserVersion {
    /** Parsed from the major version component; NaN when the UA carried no version. */
    major: number;
    /** The raw version string as matched from the UA. */
    string: string;
    /** Only present when the UA version has at least two components. */
    minor?: number;
    /** Only present when the UA version has at least three components. */
    build?: number;
}

interface BrowserInfo {
    /** Normalized browser name, e.g. 'chrome', 'safari', 'msedge'. Empty when unmatched. */
    name: string;
    /** Matched platform token, e.g. 'windows', 'mac', 'android'. Empty when unmatched. */
    platform: string;
    version: BrowserVersion;

    // Browser flags -- present (true) only for the detected browser.
    chrome?: boolean;
    safari?: boolean;
    firefox?: boolean;
    opera?: boolean;
    msie?: boolean;
    msedge?: boolean;
    iemobile?: boolean;
    webkit?: boolean;

    // Platform flags -- present (true) only for the detected platform.
    android?: boolean;
    ipad?: boolean;
    iphone?: boolean;
    ipod?: boolean;
    kindle?: boolean;
    windows?: boolean;
    mac?: boolean;
    linux?: boolean;
    cros?: boolean;

    // detect() also assigns the raw matched token, which may be a name not listed above.
    [key: string]: unknown;
}

declare const Browser: BrowserInfo;
export default Browser;
