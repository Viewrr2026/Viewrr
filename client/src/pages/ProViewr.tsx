/**
 * PRD-013 — Pro Viewrr Subscription Page
 *
 * FR-03: The browser NEVER activates Pro. Only webhook-confirmed server state counts.
 * FR-25: Returning from checkout shows "Confirming…" then polls for authoritative state.
 * FR-10: 8% commission benefit is the primary conversion argument.
 * FR-05: Founding 10 offer shown while spaces remain.
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Crown, Check, Zap, TrendingUp, Star, Shield, Rocket, BarChart2,
  Users, ArrowRight, Sparkles, Percent, ChevronRight, AlertCircle, Loader2,
  BadgeCheck, RefreshCw, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import LoginModal from "@/components/LoginModal";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────
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

// ── Commission savings calculator data ────────────────────────────────────────
const savingsExamples = [
  { label: "£500 project", gross: 500 },
  { label: "£1,000 project", gross: 1000 },
  { label: "£3,000 earnings", gross: 3000 },
];

function calcSavings(gross: number) {
  const standard = Math.round(gross * 0.11 * 100) / 100;
  const pro = Math.round(gross * 0.08 * 100) / 100;
  return { standard, pro, save: Math.round((standard - pro) * 100) / 100 };
}

function fmtGBP(n: number) {
  return `£${n.toFixed(2).replace(/\.00$/, "")}`;
}

// ── Perk definitions ──────────────────────────────────────────────────────────
const perks = [
  {
    icon: Percent,
    title: "8% Viewrr Commission",
    desc: "Keep more from every eligible Viewrr project. Standard commission is 11% — Pro creatives pay just 8%.",
    highlight: true,
  },
  {
    icon: TrendingUp,
    title: "Priority Discovery",
    desc: "Your profile is placed above standard creatives on Browse Talent — maximum visibility to every client.",
    highlight: false,
  },
  {
    icon: Crown,
    title: "Pro Viewrr Badge",
    desc: "A Pro badge on your profile signals premium membership to every client who views your work.",
    highlight: false,
  },
  {
    icon: Rocket,
    title: "Priority in AI Match",
    desc: "When clients use AI Match your profile is weighted more heavily in results.",
    highlight: false,
  },
  {
    icon: Star,
    title: "Featured on Landing Page",
    desc: "Rotate into the Featured Creatives section — seen by every visitor before they browse.",
    highlight: false,
  },
  {
    icon: BarChart2,
    title: "Profile Analytics",
    desc: "See weekly profile views, saves, and enquiries. Know exactly what's working.",
    highlight: false,
  },
  {
    icon: Users,
    title: "Unlimited Connections",
    desc: "Standard accounts have enquiry limits. Pro Viewrrs have no cap on active work.",
    highlight: false,
  },
  {
    icon: Zap,
    title: "Instant Notifications",
    desc: "Get notified the moment a client saves your profile or sends an enquiry.",
    highlight: false,
  },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProViewr() {
  const { user } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // FR-25: detect return from Stripe checkout
  const searchParams = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const returnStatus = searchParams.get("status"); // "success" | "cancelled"
  const [isConfirming, setIsConfirming] = useState(returnStatus === "success");
  const [confirmAttempts, setConfirmAttempts] = useState(0);

  // Authoritative Pro status — always from server
  const { data: proStatus, refetch: refetchStatus, isLoading: statusLoading } =
    useQuery<ProEntitlement>({
      queryKey: ["/api/pro/status", user?.id],
      queryFn: () =>
        user
          ? apiRequest("GET", `/api/pro/status/${user.id}`).then(r => r.json())
          : Promise.resolve({ entitlementActive: false, foundingProSpacesRemaining: 0 }),
      enabled: !!user,
      refetchInterval: isConfirming ? 3000 : false, // poll while confirming
    });

  // FR-25: stop polling once confirmed or after 10 attempts
  useEffect(() => {
    if (!isConfirming) return;
    if (proStatus?.entitlementActive) {
      setIsConfirming(false);
      return;
    }
    if (confirmAttempts > 10) {
      setIsConfirming(false);
    }
    setConfirmAttempts(a => a + 1);
  }, [proStatus, isConfirming]);

  const isAlreadyPro = proStatus?.entitlementActive;
  const isFounder = proStatus?.foundingMember;
  const spacesLeft = proStatus?.foundingProSpacesRemaining ?? 0;
  const showFoundingOffer = spacesLeft > 0 && !isAlreadyPro;
  const isFreelancer = user?.role === "freelancer";

  // POST /api/pro/checkout → redirect to Stripe
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pro/checkout", { userId: user?.id });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Unable to start checkout.");
      return body;
    },
    onSuccess: (data) => {
      if (data.alreadyPro) {
        queryClient.invalidateQueries({ queryKey: ["/api/pro/status", user?.id] });
        return;
      }
      // Redirect to Stripe Checkout
      window.location.href = data.checkoutUrl;
    },
    onError: (e: any) => {
      toast({ title: e.message, variant: "destructive" });
    },
  });

  // POST /api/pro/claim-founding
  const claimFoundingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pro/claim-founding", { userId: user?.id });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 409) throw new Error("FOUNDING_FULL");
        throw new Error(body.error || "Unable to claim Founding Pro.");
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pro/status", user?.id] });
    },
    onError: (e: any) => {
      if (e.message === "FOUNDING_FULL") {
        // Spaces ran out between page load and click — show paid offer
        queryClient.invalidateQueries({ queryKey: ["/api/pro/status", user?.id] });
        toast({ title: "All Founding Pro places have been claimed.", description: "You can subscribe at £49.99/month." });
      } else {
        toast({ title: e.message, variant: "destructive" });
      }
    },
  });

  function handleCTA() {
    if (!user) { setLoginOpen(true); return; }
    if (!isFreelancer) {
      toast({ title: "Pro Viewrr is for freelancer accounts only.", variant: "destructive" });
      return;
    }
    if (showFoundingOffer) {
      claimFoundingMutation.mutate();
    } else {
      checkoutMutation.mutate();
    }
  }

  const isPending = checkoutMutation.isPending || claimFoundingMutation.isPending;

  // ── Success state (webhook confirmed) ────────────────────────────────────────
  if (isAlreadyPro && (returnStatus === "success" || claimFoundingMutation.isSuccess)) {
    return <ProSuccessScreen isFounder={isFounder ?? false} navigate={navigate} />;
  }

  // ── Confirming state (returned from Stripe, awaiting webhook) ─────────────
  if (isConfirming && !isAlreadyPro) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: "linear-gradient(135deg,#FF5A1F22,#FFA50022)", border: "1px solid #FF5A1F44" }}>
            <Loader2 size={28} className="animate-spin" style={{ color: "#FF5A1F" }} />
          </div>
          <h2 className="text-xl font-bold mb-2">Setting up your Pro membership…</h2>
          <p className="text-sm text-muted-foreground mb-4">
            We're confirming your payment with Stripe. This usually takes a few seconds.
          </p>
          <p className="text-xs text-muted-foreground">
            If this takes longer than expected, check your Pro status in your profile menu.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0" aria-hidden
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25 100% 96%) 0%, transparent 70%)" }} />
        <div className="hidden dark:block pointer-events-none absolute inset-0" aria-hidden
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25 60% 12%) 0%, transparent 70%)" }} />

        <div className="mx-auto max-w-4xl px-6 py-20 text-center relative">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold mb-6"
            style={{ background: "linear-gradient(135deg, #FF5A1F22, #FFA50022)", border: "1px solid #FF5A1F44", color: "#FF5A1F" }}>
            <Crown size={14} />
            Pro Viewrr Membership
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Get discovered more. Win more work.<br />
            <span style={{ color: "#FF5A1F" }}>Keep more of what you earn.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
            Pro Viewrr gives you priority discovery, a Pro badge, and — most importantly — a reduced 8% commission on eligible Viewrr projects.
          </p>

          {/* ── Founding Pro offer banner ───────────────────────────────────── */}
          {showFoundingOffer && (
            <div className="max-w-lg mx-auto mb-8 rounded-2xl border-2 px-6 py-4 text-left"
              style={{ borderColor: "#FF5A1F", background: "linear-gradient(135deg,#FF5A1F08,#FFA50008)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Crown size={16} style={{ color: "#FF5A1F" }} />
                <span className="font-bold text-sm" style={{ color: "#FF5A1F" }}>Founding Pro</span>
                <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full text-white"
                  style={{ background: "#FF5A1F" }}>
                  {spacesLeft} of {10} remaining
                </span>
              </div>
              <p className="text-sm font-semibold mb-0.5">We're giving Pro Viewrr free to our first 10 creative members.</p>
              <p className="text-xs text-muted-foreground">
                Get all Pro benefits — including our reduced 8% commission — at £0/month. This is deliberately exclusive.
              </p>
            </div>
          )}

          {/* ── Pricing card ────────────────────────────────────────────────── */}
          <div className="inline-block relative mx-auto">
            <div className="absolute -inset-px rounded-2xl pointer-events-none"
              style={{ background: "linear-gradient(135deg, #FF5A1F, #FFA500)", opacity: 0.35, filter: "blur(8px)" }} aria-hidden />
            <div className="relative rounded-2xl border-2 bg-background px-10 py-8 text-center"
              style={{ borderColor: "#FF5A1F88" }}>

              {showFoundingOffer ? (
                <>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-1">Founding Pro</p>
                  <div className="flex items-end justify-center gap-1 mb-1">
                    <span className="text-6xl font-black" style={{ color: "#FF5A1F" }}>£0</span>
                    <span className="text-2xl font-bold text-muted-foreground mb-2">/mo</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-6">Free for life while your account is in good standing.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-1">Monthly subscription</p>
                  <div className="flex items-end justify-center gap-1 mb-1">
                    <span className="text-6xl font-black" style={{ color: "#FF5A1F" }}>£49</span>
                    <span className="text-2xl font-bold text-muted-foreground mb-2">.99</span>
                    <span className="text-sm text-muted-foreground mb-2">/mo</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-6">Cancel anytime. Recurring monthly billing.</p>
                </>
              )}

              {isAlreadyPro ? (
                <div className="flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold text-sm"
                  style={{ background: "linear-gradient(135deg, #FF5A1F22, #FFA50022)", border: "1px solid #FF5A1F55", color: "#FF5A1F" }}>
                  <Crown size={16} />
                  You're a Pro Viewrr
                </div>
              ) : (
                <Button
                  data-testid="btn-subscribe-pro"
                  size="lg"
                  className="w-full text-white font-bold text-base rounded-xl"
                  style={{ background: "linear-gradient(135deg, #FF5A1F, #FF8C42)", boxShadow: "0 4px 20px #FF5A1F55" }}
                  onClick={handleCTA}
                  disabled={isPending || statusLoading}
                >
                  {isPending ? (
                    <><Loader2 size={16} className="mr-2 animate-spin" />
                      {showFoundingOffer ? "Claiming…" : "Taking you to checkout…"}
                    </>
                  ) : showFoundingOffer ? (
                    <><Crown size={16} className="mr-2" />Claim Founding Pro<ArrowRight size={16} className="ml-2" /></>
                  ) : (
                    <><Crown size={16} className="mr-2" />Become a Pro Viewrr<ArrowRight size={16} className="ml-2" /></>
                  )}
                </Button>
              )}

              {!user && (
                <p className="text-xs text-muted-foreground mt-3">Sign in with a freelancer account to subscribe</p>
              )}
              {user && !isFreelancer && (
                <p className="text-xs text-muted-foreground mt-3">Pro Viewrr is available for freelancer accounts only</p>
              )}
            </div>
          </div>

          {/* FR-32: billing disclosure */}
          {!isAlreadyPro && !showFoundingOffer && (
            <p className="text-xs text-muted-foreground mt-4 max-w-xs mx-auto">
              By subscribing you agree to a recurring monthly charge of £49.99. Cancel anytime before renewal. The 8% commission applies to new eligible invoices created while Pro is active.
            </p>
          )}
        </div>
      </section>

      {/* ── FR-10: Commission savings hero ──────────────────────────────────── */}
      <section className="border-b border-border" style={{ background: "linear-gradient(135deg,#FF5A1F06,#FFA50004)" }}>
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold mb-4"
            style={{ background: "#FF5A1F18", color: "#FF5A1F", border: "1px solid #FF5A1F33" }}>
            <Percent size={12} /> Commission savings
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-3">Keep more of what you earn</h2>
          <p className="text-muted-foreground mb-10 max-w-lg mx-auto">
            Pro creatives pay just <strong>8% Viewrr commission</strong> instead of 11%. That 3% difference adds up fast.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {savingsExamples.map(({ label, gross }) => {
              const { standard, pro, save } = calcSavings(gross);
              return (
                <div key={label} className="rounded-2xl border border-border bg-card p-5 text-left">
                  <p className="text-xs text-muted-foreground font-medium mb-3">{label}</p>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Standard fee (11%)</span>
                    <span className="text-xs font-mono text-muted-foreground">{fmtGBP(standard)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold" style={{ color: "#FF5A1F" }}>Pro fee (8%)</span>
                    <span className="text-xs font-mono font-semibold" style={{ color: "#FF5A1F" }}>{fmtGBP(pro)}</span>
                  </div>
                  <div className="rounded-xl px-3 py-2 flex items-center justify-between"
                    style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <span className="text-xs font-semibold text-green-700 dark:text-green-400">You save</span>
                    <span className="text-sm font-black text-green-700 dark:text-green-400">{fmtGBP(save)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-6">
            Commission savings apply to new eligible invoices created while your Pro membership is active.
          </p>
        </div>
      </section>

      {/* ── Perks grid ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold mb-2">Everything included in Pro Viewrr</h2>
          <p className="text-muted-foreground">Tools and advantages to grow your creative business.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {perks.map(({ icon: Icon, title, desc, highlight }, i) => (
            <div key={i}
              className="group rounded-xl border bg-card p-5 hover:border-primary/40 transition-all hover:shadow-md"
              style={highlight ? { borderColor: "#FF5A1F55", background: "linear-gradient(135deg,#FF5A1F06,#FFA50006)" } : {}}>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-colors"
                style={{ background: "linear-gradient(135deg, #FF5A1F18, #FFA50018)" }}>
                <Icon size={18} style={{ color: "#FF5A1F" }} />
              </div>
              {highlight && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white mb-2 inline-block"
                  style={{ background: "#FF5A1F" }}>Primary benefit</span>
              )}
              <h3 className="font-semibold text-sm mb-1.5">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Compare table ────────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-2xl font-bold text-center mb-10">Standard vs Pro Viewrr</h2>
          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="grid grid-cols-3 bg-muted/50">
              <div className="px-5 py-3 text-sm font-semibold text-muted-foreground">Feature</div>
              <div className="px-5 py-3 text-sm font-semibold text-center border-l border-border">Standard</div>
              <div className="px-5 py-3 text-sm font-semibold text-center border-l border-border"
                style={{ color: "#FF5A1F", background: "linear-gradient(135deg, #FF5A1F0A, #FFA5000A)" }}>
                <Crown size={12} className="inline mr-1" />Pro Viewrr
              </div>
            </div>
            {[
              ["Viewrr commission", "11%", "8% ✦"],
              ["Profile position", "Sorted by rating", "Priority placement"],
              ["AI Match weighting", "Standard", "Priority boost"],
              ["Landing page feature", "—", "Rotating feature"],
              ["Pro badge", "—", "Crown badge"],
              ["Profile analytics", "—", "Weekly stats"],
              ["Active enquiry limit", "5", "Unlimited"],
              ["Instant notifications", "—", "✓"],
            ].map(([feature, standard, pro], i) => (
              <div key={i} className={`grid grid-cols-3 border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                <div className="px-5 py-3 text-sm">{feature}</div>
                <div className="px-5 py-3 text-sm text-center border-l border-border text-muted-foreground">{standard}</div>
                <div className="px-5 py-3 text-sm text-center border-l border-border font-semibold"
                  style={{ color: "#FF5A1F", background: "linear-gradient(135deg, #FF5A1F06, #FFA50006)" }}>
                  {pro}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-4">
            ✦ Pro commission applies to new eligible invoices created while the subscription is active. Accreditation and trust verification are earned separately and cannot be purchased.
          </p>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-2xl px-6 py-20 text-center">
        <Sparkles size={32} className="mx-auto mb-4" style={{ color: "#FF5A1F" }} />
        <h2 className="text-2xl font-bold mb-3">
          {showFoundingOffer ? "Claim your Founding Pro place" : "Ready to grow your creative business?"}
        </h2>
        <p className="text-muted-foreground mb-8">
          {showFoundingOffer
            ? `${spacesLeft} of 10 Founding Pro places remain. Once they're gone, Pro Viewrr is £49.99/month.`
            : "Pro Viewrr gives you priority discovery, a reduced commission rate, and more — all in one membership."}
        </p>
        {isAlreadyPro ? (
          <div className="flex items-center justify-center gap-2 text-sm font-semibold" style={{ color: "#FF5A1F" }}>
            <Check size={18} />
            You're already a Pro Viewrr.
          </div>
        ) : (
          <Button
            data-testid="btn-subscribe-pro-bottom"
            size="lg"
            className="text-white font-bold px-10 rounded-xl"
            style={{ background: "linear-gradient(135deg, #FF5A1F, #FF8C42)", boxShadow: "0 4px 20px #FF5A1F44" }}
            onClick={handleCTA}
            disabled={isPending || statusLoading}
          >
            {isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Crown size={16} className="mr-2" />}
            {showFoundingOffer ? "Claim Founding Pro — Free" : "Start Pro Viewrr — £49.99/mo"}
          </Button>
        )}
      </section>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

// ── Success screen (FR-13) ────────────────────────────────────────────────────
function ProSuccessScreen({ isFounder, navigate }: { isFounder: boolean; navigate: any }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)", boxShadow: "0 8px 32px #FF5A1F55" }}>
          <Crown size={36} className="text-white" />
        </div>

        {isFounder ? (
          <>
            <h1 className="text-2xl font-extrabold mb-2">👑 You're a Founding Pro</h1>
            <p className="text-muted-foreground mb-2">
              You're one of Viewrr's first 10 Pro creatives.
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              Your Pro membership is on us. Your Viewrr commission has dropped from 11% to <strong>8%</strong> for eligible new work.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold mb-2">👑 Welcome to Pro Viewrr</h1>
            <p className="text-muted-foreground mb-2">You're in.</p>
            <p className="text-sm text-muted-foreground mb-6">
              Your profile now has Pro status and your Viewrr commission has dropped from 11% to <strong>8%</strong> for eligible new work.
            </p>
          </>
        )}

        <div className="rounded-2xl border border-border bg-card p-5 mb-6 text-left space-y-2">
          {[
            "Priority placement on Browse Talent",
            "Pro Viewrr badge on your profile",
            "8% commission on eligible new projects",
            "Priority in AI Match",
            "Profile analytics",
          ].map((b, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm">
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "rgba(34,197,94,0.15)" }}>
                <Check size={11} className="text-green-600" />
              </div>
              {b}
            </div>
          ))}
        </div>

        <div className="flex gap-3 justify-center">
          <Button
            className="text-white rounded-xl"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
            onClick={() => navigate("/#/dashboard")}
          >
            See My Pro Profile
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => navigate("/#/pro")}>
            Explore Pro Benefits
          </Button>
        </div>
      </div>
    </div>
  );
}
