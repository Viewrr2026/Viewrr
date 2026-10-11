import type Stripe from 'stripe';
/** Recover only a definitive Accounts v1 policy rejection. Never change the key on
 * timeouts or ambiguous network failures, which could create duplicate accounts. */
export async function createCompatibleConnectAccount(stripe:Stripe,userId:number,params:Stripe.AccountCreateParams) {
  const key=`connect_account:${userId}:v1`;
  try{return await stripe.accounts.create(params,{idempotencyKey:key});}
  catch(error:any){
    if(error.type!=='StripeInvalidRequestError'||!/Accounts v1|feat_accounts_v1_support/.test(error.message??'')) throw error;
    return stripe.accounts.create(params,{idempotencyKey:`${key}:policy-retry`});
  }
}
