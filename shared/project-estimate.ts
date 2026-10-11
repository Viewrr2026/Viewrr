import { z } from 'zod';
export const estimateSchema = z.object({
  lineItems:z.array(z.object({description:z.string().trim().min(1).max(500),quantity:z.number().positive().max(10000),unitPricePence:z.number().int().nonnegative().max(10_000_000)})).min(1).max(100),
  vatPercent:z.number().min(0).max(100).default(0),
  notes:z.string().trim().max(4000).default(''),
});
export function calculateEstimate(raw:unknown) {
  const input=estimateSchema.parse(raw);
  const lineItems=input.lineItems.map(i=>({...i,totalPence:Math.round(i.quantity*i.unitPricePence)}));
  const subtotalPence=lineItems.reduce((n,i)=>n+i.totalPence,0);
  const vatPence=Math.round(subtotalPence*input.vatPercent/100);
  const totalPence=subtotalPence+vatPence;
  if (!Number.isSafeInteger(totalPence)||totalPence<50||totalPence>10_000_000) throw Object.assign(new Error('Total must be between £0.50 and £100,000'),{status:400});
  return {...input,lineItems,subtotalPence,vatPence,totalPence};
}
export function invitationEstimate(title:string,budget:unknown) {
  const amount=String(budget??'').trim().replace(/^£\s*/, '').replace(/,/g,'');
  if(!/^\d+(\.\d{1,2})?$/.test(amount)) throw Object.assign(new Error('Enter a single provisional estimate in GBP, for example £1500.00.'),{status:400});
  return calculateEstimate({lineItems:[{description:title,quantity:1,unitPricePence:Math.round(Number(amount)*100)}],vatPercent:0,notes:'Provisional total agreed with the project invitation. Changes to the agreed total, VAT or scope require approval before the final invoice.'});
}
