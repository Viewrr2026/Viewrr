const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const query = require('query-string');

test('router query parser retains unicode, spaces, repeated keys and encoded URLs', () => {
  const input = { name: 'Café £100', tag: ['film', 'photo'], returnTo: 'https://www.viewrr.co.uk/#/your-work' };
  assert.deepEqual({ ...query.parse(query.stringify(input)) }, input);
  assert.equal(query.parse('name=Matt+Burroughs').name, 'Matt Burroughs');
  assert.equal(query.parse('empty=&flag').empty, '');
  assert.equal(query.parse('empty=&flag').flag, null);
});

test('malformed percent-encoded queries terminate without hanging navigation', () => {
  // Run in a child with a hard timeout so a vulnerable decoder cannot hang CI.
  execFileSync(process.execPath, ['-e', `
    const q = require('query-string');
    const assert = require('node:assert/strict');
    for (const value of ['%C0%AF'.repeat(2000), '%E0%A4'.repeat(2000), '%'.repeat(12000)]) {
      assert.equal(typeof q.parse('value=' + value).value, 'string');
    }
  `], { cwd: require('node:path').resolve(__dirname, '..'), timeout: 5000, stdio: 'pipe' });
});

test('shell quoting rejects newline tokens after comments', () => {
  const { quote } = require('shell-quote');
  assert.throws(() => quote(['echo', { comment: 'note' }, 'value\nexample']), TypeError);
});

test('patched brace expansion preserves ordinary build globs', () => {
  const { braceExpand: expand } = require('minimatch');
  assert.deepEqual(expand('src/{app,lib}/*.tsx'), ['src/app/*.tsx', 'src/lib/*.tsx']);
});

test('query parser accepts the Babel-transformed ESM decoder used by mobile tooling', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const babel = require('@babel/core');
  const decoderFile = require.resolve('decode-uri-component');
  const { code } = babel.transformFileSync(decoderFile, {
    configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  const decoderModule = { exports: {} };
  vm.runInNewContext(code, { module: decoderModule, exports: decoderModule.exports });
  const queryFile = require.resolve('query-string');
  const localRequire = createRequire(queryFile);
  const queryModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(queryFile, 'utf8'), {
    module: queryModule, exports: queryModule.exports,
    require: name => name === 'decode-uri-component' ? decoderModule.exports : localRequire(name),
  });
  assert.equal(queryModule.exports.parse('name=Caf%C3%A9').name, 'Café');
  assert.equal(queryModule.exports.parse('bad=%C0%AF').bad, '%C0%AF');
});
