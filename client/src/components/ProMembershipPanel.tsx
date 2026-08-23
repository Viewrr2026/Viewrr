/**
 * PRD-013 FR-14/FR-15/FR-16 — Pro Membership Management Panel
 * Shown in the freelancer profile dropdown / settings area.
 * Displays status, billing info, cancellation, payment failure recovery.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown, Percent, Calendar, CreditCard, AlertCircle, Check,
  Loader2, ExternalLink, X, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProEntitlement {
  membershipType: "founding_pro" | "paid" | null;
  status: string | null;
  entitlementActive: boolean;
  commissionRatePct: number;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  foundingMember: boolean;
  foundingProSpacesRemaining: number;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function ProMembershipPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const { data: pro, isLoading } = useQuery<ProEntitlement>({
    queryKey: ["/api/pro/status", user?.id],
    queryFn: () =>
      user ? apiRequest("GET", `/api/pro/status/${user.id}`).then(r => r.json()) : Promise.resolve(null),
    enabled: !!user,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pro/cancel", { userId: user?.id });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to cancel.");
      return body;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/pro/status", user?.id] });
      setShowCancelConfirm(false);
      toast({ title: data.message || "Cancellation scheduled." });
    },
    onError: (e: any) => {
      toast({ title: e.message, variant: "destructive" });
    },
  });

  const billingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", `/api/pro/manage-billing/${user?.id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to open billing.");
      return body;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (e: any) => {
      toast({ title: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-4">
        <Loader2 size={14} className="animate-spin" /> Loading membership…
      </div>
    );
  }

  if (!pro?.entitlementActive && pro?.status !== "payment_failed") {
    // Not a Pro member — show upgrade nudge
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg,#FF5A1F18,#FFA50018)" }}>
            <Crown size={16} style={{ color: "#FF5A1F" }} />
          </div>
          <div>
            <p className="text-sm font-semibold">Pro Viewrr</p>
            <p className="text-xs text-muted-foreground">Not subscribed</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Upgrade to Pro and pay just 8% Viewrr commission instead of 11%.
        </p>
        <Button size="sm" className="w-full rounded-xl text-white text-xs"
          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
          onClick={() => { window.location.hash = "/pro"; }}>
          <Crown size={12} className="mr-1.5" />View Pro Viewrr
        </Button>
      </div>
    );
  }

  const isFounder = pro.membershipType === "founding_pro";
  const isCancelScheduled = pro.status === "cancellation_scheduled";
  const isPaymentFailed = pro.status === "payment_failed";

  return (
    <div className="rounded-2xl border bg-card overflow-hidden"
      style={isFounder ? { borderColor: "#FF5A1F55" } : {}}>

      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3"
        style={{ background: isFounder ? "linear-gradient(135deg,#FF5A1F08,#FFA50008)" : undefined }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}>
          <Crown size={16} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">
            {isFounder ? "Founding Pro" : "Pro Viewrr"}
            {isFounder && (
              <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                style={{ background: "#FF5A1F" }}>FOUNDER</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {isFounder ? "£0/month — Complimentary membership" : "£49.99/month"}
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
          style={isPaymentFailed
            ? { background: "rgba(239,68,68,0.1)", color: "#dc2626" }
            : { background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>
          {isPaymentFailed ? <AlertCircle size={11} /> : <Check size={11} />}
          {isPaymentFailed ? "Payment failed" : isCancelScheduled ? "Cancelling" : "Active"}
        </div>
      </div>

      {/* Payment failed banner */}
      {isPaymentFailed && (
        <div className="mx-4 mt-3 rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">There's a problem with your Pro Viewrr payment</p>
            <p className="text-xs text-muted-foreground mt-0.5">Update your payment method to keep your Pro benefits active.</p>
          </div>
        </div>
      )}

      {/* Cancellation scheduled banner */}
      {isCancelScheduled && (
        <div className="mx-4 mt-3 rounded-xl px-4 py-3"
          style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.2)" }}>
          <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Cancellation scheduled</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your Pro benefits remain active until {fmtDate(pro.currentPeriodEnd)}.
          </p>
        </div>
      )}

      {/* Details */}
      <div className="px-5 py-4 space-y-2.5">
        <Row icon={<Percent size={13} />} label="Commission rate" value={`${pro.commissionRatePct}%`} highlight />
        {!isFounder && pro.currentPeriodEnd && !isCancelScheduled && (
          <Row icon={<Calendar size={13} />} label="Next billing" value={fmtDate(pro.currentPeriodEnd)} />
        )}
        {isCancelScheduled && (
          <Row icon={<Calendar size={13} />} label="Active until" value={fmtDate(pro.currentPeriodEnd)} />
        )}
        {isFounder && (
          <Row icon={<Crown size={13} />} label="Membership" value="Founding Pro — complimentary" />
        )}
      </div>

      {/* Actions */}
      {!isFounder && (
        <div className="px-5 pb-5 space-y-2">
          {(isPaymentFailed || pro.membershipType === "paid") && (
            <Button
              size="sm"
              variant="outline"
              className="w-full rounded-xl text-xs"
              onClick={() => billingMutation.mutate()}
              disabled={billingMutation.isPending}
            >
              {billingMutation.isPending
                ? <Loader2 size={12} className="mr-1.5 animate-spin" />
                : <CreditCard size={12} className="mr-1.5" />}
              {isPaymentFailed ? "Update Payment Method" : "Manage Billing"}
              <ExternalLink size={11} className="ml-auto opacity-50" />
            </Button>
          )}

          {pro.entitlementActive && !isCancelScheduled && !isPaymentFailed && (
            <>
              {showCancelConfirm ? (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-xs text-center text-muted-foreground">
                    Your Pro benefits stay active until the end of the current billing period.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" className="flex-1 rounded-lg text-xs"
                      onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                      {cancelMutation.isPending ? <Loader2 size={11} className="animate-spin mr-1" /> : null}
                      Confirm cancel
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 rounded-lg text-xs"
                      onClick={() => setShowCancelConfirm(false)}>
                      Keep Pro
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors text-center py-1"
                  onClick={() => setShowCancelConfirm(true)}>
                  Cancel membership
                </button>
              )}
            </>
          )}
        </div>
      )}

      {isFounder && (
        <div className="px-5 pb-5">
          <p className="text-xs text-muted-foreground text-center">
            Your Founding Pro membership is complimentary and does not auto-renew at a paid rate.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, value, highlight = false }: {
  icon: React.ReactNode; label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="text-muted-foreground shrink-0">{icon}</div>
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <span className={`text-xs font-semibold ${highlight ? "" : ""}`}
        style={highlight ? { color: "#FF5A1F" } : {}}>{value}</span>
    </div>
  );
}
