const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

test('browser API type-checks strictly and emits its own declarations', (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpegts-browser-types-'));

    t.after(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    const root = path.resolve(__dirname, '..');
    const sourceFiles = [
        path.join(root, 'tests/browser-types.ts'),
        path.join(root, 'src/utils/browser-compatibility.ts')
    ];
    const compilerOptions = {
        strict: true,
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS,
        lib: ['lib.es5.d.ts', 'lib.dom.d.ts'],
        types: [],
        declaration: true,
        rootDir: root,
        outDir,
        ignoreDeprecations: '6.0'
    };

    const program = ts.createProgram(sourceFiles, compilerOptions);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const diagnosticText = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n'
    });

    assert.equal(diagnostics.length, 0, diagnosticText);

    const result = program.emit();

    assert.equal(result.emitSkipped, false);
    assert.equal(result.diagnostics.length, 0);
    assert.ok(fs.existsSync(path.join(outDir, 'src/utils/browser.d.ts')));
    assert.ok(fs.existsSync(path.join(outDir, 'src/utils/browser-compatibility.d.ts')));
});
