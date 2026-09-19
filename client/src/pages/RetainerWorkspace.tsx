import { useState, useMemo } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import { apiRequest } from "@/lib/queryClient";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Loader2, Plus, Star, Clock, CheckCircle2, AlertTriangle, Circle,
  MessageSquare, CreditCard, FileText, History as HistoryIcon,
  ListChecks, Inbox, BarChart3, LayoutGrid, PauseCircle, XCircle,
  ChevronDown, ChevronRight, Download, Send, ArrowRight, Gauge,
  CalendarDays, Package, TrendingUp, Star as StarIcon,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Tab =
  | "overview" | "current_cycle" | "requests" | "deliverables"
  | "usage" | "messages" | "payments" | "agreement" | "history";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "overview", label: "Overview", icon: Gauge },
  { key: "current_cycle", label: "Current Cycle", icon: LayoutGrid },
  { key: "requests", label: "Requests", icon: Inbox },
  { key: "deliverables", label: "Deliverables", icon: Package },
  { key: "usage", label: "Usage", icon: BarChart3 },
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "agreement", label: "Agreement", icon: FileText },
  { key: "history", label: "History", icon: HistoryIcon },
];

// The 14 statuses from PRD-012 section 8
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  proposed: "Proposal Sent",
  awaiting_client_acceptance: "Awaiting Client",
  accepted: "Accepted",
  active: "Active",
  active_cycle: "Active Cycle",
  renewal_due: "Renewal Due",
  cycle_review_due: "Cycle Review Due",
  overdue: "Overdue",
  paused: "Paused",
  amendment_pending: "Amendment Pending",
  ending: "Ending",
  ended: "Ended",
  cancelled: "Cancelled",
  declined: "Declined",
  expired: "Expired",
};

const STATUS_COLOURS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  proposed: "bg-blue-100 text-blue-800",
  awaiting_client_acceptance: "bg-amber-100 text-amber-800",
  accepted: "bg-blue-100 text-blue-800",
  active: "bg-green-100 text-green-800",
  active_cycle: "bg-green-100 text-green-800",
  renewal_due: "bg-amber-100 text-amber-800",
  cycle_review_due: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
  paused: "bg-zinc-200 text-zinc-700",
  amendment_pending: "bg-purple-100 text-purple-800",
  ending: "bg-orange-100 text-orange-800",
  ended: "bg-zinc-100 text-zinc-500",
  cancelled: "bg-red-100 text-red-700",
  declined: "bg-red-100 text-red-700",
  expired: "bg-zinc-100 text-zinc-500",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_COLOURS[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function fmtGBP(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Data fetching ──────────────────────────────────────────────────────────

function useWorkspace(publicId: string | undefined, userId: number | undefined) {
  return useQuery({
    queryKey: ["retainer-workspace", publicId, userId],
    queryFn: async () => {
      const res = await fetch(`/api/retainer/${publicId}/workspace?userId=${userId}`);
      if (!res.ok) throw new Error("Failed to load retainer workspace");
      return res.json();
    },
    enabled: !!publicId && !!userId,
    staleTime: 30_000,
  });
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function RetainerWorkspace() {
  const { publicId } = useParams<{ publicId: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);

  const workspaceQuery = useWorkspace(publicId, user?.id);
  const data = workspaceQuery.data;
  const agreement = data?.agreement;
  const onboarding = data?.onboarding ?? {};
  const currentCycle = data?.currentCycle;
  const cycles: any[] = data?.cycles ?? [];
  const deliverables: any[] = data?.deliverables ?? [];
  const requests: any[] = data?.requests ?? [];
  const usage: any[] = data?.usage ?? [];
  const tasks: any[] = data?.tasks ?? [];
  const amendments: any[] = data?.amendments ?? [];

  const isClient =
    agreement &&
    Number(user?.id) === Number(agreement.clientUserId);

  const isPendingProposal =
    agreement?.status === "awaiting_client_acceptance";

  const isDeclined =
    agreement?.status === "declined";

  const {
    data: submissions = [],
  } = useQuery<any[]>({
    queryKey: [
      "retainer-submissions",
      publicId,
    ],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/retainer/${publicId}/submissions`,
      );

      if (!res.ok) {
        throw new Error(
          "Failed to load work submissions",
        );
      }

      return res.json();
    },
    enabled:
      !!publicId &&
      !!user?.id &&
      !isPendingProposal &&
      !isDeclined,
    staleTime: 0,
  });

  const {
    data: stageUpdates = [],
  } = useQuery<any[]>({
    queryKey: [
      "retainer-stage-updates",
      publicId,
    ],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/retainer/${publicId}/stage-updates`,
      );

      if (!res.ok) {
        throw new Error(
          "Failed to load stage updates",
        );
      }

      return res.json();
    },
    enabled:
      !!publicId &&
      !!user?.id &&
      !isPendingProposal &&
      !isDeclined,
    staleTime: 0,
  });

  // ── Mutations ──

  const acceptRetainerMutation = useMutation({
    mutationFn: async () =>
      apiRequest(
        "POST",
        `/api/retainer/${publicId}/accept`,
        {},
      ),

    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["retainer-workspace", publicId],
      });
    },
  });

  const declineRetainerMutation = useMutation({
    mutationFn: async () =>
      apiRequest(
        "POST",
        `/api/retainer/${publicId}/decline`,
        {},
      ),

    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["retainer-workspace", publicId],
      });
    },
  });

  const submitRequestMutation = useMutation({
    mutationFn: async (payload: any) => apiRequest("POST", `/api/retainer/${publicId}/requests`, { userId: user?.id, ...payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["retainer-workspace", publicId] }); setRequestModalOpen(false); },
  });

  const requestActionMutation = useMutation({
    mutationFn: async ({ requestId, action }: { requestId: string; action: string }) =>
      apiRequest("POST", `/api/retainer/${publicId}/requests/${requestId}/${action}`, { userId: user?.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retainer-workspace", publicId] }),
  });

  const taskAdvanceMutation = useMutation({
    mutationFn: async (taskPublicId: string) =>
      apiRequest(
        "POST",
        `/api/retainer/${publicId}/tasks/${taskPublicId}/advance`,
        { userId: user?.id },
      ),

    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["retainer-workspace", publicId],
      }),
  });

  const cycleReviewMutation = useMutation({
    mutationFn: async (payload: any) =>
      apiRequest(
        "POST",
        `/api/retainer/${publicId}/cycle-review`,
        {
          userId: user?.id,
          cycleId: currentCycle?.id,
          ...payload,
        },
      ),

    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["retainer-workspace", publicId],
      });

      setReviewModalOpen(false);
    },
  });

  const payCycleMutation = useMutation({
    mutationFn: async (cyclePublicId: string) => apiRequest("POST", `/api/retainer-cycles/${cyclePublicId}/payments`, { userId: user?.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["retainer-workspace", publicId] }),
  });

  const pauseMutation = useMutation({
    mutationFn: async (payload: any) => apiRequest("POST", `/api/retainer/${publicId}/pause`, { userId: user?.id, ...payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["retainer-workspace", publicId] }); setPauseModalOpen(false); },
  });

  const endMutation = useMutation({
    mutationFn: async (payload: any) => apiRequest("POST", `/api/retainer/${publicId}/end`, { userId: user?.id, ...payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["retainer-workspace", publicId] }); setEndModalOpen(false); },
  });

  // ── Derived metrics ──
  const healthScore = agreement?.healthScore ?? computeHealthScore(currentCycle, deliverables);
  const currentCycleTasks = currentCycle
    ? tasks.filter(
        (task) =>
          Number(task.retainerCycleId) ===
          Number(currentCycle.id),
      )
    : [];

  const cycleDeliverablesTotal =
    currentCycleTasks.length;

  const cycleDeliverablesDone =
    currentCycleTasks.filter(
      (task) =>
        task.status === "complete" ||
        task.status === "done",
    ).length;

  const cycleProgressPct =
    cycleDeliverablesTotal > 0
      ? Math.round(
          (cycleDeliverablesDone /
            cycleDeliverablesTotal) *
            100,
        )
      : 0;

  const workItemGroups = deliverables
    .map((deliverable) => {
      const items = currentCycleTasks.filter(
        (task) =>
          Number(task.deliverableId) ===
          Number(deliverable.id),
      );

      const done = items.filter(
        (task) =>
          task.status === "complete" ||
          task.status === "done",
      ).length;

      return {
        deliverable,
        items,
        done,
      };
    })
    .filter((group) => group.items.length > 0);

  const primaryAction = useMemo(() => getPrimaryAction(agreement?.status, currentCycle), [agreement?.status, currentCycle]);

  if (workspaceQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={28} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  if (workspaceQuery.isError || !agreement) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <AlertTriangle size={28} className="text-amber-500 mx-auto mb-3" />
        <p className="text-sm font-semibold">Couldn't load this retainer</p>
        <p className="text-xs text-muted-foreground mt-1">Check the link or try again shortly.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-24">
      {/* ── Header ── */}
      <div className="relative rounded-2xl border border-border bg-card overflow-hidden mb-6">
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#FF5A1F,#FF8C42)" }} />
        <div className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-lg sm:text-xl font-bold font-[Clash_Display,sans-serif] truncate">
                  {agreement.name ?? "Retainer"}
                </h1>
                <StatusBadge status={agreement.status} />
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {isClient ? agreement.freelancerName : agreement.clientName} · {agreement.templateLabel ?? "Retainer"}
              </p>
              {currentCycle && (
                <p className="text-xs text-muted-foreground mt-1">
                  Cycle {currentCycle.cycleNumber} — {fmtDate(currentCycle.periodStart)} → {fmtDate(currentCycle.periodEnd)}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:items-end gap-2 shrink-0">
              <div className="flex gap-4 text-right">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Value / cycle</p>
                  <p className="text-sm font-bold">{fmtGBP(agreement.amountPerCyclePence ?? 0)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Next invoice</p>
                  <p className="text-sm font-bold">{fmtDate(agreement.nextInvoiceDate)}</p>
                </div>
              </div>
              {primaryAction &&
                !isPendingProposal &&
                !isDeclined && (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white whitespace-nowrap"
                  style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                >
                  {primaryAction.label} <ArrowRight size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Retainer proposal decision ── */}
      {isPendingProposal && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 dark:bg-amber-950/10 overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <FileText size={18} />
              </div>

              <div>
                <h2 className="text-base font-bold">
                  Retainer proposal awaiting your decision
                </h2>

                <p className="text-sm text-muted-foreground mt-1">
                  Review the agreement before accepting.
                  Cycle 1 will only begin after acceptance.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="p-3 rounded-xl bg-background border border-border">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Value / cycle
                </p>
                <p className="text-sm font-bold mt-1">
                  {fmtGBP(agreement.amountPerCyclePence ?? 0)}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-background border border-border">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Billing
                </p>
                <p className="text-sm font-bold mt-1 capitalize">
                  {(agreement.billingFrequency ?? "—").replace(/_/g, " ")}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-background border border-border">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Minimum term
                </p>
                <p className="text-sm font-bold mt-1">
                  {agreement.minimumTermCycles
                    ? `${agreement.minimumTermCycles} cycle${agreement.minimumTermCycles === 1 ? "" : "s"}`
                    : "—"}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-background border border-border">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Proposed by
                </p>
                <p className="text-sm font-bold mt-1 truncate">
                  {agreement.freelancerName}
                </p>
              </div>
            </div>

            {agreement.goal && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  Goal
                </p>
                <p className="text-sm">{agreement.goal}</p>
              </div>
            )}

            <div className="mb-5">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Deliverables
              </p>

              <div className="space-y-2">
                {deliverables.map((deliverable: any) => (
                  <div
                    key={deliverable.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-background border border-border"
                  >
                    <span className="text-sm font-medium">
                      {deliverable.name}
                    </span>

                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {deliverable.quantityIncluded}
                      {" × "}
                      {(deliverable.frequency ?? "per cycle").replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {isClient ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={
                    acceptRetainerMutation.isPending ||
                    declineRetainerMutation.isPending
                  }
                  onClick={() => acceptRetainerMutation.mutate()}
                  className="flex-1 px-4 py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-50"
                  style={{
                    background:
                      "linear-gradient(135deg,#FF5A1F,#FF8C42)",
                  }}
                >
                  {acceptRetainerMutation.isPending
                    ? "Accepting…"
                    : "Accept Retainer"}
                </button>

                <button
                  type="button"
                  disabled={
                    acceptRetainerMutation.isPending ||
                    declineRetainerMutation.isPending
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        "Decline this retainer proposal? The freelancer will be notified.",
                      )
                    ) {
                      declineRetainerMutation.mutate();
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-full text-sm font-semibold border border-red-300 text-red-700 bg-background hover:bg-red-50 disabled:opacity-50"
                >
                  {declineRetainerMutation.isPending
                    ? "Declining…"
                    : "Decline"}
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-background border border-border text-sm text-muted-foreground">
                Waiting for {agreement.clientName} to review this proposal.
              </div>
            )}

            {(acceptRetainerMutation.isError ||
              declineRetainerMutation.isError) && (
              <p className="text-xs text-red-600 mt-3">
                We couldn't update this retainer. Please try again.
              </p>
            )}
          </div>
        </div>
      )}

      {isDeclined && (
        <div className="mb-6 p-5 rounded-2xl border border-red-200 bg-red-50/60 dark:bg-red-950/10">
          <div className="flex items-start gap-3">
            <XCircle
              size={18}
              className="text-red-600 mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-semibold">
                This retainer proposal was declined
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                No cycle has been started and no work items have been created.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* FR-12: Cycle review banner */}
      {agreement.status === "cycle_review_due" && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 mb-6">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0" />
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Cycle {currentCycle?.cycleNumber} is complete — review required
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReviewModalOpen(true)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-600 text-white shrink-0"
          >
            Review cycle
          </button>
        </div>
      )}

      {/* ── Tabs ── */}
      {!isPendingProposal && !isDeclined && (
      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key ? "border-[#FF5A1F] text-[#FF5A1F]" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      )}
      {/* ── Overview ── */}
      {!isPendingProposal && !isDeclined && tab === "overview" && (
        <div className="space-y-6">
          {(onboarding.welcomeMessage || onboarding.kickoffAt) && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays size={16} className="text-[#FF5A1F]" />
                <p className="text-sm font-semibold">Getting started</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {onboarding.welcomeMessage && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                      Welcome message
                    </p>
                    <p className="text-sm whitespace-pre-wrap">
                      {onboarding.welcomeMessage}
                    </p>
                  </div>
                )}

                {onboarding.kickoffAt && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                      Kick-off
                    </p>
                    <p className="text-sm font-semibold">
                      {new Date(onboarding.kickoffAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl border border-border bg-card flex items-center gap-4">
              <HealthRing score={healthScore} />
              <div>
                <p className="text-sm font-semibold">Relationship health</p>
                <p className="text-xs text-muted-foreground">Based on delivery, satisfaction and payment history.</p>
              </div>
            </div>

            <div className="p-5 rounded-2xl border border-border bg-card">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Cycle progress</p>
              <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden mb-1.5">
                <div className="h-full rounded-full" style={{ width: `${cycleProgressPct}%`, background: "#FF5A1F" }} />
              </div>
              <p className="text-xs text-muted-foreground">{cycleDeliverablesDone} / {cycleDeliverablesTotal} deliverables done</p>
            </div>

            <div className="p-5 rounded-2xl border border-border bg-card">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Capacity used</p>
              <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden mb-1.5">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, capacityUsedPct(currentCycle))}%`,
                    background: capacityUsedPct(currentCycle) > 90 ? "#ef4444" : "#FF5A1F",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {currentCycle?.capacityUsed ?? 0} / {currentCycle?.capacityIncluded ?? "—"} used this cycle
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile label="Cycles completed" value={String(agreement.cyclesCompleted ?? cycles.filter(c => c.status === "completed").length)} icon={<CalendarDays size={13} />} />
            <MetricTile label="On-time rate" value={`${agreement.onTimeRate ?? "—"}%`} icon={<Clock size={13} />} />
            <MetricTile label="Satisfaction avg" value={agreement.satisfactionAvg ? `${agreement.satisfactionAvg.toFixed(1)} / 5` : "—"} icon={<StarIcon size={13} />} />
            <MetricTile label="Open requests" value={String(requests.filter(r => r.status === "pending").length)} icon={<Inbox size={13} />} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <QuickActionCard icon={<Plus size={15} />} label="New request" onClick={() => setRequestModalOpen(true)} />
            <QuickActionCard icon={<MessageSquare size={15} />} label="Message" onClick={() => setTab("messages")} />
            <QuickActionCard icon={<FileText size={15} />} label="View agreement" onClick={() => setTab("agreement")} />
          </div>
        </div>
      )}

      {/* ── Current Cycle: individual work items ── */}
      {!isPendingProposal && !isDeclined && tab === "current_cycle" && (
        <div className="space-y-4">
          {!currentCycle ? (
            <div className="py-16 text-center rounded-2xl border border-dashed border-border">
              <Package
                size={24}
                className="mx-auto mb-2 text-muted-foreground"
              />

              <p className="text-sm font-semibold">
                No active cycle yet
              </p>

              <p className="text-xs text-muted-foreground mt-1">
                Work items will appear here when the
                retainer cycle starts.
              </p>
            </div>
          ) : workItemGroups.length === 0 ? (
            <div className="py-16 text-center rounded-2xl border border-dashed border-border">
              <Package
                size={24}
                className="mx-auto mb-2 text-muted-foreground"
              />

              <p className="text-sm font-semibold">
                No work items in this cycle
              </p>

              <p className="text-xs text-muted-foreground mt-1">
                This cycle does not have any included
                deliverables yet.
              </p>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-2xl border border-border bg-card">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <p className="text-sm font-semibold">
                      Cycle {currentCycle.cycleNumber}
                    </p>

                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtDate(currentCycle.periodStart)}
                      {" → "}
                      {fmtDate(currentCycle.periodEnd)}
                    </p>
                  </div>

                  <p className="text-sm font-bold tabular-nums whitespace-nowrap">
                    {cycleDeliverablesDone}
                    {" / "}
                    {cycleDeliverablesTotal}
                    {" complete"}
                  </p>
                </div>

                <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${cycleProgressPct}%`,
                      background: "#FF5A1F",
                    }}
                  />
                </div>
              </div>

              {workItemGroups.map(
                ({ deliverable, items, done }) => {
                  const progress =
                    items.length > 0
                      ? Math.round(
                          (done / items.length) * 100,
                        )
                      : 0;

                  return (
                    <div
                      key={deliverable.id}
                      className="rounded-2xl border border-border bg-card overflow-hidden"
                    >
                      <div className="p-4 sm:p-5 border-b border-border">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">
                              {deliverable.name}
                            </p>

                            <p className="text-xs text-muted-foreground mt-0.5">
                              {deliverable.quantityIncluded}
                              {" "}
                              {deliverable.frequency
                                ?.replace(/_/g, " ")}
                            </p>
                          </div>

                          <span className="text-xs font-semibold whitespace-nowrap">
                            {done}
                            {" / "}
                            {items.length}
                            {" complete"}
                          </span>
                        </div>

                        <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${progress}%`,
                              background: "#FF5A1F",
                            }}
                          />
                        </div>
                      </div>

                      <div className="divide-y divide-border">
                        {items.map((task) => {
                          const complete =
                            task.status === "complete" ||
                            task.status === "done";

                          const stages: string[] =
                            Array.isArray(task.stages)
                              ? task.stages
                              : [];

                          const stageCount =
                            stages.length;

                          const currentStep =
                            Math.min(
                              Number(
                                task.stageIndex ?? 0,
                              ) + 1,
                              Math.max(
                                stageCount,
                                1,
                              ),
                            );

                          const finalApprovalStageIndex =
                            Math.max(
                              0,
                              stageCount - 1,
                            );

                          const maxFreelancerIndex =
                            finalApprovalStageIndex;

                          const taskSubmissions =
                            submissions.filter(
                              (submission: any) =>
                                submission.taskPublicId ===
                                task.publicId,
                            );

                          const taskStageUpdates =
                            stageUpdates.filter(
                              (update: any) =>
                                update.taskPublicId ===
                                task.publicId,
                            );

                          return (
                            <div
                              key={
                                task.publicId ??
                                task.id
                              }
                              className="p-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3"
                            >
                              <div className="flex items-start gap-3 flex-1 min-w-0">
                                <div className="mt-0.5 shrink-0">
                                  {complete ? (
                                    <CheckCircle2
                                      size={18}
                                      className="text-green-600"
                                    />
                                  ) : (
                                    <Circle
                                      size={18}
                                      className="text-zinc-300"
                                    />
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">
                                    {task.title}
                                  </p>

                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span
                                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                        complete
                                          ? "bg-green-100 text-green-800"
                                          : "bg-[#FF5A1F]/10 text-[#FF5A1F]"
                                      }`}
                                    >
                                      {complete
                                        ? "Complete"
                                        : task.stage ??
                                          "In progress"}
                                    </span>

                                    {stageCount > 0 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        Stage{" "}
                                        {currentStep}
                                        {" of "}
                                        {stageCount}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>



                              <WorkItemSubmissionPanel
                                publicId={publicId!}
                                task={task}
                                submissions={
                                  taskSubmissions
                                }
                                stageUpdates={
                                  taskStageUpdates
                                }
                                isClient={!!isClient}
                                complete={complete}
                                finalApprovalStageIndex={
                                  finalApprovalStageIndex
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                },
              )}
            </>
          )}
        </div>
      )}

      {/* ── Requests ── */}
      {!isPendingProposal && !isDeclined && tab === "requests" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-border bg-card">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Available capacity</p>
            <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden mb-1.5">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, 100 - capacityUsedPct(currentCycle))}%`, background: "#22c55e" }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {(currentCycle?.capacityIncluded ?? 0) - (currentCycle?.capacityUsed ?? 0)} remaining of {currentCycle?.capacityIncluded ?? "—"}
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setRequestModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
            >
              <Plus size={13} /> New Request
            </button>
          </div>

          <div className="space-y-2">
            {requests.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-12">No requests in the queue yet.</p>
            )}
            {requests.map(r => (
              <div key={r.id} className="p-4 rounded-2xl border border-border bg-card">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-semibold">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      r.priority === "high" ? "bg-red-100 text-red-800" : r.priority === "medium" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"
                    }`}>{r.priority}</span>
                    <StatusBadge status={r.status} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Due {fmtDate(r.dueDate)}</span>
                  {!isClient && r.status === "pending" && (
                    <div className="flex gap-1.5">
                      <button onClick={() => requestActionMutation.mutate({ requestId: r.id, action: "accept" })} className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-green-100 text-green-800 hover:bg-green-200">Accept</button>
                      <button onClick={() => requestActionMutation.mutate({ requestId: r.id, action: "schedule" })} className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800 hover:bg-blue-200">Schedule</button>
                      <button onClick={() => requestActionMutation.mutate({ requestId: r.id, action: "clarify" })} className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-zinc-100 text-zinc-600 hover:bg-zinc-200">Clarify</button>
                      <button onClick={() => requestActionMutation.mutate({ requestId: r.id, action: "out-of-scope" })} className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 hover:bg-red-200">Out of scope</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Deliverables ── */}
      {!isPendingProposal && !isDeclined && tab === "deliverables" && (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-zinc-50 dark:bg-zinc-900">
                {["Name", "Qty included", "Used this cycle", "Rollover balance", "Status"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deliverables.map((d: any) => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="px-3 py-2.5 font-medium">{d.name}</td>
                  <td className="px-3 py-2.5 tabular-nums">{d.quantityIncluded}</td>
                  <td className="px-3 py-2.5 tabular-nums">{d.usedThisCycle}</td>
                  <td className="px-3 py-2.5 tabular-nums">{d.rolloverBalance ?? 0}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={d.status ?? "active"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {deliverables.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-12">No deliverables configured.</p>
          )}
        </div>
      )}

      {/* ── Usage ── */}
      {!isPendingProposal && !isDeclined && tab === "usage" && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-border bg-card flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">Running total vs allowance</p>
            <p className="text-sm font-bold">
              {usage.reduce((s, u) => s + (u.quantity ?? 0), 0)} / {currentCycle?.capacityIncluded ?? "—"}
            </p>
          </div>
          <div className="space-y-2">
            {usage.length === 0 && <p className="text-center text-xs text-muted-foreground py-12">No usage logged this cycle.</p>}
            {usage.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-card text-xs">
                <div>
                  <p className="font-medium text-sm">{u.description}</p>
                  <p className="text-muted-foreground mt-0.5">Recorded by {u.recordedBy}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{u.quantity} {u.unit}</p>
                  <p className="text-muted-foreground">{fmtDate(u.date)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      {!isPendingProposal && !isDeclined && tab === "messages" && (
        <MessagesPanel retainerId={agreement.id ?? publicId} userId={user?.id} />
      )}

      {/* ── Payments ── */}
      {!isPendingProposal && !isDeclined && tab === "payments" && (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-zinc-50 dark:bg-zinc-900">
                {["Cycle", "Period", "Amount", "Status", "Invoice date", ""].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cycles.map((c: any) => (
                <tr key={c.publicId} className="border-b border-border last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="px-3 py-2.5 font-medium">Cycle {c.cycleNumber}</td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(c.periodStart)} → {fmtDate(c.periodEnd)}</td>
                  <td className="px-3 py-2.5 font-semibold">{fmtGBP(c.amountPence ?? agreement.amountPerCyclePence ?? 0)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={c.paymentStatus ?? c.status} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(c.invoiceDate)}</td>
                  <td className="px-3 py-2.5">
                    {["pending", "unpaid", "overdue"].includes(c.paymentStatus) && (
                      <button
                        onClick={() => payCycleMutation.mutate(c.publicId)}
                        disabled={payCycleMutation.isPending}
                        className="px-3 py-1 rounded-full text-[10px] font-semibold text-white disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                      >
                        Pay cycle
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cycles.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-12">No cycle payments yet.</p>
          )}
        </div>
      )}

      {/* ── Agreement ── */}
      {!isPendingProposal && !isDeclined && tab === "agreement" && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Current agreement — v{agreement.version ?? 1}</p>
              <a
                href={`/api/retainer/${publicId}/agreement/download?userId=${user?.id}`}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#FF5A1F] hover:underline"
              >
                <Download size={12} /> Download
              </a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div><p className="text-muted-foreground mb-0.5">Price</p><p className="font-semibold text-sm">{fmtGBP(agreement.amountPerCyclePence ?? 0)} / {agreement.billingFrequency}</p></div>
              <div><p className="text-muted-foreground mb-0.5">Minimum term</p><p className="font-semibold text-sm">{agreement.minimumTermCycles} cycles</p></div>
              <div><p className="text-muted-foreground mb-0.5">Notice period</p><p className="font-semibold text-sm">{agreement.noticePeriodCycles} month(s)</p></div>
              <div><p className="text-muted-foreground mb-0.5">Revisions</p><p className="font-semibold text-sm">{agreement.maxRevisions}</p></div>
              <div><p className="text-muted-foreground mb-0.5">Response SLA</p><p className="font-semibold text-sm">{agreement.responseTimeHours}h</p></div>
              <div><p className="text-muted-foreground mb-0.5">Renewal mode</p><p className="font-semibold text-sm capitalize">{agreement.renewalMode}</p></div>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Goal</p>
              <p className="text-sm">{agreement.goal}</p>
            </div>
          </div>

          {amendments.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Version history</p>
              <div className="space-y-2">
                {amendments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card text-xs">
                    <span>v{a.version} — {a.summary}</span>
                    <span className="text-muted-foreground">{fmtDate(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FR-13: Pause / End */}
          <div className="p-5 rounded-2xl border border-red-200 bg-red-50/50 dark:bg-red-950/10 space-y-3">
            <p className="text-sm font-semibold">Manage retainer</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setPauseModalOpen(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border border-border bg-card hover:bg-zinc-50"
              >
                <PauseCircle size={13} /> Pause Retainer
              </button>
              <button
                type="button"
                onClick={() => setEndModalOpen(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border border-red-300 text-red-700 bg-card hover:bg-red-50"
              >
                <XCircle size={13} /> End Retainer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── History ── */}
      {!isPendingProposal && !isDeclined && tab === "history" && (
        <div className="space-y-2">
          {cycles.filter((c: any) => c.status === "completed").length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-12">No completed cycles yet.</p>
          )}
          {cycles.filter((c: any) => c.status === "completed").map((c: any) => {
            const expanded = expandedCycle === c.publicId;
            return (
              <div key={c.publicId} className="rounded-2xl border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedCycle(expanded ? null : c.publicId)}
                  className="w-full flex items-center justify-between p-4 text-left"
                >
                  <div>
                    <p className="text-sm font-semibold">Cycle {c.cycleNumber}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(c.periodStart)} → {fmtDate(c.periodEnd)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.satisfactionScore && (
                      <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-500">
                        <Star size={12} className="fill-amber-400 text-amber-400" /> {c.satisfactionScore}
                      </span>
                    )}
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                </button>
                {expanded && (
                  <div className="px-4 pb-4 space-y-3 text-xs">
                    <div>
                      <p className="font-semibold mb-1">Deliverables completed</p>
                      <p className="text-muted-foreground">{c.deliverablesCompleted ?? "—"}</p>
                    </div>
                    <div>
                      <p className="font-semibold mb-1">Usage</p>
                      <p className="text-muted-foreground">{c.usageSummary ?? "—"}</p>
                    </div>
                    <div>
                      <p className="font-semibold mb-1">Outstanding items</p>
                      <p className="text-muted-foreground">{c.outstandingItems ?? "None"}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── FR-11: New Request modal ── */}
      <NewRequestModal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        deliverables={deliverables}
        currentCycle={currentCycle}
        onSubmit={(payload) => submitRequestMutation.mutate(payload)}
        submitting={submitRequestMutation.isPending}
      />

      {/* ── FR-12: Cycle review modal ── */}
      <CycleReviewModal
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        cycle={currentCycle}
        tasks={tasks}
        onSubmit={(payload) => cycleReviewMutation.mutate(payload)}
        submitting={cycleReviewMutation.isPending}
      />

      {/* ── FR-13: Pause modal ── */}
      <PauseModal
        open={pauseModalOpen}
        onClose={() => setPauseModalOpen(false)}
        onSubmit={(payload) => pauseMutation.mutate(payload)}
        submitting={pauseMutation.isPending}
      />

      {/* ── FR-13: End modal ── */}
      <EndModal
        open={endModalOpen}
        onClose={() => setEndModalOpen(false)}
        noticePeriodCycles={agreement.noticePeriodCycles ?? 1}
        onSubmit={(payload) => endMutation.mutate(payload)}
        submitting={endMutation.isPending}
      />

      {/* Floating new-request button (clients) */}
      {isClient &&
        !isPendingProposal &&
        !isDeclined &&
        tab !== "requests" && (
        <button
          type="button"
          onClick={() => setRequestModalOpen(true)}
          className="fixed bottom-6 right-6 flex items-center gap-1.5 px-4 py-3 rounded-full text-sm font-semibold text-white shadow-lg"
          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
        >
          <Plus size={16} /> New Request
        </button>
      )}
    </div>
  );
}

// ─── Helper components ──────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const colour = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 26;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth="6" />
        <circle
          cx="32" cy="32" r="26" fill="none" stroke={colour} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 32 32)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold">{score}</span>
      </div>
    </div>
  );
}

function computeHealthScore(currentCycle: any, deliverables: any[]) {
  if (!currentCycle) return 70;
  const onTime = currentCycle.overdueCount ? 60 : 90;
  return onTime;
}

function capacityUsedPct(currentCycle: any) {
  if (!currentCycle?.capacityIncluded) return 0;
  return Math.round(((currentCycle.capacityUsed ?? 0) / currentCycle.capacityIncluded) * 100);
}

function getPrimaryAction(status: string | undefined, currentCycle: any): { label: string; onClick: () => void } | null {
  switch (status) {
    case "renewal_due":
      return { label: "Renew retainer", onClick: () => {} };
    case "cycle_review_due":
      return { label: "Review cycle", onClick: () => {} };
    case "paused":
      return { label: "Resume retainer", onClick: () => {} };
    case "proposed":
      return { label: "Accept proposal", onClick: () => {} };
    case "amendment_pending":
      return { label: "Review amendment", onClick: () => {} };
    default:
      return { label: "Open current cycle", onClick: () => {} };
  }
}

function MetricTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-3.5 rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}<span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function QuickActionCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 p-4 rounded-2xl border border-border bg-card hover:shadow-md transition-shadow text-left"
    >
      <span className="w-8 h-8 rounded-lg bg-[#FF5A1F]/10 text-[#FF5A1F] flex items-center justify-center shrink-0">{icon}</span>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  );
}

// ─── Messages panel ─────────────────────────────────────────────────────────

function WorkItemSubmissionPanel({
  publicId,
  task,
  submissions,
  stageUpdates,
  isClient,
  complete,
  finalApprovalStageIndex,
}: {
  publicId: string;
  task: any;
  submissions: any[];
  stageUpdates: any[];
  isClient: boolean;
  complete: boolean;
  finalApprovalStageIndex: number;
}) {
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [deliverableUrl, setDeliverableUrl] =
    useState("");
  const [feedback, setFeedback] =
    useState("");
  const [error, setError] =
    useState("");

  const [busy, setBusy] =
    useState<
      "progress" |
      "submit" |
      "approve" |
      "changes" |
      null
    >(null);

  const orderedSubmissions =
    [...submissions].sort(
      (a, b) =>
        Number(a.version ?? 0) -
        Number(b.version ?? 0),
    );

  const latestSubmission =
    orderedSubmissions[
      orderedSubmissions.length - 1
    ];

  const hasApprovedSubmission =
    orderedSubmissions.some(
      (submission: any) =>
        submission.status === "approved",
    );

  const awaitingReview =
    task.status ===
    "awaiting_client_review";

  const changesRequested =
    task.status ===
    "changes_requested";

  const stageIndex =
    Number(task.stageIndex ?? 0);

  const canProgress =
    !isClient &&
    !complete &&
    !awaitingReview &&
    stageIndex <
      finalApprovalStageIndex;

  const canSubmit =
    !isClient &&
    !complete &&
    !awaitingReview &&
    stageIndex >=
      finalApprovalStageIndex;

  const orderedStageUpdates =
    [...stageUpdates].sort(
      (a, b) =>
        new Date(
          a.createdAt ?? 0,
        ).getTime() -
        new Date(
          b.createdAt ?? 0,
        ).getTime(),
    );

  const canReview =
    isClient &&
    !complete &&
    awaitingReview &&
    latestSubmission?.status ===
      "submitted";

  const nextVersion =
    Number(
      latestSubmission?.version ?? 0,
    ) + 1;

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: [
          "retainer-workspace",
          publicId,
        ],
      }),
      qc.invalidateQueries({
        queryKey: [
          "retainer-submissions",
          publicId,
        ],
      }),
      qc.invalidateQueries({
        queryKey: [
          "retainer-stage-updates",
          publicId,
        ],
      }),
    ]);
  }

  async function progressWork() {
    setError("");

    if (!note.trim()) {
      setError(
        "Add a comment about the work completed at this stage.",
      );
      return;
    }

    if (!deliverableUrl.trim()) {
      setError(
        "Add a work link before moving to the next stage.",
      );
      return;
    }

    try {
      const parsed =
        new URL(
          deliverableUrl.trim(),
        );

      if (
        parsed.protocol !== "http:" &&
        parsed.protocol !== "https:"
      ) {
        throw new Error();
      }
    } catch {
      setError(
        "Enter a valid http or https work link.",
      );
      return;
    }

    setBusy("progress");

    try {
      const res = await apiRequest(
        "POST",
        `/api/retainer/${publicId}/tasks/${task.publicId}/progress`,
        {
          note:
            note.trim(),
          deliverableUrl:
            deliverableUrl.trim(),
        },
      );

      if (!res.ok) {
        const body =
          await res
            .json()
            .catch(() => ({}));

        throw new Error(
          body?.error ??
            "Could not save stage update",
        );
      }

      setNote("");
      setDeliverableUrl("");

      await invalidate();
    } catch (e: any) {
      setError(
        e?.message ??
          "Could not save stage update",
      );
    } finally {
      setBusy(null);
    }
  }

  async function submitWork() {
    setError("");

    if (!deliverableUrl.trim()) {
      setError(
        "Add a deliverable link before submitting.",
      );
      return;
    }

    if (deliverableUrl.trim()) {
      try {
        const parsed =
          new URL(
            deliverableUrl.trim(),
          );

        if (
          parsed.protocol !== "http:" &&
          parsed.protocol !== "https:"
        ) {
          throw new Error();
        }
      } catch {
        setError(
          "Enter a valid http or https deliverable link.",
        );
        return;
      }
    }

    setBusy("submit");

    try {
      const res = await apiRequest(
        "POST",
        `/api/retainer/${publicId}/tasks/${task.publicId}/submit`,
        {
          note:
            note.trim() || null,
          deliverableUrl:
            deliverableUrl.trim(),
        },
      );

      if (!res.ok) {
        const body =
          await res
            .json()
            .catch(() => ({}));

        throw new Error(
          body?.error ??
            "Could not submit work",
        );
      }

      setNote("");
      setDeliverableUrl("");

      await invalidate();
    } catch (e: any) {
      setError(
        e?.message ??
          "Could not submit work",
      );
    } finally {
      setBusy(null);
    }
  }

  async function reviewWork(
    action:
      | "approve"
      | "request-changes",
  ) {
    setError("");

    if (
      action === "request-changes" &&
      !feedback.trim()
    ) {
      setError(
        "Add feedback before requesting changes.",
      );
      return;
    }

    setBusy(
      action === "approve"
        ? "approve"
        : "changes",
    );

    try {
      const res = await apiRequest(
        "POST",
        `/api/retainer/${publicId}/tasks/${task.publicId}/${action}`,
        {
          feedback:
            feedback.trim() || null,
        },
      );

      if (!res.ok) {
        const body =
          await res
            .json()
            .catch(() => ({}));

        throw new Error(
          body?.error ??
            "Could not update work item",
        );
      }

      setFeedback("");

      await invalidate();
    } catch (e: any) {
      setError(
        e?.message ??
          "Could not update work item",
      );
    } finally {
      setBusy(null);
    }
  }

  let summary =
    "Work submission";

  if (complete) {
    summary =
      hasApprovedSubmission
        ? "Client approved"
        : "Legacy completion";
  } else if (awaitingReview) {
    summary =
      isClient
        ? "Review submission"
        : "Awaiting client review";
  } else if (changesRequested) {
    summary =
      "Changes requested";
  } else if (canSubmit) {
    summary =
      submissions.length > 0
        ? `Submit final revision v${nextVersion}`
        : "Submit final work";
  } else if (canProgress) {
    summary =
      `Update ${task.stage ?? "current stage"} & move forward`;
  } else if (isClient) {
    summary =
      orderedStageUpdates.length > 0
        ? `${orderedStageUpdates.length} stage update${orderedStageUpdates.length === 1 ? "" : "s"}`
        : "No stage updates yet";
  }

  return (
    <div className="w-full basis-full pt-1">
      <button
        type="button"
        onClick={() =>
          setOpen((value) => !value)
        }
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/25 px-3 py-2.5 text-left hover:bg-secondary/40 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            {summary}
          </p>

          {latestSubmission && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Version{" "}
              {latestSubmission.version}
              {" · "}
              {String(
                latestSubmission.status ??
                  "submitted",
              ).replace(/_/g, " ")}
            </p>
          )}
        </div>

        {open ? (
          <ChevronDown
            size={14}
            className="shrink-0 text-muted-foreground"
          />
        ) : (
          <ChevronRight
            size={14}
            className="shrink-0 text-muted-foreground"
          />
        )}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-border bg-background p-4 space-y-4">

          {orderedStageUpdates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold">
                Stage history
              </p>

              {orderedStageUpdates.map(
                (update: any) => (
                  <div
                    key={
                      update.publicId ??
                      update.id
                    }
                    className="rounded-xl border border-border p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold">
                          Stage{" "}
                          {Number(
                            update.stageIndex ?? 0,
                          ) + 1}
                          {" — "}
                          {update.stageName}
                        </p>

                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Progressed to{" "}
                          {update.nextStageName}
                        </p>
                      </div>

                      {update.createdAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(
                            update.createdAt,
                          ).toLocaleString(
                            "en-GB",
                            {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                      )}
                    </div>

                    <p className="text-sm whitespace-pre-wrap">
                      {update.note}
                    </p>

                    <a
                      href={
                        update.deliverableUrl
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-xs font-semibold text-[#FF5A1F] hover:underline"
                    >
                      Open work link
                    </a>
                  </div>
                ),
              )}
            </div>
          )}

          {orderedSubmissions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold">
                Submission history
              </p>

              {orderedSubmissions.map(
                (submission: any) => (
                  <div
                    key={
                      submission.publicId ??
                      submission.id
                    }
                    className="rounded-xl border border-border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold">
                        Version{" "}
                        {submission.version}
                      </span>

                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground capitalize">
                        {String(
                          submission.status ??
                            "submitted",
                        ).replace(
                          /_/g,
                          " ",
                        )}
                      </span>
                    </div>

                    {submission.note && (
                      <p className="text-sm whitespace-pre-wrap">
                        {submission.note}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3">
                      {submission.deliverableUrl && (
                        <a
                          href={
                            submission.deliverableUrl
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#FF5A1F] hover:underline"
                        >
                          Open deliverable link
                        </a>
                      )}

                    </div>

                    {submission.clientFeedback && (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Client feedback
                        </p>

                        <p className="text-xs mt-1 whitespace-pre-wrap">
                          {
                            submission.clientFeedback
                          }
                        </p>
                      </div>
                    )}

                    {submission.submittedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        Submitted{" "}
                        {new Date(
                          submission.submittedAt,
                        ).toLocaleString(
                          "en-GB",
                          {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </p>
                    )}
                  </div>
                ),
              )}
            </div>
          )}

          {canProgress && (
            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <p className="text-xs font-semibold">
                  Update Stage{" "}
                  {stageIndex + 1}
                  {" — "}
                  {task.stage ??
                    "Current stage"}
                </p>

                <p className="text-[11px] text-muted-foreground mt-1">
                  Share the work completed at
                  this stage so the client has
                  a permanent progress record.
                  Saving the update moves this
                  item to the next stage.
                </p>
              </div>

              <Textarea
                rows={3}
                value={note}
                onChange={(e) =>
                  setNote(
                    e.target.value,
                  )
                }
                placeholder="What was completed or changed at this stage?"
                className="resize-none text-sm"
              />

              <input
                type="url"
                value={deliverableUrl}
                onChange={(e) =>
                  setDeliverableUrl(
                    e.target.value,
                  )
                }
                placeholder="Work link — Drive, Dropbox, Vimeo, Figma, Frame.io…"
                required
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />

              <button
                type="button"
                disabled={
                  busy === "progress"
                }
                onClick={
                  progressWork
                }
                className="w-full sm:w-auto px-4 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(135deg,#FF5A1F,#FF8C42)",
                }}
              >
                {busy === "progress"
                  ? "Saving update…"
                  : "Save update & move forward"}
              </button>
            </div>
          )}

          {canSubmit && (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold">
                  {changesRequested
                    ? `Submit revision v${nextVersion}`
                    : submissions.length > 0
                      ? `Submit final version ${nextVersion}`
                      : "Submit final work for approval"}
                </p>

                <p className="text-[11px] text-muted-foreground mt-1">
                  Add a final comment and the
                  final work link. The client
                  will approve or request
                  changes from this submission.
                </p>
              </div>

              <Textarea
                rows={3}
                value={note}
                onChange={(e) =>
                  setNote(e.target.value)
                }
                placeholder="Add your final delivery comment…"
                className="resize-none text-sm"
              />

              <input
                type="url"
                value={deliverableUrl}
                onChange={(e) =>
                  setDeliverableUrl(
                    e.target.value,
                  )
                }
                placeholder="Deliverable link — Drive, Dropbox, Vimeo, Figma, Frame.io…"
                required
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />

              <button
                type="button"
                disabled={
                  busy === "submit"
                }
                onClick={submitWork}
                className="w-full sm:w-auto px-4 py-2.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(135deg,#FF5A1F,#FF8C42)",
                }}
              >
                {busy === "submit"
                  ? "Submitting…"
                  : changesRequested
                    ? "Submit revision"
                    : "Submit for final approval"}
              </button>
            </div>
          )}

          {!isClient &&
            awaitingReview && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 p-3">
                <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                  Awaiting client approval
                </p>

                <p className="text-[11px] text-muted-foreground mt-1">
                  This item does not count
                  as complete until the
                  client approves it.
                </p>
              </div>
            )}

          {canReview && (
            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <p className="text-xs font-semibold">
                  Review this work
                </p>

                <p className="text-[11px] text-muted-foreground mt-1">
                  Approval marks this
                  individual work item as
                  100% complete.
                </p>
              </div>

              <Textarea
                rows={3}
                value={feedback}
                onChange={(e) =>
                  setFeedback(
                    e.target.value,
                  )
                }
                placeholder="Optional approval note, or explain what needs changing…"
                className="resize-none text-sm"
              />

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  disabled={
                    busy === "approve" ||
                    busy === "changes"
                  }
                  onClick={() =>
                    reviewWork("approve")
                  }
                  className="flex-1 px-4 py-2.5 rounded-full text-xs font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  {busy === "approve"
                    ? "Approving…"
                    : "Approve work"}
                </button>

                <button
                  type="button"
                  disabled={
                    busy === "approve" ||
                    busy === "changes"
                  }
                  onClick={() =>
                    reviewWork(
                      "request-changes",
                    )
                  }
                  className="flex-1 px-4 py-2.5 rounded-full text-xs font-semibold border border-amber-300 text-amber-800 bg-background hover:bg-amber-50 disabled:opacity-50"
                >
                  {busy === "changes"
                    ? "Sending feedback…"
                    : "Request changes"}
                </button>
              </div>
            </div>
          )}

          {isClient &&
            !canReview &&
            !complete &&
            orderedSubmissions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No work has been submitted
                for this item yet.
              </p>
            )}

          {complete && (
            <div
              className={`rounded-xl border p-3 ${
                hasApprovedSubmission
                  ? "border-green-200 bg-green-50/60 dark:bg-green-950/20"
                  : "border-zinc-200 bg-zinc-50 dark:bg-zinc-900/30"
              }`}
            >
              <p
                className={`text-xs font-semibold ${
                  hasApprovedSubmission
                    ? "text-green-800 dark:text-green-300"
                    : "text-muted-foreground"
                }`}
              >
                {hasApprovedSubmission
                  ? "Client approved — work item complete"
                  : "Legacy completion — completed before client approval was introduced"}
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MessagesPanel({ retainerId, userId }: { retainerId: string | number; userId: number | undefined }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const messagesQuery = useQuery({
    queryKey: ["retainer-messages", retainerId],
    queryFn: async () => {
      const res = await fetch(`/api/retainer/${retainerId}/messages?userId=${userId}`);
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!retainerId && !!userId,
    staleTime: 15_000,
  });

  const sendMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/retainer/${retainerId}/messages`, { userId, body: text }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["retainer-messages", retainerId] }); },
  });

  const messages: any[] = messagesQuery.data?.messages ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card flex flex-col h-[520px]">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messagesQuery.isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-zinc-400" /></div>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-16">No messages yet. Say hello to get started.</p>
        ) : (
          messages.map((m: any) => (
            <div key={m.id} className={`flex ${m.senderId === userId ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                m.senderId === userId ? "bg-[#FF5A1F] text-white" : "bg-zinc-100 dark:bg-zinc-800"
              }`}>
                <p>{m.body}</p>
                <p className={`text-[10px] mt-1 ${m.senderId === userId ? "text-white/70" : "text-muted-foreground"}`}>
                  {m.senderName} · {fmtDate(m.createdAt)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="p-3 border-t border-border flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && text.trim()) sendMutation.mutate(); }}
          placeholder="Write a message…"
          className="flex-1 px-3.5 py-2.5 text-sm border border-input rounded-full bg-background"
        />
        <button
          type="button"
          disabled={!text.trim() || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
          className="flex items-center justify-center w-10 h-10 rounded-full text-white disabled:opacity-50 shrink-0"
          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
        >
          {sendMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  );
}

// ─── FR-11: New Request modal ───────────────────────────────────────────────

function NewRequestModal({
  open, onClose, deliverables, currentCycle, onSubmit, submitting,
}: {
  open: boolean;
  onClose: () => void;
  deliverables: any[];
  currentCycle: any;
  onSubmit: (payload: any) => void;
  submitting: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [relatedDeliverableId, setRelatedDeliverableId] = useState<string>("");

  const remaining = currentCycle ? (currentCycle.capacityIncluded ?? 0) - (currentCycle.capacityUsed ?? 0) : null;

  function handleSubmit() {
    onSubmit({ title, description, priority, dueDate, relatedDeliverableId: relatedDeliverableId || null });
    setTitle(""); setDescription(""); setPriority("medium"); setDueDate(""); setRelatedDeliverableId("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New request</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {remaining != null && (
            <p className="text-xs text-muted-foreground bg-zinc-50 dark:bg-zinc-900 rounded-lg px-3 py-2">
              Remaining capacity this cycle: <span className="font-semibold text-foreground">{remaining}</span>
            </p>
          )}
          <div>
            <label className="text-xs font-semibold block mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background" placeholder="e.g. New Instagram carousel" />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1">Description</label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} className="resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1">Related deliverable</label>
            <Select value={relatedDeliverableId} onValueChange={setRelatedDeliverableId}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                {deliverables.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit request
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── FR-12: Cycle review modal ──────────────────────────────────────────────

function CycleReviewModal({
  open, onClose, cycle, tasks, onSubmit, submitting,
}: {
  open: boolean;
  onClose: () => void;
  cycle: any;
  tasks: any[];
  onSubmit: (payload: any) => void;
  submitting: boolean;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [outcomes, setOutcomes] = useState("");
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");

  const completedTasks = tasks.filter(t => t.status === "done");
  const outstanding = tasks.filter(t => t.status !== "done");

  function handleSubmit() {
    onSubmit({
      completedDeliverableIds: Object.keys(checked).filter(k => checked[k]),
      outstandingItems: outstanding.map(t => t.title),
      outcomesSummary: outcomes,
      satisfactionScore: stars,
      satisfactionComment: comment,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Review cycle {cycle?.cycleNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold mb-2">Completed deliverables</p>
            <div className="space-y-1.5">
              {completedTasks.map(t => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!checked[t.id]} onChange={e => setChecked(c => ({ ...c, [t.id]: e.target.checked }))} />
                  {t.title}
                </label>
              ))}
              {completedTasks.length === 0 && <p className="text-xs text-muted-foreground">No completed tasks recorded.</p>}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold mb-2">Outstanding items</p>
            {outstanding.length === 0 ? (
              <p className="text-xs text-muted-foreground">None — everything wrapped up.</p>
            ) : (
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {outstanding.map(t => <li key={t.id}>{t.title}</li>)}
              </ul>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1">Outcomes summary</label>
            <Textarea rows={3} value={outcomes} onChange={e => setOutcomes(e.target.value)} placeholder="What did this cycle achieve?" className="resize-none" />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1.5">Satisfaction pulse</label>
            <div className="flex gap-1 mb-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setStars(n)}>
                  <Star size={22} className={n <= stars ? "fill-amber-400 text-amber-400" : "text-zinc-300"} />
                </button>
              ))}
            </div>
            <Textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Any comments? (optional)" className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Submit review
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── FR-13: Pause modal ─────────────────────────────────────────────────────

function PauseModal({
  open, onClose, onSubmit, submitting,
}: { open: boolean; onClose: () => void; onSubmit: (payload: any) => void; submitting: boolean }) {
  const [reason, setReason] = useState("");
  const [effectiveCycle, setEffectiveCycle] = useState("next");
  const [feesContinue, setFeesContinue] = useState(false);
  const [deliverablesContinue, setDeliverablesContinue] = useState(false);
  const [rolloverContinues, setRolloverContinues] = useState(true);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Pause retainer</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold block mb-1">Reason</label>
            <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} className="resize-none" placeholder="Why are you pausing this retainer?" />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1">Effective cycle</label>
            <Select value={effectiveCycle} onValueChange={setEffectiveCycle}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Immediately</SelectItem>
                <SelectItem value="next">From next cycle</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center justify-between text-sm">
              Fees continue while paused
              <input type="checkbox" checked={feesContinue} onChange={e => setFeesContinue(e.target.checked)} />
            </label>
            <label className="flex items-center justify-between text-sm">
              Deliverables continue while paused
              <input type="checkbox" checked={deliverablesContinue} onChange={e => setDeliverablesContinue(e.target.checked)} />
            </label>
            <label className="flex items-center justify-between text-sm">
              Rollover continues while paused
              <input type="checkbox" checked={rolloverContinues} onChange={e => setRolloverContinues(e.target.checked)} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onSubmit({ reason, effectiveCycle, feesContinue, deliverablesContinue, rolloverContinues })}
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded-full text-sm font-semibold bg-zinc-800 text-white disabled:opacity-60"
          >
            {submitting ? <Loader2 size={14} className="animate-spin inline mr-1.5" /> : null} Confirm pause
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── FR-13: End modal ───────────────────────────────────────────────────────

function EndModal({
  open, onClose, noticePeriodCycles, onSubmit, submitting,
}: { open: boolean; onClose: () => void; noticePeriodCycles: number; onSubmit: (payload: any) => void; submitting: boolean }) {
  const [checklist, setChecklist] = useState({
    outstandingInvoices: false,
    finalDeliverables: false,
    assetsHandedOver: false,
  });
  const allChecked = Object.values(checklist).every(Boolean);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>End retainer</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <p>This agreement requires {noticePeriodCycles} month{noticePeriodCycles !== 1 ? "s" : ""} of notice. Ending now may still bill for the notice period.</p>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checklist.outstandingInvoices} onChange={e => setChecklist(c => ({ ...c, outstandingInvoices: e.target.checked }))} />
              All outstanding invoices settled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checklist.finalDeliverables} onChange={e => setChecklist(c => ({ ...c, finalDeliverables: e.target.checked }))} />
              Final deliverables confirmed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checklist.assetsHandedOver} onChange={e => setChecklist(c => ({ ...c, assetsHandedOver: e.target.checked }))} />
              Assets and access handed over
            </label>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onSubmit({ checklist })}
            disabled={!allChecked || submitting}
            className="w-full px-4 py-2.5 rounded-full text-sm font-semibold bg-red-600 text-white disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin inline mr-1.5" /> : null} End retainer
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
