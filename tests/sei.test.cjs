const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');
const { concatBytes } = require('./helpers/bytes.cjs');
const { hex, annexB, h264, h265 } = require('./helpers/video.cjs');

const UUID_A = '61616161-6161-6161-6161-616161616161';
const UUID_B = '12345678-1234-1234-1234-123456789abc';

function ascii(string) {
    return Uint8Array.from(Buffer.from(string, 'ascii'));
}

function uuidBytes(uuid) {
    return hex(uuid.replace(/-/g, ''));
}

// sei_message(): payloadType and payloadSize below 255 take one byte each
function seiMessage(type, payload) {
    return concatBytes(Uint8Array.of(type, payload.byteLength), payload);
}

function userDataUnregistered(uuid, userData) {
    return seiMessage(5, concatBytes(uuidBytes(uuid), userData));
}

// H.264 SEI NAL unit (header 0x06) ending with rbsp_trailing_bits
function h264Sei(...messages) {
    return concatBytes(Uint8Array.of(0x06), ...messages, Uint8Array.of(0x80));
}

// H.265 prefix SEI NAL unit (nal_unit_type 39, 2-byte header)
function h265PrefixSei(...messages) {
    return concatBytes(Uint8Array.of(0x4e, 0x01), ...messages, Uint8Array.of(0x80));
}

// Real NAL unit from an encoder whose payloadSize also counts its own "00 80" ending,
// so the payload runs to the end of the NAL unit with no rbsp_trailing_bits after it
const PAYLOAD_TO_END_OF_NALU = hex('06051f' + '61'.repeat(16) + Buffer.from('1795422170730').toString('hex') + '0080');

function loadSEI(load = loadSource()) {
    return load('demux/sei.ts');
}

// Copies values made inside the test's vm context, whose prototypes differ from this realm's
function plain(value) {
    if (ArrayBuffer.isView(value)) {
        return Uint8Array.from(value);
    }
    if (Array.isArray(value)) {
        return Array.from(value, plain);
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
    }
    return value;
}

function parse(nalu, config, codec = 'h264', pts = 40) {
    const { parseSEIMessages, SEIFilter } = loadSEI();
    return plain(parseSEIMessages(nalu, pts, codec, new SEIFilter(config)));
}

test('SEI parser reports every message of a NAL unit, like hls.js', () => {
    const nalu = h264Sei(
        seiMessage(0, Uint8Array.of(0xaa)),
        seiMessage(1, Uint8Array.of(0xbb, 0xcc)),
        userDataUnregistered(UUID_B, ascii('EPOCH_MS=1795422131374|STREAM=TEST\0')));

    const messages = parse(nalu);

    assert.deepEqual(messages.map(m => [m.type, m.size, m.pts]), [[0, 1, 40], [1, 2, 40], [5, 51, 40]]);
    assert.equal(messages[2].uuid_string, UUID_B);
    assert.deepEqual(messages[2].uuid, uuidBytes(UUID_B));
    assert.equal(Buffer.from(messages[2].user_data).toString('ascii'), 'EPOCH_MS=1795422131374|STREAM=TEST\0');
    assert.equal(messages[0].uuid, undefined);
});

test('SEI parser keeps a payload that runs to the end of the NAL unit', () => {
    const messages = parse(PAYLOAD_TO_END_OF_NALU);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].uuid_string, UUID_A);
    // user_data is reported exactly as sent, including the encoder's own ending bytes
    assert.deepEqual(messages[0].user_data, concatBytes(ascii('1795422170730'), Uint8Array.of(0x00, 0x80)));
});

test('SEI parser removes emulation prevention bytes', () => {
    // user_data 00 00 01 is escaped as 00 00 03 01; payloadSize counts the unescaped bytes
    const nalu = concatBytes(Uint8Array.of(0x06, 0x05, 19), uuidBytes(UUID_A), Uint8Array.of(0x00, 0x00, 0x03, 0x01, 0x80));

    const messages = parse(nalu);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].size, 19);
    assert.deepEqual(messages[0].user_data, Uint8Array.of(0x00, 0x00, 0x01));
});

test('SEI parser reports the messages before a truncated payload', () => {
    const nalu = concatBytes(Uint8Array.of(0x06), seiMessage(1, Uint8Array.of(0xbb)), Uint8Array.of(5, 40, 0x61, 0x61));

    assert.deepEqual(parse(nalu).map(m => m.type), [1]);
});

test('SEI parser reports uuid and user_data as copies of their own size', () => {
    // A large surrounding buffer stands in for the chunk the demuxer reads NAL units from
    const chunk = concatBytes(new Uint8Array(4096), h264Sei(userDataUnregistered(UUID_A, ascii('123'))), new Uint8Array(4096));
    const nalu = chunk.subarray(4096, chunk.byteLength - 4096);

    const { parseSEIMessages, SEIFilter } = loadSEI();
    const [message] = parseSEIMessages(nalu, 0, 'h264', new SEIFilter());

    assert.equal(message.uuid.buffer.byteLength, 16);
    assert.equal(message.user_data.buffer.byteLength, 3);
});

test('SEI parser handles the 2-byte H.265 NAL unit header', () => {
    const messages = parse(h265PrefixSei(userDataUnregistered(UUID_B, ascii('x'))), null, 'h265');

    assert.deepEqual(messages.map(m => [m.type, m.uuid_string]), [[5, UUID_B]]);
});

test('seiUUIDAllowlist reports only listed user_data_unregistered messages', () => {
    const nalu = h264Sei(
        seiMessage(1, Uint8Array.of(0xbb)),
        userDataUnregistered(UUID_A, ascii('a')),
        userDataUnregistered(UUID_B, ascii('b')));

    // Dashes and case do not matter
    const messages = parse(nalu, { seiUUIDAllowlist: ['12345678123412341234123456789ABC'] });

    assert.deepEqual(messages.map(m => [m.type, m.uuid_string]), [[5, UUID_B]]);
    assert.deepEqual(parse(nalu, { seiUUIDAllowlist: [UUID_A, UUID_B] }).map(m => m.uuid_string), [UUID_A, UUID_B]);
    assert.deepEqual(parse(nalu, { seiUUIDAllowlist: ['00000000-0000-0000-0000-000000000000'] }), []);
});

test('SEIFilter is inactive when disabled or when the allowlist is empty', () => {
    const { SEIFilter } = loadSEI();

    assert.equal(new SEIFilter(undefined).active, true);
    assert.equal(new SEIFilter({ enableSEIParsing: true, seiUUIDAllowlist: null }).active, true);
    assert.equal(new SEIFilter({ enableSEIParsing: false }).active, false);
    assert.equal(new SEIFilter({ seiUUIDAllowlist: [] }).active, false);
    assert.equal(new SEIFilter({ enableSEIParsing: false, seiUUIDAllowlist: [UUID_A] }).active, false);
    assert.deepEqual(parse(PAYLOAD_TO_END_OF_NALU, { enableSEIParsing: false }), []);
});

test('SEIFilter ignores invalid allowlist entries, so they match nothing', () => {
    const warnings = [];
    const { SEIFilter } = loadSource({ console: { ...console, warn: (...args) => warnings.push(args.join(' ')) } })('demux/sei.ts');

    const filter = new SEIFilter({ seiUUIDAllowlist: ['not-a-uuid'] });

    assert.equal(filter.active, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not-a-uuid/);
});

test('validateSEIConfig rejects values updateSEIConfig cannot apply', () => {
    const { validateSEIConfig } = loadSEI();

    assert.equal(validateSEIConfig({}), null);
    assert.equal(validateSEIConfig({ enableSEIParsing: false, seiUUIDAllowlist: null }), null);
    assert.equal(validateSEIConfig({ seiUUIDAllowlist: [UUID_A, '12345678123412341234123456789ABC'] }), null);
    assert.match(validateSEIConfig(null), /object/);
    assert.match(validateSEIConfig({ enableSEIParsing: 'yes' }), /enableSEIParsing/);
    assert.match(validateSEIConfig({ seiUUIDAllowlist: UUID_A }), /array/);
    assert.match(validateSEIConfig({ seiUUIDAllowlist: ['1234'] }), /invalid uuid: 1234/);
});

test('applySEIConfig changes only the fields that are given', () => {
    const { applySEIConfig } = loadSEI();
    const allowlist = [UUID_A];
    const config = { enableSEIParsing: true, seiUUIDAllowlist: null, isLive: true };

    applySEIConfig(config, { seiUUIDAllowlist: allowlist });
    allowlist.push(UUID_B);
    assert.deepEqual(config, { enableSEIParsing: true, seiUUIDAllowlist: [UUID_A], isLive: true });

    applySEIConfig(config, { enableSEIParsing: false, seiUUIDAllowlist: undefined });
    assert.deepEqual(config, { enableSEIParsing: false, seiUUIDAllowlist: [UUID_A], isLive: true });

    applySEIConfig(config, { seiUUIDAllowlist: null });
    assert.deepEqual(config, { enableSEIParsing: false, seiUUIDAllowlist: null, isLive: true });
});

// FLV AVC video tag body after the 5-byte header: NAL units with 4-byte lengths
function avcTagBody(...nalus) {
    return concatBytes(...nalus.flatMap(nalu => {
        const length = new Uint8Array(4);
        new DataView(length.buffer).setUint32(0, nalu.byteLength);
        return [length, nalu];
    }));
}

// Counts parseSEIMessages calls by replacing the export the demuxers call
function countParserCalls(load) {
    const sei = load('demux/sei.ts');
    const parseSEIMessages = sei.parseSEIMessages;
    const calls = { count: 0 };
    sei.parseSEIMessages = (...args) => {
        calls.count++;
        return parseSEIMessages(...args);
    };
    return calls;
}

function createFLVDemuxer(config, received) {
    const load = loadSource();
    const calls = countParserCalls(load);
    const FLVDemuxer = load('demux/flv-demuxer.js').default;
    const demuxer = new FLVDemuxer({ dataOffset: 9, hasAudioTrack: false, hasVideoTrack: true }, config);
    demuxer.onSeiArrived = sei => received.push([sei.pts, sei.type, sei.uuid_string]);
    return { demuxer, calls };
}

function parseFLVFrame(demuxer, timestamp, ...nalus) {
    const body = avcTagBody(...nalus);
    demuxer._parseAVCVideoData(body.buffer, 0, body.byteLength, timestamp, 0, 1, 20);
}

const SEI_NALU = h264Sei(seiMessage(1, Uint8Array.of(0xbb)), userDataUnregistered(UUID_A, ascii('1')));

test('FLV demuxer reports every SEI message with pts = dts + cts', () => {
    const received = [];
    const { demuxer } = createFLVDemuxer({}, received);

    parseFLVFrame(demuxer, 1000, SEI_NALU, h264.idr);

    assert.deepEqual(received, [[1020, 1, undefined], [1020, 5, UUID_A]]);
    assert.equal(demuxer._videoTrack.samples.length, 1);
});

test('FLV demuxer does not parse SEI when disabled, and follows updateSEIConfig', () => {
    const received = [];
    const config = { enableSEIParsing: false };
    const { demuxer, calls } = createFLVDemuxer(config, received);

    parseFLVFrame(demuxer, 0, SEI_NALU, h264.idr);
    assert.equal(calls.count, 0);
    // The frame itself, SEI NAL unit included, still goes to the remuxer
    assert.equal(demuxer._videoTrack.samples[0].units.length, 2);

    demuxer.updateSEIConfig({ enableSEIParsing: true, seiUUIDAllowlist: [UUID_A] });
    parseFLVFrame(demuxer, 40, SEI_NALU, h264.idr);
    assert.deepEqual(received, [[60, 5, UUID_A]]);

    demuxer.updateSEIConfig({ enableSEIParsing: true, seiUUIDAllowlist: [] });
    parseFLVFrame(demuxer, 80, SEI_NALU, h264.idr);
    assert.equal(calls.count, 1);
    assert.equal(received.length, 1);
});

function createTSDemuxer(config, received) {
    const load = loadSource();
    const calls = countParserCalls(load);
    const TSDemuxer = load('demux/ts-demuxer.ts').default;
    const demuxer = new TSDemuxer({ ts_packet_size: 188, sync_offset: 0 }, config);
    demuxer.has_video_ = true;
    demuxer.onMediaInfo = () => {};
    demuxer.onTrackMetadata = () => {};
    demuxer.onSEI = sei => received.push([sei.pts, sei.type, sei.uuid_string]);
    return { demuxer, calls };
}

test('TS demuxer reports H.264 SEI messages in milliseconds, filtered by the allowlist', () => {
    const received = [];
    const { demuxer } = createTSDemuxer({ seiUUIDAllowlist: [UUID_A] }, received);

    demuxer.parseH264Payload(annexB(h264.handBuiltSps(), h264.pps, SEI_NALU, h264.idr), 90000, 90000, 0, 0);

    assert.deepEqual(received, [[1000, 5, UUID_A]]);
});

test('TS demuxer reports H.265 prefix SEI messages', () => {
    const received = [];
    const { demuxer } = createTSDemuxer({}, received);

    demuxer.parseH265Payload(annexB(h265.vps, h265.spsNoTiming, h265.pps, h265PrefixSei(userDataUnregistered(UUID_B, ascii('x'))), h265.idr),
        180000, 180000, 0, 0);

    assert.deepEqual(received, [[2000, 5, UUID_B]]);
});

test('TS demuxer does not parse SEI when disabled, and follows updateSEIConfig', () => {
    const received = [];
    const { demuxer, calls } = createTSDemuxer({ enableSEIParsing: false }, received);
    const frame = annexB(h264.handBuiltSps(), h264.pps, SEI_NALU, h264.idr);

    demuxer.parseH264Payload(frame, 90000, 90000, 0, 0);
    assert.equal(calls.count, 0);

    demuxer.updateSEIConfig({ enableSEIParsing: true });
    demuxer.parseH264Payload(frame, 93600, 93600, 0, 0);
    assert.deepEqual(received, [[1040, 1, undefined], [1040, 5, UUID_A]]);
});

test('TransmuxingController.updateSEIConfig updates its config and the current demuxer', () => {
    const load = loadSource({ navigator: { userAgent: '' } });
    const TransmuxingController = load('core/transmuxing-controller.js').default;
    const config = { enableSEIParsing: true, seiUUIDAllowlist: null };
    const controller = new TransmuxingController({ type: 'flv', url: 'http://localhost/live.flv' }, config);
    const applied = [];
    controller._demuxer = { updateSEIConfig: c => applied.push({ ...c }) };

    controller.updateSEIConfig({ seiUUIDAllowlist: [UUID_A] });

    assert.deepEqual(config, { enableSEIParsing: true, seiUUIDAllowlist: [UUID_A] });
    assert.deepEqual(applied, [{ enableSEIParsing: true, seiUUIDAllowlist: [UUID_A] }]);
});
