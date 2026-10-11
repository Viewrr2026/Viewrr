import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompatibleConnectAccount } from '../connect-account-create';
test('cached policy refusal permits one stable compatibility retry, but network errors do not',async()=>{
  const keys:string[]=[];const params={type:'express' as const};
  const stripe:any={accounts:{create:async(p:any,o:any)=>{assert.deepEqual(p,params);keys.push(o.idempotencyKey);if(keys.length===1)throw Object.assign(new Error('Enable Accounts v1 support'),{type:'StripeInvalidRequestError'});return{id:'acct_test'};}}};
  assert.equal((await createCompatibleConnectAccount(stripe,61,params)).id,'acct_test');
  assert.deepEqual(keys,['connect_account:61:v1','connect_account:61:v1:policy-retry']);
  let count=0;stripe.accounts.create=async()=>{count++;throw new Error('Connection timeout');};
  await assert.rejects(createCompatibleConnectAccount(stripe,61,params),/timeout/);assert.equal(count,1);
});
