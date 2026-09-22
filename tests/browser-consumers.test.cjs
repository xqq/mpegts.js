const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');

const chrome = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
const android = 'Mozilla/5.0 (Linux; Android 4.0.3) AppleWebKit/534.30 Version/4.0 Safari/534.30';
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';

function browserEnvironment(userAgent) {
    return loadSource({
        navigator: { userAgent },
        self: {
            fetch() {},
            ReadableStream() {}
        }
    });
}

// Expected AAC bytes are fixed regression vectors, not calculated using the
// production algorithm. The two demuxers must produce the same wire config.
const aacCases = [
    {
        index: 4,
        channels: 2,
        rate: 44100,
        expected: {
            firefox: [0x12, 0x10],
            android: [0x12, 0x10],
            default: [0x2a, 0x12, 0x08, 0]
        }
    },
    {
        index: 6,
        channels: 2,
        rate: 24000,
        expected: {
            firefox: [0x2b, 0x11, 0x88, 0],
            android: [0x13, 0x10],
            default: [0x2b, 0x11, 0x88, 0]
        }
    },
    {
        index: 7,
        channels: 2,
        rate: 22050,
        expected: {
            firefox: [0x2b, 0x92, 0x08, 0],
            android: [0x13, 0x90],
            default: [0x2b, 0x92, 0x08, 0]
        }
    },
    {
        index: 4,
        channels: 1,
        rate: 44100,
        expected: {
            firefox: [0x12, 0x08],
            android: [0x12, 0x08],
            default: [0x12, 0x08]
        }
    },
    {
        index: 7,
        channels: 1,
        rate: 22050,
        expected: {
            firefox: [0x2b, 0x8a, 0x08, 0],
            android: [0x13, 0x88],
            default: [0x2b, 0x8a, 0x08, 0]
        }
    }
];

for (const { label, userAgent, branch } of [
    {
        label: 'Firefox',
        userAgent: firefox,
        branch: 'firefox'
    },
    {
        label: 'Firefox on Android takes precedence',
        userAgent: 'Mozilla/5.0 (Android 13) Gecko/120.0 Firefox/120.0',
        branch: 'firefox'
    },
    {
        label: 'Chrome on Android',
        userAgent: `${chrome} Android 13`,
        branch: 'android'
    },
    {
        label: 'stock Android',
        userAgent: android,
        branch: 'android'
    },
    {
        label: 'Chrome',
        userAgent: chrome,
        branch: 'default'
    },
    {
        label: 'Safari',
        userAgent: safari,
        branch: 'default'
    },
    {
        label: 'iOS Firefox is not Gecko',
        userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/120.0 Safari/605.1.15',
        branch: 'default'
    },
    {
        // Intentional correction: compatibility text no longer selects Android AAC.
        label: 'Windows Phone ignores Android compatibility token',
        userAgent: `${chrome} (Windows Phone 10.0; Android 6.0) Edge/15.15063`,
        branch: 'default'
    },
    {
        label: 'unknown',
        userAgent: '',
        branch: 'default'
    }
]) {
    test(`AAC configuration: ${label}`, () => {
        const load = browserEnvironment(userAgent);
        const { AudioSpecificConfig } = load('demux/aac.ts');
        const FLVDemuxer = load('demux/flv-demuxer.js').default;
        const flv = new FLVDemuxer({
            dataOffset: 0,
            hasAudioTrack: true,
            hasVideoTrack: false
        }, {});

        for (const input of aacCases) {
            const { index, channels, rate } = input;
            const expected = input.expected[branch];
            const tsConfig = new AudioSpecificConfig({
                audio_object_type: 2,
                sampling_freq_index: index,
                sampling_frequency: rate,
                channel_config: channels,
                data: new Uint8Array(0)
            });
            const sourceConfig = Uint8Array.of(
                (2 << 3) | (index >> 1),
                ((index & 1) << 7) | (channels << 3)
            );
            const flvConfig = flv._parseAACAudioSpecificConfig(sourceConfig.buffer, 0, 2);

            // Configs are number[] until remuxing serializes them as bytes.
            assert.deepEqual(Array.from(Uint8Array.from(tsConfig.config)), expected);
            assert.deepEqual(Array.from(Uint8Array.from(flvConfig.config)), expected);
            assert.equal(tsConfig.sampling_rate, rate);
            assert.equal(flvConfig.samplingRate, rate);
            assert.equal(tsConfig.channel_count, channels);
            assert.equal(flvConfig.channelCount, channels);

            const codec = expected.length === 4 ? 'mp4a.40.5' : 'mp4a.40.2';
            assert.equal(tsConfig.codec_mimetype, codec);
            assert.equal(flvConfig.codec, codec);
            assert.equal(tsConfig.original_codec_mimetype, 'mp4a.40.2');
            assert.equal(flvConfig.originalCodec, 'mp4a.40.2');
        }
    });
}

test('fetch support only blacklists legacy Edge before build 15048 or with unknown build', () => {
    for (const [userAgent, expected] of [
        ['Edge/15.15047', false],
        ['Edge/15.15048', true],
        ['Edge/18.19041', true],
        ['Edge/15', false],
        ['Edge/oops', false],
        [`${chrome} Edg/120.0`, true],
        ['EdgiOS/120.0', true],
        [chrome, true],
        ['', true]
    ]) {
        const FetchStreamLoader = browserEnvironment(userAgent)('io/fetch-stream-loader.js').default;
        assert.equal(FetchStreamLoader.isSupported(), expected, userAgent);
    }

    const loadWithoutFetch = loadSource({
        navigator: { userAgent: chrome },
        self: {}
    });
    const FetchStreamLoader = loadWithoutFetch('io/fetch-stream-loader.js').default;

    assert.equal(Boolean(FetchStreamLoader.isSupported()), false);
});

test('buffering fetch abort preserves Chrome and modern Edge behavior', () => {
    for (const [userAgent, shouldAbort] of [
        [chrome, false],
        [`${chrome} Edg/120.0`, false],
        [`${chrome} OPR/106.0`, true],
        [`${chrome} Edge/18.19041`, true],
        [safari, true],
        ['CriOS/120.0', true]
    ]) {
        const load = browserEnvironment(userAgent);
        const FetchStreamLoader = load('io/fetch-stream-loader.js').default;
        const { LoaderStatus } = load('io/loader.js');
        const loader = new FetchStreamLoader({}, {});
        let calls = 0;

        loader._abortController = {
            abort() {
                calls++;
            }
        };
        loader._status = LoaderStatus.kBuffering;
        loader.abort();

        assert.equal(calls, shouldAbort ? 1 : 0, userAgent);
        assert.equal(loader._requestAbort, true);

        loader._status = LoaderStatus.kConnecting;
        loader.abort();

        assert.equal(calls, shouldAbort ? 2 : 1, userAgent);
    }
});

function videoElement() {
    return {
        addEventListener() {},
        removeEventListener() {},
        currentTime: 0,
        buffered: {
            length: 1,
            start() {
                return 0;
            },
            end() {
                return 10;
            }
        }
    };
}

test('seeking and remuxing agree on legacy workarounds', () => {
    for (const { userAgent, forceFirstIDR, legacySeekWorkaround, firefoxMp3Support } of [
        {
            userAgent: 'Chrome/49.0.0',
            forceFirstIDR: true,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        },
        {
            userAgent: 'Chrome/50.0.2660',
            forceFirstIDR: true,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        },
        {
            userAgent: 'Chrome/50.0.2661',
            forceFirstIDR: false,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        },
        {
            userAgent: 'Chrome/50.0',
            forceFirstIDR: false,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        },
        {
            userAgent: 'Edge/15.15048',
            forceFirstIDR: false,
            legacySeekWorkaround: true,
            firefoxMp3Support: false
        },
        {
            userAgent: 'MSIE 10.0',
            forceFirstIDR: false,
            legacySeekWorkaround: true,
            firefoxMp3Support: false
        },
        {
            userAgent: `${chrome} Edg/120.0`,
            forceFirstIDR: false,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        },
        {
            userAgent: firefox,
            forceFirstIDR: false,
            legacySeekWorkaround: false,
            firefoxMp3Support: true
        },
        {
            userAgent: 'FxiOS/120.0',
            forceFirstIDR: false,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        },
        {
            userAgent: 'CriOS/49.0.0',
            forceFirstIDR: false,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        },
        {
            userAgent: '',
            forceFirstIDR: false,
            legacySeekWorkaround: false,
            firefoxMp3Support: false
        }
    ]) {
        const load = browserEnvironment(userAgent);
        const SeekingHandler = load('player/seeking-handler.ts').default;
        const MP4Remuxer = load('remux/mp4-remuxer.js').default;
        const config = { accurateSeek: true };
        const seeking = new SeekingHandler(config, videoElement(), () => {});
        const remuxer = new MP4Remuxer({});

        assert.equal(remuxer._forceFirstIDR, forceFirstIDR, userAgent);
        assert.equal(remuxer._fillSilentAfterSeek, legacySeekWorkaround, userAgent);
        assert.equal(remuxer._mp3UseMpegAudio, !firefoxMp3Support, userAgent);
        assert.equal(seeking._always_seek_keyframe, forceFirstIDR || legacySeekWorkaround, userAgent);
        assert.equal(config.accurateSeek, !(forceFirstIDR || legacySeekWorkaround), userAgent);
    }
});

test('Safari zero-seek workaround excludes stock Android and other browsers', () => {
    for (const [userAgent, expectedTime] of [
        [safari, 0.1],
        [android, 0],
        [chrome, 0],
        ['Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/120.0 Safari/605.1.15', 0],
        // Intentional correction: Version/Safari tokens do not make iOS Edge Safari.
        [`${safari} EdgiOS/120.0`, 0],
        ['AppleWebKit/605.1.15', 0]
    ]) {
        const SeekingHandler = browserEnvironment(userAgent)('player/seeking-handler.ts').default;
        const video = videoElement();
        const seeking = new SeekingHandler({ accurateSeek: true }, video, () => {});

        seeking.seek(0);

        assert.equal(video.currentTime, expectedTime, userAgent);

        // Also exercise user-initiated seeking independently of seek().
        const userVideo = videoElement();
        const userSeeking = new SeekingHandler({ accurateSeek: true }, userVideo, () => {});

        userSeeking._onMediaSeeking({});

        assert.equal(userVideo.currentTime, expectedTime, userAgent);
    }
});
