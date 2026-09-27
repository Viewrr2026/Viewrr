import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus,
  Trash2,
  Copy,
  ChevronLeft,
  ChevronRight,
  Send,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { apiRequest } from "@/lib/queryClient";
import { safeGet, safeSet, safeRemove } from "@/lib/storage";
import {
  customRetainerSchema,
  scheduleGaps,
  nextDate,
  type CustomRetainerPlan,
  type CustomCyclePlan,
} from "@shared/retainer-v1";
export const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
export const buttonClass =
  "rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50";
export const primaryClass =
  buttonClass + " bg-[#FF5A1F] text-white border-transparent";
export const gbp = (p: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    p / 100,
  );
const newGroup = () => ({
  id: crypto.randomUUID(),
  name: "",
  quantity: 1,
  brief: "",
});
const newCycle = (startDate = ""): CustomCyclePlan => ({
  id: crypto.randomUUID(),
  name: "",
  startDate,
  endDate: startDate ? nextDate(startDate, 27) : "",
  amountPence: 0,
  revisionAllowance: 2,
  paymentDays: 5,
  deliverables: [newGroup()],
});
const emptyPlan = (): CustomRetainerPlan => ({
  title: "",
  startDate: "",
  endDate: "",
  gapsAcknowledged: false,
  cycles: [newCycle()],
});
export function PlanSummary({ plan }: { plan: CustomRetainerPlan }) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{plan.title}</h3>
      <p className="text-sm text-muted-foreground">
        {plan.startDate} → {plan.endDate} · {plan.cycles.length} cycles ·{" "}
        {gbp(plan.cycles.reduce((n, c) => n + c.amountPence, 0))} total
      </p>
      {plan.cycles.map((c, i) => (
        <div
          key={c.id}
          className="p-4 rounded-xl border border-border bg-background"
        >
          <div className="flex justify-between gap-3">
            <strong className="text-sm">
              {i + 1}. {c.name}
            </strong>
            <strong className="text-sm">{gbp(c.amountPence)}</strong>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {c.startDate} → {c.endDate} · {c.revisionAllowance} revisions ·
            Payment{" "}
            {c.paymentDays === 0
              ? "immediately"
              : `within ${c.paymentDays} calendar days`}{" "}
            after all items are approved
          </p>
          <ul className="text-sm mt-2 space-y-1">
            {c.deliverables.map((d) => (
              <li key={d.id}>
                {d.quantity} × {d.name}
                {d.brief && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {d.brief}
                  </p>
                )}
                {d.itemBriefs?.some(Boolean) && (
                  <ul className="text-xs text-muted-foreground">
                    {d.itemBriefs.map(
                      (brief, i) =>
                        brief && (
                          <li key={i}>
                            {i + 1}: {brief}
                          </li>
                        ),
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        One invoice per cycle. Clean files unlock only after verified payment.
        One subsequent cycle may proceed within payment terms; overdue payment
        freezes subsequent work. Dates change only by mutual agreement.
      </p>
    </div>
  );
}
export default function CustomRetainerBuilder({
  initialPlan,
  agreementId,
  expectedVersion,
  onSaved,
  onCancel,
}: {
  initialPlan?: CustomRetainerPlan;
  agreementId?: string;
  expectedVersion?: number;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const key = `viewrr-custom-retainer-v1:${user?.id}:${agreementId ?? "new"}`;
  const [plan, setPlan] = useState<CustomRetainerPlan>(() => {
    if (initialPlan) return structuredClone(initialPlan);
    try {
      const saved = JSON.parse(safeGet(key) ?? "null");
      return saved?.cycles ? saved : emptyPlan();
    } catch {
      return emptyPlan();
    }
  });
  const [step, setStep] = useState(1),
    [recipientId, setRecipient] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!agreementId && user) safeSet(key, JSON.stringify(plan));
  }, [plan, key, user, agreementId]);
  const { data: connections = [] } = useQuery<any[]>({
    queryKey: ["retainer-connections", user?.id],
    queryFn: async () =>
      (await apiRequest("GET", `/api/connections?userId=${user?.id}`)).json(),
    enabled: !!user && !agreementId,
  });
  const updateCycle = (index: number, patch: Partial<CustomCyclePlan>) =>
    setPlan((p) => ({
      ...p,
      gapsAcknowledged: false,
      cycles: p.cycles.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  const gaps = scheduleGaps(plan);
  const validation = customRetainerSchema.safeParse(plan);
  async function send() {
    if (!validation.success) {
      setError(validation.error.issues.map((i) => i.message).join("; "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiRequest(
        "POST",
        agreementId
          ? `/api/custom-retainers/${agreementId}/propose`
          : "/api/custom-retainers",
        agreementId
          ? { plan, expectedVersion }
          : { plan, recipientId: Number(recipientId) },
      );
      const result = await res.json();
      safeRemove(key);
      if (onSaved) onSaved();
      else navigate(`/retainer/${result.agreementPublicId}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const headings = [
    "Name your Retainer work",
    "When is the start date and end date?",
    "What are we producing?",
    "Review and send",
  ];
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-[#FF5A1F] font-semibold">
          {agreementId ? "Revise retainer proposal" : "Build your retainer"}
        </p>
        <h1 className="text-2xl font-bold mt-2">{headings[step - 1]}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Step {step} of 4 · Your partner reviews the complete proposal before
          work begins.
        </p>
      </div>
      <div className="flex gap-2">
        {headings.map((h, i) => (
          <button
            type="button"
            key={h}
            aria-label={h}
            onClick={() => setStep(i + 1)}
            className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-[#FF5A1F]" : "bg-muted"}`}
          />
        ))}
      </div>
      {step === 1 && (
        <label className="block text-sm font-semibold">
          Retainer title
          <input
            className={fieldClass + " mt-2"}
            maxLength={160}
            value={plan.title}
            placeholder="Social media production for Acme"
            onChange={(e) => setPlan({ ...plan, title: e.target.value })}
          />
        </label>
      )}
      {step === 2 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {(["startDate", "endDate"] as const).map((k) => (
            <label key={k} className="text-sm font-semibold">
              {k === "startDate" ? "Start date" : "End date"}
              <input
                type="date"
                className={fieldClass + " mt-2"}
                value={plan[k]}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    [k]: e.target.value,
                    gapsAcknowledged: false,
                  })
                }
              />
            </label>
          ))}
          <p className="sm:col-span-2 text-sm text-muted-foreground">
            Plan cycles using actual calendar dates. Gaps and overlaps are
            checked before sending.
          </p>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-5">
          {plan.cycles.map((c, index) => (
            <section
              key={c.id}
              className="rounded-2xl border border-border bg-card p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Cycle {index + 1}</h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      const start = nextDate(c.endDate);
                      const duration = Math.round(
                        (Date.parse(c.endDate) - Date.parse(c.startDate)) /
                          86400000,
                      );
                      const copy = {
                        ...structuredClone(c),
                        id: crypto.randomUUID(),
                        name: `${c.name} (copy)`,
                        startDate: start,
                        endDate: nextDate(start, duration),
                        deliverables: c.deliverables.map((d) => ({
                          ...d,
                          id: crypto.randomUUID(),
                        })),
                      };
                      setPlan({
                        ...plan,
                        gapsAcknowledged: false,
                        cycles: [
                          ...plan.cycles.slice(0, index + 1),
                          copy,
                          ...plan.cycles.slice(index + 1),
                        ],
                      });
                    }}
                  >
                    <Copy size={14} className="inline mr-1" />
                    Duplicate
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove cycle ${index + 1}`}
                    className={buttonClass}
                    disabled={plan.cycles.length === 1}
                    onClick={() =>
                      setPlan({
                        ...plan,
                        gapsAcknowledged: false,
                        cycles: plan.cycles.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <label className="block text-sm">
                Cycle name
                <input
                  className={fieldClass + " mt-1"}
                  value={c.name}
                  onChange={(e) => updateCycle(index, { name: e.target.value })}
                  placeholder="Launch content"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(["startDate", "endDate"] as const).map((k) => (
                  <label key={k} className="text-sm">
                    {k === "startDate" ? "Starts" : "Ends"}
                    <input
                      className={fieldClass + " mt-1"}
                      type="date"
                      value={c[k]}
                      onChange={(e) =>
                        updateCycle(index, { [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label className="text-sm">
                  Cycle price (£)
                  <input
                    className={fieldClass + " mt-1"}
                    type="number"
                    min="0.50"
                    step="0.01"
                    value={c.amountPence ? c.amountPence / 100 : ""}
                    onChange={(e) =>
                      updateCycle(index, {
                        amountPence: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </label>
                <label className="text-sm">
                  Included revisions
                  <input
                    className={fieldClass + " mt-1"}
                    type="number"
                    min="0"
                    max="100"
                    value={c.revisionAllowance}
                    onChange={(e) =>
                      updateCycle(index, {
                        revisionAllowance: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <PaymentTerms
                days={c.paymentDays}
                onChange={(paymentDays) => updateCycle(index, { paymentDays })}
              />
              <div className="space-y-3">
                {c.deliverables.map((d, di) => (
                  <div
                    key={d.id}
                    className="rounded-xl border border-border p-3 space-y-2"
                  >
                    <div className="flex gap-2 items-end">
                      <label className="flex-1 text-xs">
                        Deliverable
                        <input
                          className={fieldClass + " mt-1"}
                          value={d.name}
                          placeholder="TikTok video"
                          onChange={(e) =>
                            updateCycle(index, {
                              deliverables: c.deliverables.map((x, i) =>
                                i === di ? { ...x, name: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="w-20 text-xs">
                        Quantity
                        <input
                          className={fieldClass + " mt-1"}
                          type="number"
                          min="1"
                          max="200"
                          value={d.quantity}
                          onChange={(e) =>
                            updateCycle(index, {
                              deliverables: c.deliverables.map((x, i) =>
                                i === di
                                  ? {
                                      ...x,
                                      quantity: Number(e.target.value),
                                      itemBriefs: x.itemBriefs?.slice(
                                        0,
                                        Math.max(0, Number(e.target.value)),
                                      ),
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove ${d.name || "deliverable"}`}
                        className={buttonClass}
                        disabled={c.deliverables.length === 1}
                        onClick={() =>
                          updateCycle(index, {
                            deliverables: c.deliverables.filter(
                              (_, i) => i !== di,
                            ),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <label className="block text-xs">
                      Brief
                      <textarea
                        className={fieldClass + " mt-1"}
                        value={d.brief}
                        onChange={(e) =>
                          updateCycle(index, {
                            deliverables: c.deliverables.map((x, i) =>
                              i === di ? { ...x, brief: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <details className="text-xs">
                      <summary className="cursor-pointer font-semibold">
                        Customise individual briefs (optional)
                      </summary>
                      <div className="space-y-2 mt-2">
                        {Array.from(
                          { length: Math.min(200, Math.max(0, d.quantity)) },
                          (_, itemIndex) => (
                            <label key={itemIndex} className="block">
                              {d.name || "Output"} {itemIndex + 1}
                              <textarea
                                className={fieldClass + " mt-1"}
                                value={d.itemBriefs?.[itemIndex] ?? ""}
                                placeholder="Leave blank to use the group brief"
                                onChange={(e) => {
                                  const itemBriefs = Array.from(
                                    { length: d.quantity },
                                    (_, i) =>
                                      i === itemIndex
                                        ? e.target.value
                                        : (d.itemBriefs?.[i] ?? ""),
                                  );
                                  updateCycle(index, {
                                    deliverables: c.deliverables.map((x, i) =>
                                      i === di ? { ...x, itemBriefs } : x,
                                    ),
                                  });
                                }}
                              />
                            </label>
                          ),
                        )}
                      </div>
                    </details>
                    <p className="text-xs text-muted-foreground">
                      Creates {d.quantity || 0} individually tracked output
                      {d.quantity === 1 ? "" : "s"}.
                    </p>
                  </div>
                ))}
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() =>
                    updateCycle(index, {
                      deliverables: [...c.deliverables, newGroup()],
                    })
                  }
                >
                  <Plus size={14} className="inline mr-1" />
                  Add deliverable group
                </button>
              </div>
            </section>
          ))}
          <button
            type="button"
            className={buttonClass}
            onClick={() =>
              setPlan({
                ...plan,
                gapsAcknowledged: false,
                cycles: [
                  ...plan.cycles,
                  newCycle(
                    plan.cycles.at(-1)?.endDate
                      ? nextDate(plan.cycles.at(-1)!.endDate)
                      : plan.startDate,
                  ),
                ],
              })
            }
          >
            <Plus size={14} className="inline mr-1" />
            Add cycle
          </button>
          {gaps.length > 0 && (
            <div className="rounded-xl border border-amber-200 p-4 text-sm">
              <p>Unallocated dates: {gaps.join("; ")}</p>
              <label className="flex gap-2 mt-2">
                <input
                  type="checkbox"
                  checked={plan.gapsAcknowledged}
                  onChange={(e) =>
                    setPlan({ ...plan, gapsAcknowledged: e.target.checked })
                  }
                />
                These gaps are intentional and will be shown in the proposal.
              </label>
            </div>
          )}
        </div>
      )}
      {step === 4 && (
        <div className="space-y-5">
          <PlanSummary plan={plan} />
          {!validation.success && (
            <div role="alert" className="text-sm text-red-600">
              {validation.error.issues.map((i, index) => (
                <p key={index}>{i.message}</p>
              ))}
            </div>
          )}
          {!agreementId && (
            <label className="block text-sm font-semibold">
              Send to
              <select
                className={fieldClass + " mt-2"}
                value={recipientId}
                onChange={(e) => setRecipient(e.target.value)}
              >
                <option value="">
                  Choose your{" "}
                  {user?.role === "client" ? "freelancer" : "client"}
                </option>
                {connections
                  .filter((c) => c.role !== user?.role)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <span className="block text-xs text-muted-foreground mt-2">
                Choose an existing connection. Sending records your acceptance
                of these terms.
              </span>
            </label>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 break-words">
          {error}
        </p>
      )}
      <div className="flex justify-between gap-3">
        {step > 1 ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => setStep(step - 1)}
          >
            <ChevronLeft size={14} className="inline" />
            Back
          </button>
        ) : (
          <button
            type="button"
            className={buttonClass}
            onClick={() => (onCancel ? onCancel() : navigate("/dashboard"))}
          >
            Cancel
          </button>
        )}
        {step < 4 ? (
          <button
            type="button"
            className={primaryClass}
            onClick={() => setStep(step + 1)}
          >
            Continue <ChevronRight size={14} className="inline" />
          </button>
        ) : (
          <button
            type="button"
            className={primaryClass}
            disabled={
              busy || !validation.success || (!agreementId && !recipientId)
            }
            onClick={send}
          >
            <Send size={14} className="inline mr-2" />
            {busy ? "Sending…" : "Send for review and acceptance"}
          </button>
        )}
      </div>
    </div>
  );
}
function PaymentTerms({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: number) => void;
}) {
  const [unit, setUnit] = useState("days");
  return (
    <label className="block text-sm">
      Payment due after all deliverables are approved
      <div className="flex gap-2 mt-1">
        <input
          className={fieldClass}
          type="number"
          min="0"
          max={unit === "weeks" ? 52 : 365}
          step="1"
          value={unit === "weeks" ? days / 7 : days}
          onChange={(e) =>
            onChange(Number(e.target.value) * (unit === "weeks" ? 7 : 1))
          }
        />
        <select
          aria-label="Payment term unit"
          className={fieldClass}
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value);
          }}
        >
          <option value="days">Calendar days</option>
          <option value="weeks">Weeks</option>
        </select>
      </div>
      <span className="block text-xs text-muted-foreground mt-1">
        {days === 0
          ? "Payment required before the next cycle starts."
          : `${days} calendar days. The next cycle may proceed within these terms.`}
      </span>
    </label>
  );
}
