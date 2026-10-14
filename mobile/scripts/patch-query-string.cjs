// SDK 57's CommonJS query-string needs the default export of the patched ESM decoder.
// Fail closed if upstream changes: never silently build with a missing/drifted patch.
const fs = require('node:fs');
const path = require('node:path');
const packageFile = require.resolve('query-string/package.json');
const { version } = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
if (version !== '7.1.3') throw new Error('Review the query-string compatibility patch for version ' + version);
const file = path.join(path.dirname(packageFile), 'index.js');
const original = "const decodeComponent = require('decode-uri-component');";
const patched = [
  '// Viewrr: decode-uri-component 0.5 is ESM; support its default export in Metro and Node.',
  "const decoderModule = require('decode-uri-component');",
  'const decodeComponent = decoderModule.default || decoderModule;',
].join('\n');
const source = fs.readFileSync(file, 'utf8');
if (source.includes(patched) && !source.includes(original)) {
  console.log('query-string decoder compatibility patch already applied');
} else if (source.split(original).length === 2 && !source.includes(patched)) {
  fs.writeFileSync(file, source.replace(original, patched));
  console.log('Applied query-string decoder compatibility patch');
} else {
  throw new Error('query-string source changed; review the decoder compatibility patch');
}
