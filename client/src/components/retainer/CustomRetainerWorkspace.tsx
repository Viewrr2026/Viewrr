import { useState, useMemo } from "react";
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
}: {
  publicId: string;
  data: any;
  userId: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
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
            Pay the cycle invoice to receive clean files. Unpaid originals
            remain protected.
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
    [selectedMedia, setSelectedMedia] = useState(""),
    [preview, setPreview] = useState<{ url: string; mime: string } | null>(
      null,
    );
  const isClient = userId === data.clientId;
  const media = data.media.filter((m: any) => m.task_id === task.id),
    subs = data.submissions.filter(
      (s: any) => s.retainer_cycle_task_id === task.id,
    ),
    latest = subs[0];
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
  async function upload(file: File) {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(
      `/api/custom-retainers/${publicId}/tasks/${task.public_id}/media`,
      { method: "POST", body, credentials: "include" },
    );
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    setSelectedMedia(result.id);
  }
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
    <details className="p-4">
      <summary className="cursor-pointer flex justify-between gap-2 text-sm">
        <span className="font-medium">{task.title}</span>
        <span className="text-xs text-muted-foreground">
          {task.status === "complete"
            ? "Approved"
            : task.status.replaceAll("_", " ")}
        </span>
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-sm whitespace-pre-wrap">{task.description}</p>
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
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => run(() => openMedia(s))}
              >
                View watermarked preview
              </button>
              {cycle.paid_at && s.status === "approved" && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => run(() => openMedia(s, true))}
                >
                  Receive clean file
                </button>
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
        {!isClient && cycle.canWork && (
          <div className="space-y-3">
            <label className="block text-sm">
              Upload work
              <input
                aria-label={`Upload ${task.title}`}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                disabled={busy}
                className="block mt-2 text-xs max-w-full"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void run(() => upload(f));
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Images and videos up to 200 MB; videos up to 30 minutes. A
              protected preview is generated before submission.
            </p>
            {media.map((m: any) => (
              <div
                key={m.id}
                className="flex flex-wrap gap-2 items-center text-xs"
              >
                <span>
                  {m.filename} · {m.status}
                </span>
                {m.status === "ready" && (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => run(() => openMedia(m))}
                  >
                    Preview
                  </button>
                )}
                {m.status === "failed" && (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        apiRequest(
                          "POST",
                          `/api/custom-retainers/${publicId}/media/${m.id}/retry`,
                          {},
                        ),
                      )
                    }
                  >
                    Retry preview
                  </button>
                )}
              </div>
            ))}
            <label className="block text-sm">
              Choose processed file
              <select
                className={fieldClass + " mt-1"}
                value={selectedMedia}
                onChange={(e) => setSelectedMedia(e.target.value)}
              >
                <option value="">Select a ready preview</option>
                {media
                  .filter((m: any) => m.status === "ready")
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.filename}
                    </option>
                  ))}
              </select>
            </label>
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
                !media.some(
                  (m: any) => m.id === selectedMedia && m.status === "ready",
                )
              }
              onClick={() =>
                run(() =>
                  apiRequest(
                    "POST",
                    `/api/custom-retainers/${publicId}/tasks/${task.public_id}/submit`,
                    { mediaId: selectedMedia, note },
                  ),
                )
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Pay cycle invoice · {gbp(cycle.amount_pence ?? cycle.amountPence)}
            </DialogTitle>
          </DialogHeader>
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
          "Payment submitted. Files unlock after verified confirmation.",
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
        Files unlock after the payment provider confirms payment. Freelancer
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
