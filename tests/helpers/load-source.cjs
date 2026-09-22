const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sourceRoot = path.resolve(__dirname, '../../src');
const compiled = new Map();

// Compile actual JS/TS modules to ES5 CommonJS, then give each test a separate
// module cache and global scope. No mutation of Node's navigator or require hooks.
module.exports = function loadSource(globals = {}) {
    const context = vm.createContext({ console, ...globals });
    const modules = new Map();

    function load(filename) {
        if (modules.has(filename)) {
            return modules.get(filename).exports;
        }

        if (!compiled.has(filename)) {
            const source = fs.readFileSync(filename, 'utf8');
            const result = ts.transpileModule(source, {
                fileName: filename,
                compilerOptions: {
                    target: ts.ScriptTarget.ES5,
                    module: ts.ModuleKind.CommonJS
                }
            });

            compiled.set(filename, result.outputText);
        }

        const module = { exports: {} };
        modules.set(filename, module);

        const localRequire = (specifier) => {
            if (!specifier.startsWith('.')) {
                return require(specifier);
            }

            const base = path.resolve(path.dirname(filename), specifier);
            const candidates = [base, `${base}.ts`, `${base}.js`];
            const resolved = candidates.find((candidate) => {
                return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
            });

            if (!resolved) {
                throw new Error(`Cannot resolve ${specifier} from ${filename}`);
            }

            return load(resolved);
        };

        const wrapperSource = [
            '(function(require, module, exports) {',
            compiled.get(filename),
            '})'
        ].join('\n');
        const wrapper = vm.runInContext(wrapperSource, context, { filename });

        wrapper(localRequire, module, module.exports);

        return module.exports;
    }

    return (relativePath) => load(path.resolve(sourceRoot, relativePath));
};
