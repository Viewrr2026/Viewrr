const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props });
const components = new Proxy({}, { get: (_, name) => String(name) });

// Exercise the actual adapters, rendered rows and event handlers without a
// device or network. Unused screens/imports are stubbed; JSX stays inspectable.
function loadSource(file, mocks = {}, extraExports = []) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const { outputText } = ts.transpileModule(
    source + (extraExports.length ? `\nexport { ${extraExports.join(', ')} };` : ''),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file },
  );
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (id) => mocks[id] ?? ({
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'react-native': { Text: 'Text', View: 'View', StyleSheet: { create: (styles) => styles } },
      '@/theme': { useTheme: () => ({ colors: {} }), radii: {}, spacing: {}, typography: {} },
    }[id] ?? components),
  }, { filename: file });
  return exports;
}

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (typeof node === 'object') return text(node.props?.children);
  return String(node);
}

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

async function retentionRows(retention) {
  const account = loadSource('mobile/src/api/account.ts', {
    '@/api/client': { api: { get: async (path) => {
      assert.equal(path, '/api/me/deletion-status');
      return { state: 'none', retention };
    } } },
  });
  const { RetentionRow } = loadSource('mobile/src/app/(app)/account/deletion.tsx', {}, ['RetentionRow']);
  return (await account.fetchDeletionStatus()).retention.map((entry) => text(RetentionRow({ entry })));
}

test('retention details survive the API adapter and appear in the rendered native row', async () => {
  const detail = 'Shared contractual files require a retention review.';
  const [row] = await retentionRows([{ category: 'Work files', action: 'retained', periodDays: 730, detail }]);
  assert.ok(row.includes('Work files'));
  assert.ok(row.includes('Retention review period: 730 days.'));
  assert.ok(row.includes(detail));
});

test('older or incomplete retention responses render without promising missing explanations', async () => {
  const rows = await retentionRows([
    { category: 'Account', action: 'anonymised', periodDays: 0 },
    { category: 'Records', action: 'retained', periodDays: 730, detail: 123 },
    { category: 'Other records', action: 'retained', periodDays: 0, detail: '   ' },
    null,
  ]);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.doesNotMatch(row, /below|undefined|null|123/);
});

async function submitReview(role, serverError) {
  const state = [5, 0, '  Excellent completed project.  ', false, ''];
  let stateIndex = 0;
  const requests = [], invalidations = [], closed = [];
  const { ReviewModal } = loadSource('client/src/pages/YourWork.tsx', {
    react: { useState: () => {
      const index = stateIndex++;
      return [state[index], (value) => { state[index] = value; }];
    } },
    '@/lib/queryClient': {
      apiRequest: async (method, path, body) => {
        requests.push({ method, path, body });
        // Public discovery remains unavailable for the blocked counterparty.
        if (method === 'GET') throw new Error('404: Profile not found');
        if (serverError) throw new Error(serverError);
        return { ok: true };
      },
      queryClient: { invalidateQueries: (key) => invalidations.push(key) },
    },
  }, ['ReviewModal']);
  const tree = ReviewModal({
    open: true, role, onClose: (submitted) => closed.push(submitted),
    currentUser: { id: 1, name: 'Reviewer' },
    pw: { project: { id: 42, status: 'completed', briefCategory: 'Video' },
      client: { id: 1, name: 'Client' }, freelancer: { id: 2, name: 'Freelancer' } },
  });
  const button = find(tree, (node) => typeof node.props?.onClick === 'function' && text(node) === 'Publish review');
  assert.ok(button, 'the review submission control exists');
  await button.props.onClick();
  return { requests: JSON.parse(JSON.stringify(requests)), invalidations, closed, state };
}

for (const role of ['client', 'freelancer']) {
  test(`${role} can submit a project review when the public profile is unavailable`, async () => {
    const result = await submitReview(role);
    assert.deepEqual(result.requests, [{ method: 'POST', path: '/api/reviews', body: {
      rating: 5, comment: 'Excellent completed project.', projectType: 'Video', projectId: 42, role,
    } }]);
    assert.deepEqual(result.closed, [true]);
    assert.equal(result.invalidations.length, 1);
    assert.equal(result.state[3], false);
  });
}

test('a server-rejected review stays open and shows the server error', async () => {
  const result = await submitReview('client', 'Reviews are only accepted on completed projects');
  assert.deepEqual(result.closed, []);
  assert.equal(result.invalidations.length, 0);
  assert.equal(result.state[3], false);
  assert.equal(result.state[4], 'Reviews are only accepted on completed projects');
});
