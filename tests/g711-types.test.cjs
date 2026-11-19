const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

test('G.711 decoder and transcoder type-check strictly and emit declarations', (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpegts-g711-types-'));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const root = path.resolve(__dirname, '..');
    const program = ts.createProgram([
        path.join(root, 'src/demux/g711.ts'),
        path.join(root, 'src/demux/g711-transcoder.ts')
    ], {
        strict: true, allowJs: true, declaration: true,
        target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS,
        lib: ['lib.es5.d.ts', 'lib.dom.d.ts'], types: [],
        rootDir: path.join(root, 'src'), outDir, ignoreDeprecations: '6.0'
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n'
    }));
    const result = program.emit();
    assert.equal(result.emitSkipped, false);
    assert.equal(result.diagnostics.length, 0);
    assert.ok(fs.existsSync(path.join(outDir, 'demux/g711.d.ts')));
    assert.ok(fs.existsSync(path.join(outDir, 'demux/g711-transcoder.d.ts')));
});
