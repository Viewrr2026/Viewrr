/**
 * PRD-013 FR-18/19 — Founder Pro Viewrr Dashboard
 * Subscription analytics, member table, economics monitoring.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Crown, Users, TrendingUp, AlertCircle, CheckCircle2,
  XCircle, RefreshCw, BarChart3, Percent, Loader2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

function fmtGBP(pence: number) {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

interface ProStats {
  activePaidMembers: number;
  foundingProMembers: number;
  foundingProMax: number;
  monthlyRecurringRevenuePence: number;
  newMembersThisMonth: number;
  cancellationsThisMonth: number;
  failedRenewals: number;
  foundingProList: any[];
  paidMemberList: any[];
}

export default function FounderProSubscriptions() {
  const { data: stats, isLoading, refetch } = useQuery<ProStats>({
    queryKey: ["/api/founder/pro-dashboard"],
    queryFn: () => apiRequest("GET", "/api/founder/pro-dashboard").then(r => r.json()),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = stats!;
  const totalMembers = s.activePaidMembers + s.foundingProMembers;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Crown size={20} style={{ color: "#FF5A1F" }} />
            Pro Viewrr Subscriptions
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Subscription analytics and member management</p>
        </div>
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => refetch()}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Active Paid Members"
          value={String(s.activePaidMembers)}
          icon={<Users size={16} style={{ color: "#FF5A1F" }} />}
          color="#FF5A1F"
        />
        <KpiCard
          label={`Founding Pro (${s.foundingProMembers}/${s.foundingProMax})`}
          value={`${s.foundingProMembers} / ${s.foundingProMax}`}
          icon={<Crown size={16} style={{ color: "#FF5A1F" }} />}
          color="#FF5A1F"
        />
        <KpiCard
          label="Monthly Recurring Revenue"
          value={fmtGBP(s.monthlyRecurringRevenuePence)}
          icon={<TrendingUp size={16} className="text-green-600" />}
          color="#16a34a"
        />
        <KpiCard
          label="New This Month"
          value={String(s.newMembersThisMonth)}
          icon={<BarChart3 size={16} className="text-blue-600" />}
          color="#2563eb"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Cancellations This Month" value={String(s.cancellationsThisMonth)} icon={<XCircle size={15} className="text-muted-foreground" />} color="#6b7280" />
        <KpiCard label="Failed Renewals" value={String(s.failedRenewals)} icon={<AlertCircle size={15} className="text-red-500" />} color="#ef4444" />
        <KpiCard label="Total Pro Members" value={String(totalMembers)} icon={<CheckCircle2 size={15} className="text-green-600" />} color="#16a34a" />
      </div>

      {/* ── Founding Pro allocations ── */}
      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"
          style={{ background: "linear-gradient(135deg,#FF5A1F06,transparent)" }}>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Crown size={14} style={{ color: "#FF5A1F" }} />
            Founding Pro Allocations ({s.foundingProMembers}/{s.foundingProMax})
          </h3>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: s.foundingProMax }).map((_, i) => (
              <div key={i} className="w-2 h-2 rounded-full"
                style={{ background: i < s.foundingProMembers ? "#FF5A1F" : "#e5e7eb" }} />
            ))}
          </div>
        </div>
        {s.foundingProList.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No Founding Pro allocations yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">#</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Creative</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Allocated</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {s.foundingProList.map((f: any, i) => (
                <tr key={i} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-bold" style={{ color: "#FF5A1F" }}>#{f.allocation_number}</td>
                  <td className="px-4 py-2.5 font-medium">{f.name || "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{f.email}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(f.allocated_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full font-semibold text-[10px]"
                      style={f.active ? { background: "rgba(34,197,94,0.1)", color: "#16a34a" } : { background: "rgba(107,114,128,0.1)", color: "#6b7280" }}>
                      {f.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Paid members table ── */}
      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Users size={14} style={{ color: "#FF5A1F" }} /> Paid Members
          </h3>
        </div>
        {s.paidMemberList.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No paid subscribers yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Creative</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Commission</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Next Billing</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Since</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Stripe Sub ID</th>
                </tr>
              </thead>
              <tbody>
                {s.paidMemberList.map((m: any, i) => (
                  <tr key={i} className="border-t border-border hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{m.name || "—"}</p>
                      <p className="text-muted-foreground">{m.email}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={m.status} />
                    </td>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: "#FF5A1F" }}>8%</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(m.current_period_end)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(m.created_at)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground text-[10px]">
                      {m.stripe_subscription_id || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FR-28 reminder */}
      <div className="rounded-xl px-4 py-3 text-xs text-muted-foreground"
        style={{ background: "rgba(107,114,128,0.06)", border: "1px solid rgba(107,114,128,0.15)" }}>
        <strong>Note:</strong> Pro is a commercial membership. Accreditation and trust verification are separate and cannot be purchased. Pro subscription revenue is separate from marketplace project payments.
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        {icon}
      </div>
      <p className="text-xl font-black" style={{ color }}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: "rgba(34,197,94,0.1)", color: "#16a34a", label: "Active" },
    cancellation_scheduled: { bg: "rgba(234,179,8,0.1)", color: "#ca8a04", label: "Cancelling" },
    payment_failed: { bg: "rgba(239,68,68,0.1)", color: "#dc2626", label: "Payment Failed" },
    past_due: { bg: "rgba(239,68,68,0.1)", color: "#dc2626", label: "Past Due" },
    cancelled: { bg: "rgba(107,114,128,0.1)", color: "#6b7280", label: "Cancelled" },
    expired: { bg: "rgba(107,114,128,0.1)", color: "#6b7280", label: "Expired" },
    checkout_pending: { bg: "rgba(59,130,246,0.1)", color: "#2563eb", label: "Pending" },
  };
  const s = map[status] ?? { bg: "rgba(107,114,128,0.1)", color: "#6b7280", label: status };
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: s.bg, color: s.color }}>{s.label}</span>
  );
}
