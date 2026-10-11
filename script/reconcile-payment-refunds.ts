import Stripe from 'stripe';
import { retainerPool } from '../server/retainer-v1-db';
import { syncChargeRefunds } from '../server/payment-refund-sync';
if(!process.env.STRIPE_SECRET_KEY||!process.env.DATABASE_URL) throw new Error('Set the target environment Stripe key and DATABASE_URL.');
const apply=process.argv.includes('--apply');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2025-02-24.acacia' as any});
const db=retainerPool();
let cursor=0,count=0;
for(;;){
  const {rows}=await db.query(`SELECT id,public_id,stripe_charge_id FROM payments
    WHERE id>$1 AND stripe_charge_id IS NOT NULL ORDER BY id LIMIT 100`,[cursor]);
  if(!rows.length)break;
  for(const payment of rows){
    const charge=await stripe.charges.retrieve(payment.stripe_charge_id);
    if(charge.amount_refunded>0){
      console.log(JSON.stringify({payment:payment.public_id,refundedPence:charge.amount_refunded,action:apply?'reconcile':'dry-run'}));
      if(apply)await syncChargeRefunds(stripe,charge.id);
      count++;
    }
    cursor=payment.id;
  }
}
console.log(`${apply?'Reconciled':'Found'} ${count} payments with refunds. No Stripe money movement was requested.`);
process.exit(0);
