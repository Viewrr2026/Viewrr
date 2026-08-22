import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { PaymentJourneyBar } from "@/components/PaymentJourney";
import {
  CheckCircle2, AlertCircle, Banknote, DollarSign, TrendingUp,
  ArrowDownToLine, ChevronDown, ChevronUp, Info, Loader2 as LoaderIcon,
} from "lucide-react";

// ── Payouts Panel ─────────────────────────────────────────────────────────────
function PayoutsPanel({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const [popupOpen, setPopupOpen]         = useState(false);
  const [popupDone, setPopupDone]         = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsRead, setTermsRead]         = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  const popupRef  = useRef<Window | null>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: status, isLoading, refetch } = useQuery<{
    connected: boolean;
    stripeAccountId?: string;
    onboarded?: boolean;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    identityVerified?: boolean;
    automaticPayoutsEnabled?: boolean;
    viewrrTermsAccepted?: boolean;
    viewrrTermsAcceptedAt?: string | null;
    transfersReady?: boolean;
    pendingPence?: number;
    readinessState?: string;
    disabledReason?: string | null;
    pendingRequirements?: string[];
  }>({
    queryKey: ["/api/stripe/status", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/status/${userId}`);
      if (!res.ok) return { connected: false, onboarded: false, pendingPence: 0 };
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (popupRef.current?.closed) {
        clearInterval(pollRef.current!);
        setPopupOpen(false);
        await refetch();
        return;
      }
      try {
        const res = await apiRequest("GET", `/api/stripe/status/${userId}`);
        if (res.ok) {
          const data = await res.json();
          queryClient.setQueryData(["/api/stripe/status", userId], data);
          if (data.chargesEnabled || data.identityVerified) {
            clearInterval(pollRef.current!);
            popupRef.current?.close();
            setPopupOpen(false);
            setPopupDone(true);
          }
        }
      } catch {}
    }, 2500);
  }, [userId, refetch]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleAcceptTerms = async () => {
    setAcceptingTerms(true);
    try {
      const res = await apiRequest("POST", "/api/stripe/accept-terms", { userId });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error || "Could not save terms acceptance");
      }
      setShowTermsModal(false);
      await refetch();
      connectMutation.mutate();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAcceptingTerms(false);
    }
  };

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res1 = await apiRequest("POST", "/api/stripe/connect-account", { userId });
      const data1 = await res1.json().catch(() => ({}));
      if ((data1 as any).code === "VIEWRR_PAYMENT_TERMS_REQUIRED") {
        setShowTermsModal(true);
        return "terms_required";
      }
      if (!res1.ok) throw new Error((data1 as any).error || "Could not set up Stripe account");
      if ((data1 as any).alreadyExists && (data1 as any).viewrrTermsAccepted) {
        await refetch();
        return "already_connected";
      }
      const res2 = await apiRequest("POST", "/api/stripe/onboarding-link", { userId });
      if (!res2.ok) {
        const b = await res2.json().catch(() => ({}));
        throw new Error((b as any).error || "Could not generate onboarding link");
      }
      const { url } = await res2.json();
      return url as string;
    },
    onSuccess: (result) => {
      if (result === "terms_required" || result === "already_connected") return;
      const url = result as string;
      const w = 520, h = 720;
      const left = Math.round(window.screenX + (window.outerWidth  - w) / 2);
      const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);
      const popup = window.open(url, "stripe_onboarding", `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
      if (popup) {
        popupRef.current = popup;
        setPopupOpen(true);
        setPopupDone(false);
        startPolling();
      } else {
        window.location.href = url;
      }
    },
  });

  const pendingGBP   = ((status?.pendingPence ?? 0) / 100).toFixed(2);
  const isFullyActive = status?.connected && (status?.chargesEnabled || status?.identityVerified) && status?.viewrrTermsAccepted;
  const needsTermsOnly = status?.connected && !status?.viewrrTermsAccepted;

  const statusItems = status?.connected ? [
    { label: "Connected",            ok: !!status.connected },
    { label: "Identity Verified",    ok: !!(status.identityVerified || (status as any).detailsSubmitted) },
    { label: "Transfers Enabled",    ok: !!(status.transfersReady  || status.chargesEnabled) },
    { label: "Automatic Payouts",    ok: !!(status.automaticPayoutsEnabled || status.payoutsEnabled) },
    { label: "Viewrr Terms Accepted", ok: !!status.viewrrTermsAccepted },
  ] : null;

  return (
    <>
      {/* Terms modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}>
          <div className="relative w-full max-w-md mx-4 rounded-2xl border border-border bg-card p-6 flex flex-col gap-4" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,90,31,0.1)" }}>
                <Banknote size={18} style={{ color: "#FF5A1F" }} />
              </div>
              <div>
                <p className="text-sm font-semibold">Accept Viewrr Payment Terms</p>
                <p className="text-xs text-muted-foreground">Your Stripe account is already connected</p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-secondary/40 px-4 py-3 space-y-2 text-xs text-muted-foreground leading-relaxed max-h-56 overflow-y-auto">
              <p className="font-semibold text-foreground">Viewrr Payments & Stripe Connect Disclosure</p>
              <p>By accepting, you confirm:</p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>Viewrr collects an 11% platform fee on each payment.</li>
                <li>Payments are processed by Stripe on behalf of Viewrr.</li>
                <li>Funds are allocated to your Stripe balance after payment confirmation. Arrival at your bank depends on your Stripe payout schedule.</li>
                <li>Refunds may be initiated by Viewrr if a valid dispute is upheld.</li>
                <li>You authorise Viewrr to use Stripe Connect to facilitate transfers to your connected account.</li>
                <li>You have read and agree to <a href="https://stripe.com/gb/connect-account/legal" target="_blank" rel="noopener noreferrer" className="underline text-foreground">Stripe Connected Account Agreement</a>.</li>
              </ul>
              <p className="text-[10px] text-muted-foreground/70 mt-2">Version 1.0 — effective 1 January 2026</p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={termsRead} onChange={e => setTermsRead(e.target.checked)} className="mt-0.5" />
              <span className="text-xs text-muted-foreground">I have read and agree to the Viewrr payment terms above.</span>
            </label>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 text-white rounded-full text-xs" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} disabled={!termsRead || acceptingTerms} onClick={handleAcceptTerms}>
                {acceptingTerms ? <><LoaderIcon size={12} className="animate-spin mr-1.5" />Saving…</> : "Accept & continue"}
              </Button>
              <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => setShowTermsModal(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Stripe popup overlay */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}>
          <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-border bg-card p-8 flex flex-col items-center text-center" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>
            <div className="relative mb-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,90,31,0.12)" }}>
                <Banknote size={28} style={{ color: "#FF5A1F" }} />
              </div>
              <svg className="absolute inset-0 w-16 h-16" viewBox="0 0 64 64" style={{ animation: "spin 2s linear infinite" }}>
                <circle cx="32" cy="32" r="29" fill="none" stroke="#FF5A1F" strokeWidth="2.5" strokeDasharray="60 120" strokeLinecap="round" />
              </svg>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
            <h3 className="text-base font-semibold mb-1">Verifying your identity</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
              Complete the steps in the Stripe window that just opened.<br />
              This page will update automatically when you're done.
            </p>
            <div className="flex items-center gap-1.5 mb-6">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: "#FF5A1F", animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite`, opacity: 0.3 }} />
              ))}
              <style>{`@keyframes pulse-dot { 0%, 80%, 100% { opacity: 0.3; transform: scale(1); } 40% { opacity: 1; transform: scale(1.4); } }`}</style>
            </div>
            <div className="flex items-center gap-3 w-full">
              <Button variant="outline" size="sm" className="flex-1 rounded-full text-xs" onClick={() => popupRef.current?.focus()}>Bring window to front</Button>
              <Button size="sm" variant="ghost" className="rounded-full text-xs text-muted-foreground" onClick={() => { popupRef.current?.close(); if (pollRef.current) clearInterval(pollRef.current); setPopupOpen(false); }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8 rounded-2xl border border-border bg-card overflow-hidden" data-testid="panel-payouts">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Banknote size={16} className="text-primary" />
            <span className="text-sm font-semibold">Payouts</span>
          </div>
          {isFullyActive && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>
              <CheckCircle2 size={12} /> Active
            </span>
          )}
          {needsTermsOnly && <span className="text-xs font-medium text-amber-600 dark:text-amber-400 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20">Terms needed</span>}
          {status?.connected && !status?.identityVerified && !needsTermsOnly && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20">Verification needed</span>
          )}
        </div>

        <div className="px-5 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderIcon size={14} className="animate-spin" /> Checking payout status…</div>
          ) : (
            <div className="space-y-4">
              {statusItems && (
                <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
                  {statusItems.map(item => (
                    <div key={item.label} className="flex items-center gap-2.5">
                      {item.ok ? <CheckCircle2 size={13} className="text-green-500 shrink-0" /> : <AlertCircle size={13} className="text-amber-500 shrink-0" />}
                      <span className={`text-xs ${item.ok ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {popupDone && !status?.identityVerified && (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-medium" style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 size={14} /> Verification submitted — Stripe is processing your details.
                </div>
              )}
              {needsTermsOnly && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl" style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.2)" }}>
                    <CheckCircle2 size={15} style={{ color: "#FF5A1F" }} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">Your Stripe account is already connected</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">You just need to accept Viewrr's payment terms to start receiving payments. This takes under 30 seconds.</p>
                    </div>
                  </div>
                  <Button size="sm" className="text-white rounded-full gap-2 text-xs w-full" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} onClick={() => setShowTermsModal(true)}>
                    Review & Accept Terms →
                  </Button>
                </div>
              )}
              {isFullyActive && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 text-sm">
                    <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                    <span className="text-muted-foreground">Your bank account is connected. Payments are paid out automatically.</span>
                  </div>
                  {(status?.pendingPence ?? 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-secondary/60 border border-border">
                      <div className="flex items-center gap-2">
                        <DollarSign size={14} className="text-primary" />
                        <span className="text-xs font-semibold">Pending earnings</span>
                      </div>
                      <span className="text-sm font-bold" style={{ color: "#FF5A1F" }}>£{pendingGBP}</span>
                    </div>
                  )}
                </div>
              )}
              {status?.connected && !status?.identityVerified && !needsTermsOnly && !popupDone && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Your Stripe account exists but needs verification to receive payments.
                      {(status?.pendingPence ?? 0) > 0 && <span className="block mt-1 font-medium text-foreground">£{pendingGBP} is held and will be released once verified.</span>}
                    </p>
                  </div>
                  <Button size="sm" className="text-white rounded-full gap-2 text-xs" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                    {connectMutation.isPending ? <><LoaderIcon size={12} className="animate-spin" /> Opening…</> : <>Complete verification →</>}
                  </Button>
                  {connectMutation.isError && <p className="text-xs text-destructive">{(connectMutation.error as any)?.message}</p>}
                </div>
              )}
              {!status?.connected && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">Connect your bank account to receive payments from clients directly. It takes about 2 minutes.</p>
                  <Button size="sm" className="text-white rounded-full gap-2 text-xs" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                    {connectMutation.isPending ? <><LoaderIcon size={12} className="animate-spin" /> Opening…</> : <><Banknote size={12} /> Set up payouts</>}
                  </Button>
                  {connectMutation.isError && <p className="text-xs text-destructive">{(connectMutation.error as any)?.message}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Earnings Panel ────────────────────────────────────────────────────────────
function EarningsPanel({ userId }: { userId: number }) {
  const [educationOpen, setEducationOpen]     = useState(false);
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    lifetimeEarnedPence: number;
    lifetimeVolumePence: number;
    availableBalancePence: number;
    pendingBalancePence: number;
    nextPayout?: { id: string; amount: number; arrivalDate?: string | null } | null;
    payouts: Array<{ id: string; amount: number; status: string; arrivalDate?: string | null; created: string; automatic?: boolean }>;
    recentPayments: Array<any>;
  }>({
    queryKey: ["/api/stripe/earnings", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/earnings/${userId}`);
      if (!res.ok) return { lifetimeEarnedPence: 0, lifetimeVolumePence: 0, availableBalancePence: 0, pendingBalancePence: 0, payouts: [], recentPayments: [] };
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const fmt = (p: number) => `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const friendlyPayout = (s: string) => ({ paid: "Paid to bank", in_transit: "In transit", pending: "Pending", canceled: "Cancelled", failed: "Failed" }[s] ?? s);
  const paymentToJourneyStatus = (p: any) => ({
    paymentStatus: p.status ?? "pending",
    transferStatus: p.transfer_status ?? null,
    payoutStatus: null,
    grossPence: p.gross_pence,
    freelancerPence: p.freelancer_pence,
    platformFeePence: p.platform_fee_pence,
    timestamps: { paid: p.succeeded_at ?? p.created_at, authorised: p.succeeded_at, transferred: p.transferred_at ?? null },
  });

  return (
    <div className="mb-8 rounded-2xl border border-border bg-card overflow-hidden" data-testid="panel-earnings">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" />
          <span className="text-sm font-semibold">Earnings</span>
        </div>
        <a href="/#/help/payments" className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
          <Info size={11} /> Help
        </a>
      </div>

      <div className="px-5 py-4">
        {/* How payments work accordion */}
        <div className="mb-4 rounded-xl border border-border overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/30 transition-colors" onClick={() => setEducationOpen(o => !o)}>
            <span className="text-xs font-semibold">How payments work</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{educationOpen ? "Hide" : "Learn More"}</span>
              {educationOpen ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
            </div>
          </button>
          {educationOpen && (
            <div className="px-4 pb-4 space-y-2 text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
              {[
                "Your client pays securely through Viewrr.",
                "Stripe securely processes the payment.",
                "Stripe may temporarily hold the funds during its availability period — this is normal and protects both parties.",
                "Automatic payouts send the funds to your bank.",
                "You'll receive your earnings automatically — no action needed.",
              ].map((line, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-white text-[9px] font-bold mt-0.5" style={{ background: "#FF5A1F" }}>{i + 1}</span>
                  <span>{line}</span>
                </div>
              ))}
              <div className="pt-1">
                <a href="/#/help/payments" className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#FF5A1F" }}>Learn More →</a>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderIcon size={14} className="animate-spin" /> Loading earnings…</div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Available balance", value: fmt(data?.availableBalancePence ?? 0), highlight: true },
                { label: "Pending balance",   value: fmt(data?.pendingBalancePence   ?? 0) },
                { label: "Lifetime earnings", value: fmt(data?.lifetimeEarnedPence   ?? 0) },
                { label: "Project volume",    value: fmt(data?.lifetimeVolumePence   ?? 0) },
              ].map(card => (
                <div key={card.label} className="flex flex-col gap-0.5 p-3 rounded-xl border border-border bg-secondary/30">
                  <span className="text-[10px] text-muted-foreground">{card.label}</span>
                  <span className={`text-lg font-bold tabular-nums ${card.highlight ? "text-foreground" : "text-muted-foreground"}`}>{card.value}</span>
                </div>
              ))}
            </div>

            {data?.nextPayout && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.2)" }}>
                <ArrowDownToLine size={15} style={{ color: "#FF5A1F" }} className="shrink-0" />
                <div>
                  <p className="text-xs font-semibold">Next automatic payout: {fmt(data.nextPayout.amount)}</p>
                  {data.nextPayout.arrivalDate && (
                    <>
                      <p className="text-xs text-muted-foreground mt-0.5">Estimated bank arrival: {data.nextPayout.arrivalDate}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 italic">Estimated dates depend on Stripe and your bank.</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {(data?.recentPayments ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2">Recent payments</p>
                <div className="space-y-2">
                  {data!.recentPayments.slice(0, 5).map((p: any) => {
                    const isExpanded = expandedPayment === p.public_id;
                    const jStatus = paymentToJourneyStatus(p);
                    return (
                      <div key={p.public_id} className="rounded-xl border border-border overflow-hidden">
                        <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/20 transition-colors" onClick={() => setExpandedPayment(isExpanded ? null : p.public_id)}>
                          <div>
                            <p className="text-xs font-semibold">{p.project_title ?? "Payment"}</p>
                            <p className="text-[11px] text-muted-foreground">{fmt(p.freelancer_pence ?? 0)} · {p.status}</p>
                          </div>
                          {isExpanded ? <ChevronUp size={13} className="text-muted-foreground shrink-0" /> : <ChevronDown size={13} className="text-muted-foreground shrink-0" />}
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-border pt-3">
                            {(p.status === "succeeded" && !p.transfer_status) && (
                              <div className="mb-3 px-3 py-2.5 rounded-xl text-xs" style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.18)" }}>
                                <p className="font-semibold mb-1" style={{ color: "#FF5A1F" }}>Why haven't I received this yet?</p>
                                <p className="text-muted-foreground">Your client has paid. Your payment has reached Stripe and is in its standard availability period. Stripe will automatically send it to your bank once this period ends. No action is needed.</p>
                              </div>
                            )}
                            <PaymentJourneyBar
                              paymentStatus={jStatus.paymentStatus}
                              transferStatus={jStatus.transferStatus}
                              payoutStatus={jStatus.payoutStatus}
                              grossPence={jStatus.grossPence}
                              freelancerPence={jStatus.freelancerPence}
                              platformFeePence={jStatus.platformFeePence}
                              timestamps={jStatus.timestamps}
                              role="freelancer"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(data?.payouts ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2">Payout history</p>
                <div className="space-y-1.5">
                  {data!.payouts.slice(0, 6).map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === "paid" ? "bg-green-500" : p.status === "failed" ? "bg-red-500" : "bg-amber-400"}`} />
                        <span className="text-muted-foreground">{p.created?.slice(0, 10)}</span>
                        {p.automatic && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">Auto</span>}
                      </div>
                      <span className="font-semibold">{fmt(p.amount)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${p.status === "paid" ? "bg-green-100 text-green-800" : p.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{friendlyPayout(p.status)}</span>
                      {p.arrivalDate && <span className="text-[10px] text-muted-foreground">→ {p.arrivalDate}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!data?.payouts?.length && !data?.lifetimeEarnedPence && (
              <p className="text-xs text-muted-foreground text-center py-4">No earnings yet. Complete a project to see your balance here.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PayoutsEarnings() {
  const { user } = useAuth();

  if (!user || user.role !== "freelancer") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">This page is only available to freelancers.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Clash Display, sans-serif" }}>Payouts & Earnings</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your bank connection and track your earnings.</p>
        </div>

        <PayoutsPanel userId={user.id} />
        <EarningsPanel userId={user.id} />
      </div>
    </div>
  );
}
