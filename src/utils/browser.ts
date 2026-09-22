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

export type BrowserName = 'chrome' | 'chromium' | 'firefox' | 'safari' | 'edge' |
    'opera' | 'ie' | 'android' | 'unknown';

export type BrowserEngine = 'blink' | 'webkit' | 'gecko' | 'edgehtml' | 'trident' |
    'presto' | 'unknown';

export type BrowserPlatform = 'ios' | 'windows-phone' | 'kindle' | 'android' |
    'windows' | 'macos' | 'linux' | 'chromeos' | 'unknown';

export interface BrowserVersion {
    // Original numeric version token, including components beyond patch
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
    // Browser product version; null when absent or malformed
    readonly version: BrowserVersion | null;
    // Embedded Chrome/Chromium version, never the Edge or Opera product version
    readonly chromiumVersion: BrowserVersion | null;
}

function parseVersion(token: string | undefined): BrowserVersion | null {
    if (!token || !/^\d+(?:\.\d+)*$/.test(token)) {
        return null;
    }

    const components = token.split('.').map(Number);
    // Avoid rounding huge components or accepting Infinity. Use ES5 runtime APIs.
    if (components.some((component) => !isFinite(component) || component > 9007199254740991)) {
        return null;
    }

    return {
        string: token,
        major: components[0],
        minor: components.length > 1 ? components[1] : null,
        build: components.length > 2 ? components[2] : null,
        patch: components.length > 3 ? components[3] : null
    };
}

function parsePlatform(ua: string): BrowserPlatform {
    // Windows Phone can advertise Android; iOS also advertises Mac OS X.
    if (/\bWindows Phone\b/i.test(ua)) { return 'windows-phone'; }
    if (/\b(?:iPad|iPod|iPhone)\b/i.test(ua)) { return 'ios'; }
    if (/\bKindle\b/i.test(ua)) { return 'kindle'; }
    if (/\bAndroid\b/i.test(ua)) { return 'android'; }
    if (/\bCrOS\b/i.test(ua)) { return 'chromeos'; }
    if (/\bWindows\b/i.test(ua)) { return 'windows'; }
    if (/\b(?:Macintosh|Mac OS X|Mac_PowerPC)\b/i.test(ua)) { return 'macos'; }
    if (/\bLinux\b/i.test(ua)) { return 'linux'; }
    return 'unknown';
}

interface BrowserRule {
    readonly pattern: RegExp;
    readonly name: BrowserName;
    readonly engine: BrowserEngine;
}

// Specific product tokens must precede Chrome and Safari compatibility tokens.
// iOS product tokens identify WebKit even when a desktop UA hides the platform.
const browserRules: ReadonlyArray<BrowserRule> = [
    { pattern: /\bEdge\b(?:\/([^\s;()]*))?/i, name: 'edge', engine: 'edgehtml' },
    { pattern: /\bEdgiOS\b(?:\/([^\s;()]*))?/i, name: 'edge', engine: 'webkit' },
    { pattern: /\b(?:EdgA|Edg)\b(?:\/([^\s;()]*))?/i, name: 'edge', engine: 'blink' },
    { pattern: /\bOPR\b(?:\/([^\s;()]*))?/i, name: 'opera', engine: 'blink' },
    { pattern: /\bCriOS\b(?:\/([^\s;()]*))?/i, name: 'chrome', engine: 'webkit' },
    { pattern: /\bFxiOS\b(?:\/([^\s;()]*))?/i, name: 'firefox', engine: 'webkit' },
    { pattern: /\bIEMobile\b(?:\/([^\s;()]*))?/i, name: 'ie', engine: 'trident' },
    { pattern: /\bMSIE\b(?:[ /]([^\s;()]*))?/i, name: 'ie', engine: 'trident' },
    { pattern: /\bTrident\b.*?\brv:([^\s;()]*)/i, name: 'ie', engine: 'trident' },
    { pattern: /\bChromium\b(?:[ /]([^\s;()]*))?/i, name: 'chromium', engine: 'blink' },
    { pattern: /\bChrome\b(?:[ /]([^\s;()]*))?/i, name: 'chrome', engine: 'blink' },
    { pattern: /\bFirefox\b(?:[ /]([^\s;()]*))?/i, name: 'firefox', engine: 'gecko' },
    { pattern: /\bOpera\b(?:[ /]([^\s;()]*))?/i, name: 'opera', engine: 'presto' }
];

export function parseUserAgent(ua: string): BrowserInfo {
    const platform = parsePlatform(ua);
    const chromium = /\b(?:Chromium|Chrome)\b(?:[ /]([^\s;()]*))?/i.exec(ua);
    const productVersion = /\bVersion\/([^\s;()]*)/i.exec(ua);

    for (const rule of browserRules) {
        const match = rule.pattern.exec(ua);
        if (!match) {
            continue;
        }

        // Pre-Blink Chrome used WebKit. Do not guess when its version is missing.
        const chromiumVersion = chromium ? parseVersion(chromium[1]) : null;
        const engine = (rule.name === 'chrome' || rule.name === 'chromium') &&
            rule.engine === 'blink' && chromiumVersion !== null && chromiumVersion.major < 28
            ? 'webkit' : rule.engine;

        return {
            name: rule.name,
            engine,
            platform,
            version: parseVersion(rule.engine === 'presto' && productVersion ? productVersion[1] : match[1]),
            chromiumVersion: rule.engine === 'blink' ? chromiumVersion : null
        };
    }

    const webkit = /\bAppleWebKit\b/i.test(ua);
    // A Safari token alone is common in embedded browsers and does not identify Safari.
    const safari = webkit && /\bSafari\b/i.test(ua) && productVersion !== null;
    return {
        name: safari ? (platform === 'android' ? 'android' : 'safari') : 'unknown',
        engine: webkit ? 'webkit' : /\bTrident\b/i.test(ua) ? 'trident' :
            /\bPresto\b/i.test(ua) ? 'presto' : /\bGecko\//i.test(ua) ? 'gecko' : 'unknown',
        platform,
        version: safari && productVersion ? parseVersion(productVersion[1]) : null,
        chromiumVersion: null
    };
}

// navigator is available in both Window and WorkerGlobalScope; neither is required.
const Browser: BrowserInfo = parseUserAgent(
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : ''
);

export default Browser;
