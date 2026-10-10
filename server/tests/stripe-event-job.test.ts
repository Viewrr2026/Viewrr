import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStripeEventJob } from '../stripe-event-job';

function fixture(status = 'processed', type = 'charge.refunded') {
  const calls: string[] = [];
  const deps: any = {
    query: async (_sql: string, values: string[]) => {
      assert.deepEqual(values, ['evt_test']);
      return [{stripe_event_id:'evt_test',processing_status:status,raw_payload:null,event_type:type}];
    },
    retrieve: async () => { calls.push('retrieve'); return {id:'evt_test',type}; },
    process: async () => { calls.push('process'); },
    mark: async (_id: string, error?: string) => { calls.push(error ? 'failed' : 'processed'); },
  };
  return {deps,calls};
}
test('explicit historical refund replay retrieves from Stripe and processes; ordinary duplicate skips', async () => {
  const {deps,calls}=fixture();
  await runStripeEventJob({stripeEventId:'evt_test'},1,deps);
  assert.deepEqual(calls,[]);
  await runStripeEventJob({stripeEventId:'evt_test',replay:true},1,deps);
  assert.deepEqual(calls,['retrieve','process','processed']);
});
test('replay does not repeat already-processed payment fulfilment', async () => {
  const {deps,calls}=fixture('processed','payment_intent.succeeded');
  await runStripeEventJob({stripeEventId:'evt_test',replay:true},1,deps);
  assert.deepEqual(calls,[]);
});
test('failed events retry and retrieval failures propagate to durable queue', async () => {
  const {deps,calls}=fixture('failed');
  deps.retrieve=async()=>{throw new Error('Stripe unavailable');};
  await assert.rejects(runStripeEventJob({stripeEventId:'evt_test'},2,deps),/Stripe unavailable/);
  assert.deepEqual(calls,['failed']);
});
test('mismatched event cannot be processed', async () => {
  const {deps,calls}=fixture('failed');
  deps.retrieve=async()=>({id:'evt_other',type:'charge.refunded'});
  await assert.rejects(runStripeEventJob({stripeEventId:'evt_test'},2,deps),/does not match/);
  assert.deepEqual(calls,['failed']);
});
