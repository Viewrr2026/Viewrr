/**
 * Earnings & Payouts Hub — PRD: Viewrr_PRD_Freelancer_Earnings_Payouts_Hub
 *
 * FR-06  Shared money formatter — validates isSafeInteger, currency GBP, divides once by 100,
 *        uses Intl.NumberFormat. Never uses Number(v)||0. Returns unavailable sentinel on bad input.
 * FR-07  Missing / null / NaN / Infinity / decimal / unsafe integers → unavailable state, not £0.00.
 * FR-08  Single exhaustive state mapper drives the top action banner.
 * FR-09  "You've been paid" copy appears ONLY when payout.status === "paid" AND amount is valid.
 * FR-11  Skeleton, true-empty, recoverable-error states on all panels.
 * Section 5  Page title "Earnings & payouts", supporting copy per spec, menu label "Earnings & payouts".
 * Section 6  Module order: status banner → balance summary → payout account → earnings → transactions → education.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { PaymentJourneyBar } from "@/components/PaymentJourney";
import {
  CheckCircle2, AlertCircle, Banknote, TrendingUp, ArrowDownToLine,
  ChevronDown, ChevronUp, Info, Loader2 as LoaderIcon, RefreshCw,
  ShieldAlert, Wallet, ReceiptText, HelpCircle, XCircle, ExternalLink,
  Clock, Star, Shield,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// FR-06  Safe money formatter
// ─────────────────────────────────────────────────────────────────────────────
const UNAVAILABLE = "—";

function fmtGBP(minorUnits: unknown): string {
  // FR-07: reject non-integer, NaN, Infinity, null, undefined, unsafe
  if (
    minorUnits === null ||
    minorUnits === undefined ||
    typeof minorUnits !== "number" ||
    !Number.isSafeInteger(minorUnits) ||
    !Number.isFinite(minorUnits)
  ) {
    return UNAVAILABLE;
  }
  // Divide once by 100 — never recompute from display strings
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    minorUnits / 100,
  );
}

/** Returns true only when fmtGBP produced a valid currency string */
function isValidAmount(minorUnits: unknown): minorUnits is number {
  return (
    typeof minorUnits === "number" &&
    Number.isSafeInteger(minorUnits) &&
    Number.isFinite(minorUnits)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-08/09  Exhaustive state mapper
// Derives ONE banner state from the combination of Connect + ledger statuses.
// "paid" headline is ONLY emitted when payout.status === "paid" AND amount is valid.
// ─────────────────────────────────────────────────────────────────────────────
type BannerState =
  | { kind: "no_connect" }
  | { kind: "needs_verification" }
  | { kind: "needs_terms" }
  | { kind: "stripe_reviewing" }
  | { kind: "verification_success" }
  | { kind: "payment_received"; amountMinor: number }
  | { kind: "payout_in_transit"; amountMinor: number }
  | { kind: "payout_paid"; amountMinor: number }
  | { kind: "payout_failed" }
  | { kind: "no_earnings" }
  | { kind: "data_unavailable" };

interface ConnectStatus {
  connected: boolean;
  chargesEnabled?: boolean;
  identityVerified?: boolean;
  viewrrTermsAccepted?: boolean;
  transfersReady?: boolean;
  automaticPayoutsEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  readinessState?: string;
  stripeAccountId?: string;
  currentlyDue?: string[];
  pastDue?: string[];
  pendingVerification?: string[];
  disabledReason?: string | null;
}

interface EarningsData {
  availableBalancePence?: number;
  pendingBalancePence?: number;
  lifetimeEarnedPence?: number;
  lifetimeVolumePence?: number;
  nextPayout?: { id: string; amount: number; arrivalDate?: string | null } | null;
  payouts?: Array<{ id: string; amount: number; status: string; arrivalDate?: string | null; created: string; automatic?: boolean }>;
  recentPayments?: Array<any>;
}

function deriveBannerState(
  connect: ConnectStatus | undefined,
  earnings: EarningsData | undefined,
): BannerState {
  if (!connect) return { kind: "data_unavailable" };

  // Connect not started
  if (!connect.connected) return { kind: "no_connect" };

  // Terms not accepted
  if (!connect.viewrrTermsAccepted) return { kind: "needs_terms" };

  // FR-07: Stripe is actively reviewing — don't show CTA they can't act on
  if (
    !connect.chargesEnabled &&
    !connect.identityVerified &&
    (connect.pendingVerification?.length ?? 0) > 0 &&
    (connect.currentlyDue?.length ?? 0) === 0
  ) return { kind: "stripe_reviewing" };

  // Identity not verified — actionable items exist
  if (!connect.identityVerified && !connect.chargesEnabled) return { kind: "needs_verification" };

  if (!earnings) return { kind: "data_unavailable" };

  // FR-09: payout paid — check the most recent payout with status "paid"
  const latestPayout = (earnings.payouts ?? []).find(p => p.status === "paid");
  if (latestPayout && isValidAmount(latestPayout.amount)) {
    return { kind: "payout_paid", amountMinor: latestPayout.amount };
  }

  // Payout failed
  const failedPayout = (earnings.payouts ?? []).find(p => p.status === "failed");
  if (failedPayout) return { kind: "payout_failed" };

  // Payout in transit (most recent)
  const inTransit = (earnings.payouts ?? []).find(p => p.status === "in_transit" || p.status === "pending");
  if (inTransit && isValidAmount(inTransit.amount)) {
    return { kind: "payout_in_transit", amountMinor: inTransit.amount };
  }

  // Payment received (transfer pending / in transit)
  const latestPayment = (earnings.recentPayments ?? []).find(
    p => p.status === "succeeded",
  );
  if (latestPayment && isValidAmount(latestPayment.freelancer_pence)) {
    return { kind: "payment_received", amountMinor: latestPayment.freelancer_pence };
  }

  // No earnings yet
  if (!isValidAmount(earnings.lifetimeEarnedPence) || earnings.lifetimeEarnedPence === 0) {
    return { kind: "no_earnings" };
  }

  return { kind: "data_unavailable" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status / Action Banner  (Module 1 per spec)
// ─────────────────────────────────────────────────────────────────────────────
function StatusBanner({
  banner,
  onSetupClick,
  onVerifyClick,
  onDashboardClick,
}: {
  banner: BannerState;
  onSetupClick: () => void;
  onVerifyClick: () => void;
  onDashboardClick?: () => void;
}) {
  // Section 7 copy matrix
  const config: Record<
    BannerState["kind"],
    { icon: React.ReactNode; headline: string; sub?: string; cta?: string; onCta?: () => void; style: "orange" | "green" | "amber" | "red" | "neutral" }
  > = {
    no_connect: {
      icon: <Wallet size={18} className="text-white" />,
      headline: "Set up payouts",
      sub: "Connect your bank account to start receiving payments.",
      cta: "Connect bank account",
      onCta: onSetupClick,
      style: "orange",
    },
    needs_verification: {
      icon: <ShieldAlert size={18} className="text-white" />,
      headline: "Complete payout verification",
      sub: "Your Stripe account needs verification before you can receive payouts.",
      cta: "Complete verification →",
      onCta: onVerifyClick,
      style: "amber",
    },
    stripe_reviewing: {
      icon: <Clock size={18} className="text-white" />,
      headline: "Stripe is reviewing your information",
      sub: "No action needed right now. Stripe will notify you when the review is complete — this usually takes 1–3 business days.",
      style: "neutral",
    },
    verification_success: {
      icon: <CheckCircle2 size={18} className="text-white" />,
      headline: "You're ready to get paid",
      sub: "Your Stripe account is connected and payouts are enabled. When clients pay you through Viewrr, Stripe will automatically send eligible earnings to your bank.",
      cta: "View earnings",
      style: "green",
    },
    needs_terms: {
      icon: <ReceiptText size={18} className="text-white" />,
      headline: "Accept Viewrr payment terms",
      sub: "One quick step to unlock payouts.",
      cta: "Review & accept",
      onCta: onSetupClick,
      style: "amber",
    },
    payment_received: {
      icon: <CheckCircle2 size={18} className="text-white" />,
      headline: "Payment received",
      sub: "Your payout is being prepared and will reach your bank soon.",
      cta: "View details",
      style: "green",
    },
    payout_in_transit: {
      icon: <ArrowDownToLine size={18} className="text-white" />,
      headline: "Your payout is on the way",
      sub: "Funds are in transit to your bank account.",
      cta: "Track payout",
      style: "orange",
    },
    payout_paid: {
      icon: <Banknote size={18} className="text-white" />,
      headline: "", // built dynamically below with validated amount
      sub: "",
      cta: "View transaction",
      style: "green",
    },
    payout_failed: {
      icon: <XCircle size={18} className="text-white" />,
      headline: "Your payout needs attention",
      sub: "A payout could not be completed. Please check your payout account.",
      cta: "Resolve payout issue",
      onCta: onVerifyClick,
      style: "red",
    },
    no_earnings: {
      icon: <TrendingUp size={18} className="text-white" />,
      headline: "Your earnings will appear here",
      sub: "Complete a project to see your balance.",
      cta: "View available briefs",
      style: "neutral",
    },
    data_unavailable: {
      icon: <RefreshCw size={18} className="text-white" />,
      headline: "We couldn't load this amount",
      sub: "There was a problem fetching your financial data.",
      cta: "Retry",
      style: "neutral",
    },
  };

  const c = config[banner.kind];

  // FR-09: build paid headline only from validated payout record
  let headline = c.headline;
  let sub = c.sub ?? "";
  if (banner.kind === "payout_paid") {
    headline = `You've been paid ${fmtGBP(banner.amountMinor)}`;
    sub = "The funds have been sent to your bank account.";
  } else if (banner.kind === "payout_in_transit") {
    headline = `Your payout is on the way — ${fmtGBP(banner.amountMinor)}`;
  } else if (banner.kind === "payment_received") {
    headline = `Payment received — ${fmtGBP(banner.amountMinor)}`;
  }

  const bgMap = {
    orange: "linear-gradient(135deg, #FF5A1F 0%, #FF8C42 60%, #FFD700 100%)",
    green:  "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)",
    amber:  "linear-gradient(135deg, #d97706 0%, #f59e0b 100%)",
    red:    "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)",
    neutral:"linear-gradient(135deg, #64748b 0%, #94a3b8 100%)",
  };

  return (
    <div
      className="mb-6 rounded-2xl overflow-hidden"
      style={{ background: bgMap[c.style], boxShadow: "0 4px 24px rgba(0,0,0,0.15)" }}
      data-testid="status-banner"
    >
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/20 shrink-0">
            {c.icon}
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">{headline}</p>
            {sub && <p className="text-white/80 text-xs mt-0.5">{sub}</p>}
          </div>
        </div>
        {c.cta && (
          <button
            onClick={c.onCta}
            className="flex-shrink-0 px-4 py-2 rounded-full bg-white text-xs font-bold transition-all hover:scale-105 active:scale-95"
            style={{ color: c.style === "green" ? "#16a34a" : c.style === "red" ? "#dc2626" : "#FF5A1F" }}
          >
            {c.cta} →
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance Summary  (Module 2 per spec — with definition tooltips)
// ─────────────────────────────────────────────────────────────────────────────
const BALANCE_DEFS = {
  "Available balance": "Funds cleared and ready to be paid to your bank.",
  "Pending balance": "Payments received but still in Stripe's availability period.",
  "Lifetime earnings": "Total net amount paid out to you across all projects.",
  "Project volume": "Total gross amount clients have paid for your projects.",
};

function BalanceSummary({ data, isLoading, isError, onRetry }: {
  data: EarningsData | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="balance-skeleton">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-xl border border-border bg-secondary/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle size={14} className="text-destructive shrink-0" />
          <span>We couldn't load your balances.</span>
        </div>
        <Button size="sm" variant="outline" className="rounded-full text-xs gap-1" onClick={onRetry}>
          <RefreshCw size={11} /> Retry
        </Button>
      </div>
    );
  }

  const cards = [
    { label: "Available balance" as const, value: data?.availableBalancePence, highlight: true },
    { label: "Pending balance"   as const, value: data?.pendingBalancePence },
    { label: "Lifetime earnings" as const, value: data?.lifetimeEarnedPence },
    { label: "Project volume"    as const, value: data?.lifetimeVolumePence },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="balance-summary">
      {cards.map(card => (
        <div
          key={card.label}
          className="relative flex flex-col gap-1 p-3 rounded-xl border border-border bg-card"
        >
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground leading-tight">{card.label}</span>
            <button
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => setTooltip(tooltip === card.label ? null : card.label)}
              aria-label={`Definition of ${card.label}`}
            >
              <HelpCircle size={10} />
            </button>
          </div>
          {tooltip === card.label && (
            <div className="absolute bottom-full left-0 mb-1 z-10 w-48 rounded-xl border border-border bg-popover px-3 py-2 text-[10px] text-muted-foreground shadow-lg">
              {BALANCE_DEFS[card.label]}
            </div>
          )}
          {/* FR-07: show UNAVAILABLE sentinel rather than £0 for missing/invalid values */}
          <span
            className={`text-lg font-bold tabular-nums ${card.highlight ? "text-foreground" : "text-muted-foreground"}`}
            aria-label={`${card.label}: ${fmtGBP(card.value)}`}
          >
            {fmtGBP(card.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payout Account  (Module 3 per spec)
// ─────────────────────────────────────────────────────────────────────────────
function PayoutAccount({
  userId,
  onSetupTriggered,
  onMutationReady,
  onDashboardMutationReady,
}: {
  userId: number;
  onSetupTriggered?: () => void;
  onMutationReady?: (fn: () => void) => void;
  onDashboardMutationReady?: (fn: () => void) => void;
}) {
  const queryClient = useQueryClient();
  const [popupOpen, setPopupOpen]           = useState(false);
  const [popupDone, setPopupDone]           = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsRead, setTermsRead]           = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: status, isLoading, isError, refetch } = useQuery<ConnectStatus & {
    stripeAccountId?: string;
    readinessState?: string;
    disabledReason?: string | null;
    pendingRequirements?: string[];
  }>({
    queryKey: ["/api/stripe/status", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/status/${userId}`);
      if (!res.ok) throw new Error("Could not fetch Connect status");
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
  }, [userId, refetch, queryClient]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

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
      // FR-02: if account already exists and terms accepted → go straight to onboarding link
      if (status?.connected && status?.viewrrTermsAccepted) {
        const res2 = await apiRequest("POST", "/api/stripe/onboarding-link", { userId });
        if (!res2.ok) { const b = await res2.json().catch(() => ({})); throw new Error((b as any).error || "We couldn't open Stripe. Please try again."); }
        const { url } = await res2.json();
        return url as string;
      }
      // New account or terms not yet accepted — go through connect-account
      const res1 = await apiRequest("POST", "/api/stripe/connect-account", { userId });
      const data1 = await res1.json().catch(() => ({}));
      if ((data1 as any).code === "VIEWRR_PAYMENT_TERMS_REQUIRED") { setShowTermsModal(true); return "terms_required"; }
      if (!res1.ok) throw new Error((data1 as any).error || "Could not set up Stripe account");
      // FR-02: if alreadyExists but needsOnboarding — get onboarding link
      if ((data1 as any).alreadyExists && (data1 as any).needsOnboarding) {
        const res2 = await apiRequest("POST", "/api/stripe/onboarding-link", { userId });
        if (!res2.ok) { const b = await res2.json().catch(() => ({})); throw new Error((b as any).error || "We couldn't open Stripe. Please try again."); }
        const { url } = await res2.json();
        return url as string;
      }
      if ((data1 as any).alreadyExists) { await refetch(); return "already_connected"; }
      const res2 = await apiRequest("POST", "/api/stripe/onboarding-link", { userId });
      if (!res2.ok) { const b = await res2.json().catch(() => ({})); throw new Error((b as any).error || "We couldn't open Stripe. Please try again."); }
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
      if (popup) { popupRef.current = popup; setPopupOpen(true); setPopupDone(false); startPolling(); onSetupTriggered?.(); }
      else { window.location.href = url; }
    },
    onError: (e: any) => {
      console.error("[connectMutation]", e.message);
    },
  });

  // FR-09: Dashboard link mutation (opens Stripe Express dashboard for verified accounts)
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const openDashboard = async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const res = await apiRequest("POST", "/api/stripe/dashboard-link", { userId });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).error || "Could not open Stripe dashboard"); }
      const { url } = await res.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setDashboardError(e.message ?? "We couldn't open Stripe. Please try again.");
    } finally {
      setDashboardLoading(false);
    }
  };

  // Expose mutations to parent via refs (FR-01: banner CTAs must work)
  useEffect(() => { onMutationReady?.(() => connectMutation.mutate()); }, [connectMutation.mutate]);
  useEffect(() => { onDashboardMutationReady?.(openDashboard); }, [openDashboard]);

  // FR-17: Handle ?stripe=refresh — Stripe expired link recovery
  // FR-18: Handle ?stripe=complete — sync after return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeParam = params.get("stripe");
    if (stripeParam === "refresh") {
      // Link expired — auto-generate a new one
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      setTimeout(() => connectMutation.mutate(), 300);
    } else if (stripeParam === "complete") {
      // Returned from Stripe — sync and show checking state
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      refetch().then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/stripe/status", userId] });
      });
    }
  }, []);

  const isFullyActive  = status?.connected && status?.chargesEnabled && status?.payoutsEnabled && status?.viewrrTermsAccepted;
  const needsTermsOnly = status?.connected && !status?.viewrrTermsAccepted;
  const isStripeReviewing = !isFullyActive && !!(status?.pendingVerification?.length) && !(status?.currentlyDue?.length);

  // FR-06: Readiness label derives from actual Stripe fields
  const getReadinessLabel = () => {
    if (!status?.connected) return { label: "Not connected", color: "text-muted-foreground" };
    if (isFullyActive) return { label: "Ready for payouts", color: "text-green-600 dark:text-green-400" };
    if (isStripeReviewing) return { label: "Stripe review in progress", color: "text-blue-600 dark:text-blue-400" };
    if (needsTermsOnly) return { label: "Terms required", color: "text-amber-600 dark:text-amber-400" };
    return { label: "Action required", color: "text-amber-600 dark:text-amber-400" };
  };
  const readiness = getReadinessLabel();

  const statusItems = status?.connected ? [
    { label: "Stripe connected",      ok: !!status.connected },
    { label: "Identity verified",     ok: !!(status.identityVerified || status.detailsSubmitted) },
    { label: "Transfers enabled",     ok: !!(status.transfersReady || status.chargesEnabled) },
    { label: "Automatic payouts",     ok: !!(status.automaticPayoutsEnabled || status.payoutsEnabled) },
    { label: "Viewrr terms accepted", ok: !!status.viewrrTermsAccepted },
  ] : null;

  // FR-19: Verification success moment — show once after popup closes with success
  const showSuccessHero = popupDone && isFullyActive;

  return (
    <>
      {/* FR-19: Verification success hero */}
      {showSuccessHero && (
        <div className="mb-6 rounded-2xl overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.1), rgba(34,197,94,0.05))", border: "1px solid rgba(34,197,94,0.3)" }}>
          <div className="px-5 py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                <CheckCircle2 size={20} className="text-green-500" />
              </div>
              <div>
                <p className="text-sm font-bold">You're ready to get paid</p>
                <p className="text-xs text-muted-foreground">Your payout account is fully set up.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              When clients pay you through Viewrr, Stripe will automatically send eligible earnings to your connected bank account.
            </p>
            <Button size="sm" className="mt-3 rounded-full text-xs" variant="outline" onClick={() => {}}>View earnings</Button>
          </div>
        </div>
      )}

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

      <div className="mb-6 rounded-2xl border border-border bg-card overflow-hidden" data-testid="panel-payout-account">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Banknote size={16} className="text-primary" />
            <span className="text-sm font-semibold">Payout account</span>
          </div>
          {/* FR-06: dynamic readiness badge */}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            isFullyActive ? "bg-green-100 dark:bg-green-900/20" : isStripeReviewing ? "bg-blue-100 dark:bg-blue-900/20" : "bg-amber-100 dark:bg-amber-900/20"
          } ${readiness.color}`}>
            {readiness.label}
          </span>
        </div>

        <div className="px-5 py-4">
          {/* FR-11: skeleton while loading */}
          {isLoading && (
            <div className="space-y-2">
              {[0,1,2,3,4].map(i => <div key={i} className="h-6 rounded-lg bg-secondary/40 animate-pulse" style={{ width: `${70 + i * 5}%` }} />)}
            </div>
          )}

          {/* FR-11: recoverable error */}
          {isError && !isLoading && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle size={14} className="text-destructive shrink-0" />
                <span>Couldn't load payout account status.</span>
              </div>
              <Button size="sm" variant="outline" className="rounded-full text-xs gap-1" onClick={() => refetch()}>
                <RefreshCw size={11} /> Retry
              </Button>
            </div>
          )}

          {!isLoading && !isError && (
            <div className="space-y-4">
              {/* FR-06: readiness checklist */}
              {statusItems && (
                <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
                  {statusItems.map(item => (
                    <div key={item.label} className="flex items-center gap-2.5">
                      {item.ok
                        ? <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                        : isStripeReviewing
                        ? <Clock size={13} className="text-blue-500 shrink-0" />
                        : <AlertCircle size={13} className="text-amber-500 shrink-0" />}
                      <span className={`text-xs ${item.ok ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* FR-07: Stripe reviewing — no CTA */}
              {isStripeReviewing && !popupDone && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)" }}>
                  <Clock size={15} className="text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Stripe is reviewing your information</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">This typically takes 1–3 business days. No action needed from you right now.</p>
                  </div>
                </div>
              )}

              {popupDone && !status?.identityVerified && (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-medium" style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 size={14} /> Verification submitted — Stripe is processing your details.
                </div>
              )}

              {/* Terms only */}
              {needsTermsOnly && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl" style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.2)" }}>
                    <CheckCircle2 size={15} style={{ color: "#FF5A1F" }} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">Your Stripe account is already connected</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Accept Viewrr's payment terms to start receiving payments — takes under 30 seconds.</p>
                    </div>
                  </div>
                  <Button size="sm" className="text-white rounded-full gap-2 text-xs w-full" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} onClick={() => setShowTermsModal(true)}>
                    Review & Accept Terms →
                  </Button>
                </div>
              )}

              {/* FR-08: Fully verified — show Manage Stripe button */}
              {isFullyActive && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 text-sm">
                    <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                    <span className="text-muted-foreground">Your bank account is connected. Payments are paid out automatically.</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full text-xs gap-2 w-full"
                    onClick={openDashboard}
                    disabled={dashboardLoading}
                  >
                    {dashboardLoading
                      ? <><LoaderIcon size={12} className="animate-spin" /> Opening Stripe…</>
                      : <><ExternalLink size={12} /> Manage Stripe account</>}
                  </Button>
                  {dashboardError && (
                    <div className="space-y-2">
                      <p className="text-xs text-destructive">{dashboardError}</p>
                      <Button size="sm" variant="outline" className="rounded-full text-xs gap-1 w-full" onClick={openDashboard}>
                        <RefreshCw size={11} /> Try Again
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* FR-01: Verification needed — resolve CTA (not duplicated from banner, lower visual weight) */}
              {status?.connected && !status?.chargesEnabled && !needsTermsOnly && !isStripeReviewing && !popupDone && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {(status?.currentlyDue?.length ?? 0) > 0
                        ? `Stripe needs ${status!.currentlyDue!.length} item${status!.currentlyDue!.length > 1 ? "s" : ""} from you to enable payments.`
                        : "Your Stripe account needs verification before you can receive payments."}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="text-white rounded-full gap-2 text-xs w-full"
                    style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                    onClick={() => connectMutation.mutate()}
                    disabled={connectMutation.isPending}
                  >
                    {connectMutation.isPending
                      ? <><LoaderIcon size={12} className="animate-spin" /> Opening Stripe…</>
                      : <>Resolve verification</>}
                  </Button>
                  {connectMutation.isError && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-destructive">{(connectMutation.error as any)?.message ?? "We couldn't open Stripe. Your account is still connected."}</p>
                      <Button size="sm" variant="outline" className="rounded-full text-xs gap-1" onClick={() => connectMutation.mutate()}>
                        <RefreshCw size={11} /> Try Again
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Not connected yet */}
              {!status?.connected && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">Connect your bank account to receive payments from clients. Takes about 2 minutes.</p>
                  <Button size="sm" className="text-white rounded-full gap-2 text-xs w-full" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                    {connectMutation.isPending ? <><LoaderIcon size={12} className="animate-spin" /> Opening…</> : <><Banknote size={12} /> Set up payouts</>}
                  </Button>
                  {connectMutation.isError && <p className="text-xs text-destructive">{(connectMutation.error as any)?.message}</p>}
                </div>
              )}

              {/* FR-20: Payout education */}
              <div className="rounded-xl border border-border overflow-hidden">
                <details>
                  <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none hover:bg-secondary/20 transition-colors">
                    <span className="text-xs font-semibold flex items-center gap-1.5"><Shield size={12} className="text-muted-foreground" /> How payouts work</span>
                    <span className="text-[10px] text-muted-foreground">Learn more</span>
                  </summary>
                  <div className="px-4 pb-4 space-y-2 text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
                    {[
                      "Your client pays through Viewrr.",
                      "Stripe processes your earnings.",
                      "Funds become available after Stripe's availability period.",
                      "Stripe automatically sends eligible funds to your bank.",
                    ].map((line, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-white text-[9px] font-bold mt-0.5" style={{ background: "#FF5A1F" }}>{i + 1}</span>
                        <span>{line}</span>
                      </div>
                    ))}
                    <a href="/#/help/payments" className="inline-flex items-center gap-1 text-[11px] font-semibold pt-1" style={{ color: "#FF5A1F" }}>Learn about payouts →</a>
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Earnings Summary + Transaction History + Education  (Modules 4-6 per spec)
// ─────────────────────────────────────────────────────────────────────────────
function EarningsAndHistory({ userId, onViewBreakdown }: { userId: number; onViewBreakdown?: (id: string) => void }) {
  const [educationOpen, setEducationOpen]     = useState(false);
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<EarningsData>({
    queryKey: ["/api/stripe/earnings", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/earnings/${userId}`);
      if (!res.ok) throw new Error("Could not load earnings");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const friendlyPayout = (s: string) =>
    ({ paid: "Paid to bank", in_transit: "In transit", pending: "Pending", canceled: "Cancelled", failed: "Failed" }[s] ?? s);

  const paymentToJourneyStatus = (p: any) => ({
    paymentStatus:  p.status          ?? "pending",
    transferStatus: p.transfer_status ?? null,
    payoutStatus:   null,
    grossPence:        p.gross_pence,
    freelancerPence:   p.freelancer_pence,
    platformFeePence:  p.platform_fee_pence,
    timestamps: {
      paid:        p.succeeded_at ?? p.created_at,
      authorised:  p.succeeded_at,
      transferred: p.transferred_at ?? null,
    },
  });

  // FR-11: skeleton loading — no layout shift
  if (isLoading) {
    return (
      <div className="mb-6 rounded-2xl border border-border bg-card overflow-hidden" data-testid="earnings-skeleton">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" />
          <span className="text-sm font-semibold">Earnings</span>
        </div>
        <div className="px-5 py-4 space-y-3">
          {[80, 60, 70, 40].map((w, i) => (
            <div key={i} className="h-5 rounded-lg bg-secondary/40 animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  // FR-11: recoverable error
  if (isError) {
    return (
      <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle size={14} className="text-destructive shrink-0" />
          <span>Couldn't load earnings data.</span>
        </div>
        <Button size="sm" variant="outline" className="rounded-full text-xs gap-1" onClick={() => refetch()}>
          <RefreshCw size={11} /> Retry
        </Button>
      </div>
    );
  }

  // FR-11: true-empty (no payout history, no lifetime earnings)
  const hasData = !!(data?.payouts?.length || (isValidAmount(data?.lifetimeEarnedPence) && (data?.lifetimeEarnedPence ?? 0) > 0));

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card overflow-hidden" data-testid="panel-earnings">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" />
          <span className="text-sm font-semibold">Earnings</span>
        </div>
        <a href="/#/help/payments" className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
          <Info size={11} /> Help
        </a>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Next payout */}
        {data?.nextPayout && isValidAmount(data.nextPayout.amount) && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.2)" }}>
            <ArrowDownToLine size={15} style={{ color: "#FF5A1F" }} className="shrink-0" />
            <div>
              <p className="text-xs font-semibold">Next automatic payout: {fmtGBP(data.nextPayout.amount)}</p>
              {data.nextPayout.arrivalDate && (
                <>
                  <p className="text-xs text-muted-foreground mt-0.5">Estimated bank arrival: {data.nextPayout.arrivalDate}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 italic">Estimated dates depend on Stripe and your bank.</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* FR-11: true empty */}
        {!hasData && (
          <div className="py-8 text-center">
            <TrendingUp size={28} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm font-semibold text-muted-foreground">Your earnings will appear here</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Complete a project to see your balance and transaction history.</p>
            <a href="/#/briefs" className="mt-3 inline-block text-xs font-semibold" style={{ color: "#FF5A1F" }}>View available briefs →</a>
          </div>
        )}

        {/* Transaction history (Module 5) — recent payments */}
        {(data?.recentPayments ?? []).length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-2">Transaction history</p>
            <div className="space-y-2">
              {data!.recentPayments.slice(0, 10).map((p: any) => {
                const isExpanded = expandedPayment === p.public_id;
                const jStatus    = paymentToJourneyStatus(p);
                // FR-07: validate all amounts before display
                const grossFmt   = fmtGBP(p.gross_pence);
                const netFmt     = fmtGBP(p.freelancer_pence);
                const feeFmt     = fmtGBP(p.platform_fee_pence);
                return (
                  <div key={p.public_id} className="rounded-xl border border-border overflow-hidden">
                    <div className="flex items-center justify-between">
                      <button
                        className="flex-1 flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/20 transition-colors"
                        onClick={() => setExpandedPayment(isExpanded ? null : p.public_id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{p.project_title ?? "Payment"}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Net {netFmt} · {p.status ?? "—"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted-foreground hidden sm:block">{p.created_at?.slice(0,10)}</span>
                          {isExpanded ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
                        </div>
                      </button>
                      {onViewBreakdown && (
                        <button
                          className="px-3 py-3 text-[10px] font-semibold border-l border-border hover:bg-secondary/20 transition-colors shrink-0"
                          style={{ color: "#FF5A1F" }}
                          onClick={() => onViewBreakdown(p.public_id)}
                        >
                          View breakdown
                        </button>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                        {/* FR-10: gross/fee/net breakdown */}
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Gross",       value: grossFmt },
                            { label: "Viewrr fee",  value: feeFmt },
                            { label: "Net to you",  value: netFmt },
                          ].map(r => (
                            <div key={r.label} className="flex flex-col gap-0.5 p-2 rounded-lg bg-secondary/30 border border-border">
                              <span className="text-[10px] text-muted-foreground">{r.label}</span>
                              <span className="text-xs font-bold tabular-nums">{r.value}</span>
                            </div>
                          ))}
                        </div>
                        {(p.status === "succeeded" && !p.transfer_status) && (
                          <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.18)" }}>
                            <p className="font-semibold mb-1" style={{ color: "#FF5A1F" }}>Why haven't I received this yet?</p>
                            <p className="text-muted-foreground">Your client has paid. The payment is in Stripe's standard availability period. Stripe will send it to your bank automatically — no action needed.</p>
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

        {/* Payout history */}
        {(data?.payouts ?? []).length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-2">Payout history</p>
            <div className="space-y-1.5">
              {data!.payouts.slice(0, 8).map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === "paid" ? "bg-green-500" : p.status === "failed" ? "bg-red-500" : "bg-amber-400"}`} />
                    <span className="text-muted-foreground">{p.created?.slice(0, 10)}</span>
                    {p.automatic && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">Auto</span>}
                  </div>
                  {/* FR-07: validate amount before display */}
                  <span className="font-semibold">{fmtGBP(p.amount)}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${p.status === "paid" ? "bg-green-100 text-green-800" : p.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                    {friendlyPayout(p.status)}
                  </span>
                  {p.arrivalDate && <span className="text-[10px] text-muted-foreground">→ {p.arrivalDate}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* How payments work accordion (Module 6 — moved, unchanged) */}
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
            onClick={() => setEducationOpen(o => !o)}
            aria-expanded={educationOpen}
          >
            <span className="text-xs font-semibold">How payments work</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{educationOpen ? "Hide" : "Learn more"}</span>
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
              <a href="/#/help/payments" className="inline-flex items-center gap-1 text-[11px] font-semibold pt-1" style={{ color: "#FF5A1F" }}>Full payments guide →</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function PayoutsEarnings() {
  const { user } = useAuth();

  // AC-10: permission-denied — no flash of financial data
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Sign in to view your earnings.</p>
      </div>
    );
  }

  if (user.role !== "freelancer") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">This page is only available to freelancers.</p>
      </div>
    );
  }

  return <EarningsPage userId={user.id} />;
}

function EarningsPage({ userId }: { userId: number }) {
  // Both queries needed to derive banner state
  const connectQuery = useQuery<ConnectStatus>({
    queryKey: ["/api/stripe/status", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/status/${userId}`);
      if (!res.ok) throw new Error("Status fetch failed");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const earningsQuery = useQuery<EarningsData>({
    queryKey: ["/api/stripe/earnings", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/earnings/${userId}`);
      if (!res.ok) throw new Error("Earnings fetch failed");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  // FR-08: derive single banner from both authoritative states
  const banner = deriveBannerState(connectQuery.data, earningsQuery.data);

  // FR-11/12: Earnings breakdown modal state
  const [breakdownPaymentId, setBreakdownPaymentId] = useState<string | null>(null);
  const breakdownQuery = useQuery({
    queryKey: ["/api/stripe/payment-breakdown", breakdownPaymentId, userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/payment-breakdown/${breakdownPaymentId}?userId=${userId}`);
      if (!res.ok) throw new Error("Could not load payment breakdown");
      return res.json();
    },
    enabled: !!breakdownPaymentId,
    staleTime: 60_000,
  });

  // FR-01: refs so StatusBanner can invoke the PayoutAccount mutation
  const verifyMutationRef  = useRef<(() => void) | null>(null);
  const dashboardMutationRef = useRef<(() => void) | null>(null);

  const handleSetup  = () => { verifyMutationRef.current?.(); };
  const handleVerify = () => { verifyMutationRef.current?.(); };
  const handleDashboard = () => { dashboardMutationRef.current?.(); };

  return (
    <>
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Section 5 IA: page title + supporting copy */}
        <div className="mb-8">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ fontFamily: "Clash Display, sans-serif" }}
          >
            Earnings &amp; payouts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track what you've earned, what's on the way and where your payouts are sent.
          </p>
        </div>

        {/* Module 1: Status / action banner */}
        {!connectQuery.isLoading && (
          <StatusBanner
            banner={banner}
            onSetupClick={handleSetup}
            onVerifyClick={handleVerify}
            onDashboardClick={handleDashboard}
          />
        )}

        {/* Module 2: Balance summary */}
        <BalanceSummary
          data={earningsQuery.data}
          isLoading={earningsQuery.isLoading}
          isError={earningsQuery.isError}
          onRetry={() => earningsQuery.refetch()}
        />

        {/* Module 3: Payout account */}
        <PayoutAccount
          userId={userId}
          onMutationReady={(fn) => { verifyMutationRef.current = fn; }}
          onDashboardMutationReady={(fn) => { dashboardMutationRef.current = fn; }}
        />

        {/* Modules 4-6: Earnings summary, transaction history, education */}
        <EarningsAndHistory userId={userId} onViewBreakdown={setBreakdownPaymentId} />
      </div>
    </div>

    {/* FR-11/12: Earnings breakdown modal */}
    {breakdownPaymentId && (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} onClick={() => setBreakdownPaymentId(null)}>
        <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-border bg-card p-6 flex flex-col gap-4" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">Payment breakdown</p>
            <button onClick={() => setBreakdownPaymentId(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
          </div>
          {breakdownQuery.isLoading && <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 rounded-lg bg-secondary/40 animate-pulse" />)}</div>}
          {breakdownQuery.isError && <p className="text-xs text-destructive">Could not load breakdown. Please try again.</p>}
          {breakdownQuery.data && (() => {
            const b = breakdownQuery.data as any;
            const gross = fmtGBP(b.grossPence);
            const fee = fmtGBP(b.platformFeePence);
            const net = fmtGBP(b.freelancerPence);
            const saved = b.isPro && b.savedPence > 0 ? fmtGBP(b.savedPence) : null;
            const commissionLabel = b.isPro
              ? `Pro Viewrr commission — ${(b.commissionRateBps / 100).toFixed(0)}%`
              : `Viewrr commission — ${b.commissionRateBps ? (b.commissionRateBps / 100).toFixed(0) : "11"}%`;
            return (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-medium truncate">{b.projectTitle}</p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <span className="text-xs text-muted-foreground">Client paid</span>
                    <span className="text-xs font-semibold">{gross}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-border">
                    <div>
                      <span className="text-xs text-muted-foreground">{commissionLabel}</span>
                      {b.isPro && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,90,31,0.1)", color: "#FF5A1F" }}>Pro</span>}
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground">−{fee}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-xs font-bold">Your earnings</span>
                    <span className="text-sm font-bold" style={{ color: "#FF5A1F" }}>{net}</span>
                  </div>
                </div>
                {saved && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium" style={{ background: "rgba(255,90,31,0.08)", border: "1px solid rgba(255,90,31,0.2)" }}>
                    <Star size={12} style={{ color: "#FF5A1F" }} />
                    <span style={{ color: "#FF5A1F" }}>You saved {saved} with Pro Viewrr on this project.</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>Status</span>
                  <span className="capitalize">{b.status ?? "—"}</span>
                </div>
                {b.succeededAt && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Payment date</span>
                    <span>{b.succeededAt?.slice(0,10)}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    )}
    </>
  );
}
