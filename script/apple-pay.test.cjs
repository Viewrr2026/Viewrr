const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const project = { kind: 'project', projectId: 42 };
const cycle = { kind: 'cycle', projectId: 42, cycleId: 'cycle-42' };
const checkout = { clientSecret: 'pi_fixture_secret_example', publishableKey: 'pk_test_fixture', reference: 'pay_fixture', amountPence: 12500 };

function source(path, mocks = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: path,
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: id => {
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`);
    return mocks[id];
  }, ...globals }, { filename: path });
  return exports;
}

test('invoice adapters submit only identifiers and preserve server-priced checkout', async () => {
  const requests = [];
  const api = source('mobile/src/api/payments.ts', { '@/api/client': { api: { post: async (path, body) => {
    requests.push([path, body]);
    return { ...checkout, paymentIntentId: 'pay_fixture', paymentPublicId: 'pay_cycle' };
  } } } });
  assert.deepEqual(plain(await api.createInvoicePayment(project)), checkout);
  assert.equal((await api.createInvoicePayment(cycle)).reference, 'pay_cycle');
  assert.deepEqual(plain(requests), [['/api/stripe/create-payment-intent', { projectId: 42 }], ['/api/retainer-cycles/cycle-42/payments', {}]]);
});

test('malformed checkout responses never reach the native wallet', async () => {
  for (const patch of [{ amountPence: -10 }, { amountPence: 1.2 }, { publishableKey: '' }, { clientSecret: null }, { paymentIntentId: null }]) {
    const api = source('mobile/src/api/payments.ts', { '@/api/client': { api: { post: async () => ({ ...checkout, paymentIntentId: 'pay_fixture', ...patch }) } } });
    await assert.rejects(api.createInvoicePayment(project), /Checkout is not available/);
  }
});

test('adapters require explicit server verification for project and cycle receipts', async () => {
  let response = { status: 'succeeded' };
  const api = source('mobile/src/api/payments.ts', { '@/api/client': { api: { post: async () => response, get: async () => response } } });
  assert.equal(await api.verifyInvoicePayment(project, 'pay_fixture'), 'confirming');
  assert.equal(await api.verifyInvoicePayment(cycle, 'pay_fixture'), 'confirming');
  response = { status: 'succeeded', ok: true, verified: true };
  assert.equal(await api.verifyInvoicePayment(project, 'pay_fixture'), 'paid');
  assert.equal(await api.verifyInvoicePayment(cycle, 'pay_fixture'), 'paid');
  response = { status: 'refunded' };
  assert.equal(await api.verifyInvoicePayment(cycle, 'pay_fixture'), 'unavailable');
});

function native(options = {}) {
  const events = [], storage = options.storage ?? new Map();
  let verified = options.verified ?? 'paid';
  const exports = source('mobile/src/payments/checkout.ts', {
    '@stripe/stripe-react-native': {
      initStripe: async params => events.push(['init', plain(params)]),
      initPaymentSheet: async params => { events.push(['sheet', plain(params)]); return options.initError ? { error: {} } : {}; },
      presentPaymentSheet: async () => { events.push(['present']); return options.present ? options.present() : (options.error ? { error: options.error } : {}); },
    },
    'expo-secure-store': {
      getItemAsync: async key => storage.get(key) ?? null,
      setItemAsync: async (key, value) => { if (options.storageError) throw new Error('storage failed'); storage.set(key, value); events.push(['saved', value]); },
      deleteItemAsync: async key => storage.delete(key),
    },
    '@/api/payments': {
      createInvoicePayment: async () => { events.push(['create']); return options.alreadyPending ? { status: 'confirming' } : checkout; },
      verifyInvoicePayment: async () => { events.push(['verify']); if (options.verifyError) throw new Error('offline'); return verified; },
    },
    '@/config/env': { APPLE_MERCHANT_ID: 'merchant.uk.co.viewrr.app', PAYMENT_URL_SCHEME: 'viewrr' },
  });
  return { ...exports, storage, events, setVerified: state => { verified = state; } };
}

test('native Apple Pay uses the configured merchant, GBP invoice and verified receipt', async () => {
  const flow = native();
  assert.equal(await flow.payInvoice(1, project), 'paid');
  assert.equal(flow.events.find(e => e[0] === 'init')[1].merchantIdentifier, 'merchant.uk.co.viewrr.app');
  const sheet = flow.events.find(e => e[0] === 'sheet')[1];
  assert.deepEqual(sheet.applePay, { merchantCountryCode: 'GB' });
  assert.equal(sheet.paymentIntentClientSecret, checkout.clientSecret);
  assert.equal(sheet.returnURL, 'viewrr://stripe-redirect');
  assert.equal(sheet.allowsDelayedPaymentMethods, false);
  assert.ok(flow.events.findIndex(e => e[0] === 'saved') < flow.events.findIndex(e => e[0] === 'present'));
  assert.equal(flow.storage.size, 0);
});

test('native SDK success with pending verification persists only the public reference', async () => {
  const flow = native({ verified: 'confirming' });
  assert.equal(await flow.payInvoice(1, project), 'confirming');
  assert.deepEqual([...flow.storage.values()], ['pay_fixture']);
  assert.equal(await flow.payInvoice(1, project), 'confirming');
  assert.equal(flow.events.filter(e => e[0] === 'create').length, 1);
  flow.setVerified('paid');
  assert.equal(await flow.checkPendingInvoice(1, project), 'paid');
  assert.equal(flow.storage.size, 0);
});

test('app restart checks the saved reference before creating another payment', async () => {
  const storage = new Map([['invoice-payment.1.project.42', 'pay_fixture']]);
  const flow = native({ storage });
  assert.equal(await flow.payInvoice(1, project), 'paid');
  assert.equal(flow.events.filter(e => e[0] === 'create').length, 0);
  assert.equal(await flow.checkPendingInvoice(2, project), null);
});

test('cancelled wallet stays unpaid and releases checkout only after server check', async () => {
  const flow = native({ error: { code: 'Canceled' }, verified: 'payable' });
  assert.equal(await flow.payInvoice(1, project), 'cancelled');
  assert.equal(flow.storage.size, 0);
  assert.equal(flow.events.at(-1)[0], 'verify');
});

test('cancellation callback cannot override a payment already verified by the server', async () => {
  assert.equal(await native({ error: { code: 'Canceled' } }).payInvoice(1, project), 'paid');
});

test('network loss after presentation holds the invoice for later verification', async () => {
  const flow = native({ verifyError: true });
  assert.equal(await flow.payInvoice(1, project), 'confirming');
  assert.equal(flow.storage.size, 1);
  await assert.rejects(flow.payInvoice(1, project), /offline/);
  assert.equal(flow.events.filter(e => e[0] === 'create').length, 1);
});

test('initialization and storage failures stop before payment presentation', async () => {
  for (const options of [{ initError: true }, { storageError: true }]) {
    const flow = native(options);
    await assert.rejects(flow.payInvoice(1, project));
    assert.equal(flow.events.some(e => e[0] === 'present'), false);
  }
});

test('native checkout serializes double taps and concurrent invoice buttons', async () => {
  let release;
  const flow = native({ present: () => new Promise(resolve => { release = resolve; }) });
  const first = flow.payInvoice(1, project);
  assert.equal(await flow.payInvoice(1, cycle), 'busy');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(await flow.checkPendingInvoice(1, project), 'confirming');
  assert.equal(flow.storage.size, 1);
  release({});
  assert.equal(await first, 'paid');
});

test('existing processing cycle survives navigation and checks without a new charge', async () => {
  const flow = native({ alreadyPending: true, verified: 'confirming' });
  assert.equal(await flow.payInvoice(1, cycle), 'confirming');
  assert.equal(flow.events.some(e => e[0] === 'present'), false);
  flow.setVerified('paid');
  assert.equal(await flow.checkPendingInvoice(1, cycle), 'paid');
});

const jsx = (type, props) => ({ type, props });
function find(node, type) {
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  if (!node || typeof node !== 'object') return;
  return node.type === type ? node : find(node.props?.children, type);
}
function web(options = {}) {
  const events = [], states = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const exports = source('client/src/components/InvoicePaymentForm.tsx', {
    react: {
      useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef: initial => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/ui/button': { Button: 'Button' },
    '@stripe/react-stripe-js': {
      ExpressCheckoutElement: 'Wallet', PaymentElement: 'Card',
      useElements: () => ({ submit: async () => { events.push('validate'); return options.invalid ? { error: { message: 'Invalid details' } } : {}; } }),
      useStripe: () => ({ confirmPayment: async () => {
        events.push('confirm');
        if (options.thrown) throw new Error('network');
        return options.error ? { error: options.error } : { paymentIntent: { status: options.status ?? 'succeeded', id: 'pi_fixture' } };
      } }),
    },
  }, { window: { location: { href: 'https://www.viewrr.co.uk/#/invoice/42', reload() {} } } });
  const props = { amountPence: 12500, verify: async id => { assert.equal(id, 'pi_fixture'); events.push('verify'); return options.verified ?? true; }, onPaid: () => events.push('paid'), onSubmitted: () => events.push('pending') };
  return { events, render: () => { stateIndex = 0; refIndex = 0; return exports.InvoicePaymentForm(props); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('web Apple Pay and cards share server verification and prevent duplicate submits', async () => {
  const ui = web(), tree = ui.render();
  find(tree, 'Wallet').props.onConfirm({ paymentFailed() {} });
  find(tree, 'form').props.onSubmit({ preventDefault() {} });
  await flush();
  find(tree, 'form').props.onSubmit({ preventDefault() {} });
  await flush();
  assert.deepEqual(ui.events, ['validate', 'confirm', 'verify', 'paid']);
  assert.equal(find(ui.render(), 'Wallet'), undefined);
});

test('web card fallback remains usable on browsers without wallets', async () => {
  const ui = web();
  find(ui.render(), 'Wallet').props.onReady({ availablePaymentMethods: undefined });
  find(ui.render(), 'Card').props.onReady();
  const tree = ui.render();
  assert.equal(find(tree, 'Button').props.disabled, false);
  assert.equal(find(tree, 'Card').props.options.wallets.applePay, 'never');
});

test('web pending verification and connection failures never show a paid receipt', async () => {
  for (const options of [{ verified: false }, { thrown: true }, { status: 'processing' }, { error: { type: 'api_connection_error' } }]) {
    const ui = web(options);
    find(ui.render(), 'Wallet').props.onConfirm({ paymentFailed() {} });
    await flush();
    assert.ok(ui.events.includes('pending'));
    assert.equal(ui.events.includes('paid'), false);
    assert.equal(find(ui.render(), 'Wallet'), undefined);
  }
});

test('web validation and card declines are retryable without marking paid', async () => {
  for (const options of [{ invalid: true }, { error: { type: 'card_error', message: 'Declined' } }]) {
    const ui = web(options);
    find(ui.render(), 'Wallet').props.onConfirm({ paymentFailed() {} });
    await flush();
    assert.equal(ui.events.includes('paid'), false);
    assert.equal(ui.events.includes('pending'), false);
    assert.ok(find(ui.render(), 'Card'));
  }
});

function legacy(options = {}) {
  const calls = [];
  const cycleRow = { id: 1, client_id: 10, status: options.noExisting ? 'awaiting_payment' : 'payment_processing', amount_pence: 12500, currency: 'gbp', retainer_agreement_id: 5 };
  const db = async (sql, ...values) => {
    const query = sql.join('?'); calls.push(query);
    if (query.includes('SELECT rc.*')) return [cycleRow];
    if (query.includes('SELECT workflow_version')) return [{ workflow_version: 0 }];
    if (query.includes('SELECT * FROM users')) return [{ stripe_account_id: options.accountId }];
    if (query.includes('SELECT * FROM payments')) return options.noExisting ? [] : [{ stripe_payment_intent_id: 'pi_fixture', public_id: 'pay_fixture', gross_pence: 12500, transfer_strategy: 'direct_transfer' }];
    throw new Error(`Unexpected query ${query}`);
  };
  const exports = source('server/retainer-service.ts', {
    stripe: class {
      accounts = { retrieve: async () => ({ charges_enabled: false, capabilities: { transfers: 'inactive' } }) };
      paymentIntents = { retrieve: async id => {
        assert.equal(id, 'pi_fixture');
        if (options.offline) throw new Error('offline');
        return { id, status: options.status ?? 'requires_payment_method', amount: options.amount ?? 12500, currency: 'gbp', client_secret: checkout.clientSecret };
      }, create: async () => assert.fail('Must reuse the existing payment') };
    },
    '@neondatabase/serverless': { neon: () => db },
    './payment-service': { VIEWRR_FEE_PERCENT: 11 },
    './job-queue': {},
  }, { process: { env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PUBLISHABLE_KEY: checkout.publishableKey } } });
  return { ...exports, calls };
}

test('older retainer invoices resume the same intent after closing a wallet or authentication', async () => {
  for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action']) {
    const flow = legacy({ status });
    const result = await flow.createRetainerPayment('cycle-42', 10);
    assert.equal(result.paymentIntentId, 'pi_fixture');
    assert.equal(result.amountPence, 12500);
    assert.equal(flow.calls.some(sql => /INSERT|UPDATE/.test(sql)), false);
  }
});

test('processing older retainer invoices cannot create another payment', async () => {
  for (const status of ['processing', 'succeeded', 'requires_capture']) {
    assert.equal((await legacy({ status }).createRetainerPayment('cycle-42', 10)).status, 'confirming');
  }
});

test('older retainer checkout fails closed for wrong callers, uncertain Stripe status and changed amounts', async () => {
  await assert.rejects(legacy().createRetainerPayment('cycle-42', 11), /permission/);
  for (const options of [{ offline: true }, { amount: 1 }, { status: 'canceled' }])
    await assert.rejects(legacy(options).createRetainerPayment('cycle-42', 10), /check the existing payment/);
});


test('older retainer checkout requires the freelancer to be ready for Stripe payouts', async () => {
  for (const accountId of [undefined, 'acct_fixture'])
    await assert.rejects(legacy({ noExisting: true, accountId }).createRetainerPayment('cycle-42', 10), /finish payout setup/);
});
