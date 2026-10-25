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
    process: { env: { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test.invalid/test' } },
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

test('Pro timing choices show both outcomes, the expiry date and the refund explanation', () => {
  const { DeletionTimingChoices } = loadSource('mobile/src/app/(app)/account/deletion.tsx', {}, ['DeletionTimingChoices']);
  const selected=[];
  const tree=DeletionTimingChoices({selected:null,onSelect:value=>selected.push(value),periodEnd:'2026-11-03T15:30:00Z',canScheduleEnd:true,disabled:false});
  for(const label of ['Immediate account deletion','At the end of Pro Viewrr']) {
    const radio=find(tree,node=>node.props?.accessibilityLabel===label);
    assert.ok(radio); assert.equal(radio.props.accessibilityState.checked,false); radio.props.onPress();
  }
  assert.deepEqual(selected,['immediate','pro_period_end']);
  assert.match(text(tree),/3 November 2026|November 3, 2026/);
  assert.match(text(tree),/does not automatically refund unused time/);
});

test('an unavailable paid-through date does not invent an end-of-Pro date', () => {
  const { DeletionTimingChoices } = loadSource('mobile/src/app/(app)/account/deletion.tsx', {}, ['DeletionTimingChoices']);
  const tree=DeletionTimingChoices({selected:null,onSelect:()=>{},periodEnd:null,canScheduleEnd:false,disabled:false});
  assert.equal(find(tree,node=>node.props?.accessibilityLabel==='At the end of Pro Viewrr').props.disabled,true);
  assert.equal(find(tree,node=>node.props?.accessibilityLabel==='Immediate account deletion').props.disabled,false);
  assert.match(text(tree),/expiry date is unavailable/);
});

for (const timing of ['immediate','pro_period_end']) {
  test(`native ${timing} selection reaches password confirmation and the API; only completed deletion signs out`, async () => {
    const requests=[],state=[]; let cursor=0, signedOut=0;
    const account=loadSource('mobile/src/api/account.ts',{
      '@/api/client':{api:{post:async(path,body)=>{
        requests.push({path,body});
        return path.endsWith('request-deletion')
          ? {state:'pending',message:'Enter your password.'}
          : {ok:true,state:timing==='immediate'?'anonymised':'scheduled',scheduledFor:'2026-11-03T15:30:00Z'};
      }}},
    });
    const status={state:'none',blockers:[{code:'active_pro_subscription'}],retention:[],pro:{periodEnd:'2026-11-03T15:30:00Z',canScheduleEnd:true},proDeletionTiming:null};
    const screen=loadSource('mobile/src/app/(app)/account/deletion.tsx',{
      react:{useState:initial=>{const i=cursor++; if(!(i in state))state[i]=initial; return [state[i],value=>{state[i]=value;}];},useCallback:fn=>fn},
      'expo-router':{useRouter:()=>({back(){}})},
      '@/api/account':account,
      '@/session/SessionProvider':{useSession:()=>({signOut:async()=>{signedOut++;}})},
      '@/hooks/useAsyncResource':{useAsyncResource:()=>({resource:{phase:'ready',data:status}})},
    });
    const render=()=>{cursor=0; const outer=screen.default(); return find(outer,node=>node.type==='DataState').props.children(status);};
    let tree=render();
    assert.equal(find(tree,node=>node.type==='Button'&&node.props.variant==='destructive').props.disabled,true);
    find(tree,node=>typeof node.type==='function'&&node.type.name==='DeletionTimingChoices').props.onSelect(timing);
    tree=render(); find(tree,node=>node.type==='Button'&&node.props.variant==='destructive').props.onPress();
    await new Promise(resolve=>setImmediate(resolve));
    tree=render(); find(tree,node=>node.type==='TextField').props.onChangeText('test-password');
    tree=render(); find(tree,node=>node.type==='Button'&&node.props.variant==='destructive').props.onPress();
    tree=render(); find(tree,node=>node.type==='ActionSheet').props.actions[0].onPress();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(requests)),[
      {path:'/api/me/request-deletion',body:{proDeletionTiming:timing}},
      {path:'/api/me/confirm-deletion',body:{password:'test-password',proDeletionTiming:timing}},
    ]);
    assert.equal(signedOut,timing==='immediate'?1:0);
    assert.ok(!state.includes('test-password'),'password is cleared after confirmation');
  });
}

test('account adapter keeps older responses compatible and preserves server timing on new responses', async () => {
  let raw={state:'none'};
  const account=loadSource('mobile/src/api/account.ts',{'@/api/client':{api:{get:async()=>raw}}});
  let result=await account.fetchDeletionStatus();
  assert.equal(result.pro,null); assert.equal(result.proDeletionTiming,null); assert.equal(result.proDeleteAfter,null);
  raw={state:'scheduled',pro:{periodEnd:'2026-11-03T15:30:00Z',canScheduleEnd:true},proDeletionTiming:'pro_period_end',proDeleteAfter:'2026-11-03T15:30:00Z'};
  result=await account.fetchDeletionStatus();
  assert.equal(result.pro.canScheduleEnd,true); assert.equal(result.proDeleteAfter,raw.proDeleteAfter); assert.equal(result.proDeletionTiming,'pro_period_end');
});

function confirmationHandler(mocks) {
  const source=readFileSync(resolve(root,'server/routes.ts'),'utf8');
  const file=ts.createSourceFile('routes.ts',source,ts.ScriptTarget.Latest,true);
  let registration;
  const visit=node=>{
    if(ts.isCallExpression(node)&&node.expression.getText(file)==='app.post'&&node.arguments[0]?.text==='/api/me/confirm-deletion') registration=node;
    ts.forEachChild(node,visit);
  };
  visit(file);
  assert.equal(registration.arguments[1].getText(file),'requireAuth');
  const code=ts.transpileModule(`exports.handler=${registration.arguments[2].getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={}; vm.runInNewContext(code,{exports,console:{error(){},warn(){}},...mocks}); return exports.handler;
}

for(const password of [undefined,'wrong','correct']) {
  test(`deletion endpoint authenticates ${password??'missing'} password before persisting intent or touching billing`,async()=>{
    const events=[]; let status=200,body;
    const handler=confirmationHandler({
      storage:{getUser:async()=>({email:'test@example.invalid'}),getUserByEmail:async()=>({passwordHash:'hash'})},
      verifyPassword:async value=>({valid:value==='correct'}),
      parseProDeletionTiming:value=>value,
      withAccountDeletionLock:async(user,run)=>{assert.equal(user,7); events.push('lock');return run({});},
      checkDeletionBlockers:async()=>({}),
      recordConfirmedDeletion:async(_db,user,_assessment,timing)=>{assert.equal(user,7);assert.equal(timing,'immediate');events.push('record');return 42;},
      enqueueJob:async()=>events.push('queue'),
      processConfirmedDeletion:async()=>{events.push('billing-and-cleanup');return {state:'anonymised'};},
      anonymiseUserAccount:()=>{},clearSessionCookie:()=>events.push('sign-out'),
    });
    await handler({auth:{userId:7},body:{password,proDeletionTiming:'immediate'}},{status(value){status=value;return this;},json(value){body=value;return this;}});
    assert.equal(status,password==='correct'?200:password===undefined?400:403);
    assert.deepEqual(events,password==='correct'?['lock','record','queue','billing-and-cleanup','sign-out']:[]);
    assert.ok(body);
  });
}

test('deletion uses a transaction-scoped lock while consent writes commit independently', async () => {
  const events=[],committed=[];
  const service=loadSource('server/services/pro-deletion.ts',{
    '@neondatabase/serverless':{neon:()=>({query:async(text,values)=>{events.push('write');committed.push({text,values});return [];}})},
    '../retainer-v1-db':{retainerTransaction:async run=>{
      events.push('begin');
      try { const result=await run({query:async(text,values)=>{
        assert.equal(text,'SELECT pg_advisory_xact_lock(17342, $1)'); assert.equal(values[0],7); events.push('lock');
      }}); events.push('commit');return result;
      } catch(error){events.push('rollback');throw error;}
    }},
  });
  // The function needs a URL only to instantiate the mocked HTTP client.
  // Supply process through the loader's runtime below, never a live database.
  await assert.rejects(service.withAccountDeletionLock(7,async db=>{
    await db.query('persist confirmed consent',[7]);
    throw Error('simulated Stripe failure');
  }),/simulated Stripe failure/);
  assert.deepEqual(events,['begin','lock','write','rollback']);
  assert.equal(committed.length,1);
});
