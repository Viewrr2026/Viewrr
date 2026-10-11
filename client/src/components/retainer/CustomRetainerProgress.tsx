import { useEffect, useState } from "react";
import { retainerProgress } from "@shared/retainer-progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gbp, primaryClass, buttonClass } from "./CustomRetainerBuilder";

const when = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" });
function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5">
    <p className="text-xs font-semibold text-muted-foreground">{label}</p>
    <p className="mt-2 text-2xl font-bold">{value}</p>
    {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
  </div>;
}
export function CustomRetainerOverview({ data, onCycle }: { data: any; onCycle: (id: number) => void }) {
  const p = retainerProgress(data);
  return <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Tile label="Whole-retainer deliverables" value={`${p.approvedTasks} / ${p.totalTasks} approved`} note="Across every agreed cycle, including future cycles." />
      <Tile label="Cycles completed" value={`${p.completedCycles} / ${p.totalCycles}`} note="All required work approved and cycle payment verified." />
      <Tile label="Payments received" value={gbp(p.paid)} note={`Of ${gbp(p.total)} agreed · ${gbp(p.refunded)} refunded separately.`} />
    </div>
    <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label="Whole-retainer deliverables approved" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.progress}>
      <div className="h-full bg-[#FF5A1F]" style={{ width: `${p.progress}%` }} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Tile label="On-time cycle approval" value={p.onTimeRate === null ? "Not yet available" : `${p.onTimeRate}%`} note={`${p.onTimeCycles} of ${p.measuredCycles} assessed cycles approved by their planned end date. Includes overdue cycles awaiting approval; future cycles are excluded.`} />
      <Tile label="Satisfaction average" value={p.satisfaction === null ? "Not yet rated" : `${p.satisfaction.toFixed(1)} / 5`} note={`${p.ratingCount} recorded ratings. Approval is not a satisfaction rating.`} />
      <Tile label="Open requests" value={String(data.openRequests ?? 0)} note="Pending, accepted, scheduled or awaiting clarification." />
      <Tile label="Cycles awaiting payment" value={String(p.awaitingPayment)} note="Approved cycles without verified payment." />
    </div>
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <h3 className="font-semibold">Progress by cycle</h3>
      {data.cycles.map((c: any) => {
        const tasks = data.tasks.filter((t: any) => t.retainer_cycle_id === c.id);
        const done = tasks.filter((t: any) => t.status === "complete").length;
        return <button key={c.id} type="button" onClick={() => onCycle(c.id)} className="w-full rounded-xl border p-4 text-left hover:bg-muted">
          <span className="font-semibold">Cycle {c.cycle_number} · {c.cycle_name}</span>
          <span className="block text-sm mt-1">{c.paid_at && c.accepted_at ? "Completed · payment verified" : c.reason}</span>
          <span className="block text-xs text-muted-foreground mt-1">{done} / {tasks.length} approved · {c.period_start} → {c.period_end}</span>
        </button>;
      })}
    </div>
  </div>;
}
export function CustomRetainerHistory({ data, onCycle }: { data: any; onCycle: (id: number) => void }) {
  const recorded = data.cycles.filter((c: any) => c.started_at || c.accepted_at || c.paid_at).slice().reverse();
  if (!recorded.length) return <p className="py-12 text-center text-muted-foreground">No cycle activity yet.</p>;
  return <div className="space-y-3">{recorded.map((c: any) => {
    const tasks = data.tasks.filter((t: any) => t.retainer_cycle_id === c.id);
    const refunds = (data.refundHistory ?? []).filter((r: any) => r.retainer_cycle_id === c.id);
    return <details key={c.id} className="rounded-2xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold">Cycle {c.cycle_number} · {c.cycle_name} — {c.paid_at && c.accepted_at ? "Completed" : c.reason}</summary>
      <div className="mt-4 space-y-2 text-sm">
        <p>Planned: {c.period_start} → {c.period_end}</p>
        {c.started_at && <p>Work started: {when(c.started_at)}</p>}
        {c.accepted_at && <p>All deliverables approved: {when(c.accepted_at)}</p>}
        {c.invoice_id && <p>Cycle invoice #{c.invoice_id}: {gbp(c.amount_pence)} · {c.paid_at ? "Paid" : "Due"}</p>}
        {c.paid_at && <p className="font-semibold text-emerald-700">Payment verified: {when(c.paid_at)}</p>}
        {c.due_at && <p>Agreed payment deadline: {when(c.due_at)}</p>}
        <p>{tasks.filter((t: any) => t.status === "complete").length} / {tasks.length} deliverables approved</p>
        <ul className="list-disc pl-5">{tasks.map((t: any) => <li key={t.id}>{t.title} · {t.status === "complete" ? "Approved" : t.status.replaceAll("_", " ")}</li>)}</ul>
        {refunds.map((r: any) => <p key={r.stripe_refund_id}>Refund: {gbp(r.amount_pence)} · {r.status} · {when(r.created_at)}</p>)}
        <button type="button" className={buttonClass} onClick={() => onCycle(c.id)}>View delivery and version history</button>
      </div>
    </details>;
  })}</div>;
}
export function CustomPaymentSuccess({ data, publicId, userId, onCycle }: {
  data: any; publicId: string; userId: number; onCycle: (id: number) => void;
}) {
  const [celebrate, setCelebrate] = useState<any>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const paid = data.cycles.filter((c: any) => c.paid_at && c.accepted_at)
    .sort((a: any, b: any) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())[0];
  const key = paid ? `retainer-paid:${userId}:${publicId}:${paid.id}:${paid.paid_at}` : null;
  useEffect(() => {
    if (!key || key === dismissed || !paid) return;
    // Show recent verified payments once per account/browser, including after a redirect.
    if (Date.now() - new Date(paid.paid_at).getTime() > 86400000) return;
    try { if (localStorage.getItem(key)) return; } catch {}
    setCelebrate(paid);
  }, [key, dismissed]);
  function close() {
    if (key) { try { localStorage.setItem(key, "seen"); } catch {} setDismissed(key); }
    setCelebrate(null);
  }
  const next = celebrate && (data.cycles.find((c: any) => c.cycle_number > celebrate.cycle_number && !c.paid_at)
    ?? data.cycles.find((c: any) => !c.paid_at));
  return <Dialog open={!!celebrate} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700" aria-hidden="true">✓</div>
      <DialogHeader><DialogTitle className="text-center">{celebrate?.cycle_name} has been paid!</DialogTitle></DialogHeader>
      <p className="text-center text-muted-foreground">{celebrate ? gbp(celebrate.amount_pence) : ""} payment verified. All deliverables in this cycle are approved.</p>
      <p className="text-center font-semibold">{retainerProgress(data).completedCycles} of {data.cycles.length} cycles completed</p>
      {next ? <>
        <p className="text-center text-sm">Next: {next.cycle_name} · starts {next.period_start}. Viewing it does not change its agreed start date.</p>
        <button type="button" className={primaryClass} onClick={() => { close(); onCycle(next.id); }}>View Cycle {next.cycle_number} →</button>
      </> : <p className="text-center text-sm">Every agreed cycle is now complete. Thank you for working together!</p>}
      <button type="button" className={buttonClass} onClick={() => { const id = celebrate.id; close(); onCycle(id); }}>View paid deliverables</button>
    </DialogContent>
  </Dialog>;
}
