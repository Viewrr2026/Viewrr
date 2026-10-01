import type { CustomRetainerPlan } from './retainer-v1';
export type PlanChange = { field: string; before: string; after: string };
/** Stable IDs distinguish an edited cycle/output from an added or removed one. */
export function retainerPlanChanges(before: CustomRetainerPlan, after: CustomRetainerPlan): PlanChange[] {
  const changes: PlanChange[] = [];
  const compare = (field: string, a: any, b: any) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({field,before:typeof a==='string'?a:JSON.stringify(a) ?? '—',after:typeof b==='string'?b:JSON.stringify(b) ?? '—'});
  };
  for (const key of ['title','startDate','endDate'] as const) compare(key, before[key],after[key]);
  const money = (p:number) => `£${(p/100).toFixed(2)}`;
  compare('Total estimate',money(before.cycles.reduce((n,c)=>n+c.amountPence,0)),money(after.cycles.reduce((n,c)=>n+c.amountPence,0)));
  for (const id of Array.from(new Set([...before.cycles,...after.cycles].map(c=>c.id)))) {
    const a=before.cycles.find(c=>c.id===id),b=after.cycles.find(c=>c.id===id);
    const label=b?.name ?? a!.name;
    if (!a || !b) {compare(`Cycle: ${label}`,a?'Included':'Not included',b?'Included':'Removed');continue;}
    for (const [key,title] of [['name','Name'],['startDate','Start'],['endDate','End'],['revisionAllowance','Revisions'],['paymentDays','Payment days after acceptance']] as const)
      compare(`${label} · ${title}`,a[key],b[key]);
    compare(`${label} · Price`,money(a.amountPence),money(b.amountPence));
    for (const did of Array.from(new Set([...a.deliverables,...b.deliverables].map(d=>d.id)))) {
      const x=a.deliverables.find(d=>d.id===did),y=b.deliverables.find(d=>d.id===did);
      compare(`${label} · ${y?.name ?? x!.name}`,x?`${x.quantity} × ${x.name}; ${x.brief}; item briefs: ${(x.itemBriefs??[]).join(' / ')}`:'Not included',y?`${y.quantity} × ${y.name}; ${y.brief}; item briefs: ${(y.itemBriefs??[]).join(' / ')}`:'Removed');
    }
  }
  return changes;
}
