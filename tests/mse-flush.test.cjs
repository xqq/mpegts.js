const assert = require('node:assert/strict');
const test = require('node:test');
const loadSource = require('./helpers/load-source.cjs');

const chrome = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const safari = 'Mozilla/5.0 AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

function controller(userAgent = chrome) {
    const MSEController = loadSource({ navigator: { userAgent }, self: {} })('core/mse-controller.js').default;
    const instance = new MSEController({});
    instance._mediaSource = { readyState: 'open' };
    return instance;
}

function sourceBuffer(ranges = []) {
    const removed = [];
    return {
        removed,
        updating: false,
        abort() {},
        remove(start, end) { removed.push([start, end]); },
        get buffered() {
            return {
                length: ranges.length,
                start: index => ranges[index][0],
                end: index => ranges[index][1]
            };
        }
    };
}

test('flush tolerates worker detachment before MediaSource readyState changes', () => {
    const mse = controller();
    const buffer = sourceBuffer();
    const error = Object.assign(new Error('Worker MediaSource attachment is closing'), { name: 'InvalidStateError' });
    Object.defineProperty(buffer, 'buffered', { get() { throw error; } });
    mse._sourceBuffers.video = buffer;
    mse._pendingSegments.video.push({ data: new Uint8Array([1]) });
    mse._pendingRemoveRanges.video.push({ start: 1, end: 2 });

    assert.doesNotThrow(() => mse.flush());
    assert.equal(mse._mediaSource.readyState, 'open');
    assert.equal(mse._pendingSegments.video.length, 0);
    assert.equal(mse._pendingRemoveRanges.video.length, 0);
    assert.deepEqual(buffer.removed, []);
});

test('flush preserves unexpected buffered getter errors', () => {
    const mse = controller();
    const buffer = sourceBuffer();
    const error = new TypeError('unexpected failure');
    Object.defineProperty(buffer, 'buffered', { get() { throw error; } });
    mse._sourceBuffers.video = buffer;
    assert.throws(() => mse.flush(), thrown => thrown === error);
});

test('flush uses one buffered snapshot if detachment follows the first getter', () => {
    const mse = controller();
    const buffer = sourceBuffer();
    let reads = 0;
    Object.defineProperty(buffer, 'buffered', {
        get() {
            reads++;
            if (reads > 1) {
                throw Object.assign(new Error('detached'), { name: 'InvalidStateError' });
            }
            return { length: 1, start: () => 1, end: () => 2 };
        }
    });
    mse._sourceBuffers.video = buffer;
    mse.flush();
    assert.equal(reads, 1);
    assert.deepEqual(buffer.removed, [[1, 2]]);
});

test('flush continues removing ranges from the other attached track', () => {
    const mse = controller();
    const video = sourceBuffer();
    Object.defineProperty(video, 'buffered', {
        get() { throw Object.assign(new Error('detached'), { name: 'InvalidStateError' }); }
    });
    const audio = sourceBuffer([[3, 4]]);
    mse._sourceBuffers.video = video;
    mse._sourceBuffers.audio = audio;
    mse.flush();
    assert.deepEqual(audio.removed, [[3, 4]]);
});

test('flush keeps pending range removal while SourceBuffer is updating', () => {
    const mse = controller();
    const buffer = sourceBuffer([[1, 2], [3, 4]]);
    buffer.updating = true;
    mse._sourceBuffers.video = buffer;
    mse.flush();
    assert.deepEqual(buffer.removed, []);
    assert.equal(mse._pendingRemoveRanges.video.length, 2);
    buffer.updating = false;
    mse._doRemoveRanges();
    assert.deepEqual(buffer.removed, [[1, 2], [3, 4]]);
});

test('flush preserves Safari init-segment reappend for an attached buffer', () => {
    const mse = controller(safari);
    const buffer = sourceBuffer([[1, 2]]);
    mse._sourceBuffers.video = buffer;
    const init = { type: 'video', data: new Uint8Array([1, 2, 3]) };
    mse._lastInitSegments.video = init;
    let appends = 0;
    mse._doAppendSegments = () => {
        appends++;
        assert.equal(mse._pendingSegments.video[0], init);
    };
    mse.flush();
    assert.deepEqual(buffer.removed, [[1, 2]]);
    assert.equal(appends, 1);
});
