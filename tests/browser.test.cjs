const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');

const { parseUserAgent } = loadSource()('utils/browser.ts');
const { needsChromeFirstIDR, usesChromeWorkarounds } = loadSource()('utils/browser-compatibility.ts');
const apple = 'AppleWebKit/605.1.15';
const chrome = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Safari/537.36';
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';

// Expectations describe deliberate corrections to the old parser: Edge/Opera
// product versions are not Chrome versions; Safari's version is not AppleWebKit's;
// iOS brands do not imply Blink/Gecko; unknown AppleWebKit is not Safari.
const fixtures = [
    {
        label: 'Chrome',
        userAgent: `Mozilla/5.0 (Windows NT 10.0) ${chrome}`,
        name: 'chrome',
        engine: 'blink',
        platform: 'windows',
        version: '120.0.6099.71',
        chromiumVersion: '120.0.6099.71'
    },
    {
        label: 'Chromium',
        userAgent: 'Chromium/120.0.0.0 Chrome/120.0.0.0',
        name: 'chromium',
        engine: 'blink',
        platform: 'unknown',
        version: '120.0.0.0',
        chromiumVersion: '120.0.0.0'
    },
    {
        label: 'old Chrome',
        userAgent: 'Mozilla/5.0 (Linux) AppleWebKit/534.24 Chrome/11.0.696.65 Safari/534.24',
        name: 'chrome',
        engine: 'webkit',
        platform: 'linux',
        version: '11.0.696.65',
        chromiumVersion: '11.0.696.65'
    },
    {
        label: 'modern Edge',
        userAgent: `${chrome} Edg/121.0.2277.83`,
        name: 'edge',
        engine: 'blink',
        platform: 'unknown',
        version: '121.0.2277.83',
        chromiumVersion: '120.0.6099.71'
    },
    {
        label: 'Android Edge',
        userAgent: `Mozilla/5.0 (Linux; Android 13) ${chrome} EdgA/121.0.2277.83`,
        name: 'edge',
        engine: 'blink',
        platform: 'android',
        version: '121.0.2277.83',
        chromiumVersion: '120.0.6099.71'
    },
    {
        label: 'legacy Edge',
        userAgent: `${chrome} Edge/18.19041`,
        name: 'edge',
        engine: 'edgehtml',
        platform: 'unknown',
        version: '18.19041',
        chromiumVersion: null
    },
    {
        label: 'Opera',
        userAgent: `${chrome} OPR/106.0.4998.70`,
        name: 'opera',
        engine: 'blink',
        platform: 'unknown',
        version: '106.0.4998.70',
        chromiumVersion: '120.0.6099.71'
    },
    {
        label: 'Presto Opera',
        userAgent: 'Opera/9.80 (Windows NT 6.1) Presto/2.12.388 Version/12.16',
        name: 'opera',
        engine: 'presto',
        platform: 'windows',
        version: '12.16',
        chromiumVersion: null
    },
    {
        label: 'older Opera',
        userAgent: 'Opera/9.27 (Windows NT 5.1)',
        name: 'opera',
        engine: 'presto',
        platform: 'windows',
        version: '9.27',
        chromiumVersion: null
    },
    {
        label: 'Firefox',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
        name: 'firefox',
        engine: 'gecko',
        platform: 'linux',
        version: '120.0',
        chromiumVersion: null
    },
    {
        label: 'Android Firefox',
        userAgent: 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
        name: 'firefox',
        engine: 'gecko',
        platform: 'android',
        version: '120.0',
        chromiumVersion: null
    },
    {
        label: 'Safari',
        userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${apple} Version/17.1 Safari/605.1.15`,
        name: 'safari',
        engine: 'webkit',
        platform: 'macos',
        version: '17.1',
        chromiumVersion: null
    },
    {
        label: 'iPhone Safari',
        userAgent: `${ios} ${apple} Version/17.0 Mobile/15E148 Safari/604.1`,
        name: 'safari',
        engine: 'webkit',
        platform: 'ios',
        version: '17.0',
        chromiumVersion: null
    },
    {
        label: 'iPad Safari',
        userAgent: `Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) ${apple} Version/15.0 Safari/604.1`,
        name: 'safari',
        engine: 'webkit',
        platform: 'ios',
        version: '15.0',
        chromiumVersion: null
    },
    {
        label: 'iPod Safari',
        userAgent: `Mozilla/5.0 (iPod; CPU iPhone OS 12_0 like Mac OS X) ${apple} Version/12.0 Safari/604.1`,
        name: 'safari',
        engine: 'webkit',
        platform: 'ios',
        version: '12.0',
        chromiumVersion: null
    },
    {
        label: 'iOS Chrome',
        userAgent: `${ios} ${apple} CriOS/120.0.6099.101 Mobile/15E148 Safari/604.1`,
        name: 'chrome',
        engine: 'webkit',
        platform: 'ios',
        version: '120.0.6099.101',
        chromiumVersion: null
    },
    {
        label: 'iOS Firefox',
        userAgent: `${ios} ${apple} FxiOS/120.0 Mobile/15E148 Safari/605.1.15`,
        name: 'firefox',
        engine: 'webkit',
        platform: 'ios',
        version: '120.0',
        chromiumVersion: null
    },
    {
        label: 'iOS Edge',
        userAgent: `${ios} ${apple} Version/17.0 EdgiOS/120.0.2210.86 Safari/605.1.15`,
        name: 'edge',
        engine: 'webkit',
        platform: 'ios',
        version: '120.0.2210.86',
        chromiumVersion: null
    },
    {
        label: 'iOS desktop-mode Chrome',
        userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${apple} CriOS/120 Version/17.0 Safari/605.1.15`,
        name: 'chrome',
        engine: 'webkit',
        platform: 'macos',
        version: '120',
        chromiumVersion: null
    },
    {
        label: 'IE 10',
        userAgent: 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)',
        name: 'ie',
        engine: 'trident',
        platform: 'windows',
        version: '10.0',
        chromiumVersion: null
    },
    {
        label: 'IE 11',
        userAgent: 'Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko',
        name: 'ie',
        engine: 'trident',
        platform: 'windows',
        version: '11.0',
        chromiumVersion: null
    },
    {
        label: 'IEMobile',
        userAgent: 'Mozilla/5.0 (Windows Phone 8.1; Android 4.0; Trident/7.0; rv:11.0; IEMobile/11.0) like Gecko',
        name: 'ie',
        engine: 'trident',
        platform: 'windows-phone',
        version: '11.0',
        chromiumVersion: null
    },
    {
        label: 'Windows Phone Edge compatibility tokens',
        userAgent: `Mozilla/5.0 (Windows Phone 10.0; Android 6.0; Microsoft) ${chrome} Edge/15.15063`,
        name: 'edge',
        engine: 'edgehtml',
        platform: 'windows-phone',
        version: '15.15063',
        chromiumVersion: null
    },
    {
        label: 'stock Android',
        userAgent: 'Mozilla/5.0 (Linux; Android 4.0.3) AppleWebKit/534.30 Version/4.0 Mobile Safari/534.30',
        name: 'android',
        engine: 'webkit',
        platform: 'android',
        version: '4.0',
        chromiumVersion: null
    },
    {
        label: 'Kindle',
        userAgent: 'Mozilla/5.0 (Linux; Kindle/3.0) AppleWebKit/533.1',
        name: 'unknown',
        engine: 'webkit',
        platform: 'kindle',
        version: null,
        chromiumVersion: null
    },
    {
        label: 'ChromeOS',
        userAgent: `Mozilla/5.0 (X11; CrOS x86_64 15662.0.0; Linux) ${chrome}`,
        name: 'chrome',
        engine: 'blink',
        platform: 'chromeos',
        version: '120.0.6099.71',
        chromiumVersion: '120.0.6099.71'
    },
    {
        label: 'WebView',
        userAgent: `${ios} ${apple} Mobile/15E148`,
        name: 'unknown',
        engine: 'webkit',
        platform: 'ios',
        version: null,
        chromiumVersion: null
    },
    {
        label: 'Safari compatibility token only',
        userAgent: `${apple} Safari/605.1.15`,
        name: 'unknown',
        engine: 'webkit',
        platform: 'unknown',
        version: null,
        chromiumVersion: null
    },
    {
        label: 'case insensitive',
        userAgent: 'cHrOmE/120.0.0.0 (aNdRoId 13)',
        name: 'chrome',
        engine: 'blink',
        platform: 'android',
        version: '120.0.0.0',
        chromiumVersion: '120.0.0.0'
    },
    {
        label: 'unknown',
        userAgent: 'custom-player/1.0 (like Gecko)',
        name: 'unknown',
        engine: 'unknown',
        platform: 'unknown',
        version: null,
        chromiumVersion: null
    },
    {
        label: 'empty',
        userAgent: '',
        name: 'unknown',
        engine: 'unknown',
        platform: 'unknown',
        version: null,
        chromiumVersion: null
    }
];

for (const { label, userAgent, name, engine, platform, version, chromiumVersion } of fixtures) {
    test(`parse ${label}`, () => {
        const result = parseUserAgent(userAgent);

        assert.equal(result.name, name);
        assert.equal(result.engine, engine);
        assert.equal(result.platform, platform);
        assert.equal(result.version?.string ?? null, version);
        assert.equal(result.chromiumVersion?.string ?? null, chromiumVersion);
    });
}

test('version components preserve missing values, zeroes and the original token', () => {
    for (const [token, expected] of [
        ['50', [50, null, null, null]],
        ['50.0', [50, 0, null, null]],
        ['50.0.2661', [50, 0, 2661, null]],
        ['120.0.0.0', [120, 0, 0, 0]],
        ['050.01.02661.00.5', [50, 1, 2661, 0]]
    ]) {
        const version = parseUserAgent(`Chrome/${token}`).version;

        assert.equal(version.string, token);
        assert.deepEqual(
            [version.major, version.minor, version.build, version.patch],
            expected
        );
    }
});

test('invalid or missing versions remain null without falling through to another brand', () => {
    const invalidVersions = [
        '',
        'abc',
        '50.x',
        '50..1',
        '50.',
        '50.0beta',
        '-1',
        '1e2',
        '9007199254740992',
        '9'.repeat(400)
    ];

    for (const token of invalidVersions) {
        const result = parseUserAgent(`${chrome} Edg/${token}`);
        assert.equal(result.name, 'edge');
        assert.equal(result.version, null);
        assert.equal(result.chromiumVersion.string, '120.0.6099.71');
    }

    assert.equal(parseUserAgent('Chrome').version, null);
    assert.equal(parseUserAgent('NotChrome/120.0 Safari/605.1').name, 'unknown');
});

test('default export initializes in Window, Worker and non-browser globals', () => {
    for (const globals of [
        { navigator: { userAgent: chrome }, window: {} },
        { navigator: { userAgent: chrome }, self: {} }
    ]) {
        const Browser = loadSource(globals)('utils/browser.ts').default;

        assert.equal(Browser.name, 'chrome');
    }

    for (const globals of [{}, { navigator: {} }]) {
        const Browser = loadSource(globals)('utils/browser.ts').default;

        assert.equal(Browser.name, 'unknown');
    }
});

test('Chrome first-IDR threshold does not zero-fill missing components', () => {
    for (const [version, expected] of [
        ['11.0.696.65', true],
        ['49', true],
        ['50', false],
        ['50.0', false],
        ['50.0.2660', true],
        ['50.0.2661', false],
        ['51.0.0', false],
        ['120.0.0.0', false],
        ['', false],
        ['oops', false]
    ]) {
        const browser = parseUserAgent(`Chrome/${version}`);

        assert.equal(needsChromeFirstIDR(browser), expected, version);
    }

    assert.equal(needsChromeFirstIDR(parseUserAgent('Chrome/49.0.0 OPR/36.0')), false);
    assert.equal(needsChromeFirstIDR(parseUserAgent('Chrome/49.0.0 Edge/12.10240')), false);
    assert.equal(needsChromeFirstIDR(parseUserAgent('CriOS/49.0.0')), false);
    assert.equal(needsChromeFirstIDR(parseUserAgent('Chrome/120.0.0.0 Edg/49.0')), false);
});

test('Chrome fetch behavior includes modern Edge but not Opera, EdgeHTML or iOS', () => {
    for (const [userAgent, expected] of [
        [chrome, true],
        [`${chrome} Edg/120.0`, true],
        ['Chrome/invalid', true],
        [`${chrome} OPR/106.0`, false],
        [`${chrome} Edge/18.19041`, false],
        ['CriOS/120.0', false],
        ['EdgiOS/120.0', false],
        ['', false]
    ]) {
        const browser = parseUserAgent(userAgent);

        assert.equal(usesChromeWorkarounds(browser), expected);
    }
});
