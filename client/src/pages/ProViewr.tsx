import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Crown, Check, Zap, TrendingUp, Star, Shield, Rocket, BarChart2, Users, ArrowRight, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/AuthProvider";
import LoginModal from "@/components/LoginModal";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const perks = [
  { icon: TrendingUp, title: "Top of Explore", desc: "Your profile is always pinned above all standard freelancers on the Browse Talent page — maximum visibility to every client." },
  { icon: Crown,      title: "Pro Viewrr Badge", desc: "A gold Pro Viewrr crown badge on your profile and feed posts signals elite credibility to every client that views your work." },
  { icon: Rocket,     title: "Priority in AI Match", desc: "When clients use the AI Match tool your profile is weighted heavily in results, so you win more conversations before competitors." },
  { icon: Star,       title: "Featured on Landing Page", desc: "Rotate into the Featured Creatives section on the Viewrr home page — seen by every visitor before they even browse." },
  { icon: BarChart2,  title: "Profile Analytics", desc: "See how many clients viewed your profile, saved you, and sent enquiries every week. Know what's working." },
  { icon: Users,      title: "Unlimited Connections", desc: "Standard accounts are capped at 5 active enquiries. Pro Viewrrs have no limits — take on as much work as you can handle." },
  { icon: Shield,     title: "Verified Pro Status", desc: "Your account is manually reviewed and verified by the Viewrr team, giving clients extra peace of mind before they hire." },
  { icon: Zap,        title: "Instant Notifications", desc: "Get notified the moment a client saves your profile or sends an enquiry — so you can respond before anyone else does." },
];

export default function ProViewr() {
  const { user } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check current Pro status
  const { data: proStatus } = useQuery<{ isPro: boolean; proSince?: string }>({
    queryKey: ["/api/pro/status", user?.id],
    queryFn: () => user ? apiRequest("GET", `/api/pro/status/${user.id}`).then(r => r.json()) : Promise.resolve({ isPro: false }),
    enabled: !!user,
  });

  const subscribeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pro/subscribe", { userId: user?.id }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pro/status", user?.id] });
      toast({ title: "Welcome to Pro Viewrr! 🎉", description: "Your profile is now pinned to the top of Browse Talent." });
    },
    onError: (e: any) => {
      toast({ title: "Could not subscribe", description: e.message, variant: "destructive" });
    },
  });

  const isAlreadyPro = proStatus?.isPro;
  const isFreelancer = user?.role === "freelancer";

  function handleSubscribe() {
    if (!user) { setLoginOpen(true); return; }
    if (!isFreelancer) {
      toast({ title: "Freelancers only", description: "Pro Viewrr is for freelancer accounts.", variant: "destructive" });
      return;
    }
    subscribeMutation.mutate();
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-border">
        {/* Subtle warm gradient wash */}
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25 100% 96%) 0%, transparent 70%)" }}
          aria-hidden />
        <div className="dark:hidden pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25 100% 96%) 0%, transparent 70%)" }}
          aria-hidden />
        <div className="hidden dark:block pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(25 60% 12%) 0%, transparent 70%)" }}
          aria-hidden />

        <div className="mx-auto max-w-4xl px-6 py-20 text-center relative">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold mb-6"
            style={{ background: "linear-gradient(135deg, #FF5A1F22, #FFA50022)", border: "1px solid #FF5A1F44", color: "#FF5A1F" }}>
            <Crown size={14} />
            Pro Viewrr Membership
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
            Get seen first.<br />
            <span style={{ color: "#FF5A1F" }}>Win more clients.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
            Pro Viewrr pushes your profile to the very top of Browse Talent, gives you a verified badge, and puts you first in AI Match results — for just £49.99/month.
          </p>

          {/* Pricing card */}
          <div className="inline-block relative mx-auto">
            {/* Glow ring */}
            <div className="absolute -inset-px rounded-2xl pointer-events-none"
              style={{ background: "linear-gradient(135deg, #FF5A1F, #FFA500)", opacity: 0.35, filter: "blur(8px)" }}
              aria-hidden />
            <div className="relative rounded-2xl border-2 bg-background px-10 py-8 text-center"
              style={{ borderColor: "#FF5A1F88" }}>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-1">Monthly subscription</p>
              <div className="flex items-end justify-center gap-1 mb-1">
                <span className="text-6xl font-black" style={{ color: "#FF5A1F" }}>£49</span>
                <span className="text-2xl font-bold text-muted-foreground mb-2">.99</span>
                <span className="text-sm text-muted-foreground mb-2">/mo</span>
              </div>
              <p className="text-xs text-muted-foreground mb-6">Cancel anytime. No hidden fees.</p>

              {isAlreadyPro ? (
                <div data-testid="pro-active-badge"
                  className="flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold text-sm"
                  style={{ background: "linear-gradient(135deg, #FF5A1F22, #FFA50022)", border: "1px solid #FF5A1F55", color: "#FF5A1F" }}>
                  <Crown size={16} />
                  You're a Pro Viewrr — profile is live at the top
                </div>
              ) : (
                <Button
                  data-testid="btn-subscribe-pro"
                  size="lg"
                  className="w-full text-white font-bold text-base rounded-xl"
                  style={{ background: "linear-gradient(135deg, #FF5A1F, #FF8C42)", boxShadow: "0 4px 20px #FF5A1F55" }}
                  onClick={handleSubscribe}
                  disabled={subscribeMutation.isPending}
                >
                  {subscribeMutation.isPending ? "Processing…" : (
                    <>
                      <Crown size={16} className="mr-2" />
                      Become a Pro Viewrr
                      <ArrowRight size={16} className="ml-2" />
                    </>
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
        </div>
      </section>

      {/* ── Perks grid ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold mb-2">Everything included in Pro Viewrr</h2>
          <p className="text-muted-foreground">Eight ways Pro Viewrr puts you ahead of the competition.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {perks.map(({ icon: Icon, title, desc }, i) => (
            <div key={i} data-testid={`perk-card-${i}`}
              className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-all hover:shadow-md">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-colors"
                style={{ background: "linear-gradient(135deg, #FF5A1F18, #FFA50018)" }}>
                <Icon size={18} style={{ color: "#FF5A1F" }} />
              </div>
              <h3 className="font-semibold text-sm mb-1.5">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Compare section ── */}
      <section className="border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-2xl font-bold text-center mb-10">Standard vs Pro Viewrr</h2>
          <div className="rounded-2xl border border-border overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-3 bg-muted/50">
              <div className="px-5 py-3 text-sm font-semibold text-muted-foreground">Feature</div>
              <div className="px-5 py-3 text-sm font-semibold text-center border-l border-border">Standard</div>
              <div className="px-5 py-3 text-sm font-semibold text-center border-l border-border"
                style={{ color: "#FF5A1F", background: "linear-gradient(135deg, #FF5A1F0A, #FFA5000A)" }}>
                <Crown size={12} className="inline mr-1" />Pro Viewrr
              </div>
            </div>
            {[
              ["Profile position on Browse Talent", "Sorted by rating", "Pinned to top ⭐"],
              ["AI Match weighting", "Standard", "Priority boost"],
              ["Landing page feature", "—", "Rotating feature"],
              ["Verified badge", "—", "Crown badge"],
              ["Profile analytics", "—", "Weekly stats"],
              ["Active enquiry limit", "5", "Unlimited"],
              ["Account verification", "—", "Manual review"],
              ["New enquiry notifications", "Email (24h delay)", "Instant"],
            ].map(([feature, standard, pro], i) => (
              <div key={i} className={`grid grid-cols-3 border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                <div className="px-5 py-3 text-sm">{feature}</div>
                <div className="px-5 py-3 text-sm text-center border-l border-border text-muted-foreground">{standard}</div>
                <div className="px-5 py-3 text-sm text-center border-l border-border font-medium"
                  style={{ color: "#FF5A1F", background: "linear-gradient(135deg, #FF5A1F06, #FFA50006)" }}>
                  {pro}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="mx-auto max-w-2xl px-6 py-20 text-center">
        <Sparkles size={32} className="mx-auto mb-4" style={{ color: "#FF5A1F" }} />
        <h2 className="text-2xl font-bold mb-3">Ready to stand out?</h2>
        <p className="text-muted-foreground mb-8">
          Join hundreds of top creatives who use Pro Viewrr to land more clients, faster.
        </p>
        {isAlreadyPro ? (
          <div className="flex items-center justify-center gap-2 text-sm font-semibold" style={{ color: "#FF5A1F" }}>
            <Check size={18} />
            You're already a Pro Viewrr — your profile leads the way.
          </div>
        ) : (
          <Button
            data-testid="btn-subscribe-pro-bottom"
            size="lg"
            className="text-white font-bold px-10 rounded-xl"
            style={{ background: "linear-gradient(135deg, #FF5A1F, #FF8C42)", boxShadow: "0 4px 20px #FF5A1F44" }}
            onClick={handleSubscribe}
            disabled={subscribeMutation.isPending}
          >
            <Crown size={16} className="mr-2" />
            Start Pro Viewrr — £49.99/mo
          </Button>
        )}
      </section>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
