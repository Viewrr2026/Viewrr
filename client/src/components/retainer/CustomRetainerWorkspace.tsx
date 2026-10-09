import { retainerPlanChanges } from "@shared/retainer-plan-diff";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CustomRetainerBuilder, {
  PlanSummary,
  buttonClass,
  primaryClass,
  fieldClass,
  gbp,
} from "./CustomRetainerBuilder";
export function useCustomRetainer(
  publicId: string | undefined,
  enabled: boolean,
) {
  return useQuery<any>({
    queryKey: ["custom-retainer", publicId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/custom-retainers/${publicId}`)).json(),
    enabled: enabled && !!publicId,
    refetchInterval: enabled ? 5000 : false,
  });
}
function useRefresh(publicId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["custom-retainer", publicId] });
    qc.invalidateQueries({ queryKey: ["retainer-workspace", publicId] });
    qc.invalidateQueries({ queryKey: ["custom-retainer-invitations"] });
    qc.invalidateQueries({ queryKey: ["/api/projects"] });
    qc.invalidateQueries({ queryKey: ["/api/invitations"] });
  };
}
export function CustomProposal({
  publicId,
  data,
  userId,
}: {
  publicId: string;
  data: any;
  userId: number;
}) {
  const refresh = useRefresh(publicId),
    [editing, setEditing] = useState(false),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function review(action: string) {
    setBusy(true);
    setError("");
    try {
      await apiRequest("POST", `/api/custom-retainers/${publicId}/review`, {
        version: data.pending.version,
        action,
        feedback,
      });
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <div className="rounded-2xl border border-border bg-card">
        <CustomRetainerBuilder
          initialPlan={data.pending?.plan ?? data.latestPlan}
          agreementId={publicId}
          expectedVersion={data.latestVersion}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      </div>
    );
  return (
    <section className="rounded-2xl border border-border bg-card p-5 mb-6 space-y-4">
      <h2 className="font-semibold">
        {data.pending
          ? `Proposal v${data.pending.version} — review and acceptance`
          : data.hasAcceptedAgreement ? "Agreed retainer structure" : "Retainer proposal"}
      </h2>
      {data.feedback && (
        <p className="rounded-xl bg-amber-50 text-amber-900 p-3 text-sm whitespace-pre-wrap">
          Changes requested: {data.feedback}
        </p>
      )}
      {data.pending?.requestedChanges && <p className="text-sm">Requested changes addressed by this version: {data.pending.requestedChanges}</p>}
      {data.versions?.length > 1 && <details className="rounded-xl border p-3" open={!!data.pending}>
        <summary className="cursor-pointer font-medium">What changed in v{data.latestVersion}?</summary>
        <p className="text-xs text-muted-foreground my-2">Proposed by {data.versions[0].created_by === data.clientId ? "client" : "freelancer"} · {new Date(data.versions[0].created_at).toLocaleString("en-GB")}</p>
        <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Field</th><th className="text-left">Previous</th><th className="text-left">Revised</th></tr></thead><tbody>
          {retainerPlanChanges(data.versions[1].snapshot,data.versions[0].snapshot).map((change,i)=><tr key={i} className="border-t"><td className="p-2">{change.field}</td><td className="p-2 whitespace-pre-wrap">{change.before}</td><td className="p-2 whitespace-pre-wrap">{change.after}</td></tr>)}
        </tbody></table></div>
        <details className="mt-3"><summary className="cursor-pointer">Earlier proposal versions</summary>{data.versions.slice(1).map((v:any)=><details key={v.version_number} className="mt-3"><summary className="cursor-pointer">Version {v.version_number} · {v.accepted_by_client_at && v.accepted_by_freelancer_at ? "Agreed" : "Proposed"}</summary><PlanSummary plan={v.snapshot}/></details>)}</details>
      </details>}
      {data.status === "declined" && <p role="status">This retainer invitation was declined. No work has started.</p>}
      <PlanSummary plan={data.pending?.plan ?? (data.hasAcceptedAgreement ? data.plan : data.latestPlan)} />
      {data.pending && data.pending.proposedBy !== userId && (
        <div className="space-y-3">
          <label className="block text-sm">
            Requested changes
            <textarea
              className={fieldClass + " mt-1"}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Explain any changes you need before accepting"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={primaryClass}
              onClick={() => review("accept")}
            >
              {busy ? "Saving…" : "Accept this version"}
            </button>
            <button
              type="button"
              disabled={busy || !feedback.trim()}
              className={buttonClass}
              onClick={() => review("request_changes")}
            >
              Request changes
            </button>
            <button type="button" disabled={busy} className={buttonClass}
              onClick={() => review("decline")}>
              {data.status === "active" || data.status === "paused" ? "Decline amendment" : "Decline invitation"}
            </button>
          </div>
        </div>
      )}
      {data.pending?.proposedBy === userId && (
        <p className="text-sm text-muted-foreground">
          Waiting for your partner to review this version.
        </p>
      )}
      {[
        "active",
        "paused",
        "awaiting_client_acceptance",
        "changes_requested",
      ].includes(data.status) && (
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          Revise / counter proposal
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
export function CustomCyclePanel({
  publicId,
  data,
  userId,
  initialCycleId,
}: {
  publicId: string;
  data: any;
  userId: number;
  initialCycleId?: number;
}) {
  const [selected, setSelected] = useState<number | null>(initialCycleId ?? null);
  useEffect(() => { if (initialCycleId !== undefined) setSelected(initialCycleId); }, [initialCycleId]);
  const cycle =
    data.cycles.find((c: any) => c.id === selected) ??
    data.cycles.find((c: any) => c.canWork) ??
    data.cycles.find((c: any) => !c.paid_at) ??
    data.cycles.at(-1);
  if (!cycle) return <p>No cycles have been planned.</p>;
  const tasks = data.tasks.filter((t: any) => t.retainer_cycle_id === cycle.id),
    approved = tasks.filter((t: any) => t.status === "complete").length;
  const groups = Array.from(
    new Set<string>(tasks.map((t: any) => t.group_name)),
  );
  return (
    <div className="space-y-4">
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">Whole-retainer estimate · {gbp(data.cycles.reduce((n:number,c:any)=>n+c.amount_pence,0))}</summary>
        <p className="text-sm text-muted-foreground my-3">This is the agreed estimate, not an additional bill. Each cycle is invoiced once, after its required deliverables are approved.</p>
        <div className="flex flex-wrap gap-4 text-sm mb-3">
          <span>Invoiced: {gbp(data.cycles.filter((c:any)=>c.invoice_id).reduce((n:number,c:any)=>n+c.amount_pence,0))}</span>
          <span>Paid before refunds: {gbp(data.cycles.filter((c:any)=>c.paid_at).reduce((n:number,c:any)=>n+c.amount_pence,0))}</span>
          <span>Remaining scheduled: {gbp(data.cycles.filter((c:any)=>!c.paid_at).reduce((n:number,c:any)=>n+c.amount_pence,0))}</span>
        </div>
        <PlanSummary plan={data.plan}/>
      </details>
      <label className="block text-sm font-semibold">
        Cycle
        <select
          className={fieldClass + " mt-2"}
          value={cycle.id}
          onChange={(e) => setSelected(Number(e.target.value))}
        >
          {data.cycles.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.cycle_number}. {c.cycle_name} — {c.reason}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex justify-between gap-3">
          <div>
            <h2 className="font-semibold">{cycle.cycle_name}</h2>
            <p className="text-xs text-muted-foreground">
              {cycle.period_start} → {cycle.period_end}
            </p>
          </div>
          <strong>{gbp(cycle.amount_pence)}</strong>
        </div>
        <p className="text-sm font-semibold">{cycle.reason}</p>
        <p className="text-xs text-muted-foreground">
          {approved} / {tasks.length} deliverables approved ·{" "}
          {cycle.revision_allowance} included revisions
        </p>
        <div className="h-2 bg-muted rounded-full">
          <div
            className="h-2 rounded-full bg-[#FF5A1F]"
            style={{
              width: `${tasks.length ? (approved / tasks.length) * 100 : 0}%`,
            }}
          />
        </div>
        {cycle.due_at && (
          <p className="text-sm">
            Payment deadline:{" "}
            {new Date(cycle.due_at).toLocaleString("en-GB", {
              timeZone: "Europe/London",
            })}{" "}
            Europe/London
          </p>
        )}
        {!cycle.paid_at && (
          <p className="text-xs text-muted-foreground">
            {cycle.invoice_id
              ? userId === data.clientId ? "This cycle’s invoice is ready. Verified payment completes the cycle." : "The client’s cycle invoice is ready. Work can continue only within the agreed payment terms."
              : "No payment is due for this cycle yet. Its invoice is issued when the client approves all required deliverables."}
            {" "}External delivery links use the hosting provider’s permissions; Viewrr cannot watermark or revoke those files.
          </p>
        )}
        {cycle.paid_at && userId === data.freelancerId && (
          <p className="text-xs text-muted-foreground">
            Payment received through Stripe. Bank payout timing is separate.{" "}
            <a className="text-[#FF5A1F] underline" href="/#/payouts">
              View earnings and payouts
            </a>
          </p>
        )}
        {!!data.refundHistory?.filter((r:any)=>r.retainer_cycle_id===cycle.id).length && <div className="text-sm"><strong>Cycle refund history</strong>{data.refundHistory.filter((r:any)=>r.retainer_cycle_id===cycle.id).map((r:any)=><p key={r.stripe_refund_id}>{gbp(r.amount_pence)} · {r.status} · {new Date(r.created_at).toLocaleDateString("en-GB")}</p>)}</div>}
        {cycle.accepted_at && !cycle.paid_at && userId === data.clientId && (
          <CyclePayment publicId={publicId} cycle={cycle} />
        )}
      </div>
      {groups.map((group) => (
        <section
          key={group}
          className="rounded-2xl border border-border bg-card overflow-hidden"
        >
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold">{group}</h3>
            <p className="text-xs text-muted-foreground">
              {tasks.filter((t: any) => t.group_name === group).length}{" "}
              individual deliverables in this cycle
            </p>
          </div>
          <div className="divide-y divide-border">
            {tasks
              .filter((t: any) => t.group_name === group)
              .map((task: any) => (
                <WorkItem
                  key={task.id}
                  task={task}
                  cycle={cycle}
                  data={data}
                  publicId={publicId}
                  userId={userId}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
function WorkItem({
  task,
  cycle,
  data,
  publicId,
  userId,
}: {
  task: any;
  cycle: any;
  data: any;
  publicId: string;
  userId: number;
}) {
  const refresh = useRefresh(publicId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [feedback, setFeedback] = useState(""),
    [deliverableUrl, setDeliverableUrl] = useState(""),
    [submittedLocally, setSubmittedLocally] = useState(false),
    [expanded, setExpanded] = useState(false),
    [preview, setPreview] = useState<{ url: string; mime: string } | null>(
      null,
    );
  const isClient = userId === data.clientId;
  const subs = data.submissions.filter(
      (s: any) => s.retainer_cycle_task_id === task.id,
    ),
    latest = subs[0];
  const isApproved = latest?.status === "approved" || task.status === "complete";
  const awaitingReview = latest?.status === "submitted" || submittedLocally;
  useEffect(() => {
    setSubmittedLocally(false);
  }, [latest?.id, latest?.status]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  async function openMedia(m: any, original = false) {
    const response = await (
      await apiRequest(
        "GET",
        `/api/custom-retainers/${publicId}/media/${m.media_id ?? m.id}${original ? "?original=true" : ""}`,
      )
    ).json();
    if (original) {
      const link = document.createElement("a");
      link.href = response.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } else setPreview({ url: response.url, mime: m.mime_type });
  }
  return (
    <details className="p-4" onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary className="cursor-pointer flex justify-between gap-2 text-sm"><span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span className="text-xs text-muted-foreground">{isApproved ? "View approved delivery" : awaitingReview ? "View submitted delivery" : "Expand to submit / review"}</span>
        <span className="font-medium">{task.title}</span>
        <span className={isApproved
          ? "inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "text-xs text-muted-foreground"}>
          {isApproved ? "✓ Approved" : awaitingReview ? "Waiting for client approval" : task.status.replaceAll("_", " ")}
        </span>
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-sm whitespace-pre-wrap">{task.description}</p>
        {isApproved && (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Approved by the client. Your delivery and submission history are available below.
          </p>
        )}
        {awaitingReview && !isApproved && (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {isClient ? "This delivery is ready for your review." : "Submitted — waiting for client approval. You can submit a revision if the client requests changes."}
          </p>
        )}
        {subs.map((s: any) => (
          <div
            key={s.id}
            className="rounded-xl border border-border p-3 space-y-2"
          >
            <p className="text-xs font-semibold">
              Version {s.version} · {s.status.replaceAll("_", " ")}
            </p>
            <p className="text-sm whitespace-pre-wrap">{s.note}</p>
            {s.client_feedback && (
              <p className="text-sm whitespace-pre-wrap">
                Client feedback: {s.client_feedback}
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              {s.deliverable_url ? (
                <a className={buttonClass} href={s.deliverable_url} target="_blank" rel="noopener noreferrer">
                  Open delivery link
                </a>
              ) : (
                <>
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => run(() => openMedia(s))}>
                    View watermarked preview
                  </button>
                  {cycle.paid_at && s.status === "approved" && (
                    <button type="button" className={buttonClass} disabled={busy} onClick={() => run(() => openMedia(s, true))}>
                      Receive clean file
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {preview && (
          <div className="rounded-xl bg-zinc-100 p-2">
            {preview.mime.startsWith("video/") ? (
              <video className="w-full max-h-96" src={preview.url} controls />
            ) : (
              <img
                className="max-h-96 mx-auto"
                src={preview.url}
                alt={`Watermarked preview of ${task.title}`}
              />
            )}
            <button
              type="button"
              className={buttonClass + " mt-2"}
              onClick={() => setPreview(null)}
            >
              Close preview
            </button>
          </div>
        )}
        {!isClient && awaitingReview && !isApproved && (
          <button type="button" className={buttonClass + " bg-muted text-muted-foreground cursor-not-allowed"} disabled>
            Waiting for client approval
          </button>
        )}
        {!isClient && cycle.canWork && !isApproved && !awaitingReview && (
          <div className="space-y-3">
            <label className="block text-sm">
              Delivery link
              <input
                aria-label={`Delivery link for ${task.title}`}
                type="url"
                placeholder="https://"
                className={fieldClass + " mt-1"}
                value={deliverableUrl}
                onChange={(e) => setDeliverableUrl(e.target.value)}
                disabled={busy}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Share a Google Drive, Dropbox or other hosted link. Give the client permission to review it.
              External links are not watermarked or payment-protected by Viewrr. Use a preview copy if needed.
              Submit again after changes to create a new review version, even when using the same link.
            </p>
            <label className="block text-sm">
              Submission note
              <textarea
                className={fieldClass + " mt-1"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={primaryClass}
              disabled={
                busy ||
                !note.trim() ||
                !deliverableUrl.trim()
              }
              onClick={() =>
                run(async () => {
                  await apiRequest(
                    "POST",
                    `/api/custom-retainers/${publicId}/tasks/${task.public_id}/submit`,
                    { deliverableUrl: deliverableUrl.trim(), note },
                  );
                  setSubmittedLocally(true);
                })
              }
            >
              Submit for client review
            </button>
          </div>
        )}
        {isClient && cycle.canWork && latest?.status === "submitted" && (
          <div className="space-y-2">
            <label className="block text-sm">
              Review feedback
              <textarea
                className={fieldClass + " mt-1"}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </label>
            <div className="flex gap-2 flex-wrap">
              {(["approve", "request_changes"] as const).map((action) => (
                <button
                  type="button"
                  key={action}
                  className={action === "approve" ? primaryClass : buttonClass}
                  disabled={
                    busy || (action === "request_changes" && !feedback.trim())
                  }
                  onClick={() =>
                    run(() =>
                      apiRequest(
                        "POST",
                        `/api/custom-retainers/${publicId}/submissions/${latest.id}/review`,
                        { action, feedback },
                      ),
                    )
                  }
                >
                  {action === "approve"
                    ? "Approve this version"
                    : "Request changes"}
                </button>
              ))}
            </div>
          </div>
        )}
        {!cycle.canWork && !cycle.paid_at && (
          <p className="text-sm text-amber-700">{cycle.reason}</p>
        )}
        {busy && (
          <p role="status" className="text-xs">
            Saving…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
export function CyclePayment({
  publicId,
  cycle,
}: {
  publicId: string;
  cycle: any;
}) {
  const [checkout, setCheckout] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = useRefresh(publicId);
  const stripe = useMemo(
    () =>
      checkout?.publishableKey ? loadStripe(checkout.publishableKey) : null,
    [checkout?.publishableKey],
  );
  async function start() {
    setBusy(true);
    setError("");
    try {
      const result = await (
        await apiRequest(
          "POST",
          `/api/retainer-cycles/${cycle.public_id ?? cycle.publicId}/payments`,
          {},
        )
      ).json();
      if (!result.publishableKey || !result.clientSecret)
        throw new Error("Checkout is not configured");
      setCheckout(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className={primaryClass}
        disabled={busy}
        onClick={start}
      >
        {busy ? "Opening checkout…" : "Pay cycle invoice"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Dialog
        open={!!checkout}
        onOpenChange={(open) => {
          if (!open) {
            setCheckout(null);
            refresh();
          }
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4 pr-12">
            <DialogTitle>
              Pay cycle invoice · {gbp(cycle.amount_pence ?? cycle.amountPence)}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-6">
          {checkout && stripe && (
            <Elements
              stripe={stripe}
              options={{ clientSecret: checkout.clientSecret }}
            >
              <CheckoutForm
                onConfirmed={() => {
                  setCheckout(null);
                  refresh();
                }}
              />
            </Elements>
          )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function CheckoutForm({ onConfirmed }: { onConfirmed: () => void }) {
  const stripe = useStripe(),
    elements = useElements(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (error) setMessage(error.message ?? "Payment could not be completed");
      else {
        setMessage(
          "Payment submitted. The cycle completes after verified confirmation.",
        );
        onConfirmed();
      }
    } catch {
      setMessage(
        "Payment status is uncertain. Refresh the invoice before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement />
      <p className="text-xs text-muted-foreground">
        The cycle completes after verified payment confirmation. Freelancer
        bank arrival is tracked separately.
      </p>
      <button className={primaryClass} disabled={!stripe || !elements || busy}>
        {busy ? "Processing…" : "Pay securely"}
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
