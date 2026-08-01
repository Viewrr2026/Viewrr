import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  Loader2, AlertTriangle, CheckCircle2, RefreshCw, Download,
  BarChart3, AlertCircle, Clock, ArrowDownToLine, Zap,
  ChevronDown, ChevronRight, ExternalLink, Play, Wrench,
  TrendingUp, Users, CreditCard, ShieldAlert, Banknote,
} from "lucide-react";

type Period = "today" | "7d" | "30d";

function fmtGBP(pence: number) {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// FR-08: friendly status labels
const FRIENDLY_STATUS: Record<string, string> = {
  pending:                 "Awaiting payment",
  requires_payment_method: "Awaiting card details",
  requires_confirmation:   "Confirming",
  requires_action:         "Action required",
  processing:              "Processing",
  succeeded:               "Payment confirmed",
  failed:                  "Payment failed",
  cancelled:               "Cancelled",
  refunded:                "Refunded",
  partially_refunded:      "Partially refunded",
  disputed:                "Under dispute",
  transferred:             "Funds allocated",
  paid:                    "Paid to bank",
  in_transit:              "In transit",
  open:                    "Open",
  resolved:                "Resolved",
  ignored_with_reason:     "Ignored",
  dead_letter:             "Failed — needs review",
};

function friendly(status: string) {
  return FRIENDLY_STATUS[status] ?? status.replace(/_/g, " ");
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    open: "bg-amber-100 text-amber-800",
    investigating: "bg-blue-100 text-blue-800",
    action_required: "bg-red-100 text-red-800",
    resolved: "bg-green-100 text-green-800",
    ignored_with_reason: "bg-zinc-100 text-zinc-500",
    succeeded: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    pending: "bg-amber-100 text-amber-700",
    dead_letter: "bg-red-200 text-red-900",
    in_transit: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
    transferred: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colours[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {friendly(status)}
    </span>
  );
}

function MetricCard({
  label, value, sub, accent, warn, onClick, icon,
}: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean; onClick?: () => void; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1 p-4 rounded-2xl border transition-shadow text-left w-full ${
        accent ? "border-red-200 bg-red-50 dark:bg-red-950/20" :
        warn ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20" :
        "border-border bg-card"
      } hover:shadow-md`}
    >
      <div className="flex items-center gap-1.5">
        {icon && <span className={`${accent ? "text-red-500" : warn ? "text-amber-500" : "text-muted-foreground"}`}>{icon}</span>}
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <span className={`text-2xl font-bold tabular-nums ${accent ? "text-red-600" : warn ? "text-amber-700" : ""}`}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </button>
  );
}

type Tab = "overview" | "payments" | "exceptions" | "payouts" | "refunds" | "connected" | "timeline";

export default function FounderFinance() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("today");
  const [tab, setTab] = useState<Tab>("overview");
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [selectedPaymentForTimeline, setSelectedPaymentForTimeline] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["finance-overview", user?.id, period],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/overview?userId=${user?.id}&period=${period}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const manualAccountsQuery = useQuery({
    queryKey: ["finance-manual-accounts", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/manual-accounts?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 120_000,
  });

  const migrationStatusQuery = useQuery({
    queryKey: ["finance-migration-status", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/migration-status?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 120_000,
  });

  const paymentsQuery = useQuery({
    queryKey: ["finance-payments", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/payments?userId=${user?.id}&limit=50`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id && tab === "payments",
    staleTime: 60_000,
  });

  const exceptionsQuery = useQuery({
    queryKey: ["finance-exceptions", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/exceptions?userId=${user?.id}&status=open`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id && tab === "exceptions",
    staleTime: 60_000,
  });

  const payoutsQuery = useQuery({
    queryKey: ["finance-payouts", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/payouts?userId=${user?.id}&limit=50`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id && tab === "payouts",
    staleTime: 60_000,
  });

  const refundsQuery = useQuery({
    queryKey: ["finance-refunds", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/refunds?userId=${user?.id}&limit=50`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id && tab === "refunds",
    staleTime: 60_000,
  });

  const connectedQuery = useQuery({
    queryKey: ["finance-connected", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/founder/finance/connected-accounts?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id && tab === "connected",
    staleTime: 60_000,
  });

  // FR-05: Payment timeline for a specific payment
  const timelineQuery = useQuery({
    queryKey: ["finance-payment-timeline", selectedPaymentForTimeline],
    queryFn: async () => {
      if (!selectedPaymentForTimeline) return null;
      const res = await fetch(`/api/founder/finance/payments/${selectedPaymentForTimeline}/timeline?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedPaymentForTimeline && tab === "timeline",
    staleTime: 30_000,
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/finance/run-exception-scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user?.id }),
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-exceptions"] }),
  });

  const payoutMigrationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/finance/payout-migration", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user?.id }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-manual-accounts"] });
      qc.invalidateQueries({ queryKey: ["finance-migration-status"] });
    },
  });

  const repairAccountMutation = useMutation({
    mutationFn: async (stripeAccountId: string) => {
      const res = await fetch("/api/founder/finance/payout-migration", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user?.id, stripeAccountId }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-manual-accounts"] });
      qc.invalidateQueries({ queryKey: ["finance-connected"] });
    },
  });

  const resolveException = useMutation({
    mutationFn: async ({ publicId, status, note }: { publicId: string; status: string; note?: string }) => {
      const res = await fetch(`/api/founder/finance/exceptions/${publicId}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user?.id, status, resolutionNote: note }),
      });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-exceptions"] }),
  });

  const ov = overviewQuery.data;
  const manualAccts = manualAccountsQuery.data;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "payments", label: "Payments" },
    { key: "timeline", label: "Payment Timeline" },
    { key: "exceptions", label: `Exceptions${ov?.openExceptions ? ` (${ov.openExceptions})` : ""}` },
    { key: "payouts", label: "Payouts" },
    { key: "refunds", label: "Refunds" },
    { key: "connected", label: "Connected Accounts" },
  ];

  return (
    <AdminLayout>
      <DashboardHeader
        title="Finance & Operations"
        description="Payments, transfers, payouts, refunds, reconciliation and exceptions."
      />

      {/* FR-09: Manual payout account alert banner */}
      {manualAccts?.hasManual && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 mb-6">
          <ShieldAlert size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">
              {manualAccts.manualCount} connected account{manualAccts.manualCount !== 1 ? "s" : ""} using Manual payouts
            </p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
              These accounts will not receive automatic payouts. Freelancers must manually request each payout from their Stripe dashboard.
              Run the migration to fix this.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {manualAccts.accounts.map((a: any) => (
                <span key={a.stripeAccountId} className="text-[10px] bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-mono">
                  {a.email ?? a.stripeAccountId}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => payoutMigrationMutation.mutate()}
            disabled={payoutMigrationMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white shrink-0"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
          >
            {payoutMigrationMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Wrench size={11} />}
            Repair
          </button>
        </div>
      )}

      {/* Period selector */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(["today", "7d", "30d"] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              period === p
                ? "bg-[#FF5A1F] text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground hover:bg-zinc-200"
            }`}
          >
            {p === "today" ? "Today" : p === "7d" ? "7 days" : "30 days"}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-muted-foreground hover:bg-zinc-200 transition-colors"
          >
            {scanMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            Run scan
          </button>
          <a
            href={`/api/founder/finance/reports/export?userId=${user?.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-muted-foreground hover:bg-zinc-200 transition-colors"
          >
            <Download size={12} /> Export CSV
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
              tab === t.key
                ? "border-[#FF5A1F] text-[#FF5A1F]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {overviewQuery.isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-400" /></div>
          ) : ov ? (
            <>
              {/* Operational health banner */}
              {(ov.openExceptions > 0 || ov.failedWebhookJobs > 0) ? (
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200">
                  <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                      {ov.openExceptions + ov.failedWebhookJobs} items need attention
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      {ov.openExceptions > 0 && `${ov.openExceptions} open reconciliation exception${ov.openExceptions !== 1 ? "s" : ""}. `}
                      {ov.failedWebhookJobs > 0 && `${ov.failedWebhookJobs} background job${ov.failedWebhookJobs !== 1 ? "s" : ""} need review.`}
                    </p>
                    <button onClick={() => setTab("exceptions")} className="text-xs text-amber-700 font-semibold underline mt-1">View exceptions →</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-green-50 dark:bg-green-950/20 border border-green-200">
                  <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-green-900 dark:text-green-200">Everything reconciled</p>
                    <p className="text-xs text-green-700 dark:text-green-300">No payment differences found in the latest check.</p>
                  </div>
                </div>
              )}

              {/* FR-06: Full metrics grid */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Marketplace Volume</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <MetricCard label="Gross volume" value={fmtGBP(ov.grossVolumePence)} icon={<TrendingUp size={12} />} onClick={() => setTab("payments")} />
                  <MetricCard label="Viewrr commission (11%)" value={fmtGBP(ov.grossCommissionPence)} icon={<BarChart3 size={12} />} />
                  <MetricCard label="Stripe fees" value={fmtGBP(ov.stripeFeesPence)} icon={<CreditCard size={12} />} />
                  <MetricCard label="Net revenue" value={fmtGBP(ov.netRevenuePence)} icon={<Banknote size={12} />} />
                  <MetricCard label="Freelancer earnings" value={fmtGBP(ov.freelancerEarningsPence)} />
                  <MetricCard label="Total payments" value={String(ov.totalPayments)} onClick={() => setTab("payments")} />
                  <MetricCard label="Refunds issued" value={fmtGBP(ov.refundsTotalPence)} onClick={() => setTab("refunds")} />
                  <MetricCard label="Disputes" value={String(ov.disputeCount ?? 0)} accent={(ov.disputeCount ?? 0) > 0} />
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Payout Health</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <MetricCard label="Connected accounts" value={String(ov.connectedAccountCount ?? 0)} icon={<Users size={12} />} onClick={() => setTab("connected")} />
                  <MetricCard label="Automatic payouts" value={String(ov.automaticPayoutCount ?? 0)} icon={<ArrowDownToLine size={12} />} />
                  <MetricCard
                    label="Manual accounts"
                    value={String(ov.manualPayoutCount ?? 0)}
                    warn={(ov.manualPayoutCount ?? 0) > 0}
                    icon={<AlertCircle size={12} />}
                    onClick={() => setTab("connected")}
                  />
                  <MetricCard
                    label="Pending transfers"
                    value={fmtGBP(ov.pendingTransfersPence)}
                    accent={ov.pendingTransfersPence > 0}
                    sub={ov.pendingTransfersPence > 0 ? "Action needed" : undefined}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">System Health</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <MetricCard label="Failed payments" value={String(ov.failedPaymentCount)} accent={ov.failedPaymentCount > 0} />
                  <MetricCard label="Open exceptions" value={String(ov.openExceptions)} accent={ov.openExceptions > 0} onClick={() => setTab("exceptions")} />
                  <MetricCard label="Webhook failures" value={String(ov.webhookFailureCount ?? ov.failedWebhookJobs)} accent={(ov.webhookFailureCount ?? ov.failedWebhookJobs) > 0} />
                  <MetricCard label="Failed jobs" value={String(ov.failedWebhookJobs)} accent={ov.failedWebhookJobs > 0} />
                </div>
              </div>

              {/* Payout migration panel */}
              <div className="p-4 rounded-2xl border border-border bg-card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold mb-1">Automatic daily payouts</p>
                    <p className="text-xs text-muted-foreground mb-1">
                      Configure all eligible connected accounts to receive automatic daily payouts through Stripe.
                    </p>
                    {migrationStatusQuery.data && (
                      <p className="text-xs text-muted-foreground">
                        Status: <span className="font-semibold text-foreground">{migrationStatusQuery.data.daily}</span> daily,{" "}
                        <span className={`font-semibold ${migrationStatusQuery.data.manual > 0 ? "text-amber-600" : "text-foreground"}`}>
                          {migrationStatusQuery.data.manual}
                        </span> manual,{" "}
                        <span className="font-semibold text-foreground">{migrationStatusQuery.data.unknown}</span> unknown
                        {" "}of {migrationStatusQuery.data.total} total
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => payoutMigrationMutation.mutate()}
                    disabled={payoutMigrationMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold text-white transition-colors shrink-0"
                    style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                  >
                    {payoutMigrationMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Run migration
                  </button>
                </div>
                {payoutMigrationMutation.data && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Updated {payoutMigrationMutation.data.updated} accounts,{" "}
                    {payoutMigrationMutation.data.alreadyDaily} already daily,{" "}
                    {payoutMigrationMutation.data.requiresReview} require review.
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── Payments Tab ── */}
      {tab === "payments" && (
        <div>
          {paymentsQuery.isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-400" /></div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-zinc-50 dark:bg-zinc-900">
                    {["Date","Payment ID","Project","Client","Freelancer","Gross","Viewrr Fee","Freelancer","Status","Timeline"].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(paymentsQuery.data?.payments ?? []).map((p: any) => (
                    <>
                      <tr
                        key={p.public_id}
                        className="border-b border-border hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer"
                        onClick={() => setExpandedPayment(expandedPayment === p.public_id ? null : p.public_id)}
                      >
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{p.created_at?.slice(0, 10)}</td>
                        <td className="px-3 py-2 font-mono text-[10px]">{p.public_id}</td>
                        <td className="px-3 py-2 max-w-[120px] truncate">{p.project_title ?? "—"}</td>
                        <td className="px-3 py-2 max-w-[120px] truncate">{p.client_email ?? "—"}</td>
                        <td className="px-3 py-2 max-w-[120px] truncate">{p.freelancer_email ?? "—"}</td>
                        <td className="px-3 py-2 font-semibold tabular-nums">{fmtGBP(p.gross_pence)}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtGBP(p.platform_fee_pence)}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtGBP(p.freelancer_pence)}</td>
                        <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                        <td className="px-3 py-2">
                          <button
                            onClick={e => { e.stopPropagation(); setSelectedPaymentForTimeline(p.public_id); setTab("timeline"); }}
                            className="flex items-center gap-1 text-[10px] text-[#FF5A1F] hover:underline"
                          >
                            <Clock size={10} /> View
                          </button>
                        </td>
                      </tr>
                      {expandedPayment === p.public_id && (
                        <tr key={`${p.public_id}-detail`} className="bg-zinc-50 dark:bg-zinc-900">
                          <td colSpan={10} className="px-4 py-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                              <div><span className="text-muted-foreground block">Stripe fee</span>{p.stripe_fee_pence != null ? fmtGBP(p.stripe_fee_pence) : "—"}</div>
                              <div><span className="text-muted-foreground block">Net revenue</span>{p.net_platform_revenue_pence != null ? fmtGBP(p.net_platform_revenue_pence) : "—"}</div>
                              <div><span className="text-muted-foreground block">Transfer strategy</span>{p.transfer_strategy}</div>
                              <div><span className="text-muted-foreground block">Transfers</span>{p.transfer_count}</div>
                              <div><span className="text-muted-foreground block">Refunds</span>{p.refund_count}</div>
                              <div className="col-span-2"><span className="text-muted-foreground block">Stripe PI</span><span className="font-mono text-[10px] break-all">{p.stripe_payment_intent_id ?? "—"}</span></div>
                              {p.stripe_charge_id && (
                                <div className="col-span-2"><span className="text-muted-foreground block">Stripe Charge</span><span className="font-mono text-[10px] break-all">{p.stripe_charge_id}</span></div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {!paymentsQuery.data?.payments?.length && (
                <p className="text-center text-xs text-muted-foreground py-12">No payments yet.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── FR-05: Payment Timeline Tab ── */}
      {tab === "timeline" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Enter payment ID (pay_vrr_…)"
              value={selectedPaymentForTimeline ?? ""}
              onChange={e => setSelectedPaymentForTimeline(e.target.value)}
              className="flex-1 px-4 py-2 text-xs border border-border rounded-xl bg-background"
            />
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ["finance-payment-timeline"] })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-muted-foreground"
            >
              <RefreshCw size={11} /> Load
            </button>
          </div>

          {!selectedPaymentForTimeline && (
            <p className="text-center text-xs text-muted-foreground py-12">
              Enter a payment ID above, or click "View" on any payment in the Payments tab.
            </p>
          )}

          {timelineQuery.isLoading && (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-400" /></div>
          )}

          {timelineQuery.data && (() => {
            const tl = timelineQuery.data;
            return (
              <div className="space-y-4">
                {/* Payment summary */}
                <div className="p-4 rounded-2xl border border-border bg-card grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div><span className="text-muted-foreground block mb-0.5">Amount</span><span className="font-bold text-base">{fmtGBP(tl.payment?.gross_pence ?? 0)}</span></div>
                  <div><span className="text-muted-foreground block mb-0.5">Viewrr fee</span><span className="font-semibold">{fmtGBP(tl.payment?.platform_fee_pence ?? 0)}</span></div>
                  <div><span className="text-muted-foreground block mb-0.5">Freelancer</span><span className="font-semibold">{fmtGBP(tl.payment?.freelancer_pence ?? 0)}</span></div>
                  <div><span className="text-muted-foreground block mb-0.5">Status</span><StatusBadge status={tl.payment?.status ?? "—"} /></div>
                  <div className="col-span-2"><span className="text-muted-foreground block mb-0.5">Stripe PaymentIntent</span><span className="font-mono text-[10px]">{tl.payment?.stripe_payment_intent_id ?? "—"}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground block mb-0.5">Stripe Charge</span><span className="font-mono text-[10px]">{tl.payment?.stripe_charge_id ?? "—"}</span></div>
                  {tl.payment?.stripe_application_fee_id && (
                    <div className="col-span-2"><span className="text-muted-foreground block mb-0.5">Application Fee</span><span className="font-mono text-[10px]">{tl.payment.stripe_application_fee_id}</span></div>
                  )}
                </div>

                {/* Timeline events */}
                <div className="space-y-0">
                  {(tl.events ?? []).map((ev: any, i: number) => (
                    <div key={ev.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${
                          ev.event_type?.includes("confirmed") || ev.event_type?.includes("succeeded") || ev.event_type?.includes("paid")
                            ? "bg-green-500"
                            : ev.event_type?.includes("failed")
                            ? "bg-red-500"
                            : "bg-zinc-300"
                        }`} />
                        {i < (tl.events?.length ?? 1) - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                      </div>
                      <div className="pb-4 flex-1">
                        <p className="text-xs font-semibold">{ev.title ?? ev.event_type}</p>
                        {ev.description && <p className="text-xs text-muted-foreground mt-0.5">{ev.description}</p>}
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">{ev.occurred_at?.slice(0, 16).replace("T", " ")}</span>
                          {ev.amount_pence != null && <span className="text-[10px] font-semibold text-foreground">{fmtGBP(ev.amount_pence)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!tl.events || tl.events.length === 0) && (
                    <p className="text-xs text-muted-foreground py-4">No timeline events recorded yet.</p>
                  )}
                </div>

                {/* Transfers */}
                {tl.transfers?.length > 0 && (
                  <div className="p-4 rounded-2xl border border-border bg-card">
                    <p className="text-xs font-semibold mb-2">Stripe Transfers</p>
                    {tl.transfers.map((tr: any) => (
                      <div key={tr.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
                        <span className="font-mono text-[10px]">{tr.stripe_transfer_id}</span>
                        <span>{fmtGBP(tr.amount_pence)}</span>
                        <StatusBadge status={tr.status} />
                        <span className="text-muted-foreground">{tr.created_at?.slice(0, 10)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Exceptions Tab ── */}
      {tab === "exceptions" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">{exceptionsQuery.data?.exceptions?.length ?? 0} open exceptions</p>
            <button
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              className="flex items-center gap-1.5 text-xs text-[#FF5A1F] hover:underline"
            >
              {scanMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Run scan now
            </button>
          </div>

          {exceptionsQuery.isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-400" /></div>
          ) : (exceptionsQuery.data?.exceptions ?? []).length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-2">
              <CheckCircle2 size={32} className="text-green-500" />
              <p className="text-sm font-semibold">No open exceptions</p>
              <p className="text-xs text-muted-foreground">Everything looks good. Run a scan to check for new issues.</p>
            </div>
          ) : (
            (exceptionsQuery.data?.exceptions ?? []).map((exc: any) => (
              <div key={exc.public_id} className="p-4 rounded-2xl border border-border bg-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={exc.status} />
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        exc.severity === "critical" ? "bg-red-100 text-red-800" :
                        exc.severity === "action_required" ? "bg-orange-100 text-orange-800" :
                        "bg-zinc-100 text-zinc-600"
                      }`}>{exc.severity}</span>
                      <span className="text-[10px] text-muted-foreground">{exc.detected_at?.slice(0, 16)}</span>
                    </div>
                    <p className="text-sm font-medium">{exc.summary}</p>
                    {exc.payment_public_id && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">Payment: {exc.payment_public_id}</p>
                    )}
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer">Technical details</summary>
                      <pre className="text-[10px] bg-zinc-100 dark:bg-zinc-800 rounded p-2 mt-1 overflow-auto max-h-24">
                        {JSON.stringify(exc.technical_details, null, 2)}
                      </pre>
                    </details>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => resolveException.mutate({ publicId: exc.public_id, status: "resolved", note: "Resolved via dashboard" })}
                      className="px-3 py-1 rounded-full text-[10px] font-semibold bg-green-100 text-green-800 hover:bg-green-200"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => resolveException.mutate({ publicId: exc.public_id, status: "ignored_with_reason", note: "Ignored via dashboard" })}
                      className="px-3 py-1 rounded-full text-[10px] font-semibold bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    >
                      Ignore
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Payouts Tab ── */}
      {tab === "payouts" && (
        <div>
          {payoutsQuery.isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-400" /></div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-zinc-50 dark:bg-zinc-900">
                    {["Date","Payment","Freelancer","Amount","Stripe Payout ID","Status","Arrival"].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(payoutsQuery.data?.payouts ?? []).map((p: any) => (
                    <tr key={p.id} className="border-b border-border hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <td className="px-3 py-2 text-muted-foreground">{p.created_at?.slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono text-[10px]">{p.payment_public_id ?? "—"}</td>
                      <td className="px-3 py-2">{p.freelancer_email ?? "—"}</td>
                      <td className="px-3 py-2 font-semibold">{fmtGBP(p.amount_pence ?? 0)}</td>
                      <td className="px-3 py-2 font-mono text-[10px]">{p.stripe_payout_id ?? "—"}</td>
                      <td className="px-3 py-2"><StatusBadge status={p.status ?? "unknown"} /></td>
                      <td className="px-3 py-2 text-muted-foreground">{p.arrival_date ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!payoutsQuery.data?.payouts?.length && (
                <p className="text-center text-xs text-muted-foreground py-12">No payouts recorded yet.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Refunds Tab ── */}
      {tab === "refunds" && (
        <div>
          {refundsQuery.isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-400" /></div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-zinc-50 dark:bg-zinc-900">
                    {["Date","Payment","Client","Freelancer","Amount","Reason","Status"].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(refundsQuery.data?.refunds ?? []).map((r: any) => (
                    <tr key={r.id} className="border-b border-border hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <td className="px-3 py-2 text-muted-foreground">{r.created_at?.slice(0, 10)}</td>
                      <td className="px-3 py-2 font-mono text-[10px]">{r.payment_public_id ?? "—"}</td>
                      <td className="px-3 py-2">{r.client_email ?? "—"}</td>
                      <td className="px-3 py-2">{r.freelancer_email ?? "—"}</td>
                      <td className="px-3 py-2 font-semibold">{fmtGBP(r.amount_pence ?? 0)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.reason_code?.replace(/_/g, " ") ?? "—"}</td>
                      <td className="px-3 py-2"><StatusBadge status={r.status ?? "unknown"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!refundsQuery.data?.refunds?.length && (
                <p className="text-center text-xs text-muted-foreground py-12">No refunds recorded yet.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Connected Accounts Tab ── */}
      {tab === "connected" && (
        <div className="space-y-3">
          {connectedQuery.isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-zinc-400" /></div>
          ) : (connectedQuery.data?.accounts ?? []).length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-12">No connected Stripe accounts yet.</p>
          ) : (
            (connectedQuery.data?.accounts ?? []).map((acct: any) => {
              const schedule = (() => { try { return JSON.parse(acct.payout_schedule ?? "{}"); } catch { return null; } })();
              const isManual = !schedule?.interval || schedule.interval !== "daily";
              return (
                <div key={acct.id} className={`p-4 rounded-2xl border bg-card ${isManual && acct.payouts_enabled ? "border-amber-200" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{acct.email ?? `User #${acct.user_id}`}</p>
                        {isManual && acct.payouts_enabled && (
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-semibold">Manual payouts</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{acct.stripe_account_id}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <StatusBadge status={acct.readiness_state ?? "unknown"} />
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${acct.charges_enabled ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {acct.charges_enabled ? "Charges enabled" : "Charges disabled"}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${acct.payouts_enabled ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                          {acct.payouts_enabled ? "Payouts enabled" : "Payouts disabled"}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${!isManual ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                          {!isManual ? "Daily payouts" : "Manual schedule"}
                        </span>
                      </div>
                      {acct.disabled_reason && (
                        <p className="text-xs text-red-600 mt-1">Disabled: {acct.disabled_reason}</p>
                      )}
                      {acct.last_synced_at && (
                        <p className="text-[10px] text-muted-foreground mt-1">Last synced: {acct.last_synced_at?.slice(0, 16)}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 items-end shrink-0">
                      <a
                        href={`https://dashboard.stripe.com/connect/accounts/${acct.stripe_account_id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[#FF5A1F] hover:underline"
                      >
                        <ExternalLink size={11} /> Stripe
                      </a>
                      {/* FR-09: Repair configuration button for manual accounts */}
                      {isManual && acct.payouts_enabled && (
                        <button
                          onClick={() => repairAccountMutation.mutate(acct.stripe_account_id)}
                          disabled={repairAccountMutation.isPending}
                          className="flex items-center gap-1 text-xs text-amber-700 hover:underline"
                        >
                          {repairAccountMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <Wrench size={10} />}
                          Repair
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </AdminLayout>
  );
}
