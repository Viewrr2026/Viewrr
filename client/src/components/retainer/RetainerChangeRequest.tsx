import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { customRetainerSchema, londonDate, scheduleGaps } from "@shared/retainer-v1";
import { retainerPlanChanges } from "@shared/retainer-plan-diff";
import { buttonClass, primaryClass, fieldClass, gbp } from "./CustomRetainerBuilder";
import { CustomProposal } from "./CustomRetainerWorkspace";

export function RetainerChangeRequests({ data, publicId, userId, onNew, legacyRequests = [] }: any) {
  return <div className="space-y-4">
    <div className="rounded-2xl border bg-card p-5 space-y-3">
      <h2 className="font-semibold">Agreement change requests</h2>
      <p className="text-sm text-muted-foreground">Propose extra deliverables, revised cycle dates or an early start. Current terms stay in effect until both parties agree. Approved or paid cycles retain their original records.</p>
      <button className={primaryClass} onClick={onNew} disabled={!!data.pending || data.status === "completed"}>New change request</button>
      {data.pending && <p className="text-sm">A proposal is waiting for agreement. Review or counter it below before starting another request.</p>}
    </div>
    <CustomProposal publicId={publicId} data={data} userId={userId} />
    {!!legacyRequests.length && <details className="rounded-2xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold">Earlier general requests</summary>
      <p className="my-3 text-sm text-muted-foreground">These earlier messages did not amend the agreement. Propose any scope, price or date change using the new form.</p>
      {legacyRequests.map((r: any) => <div key={r.id} className="border-t py-3 text-sm"><p className="font-semibold">{r.title} · {r.status.replaceAll("_", " ")}</p><p>{r.description}</p></div>)}
    </details>}
    <div className="rounded-2xl border bg-card p-5 space-y-3">
      <h3 className="font-semibold">Request decisions</h3>
      {!data.proposalDecisions?.length && <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>}
      {data.proposalDecisions?.map((e: any, i: number) => <div key={i} className="border-t pt-3 text-sm">
        <p className="font-semibold">Version {e.detail.version} · {e.kind === "accept" ? "Accepted" : e.kind === "decline" ? "Declined" : "Changes requested"}</p>
        <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("en-GB")}</p>
        {e.detail.feedback && <p className="whitespace-pre-wrap">{e.detail.feedback}</p>}
      </div>)}
    </div>
  </div>;
}
export function RetainerChangeRequest({ data, publicId, onClose, onSent }: any) {
  const qc = useQueryClient();
  const eligible = data.cycles.filter((c: any) => !c.accepted_at && !c.paid_at && !c.invoice_id);
  const [kind, setKind] = useState("deliverables");
  const [cycleKey, setCycleKey] = useState(eligible[0]?.plan_key ?? "");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [extra, setExtra] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [extend, setExtend] = useState(false);
  const [ackGaps, setAckGaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groupId] = useState(() => crypto.randomUUID());
  const current = data.plan.cycles.find((c: any) => c.id === cycleKey);
  const index = data.plan.cycles.findIndex((c: any) => c.id === cycleKey);
  const previous = index > 0 && data.cycles.find((c: any) => c.plan_key === data.plan.cycles[index - 1].id);
  const earlyAllowed = !!previous?.paid_at && !data.cycles.find((c: any) => c.plan_key === cycleKey)?.started_at;
  const proposed = useMemo(() => {
    const plan = structuredClone(data.plan);
    const cycle = plan.cycles.find((c: any) => c.id === cycleKey);
    if (!cycle) return plan;
    if (kind === "deliverables") {
      cycle.deliverables.push({id:groupId,name,brief,quantity});
      cycle.amountPence += Math.round(Number(extra) * 100);
    } else {
      cycle.startDate = start || cycle.startDate;
      if (kind === "dates") cycle.endDate = end || cycle.endDate;
      if (kind === "early") cycle.earlyStart = true;
      if (extend && cycle.endDate > plan.endDate) plan.endDate = cycle.endDate;
    }
    plan.gapsAcknowledged = ackGaps;
    return plan;
  }, [data.plan,cycleKey,kind,name,brief,quantity,extra,start,end,extend,ackGaps,groupId]);
  const gaps = scheduleGaps(proposed);
  const parsed = customRetainerSchema.safeParse(proposed);
  const changes = current ? retainerPlanChanges(data.plan, proposed) : [];
  const additional = Math.round(Number(extra) * 100);
  const valid = !!current && parsed.success && !data.pending &&
    (kind === "deliverables" ? name.trim() && additional > 0 :
     kind === "early" ? earlyAllowed && !!start && start >= londonDate(new Date()) && start < current.startDate :
     (start && start !== current.startDate) || (end && end !== current.endDate));
  async function send() {
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      await apiRequest("POST", `/api/custom-retainers/${publicId}/propose`, {
        expectedVersion: data.latestVersion, plan: proposed,
      });
      await qc.invalidateQueries({queryKey:["custom-retainer",publicId]});
      onSent(); onClose();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  function resetCycle(value: string) { setCycleKey(value); setStart(""); setEnd(""); setAckGaps(false); }
  return <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}}>
    <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-2xl">
      <DialogHeader className="shrink-0 p-6 pb-3 pr-12"><DialogTitle>Request a retainer change</DialogTitle></DialogHeader>
      <div className="min-h-0 overflow-y-auto px-6 pb-6 space-y-4">
        {data.pending ? <p>A proposal is already awaiting agreement. Open Requests to review or counter it.</p> : !eligible.length ? <p>All cycles are already approved or paid. Their records cannot be changed.</p> : <>
          <label className="block text-sm">What would you like to change?
            <select className={fieldClass} value={kind} onChange={e => {setKind(e.target.value);setStart("");setEnd("");setAckGaps(false);}}>
              <option value="deliverables">Add deliverables and cost</option><option value="dates">Change cycle dates</option><option value="early">Request early start</option>
            </select>
          </label>
          <label className="block text-sm">Cycle
            <select className={fieldClass} value={cycleKey} onChange={e => resetCycle(e.target.value)}>
              {eligible.map((c: any) => <option key={c.plan_key} value={c.plan_key}>{c.cycle_number}. {c.cycle_name}</option>)}
            </select>
          </label>
          {current && <p className="rounded-xl bg-muted p-3 text-sm">Current: {current.startDate} → {current.endDate} · {gbp(current.amountPence)}</p>}
          {kind === "deliverables" ? <>
            <label className="block text-sm">Additional deliverable name<input className={fieldClass} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Extra Instagram reels" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">Quantity<input className={fieldClass} type="number" min="1" max="200" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
              <label className="text-sm">Additional total price (£)<input className={fieldClass} type="number" min="0.01" step="0.01" value={extra} onChange={e=>setExtra(e.target.value)}/></label>
            </div>
            <label className="block text-sm">Brief<textarea className={fieldClass} value={brief} onChange={e=>setBrief(e.target.value)}/></label>
            <p className="text-xs text-muted-foreground">This price covers all additional items above and is added to this cycle's invoice once agreed.</p>
          </> : <>
            {kind === "early" && !earlyAllowed && <p className="text-sm text-amber-800">Early start requires a paid previous cycle and work not yet started in this cycle.</p>}
            <label className="block text-sm">Proposed start date<input type="date" className={fieldClass} value={start || current?.startDate || ""} min={kind === "early" ? londonDate(new Date()) : undefined} onChange={e=>setStart(e.target.value)}/></label>
            {kind === "dates" && <label className="block text-sm">Proposed end date<input type="date" className={fieldClass} value={end || current?.endDate || ""} onChange={e=>setEnd(e.target.value)}/></label>}
            {kind === "early" && <p className="text-xs text-muted-foreground">The cycle's end date and price stay unchanged. Any overlap with the paid previous cycle will be explicitly included in this proposal.</p>}
            {end > data.plan.endDate && <label className="flex gap-2 text-sm"><input type="checkbox" checked={extend} onChange={e=>setExtend(e.target.checked)}/>Also propose extending the retainer end date to {end}</label>}
          </>}
          {!!gaps.length && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ackGaps} onChange={e=>setAckGaps(e.target.checked)}/>Acknowledge unallocated dates: {gaps.join(", ")}</label>}
          {!parsed.success && <p className="text-xs text-amber-800">{Array.from(new Set(parsed.error.issues.map(i=>i.message))).join(" · ")}</p>}
          {changes.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Change</th><th className="text-left">Current</th><th className="text-left">Proposed</th></tr></thead><tbody>{changes.map((c,i)=><tr key={i} className="border-t"><td className="p-2">{c.field}</td><td className="p-2 whitespace-pre-wrap">{c.before}</td><td className="p-2 whitespace-pre-wrap">{c.after}</td></tr>)}</tbody></table></div>}
          <p className="text-xs text-muted-foreground">Nothing changes until your partner accepts this version. Overdue-payment restrictions still apply.</p>
          <button className={primaryClass} disabled={!valid || busy} onClick={send}>{busy ? "Sending…" : "Send change request"}</button>
        </>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
