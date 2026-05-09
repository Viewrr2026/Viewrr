import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X, ExternalLink, Play, Trash2, Plus, Upload, Link as LinkIcon,
  Lock, CheckCircle, CreditCard, ShieldCheck, Loader2, Sparkles,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

// ── Platform detection ────────────────────────────────────────────────────────
interface PlatformInfo {
  name: string;
  color: string;
  embedUrl: string | null;
  logo: string;
}

function detectPlatform(url: string): PlatformInfo {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    if (host.includes("youtube.com") || host === "youtu.be") {
      let id = u.searchParams.get("v");
      if (!id && host === "youtu.be") id = u.pathname.slice(1);
      if (!id) { const m = u.pathname.match(/\/embed\/([^/?]+)/); if (m) id = m[1]; }
      return { name: "YouTube", color: "#FF0000", embedUrl: id ? `https://www.youtube.com/embed/${id}?rel=0&autoplay=0` : null, logo: "🎬" };
    }
    if (host.includes("vimeo.com")) {
      const m = u.pathname.match(/\/(\d+)/);
      return { name: "Vimeo", color: "#1AB7EA", embedUrl: m?.[1] ? `https://player.vimeo.com/video/${m[1]}?title=0&byline=0` : null, logo: "🎞️" };
    }
    if (host.includes("drive.google.com")) {
      const m = u.pathname.match(/\/d\/([^/]+)/);
      return { name: "Google Drive", color: "#4285F4", embedUrl: m?.[1] ? `https://drive.google.com/file/d/${m[1]}/preview` : null, logo: "📁" };
    }
    if (host.includes("docs.google.com")) {
      const isSheet = u.pathname.includes("/spreadsheets/");
      const isSlides = u.pathname.includes("/presentation/");
      const m = u.pathname.match(/\/d\/([^/]+)/);
      const type = isSlides ? "presentation" : isSheet ? "spreadsheets" : "document";
      return { name: isSlides ? "Google Slides" : isSheet ? "Google Sheets" : "Google Docs", color: "#4285F4", embedUrl: m?.[1] ? `https://docs.google.com/${type}/d/${m[1]}/preview` : null, logo: isSlides ? "📊" : isSheet ? "📈" : "📄" };
    }
    if (host.includes("dropbox.com")) {
      return { name: "Dropbox", color: "#0061FF", embedUrl: url.replace("?dl=0","?raw=1").replace("dl=0","raw=1"), logo: "📦" };
    }
    if (host.includes("frame.io") || host.includes("app.frame.io")) {
      return { name: "Frame.io", color: "#FF6B35", embedUrl: url, logo: "🎥" };
    }
    if (host.includes("figma.com")) {
      return { name: "Figma", color: "#F24E1E", embedUrl: `https://www.figma.com/embed?embed_host=viewrr&url=${encodeURIComponent(url)}`, logo: "🎨" };
    }
    return { name: host, color: "#FF5A1F", embedUrl: url, logo: "🔗" };
  } catch {
    return { name: "Link", color: "#FF5A1F", embedUrl: null, logo: "🔗" };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Deliverable {
  id: number;
  projectId: number;
  url: string;
  label: string;
  platform: string;
  embedUrl: string;
  createdBy: number;
  createdAt: string;
}

// ── Watermark overlay ─────────────────────────────────────────────────────────
function WatermarkLayer() {
  return (
    <div
      className="absolute inset-0 pointer-events-none select-none z-10 flex items-center justify-center overflow-hidden"
      aria-hidden
    >
      {/* Diagonal repeating watermark text */}
      <div className="absolute inset-0 opacity-[0.18]" style={{
        backgroundImage: `repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 60px,
          rgba(255,90,31,0.15) 60px,
          rgba(255,90,31,0.15) 61px
        )`,
      }} />
      {/* Centre stamp */}
      <div
        className="flex flex-col items-center gap-1.5 px-5 py-3 rounded-2xl border-2"
        style={{
          background: "rgba(0,0,0,0.55)",
          borderColor: "rgba(255,90,31,0.6)",
          backdropFilter: "blur(2px)",
        }}
      >
        <Lock size={18} style={{ color: "#FF5A1F" }} />
        <p className="text-white text-xs font-bold tracking-wide uppercase">Watermarked preview</p>
        <p className="text-white/60 text-[10px] text-center leading-relaxed">
          Final files released after payment
        </p>
      </div>
      {/* Tiled text watermarks */}
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className="absolute text-[10px] font-bold uppercase tracking-widest"
          style={{
            color: "rgba(255,90,31,0.25)",
            top: `${(i % 4) * 26 + 5}%`,
            left: `${Math.floor(i / 4) * 36 + 5}%`,
            transform: "rotate(-35deg)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          Viewrr · Pending Payment
        </span>
      ))}
    </div>
  );
}

// ── Embed modal (with optional watermark) ─────────────────────────────────────
function EmbedModal({
  deliverable,
  watermarked,
  onClose,
}: {
  deliverable: Deliverable;
  watermarked: boolean;
  onClose: () => void;
}) {
  const info = detectPlatform(deliverable.url);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-black/95"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg">{info.logo}</span>
          <div>
            <p className="font-semibold text-white text-sm">{deliverable.label}</p>
            <p className="text-xs text-white/50">{info.name}</p>
          </div>
          {watermarked && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(255,90,31,0.2)", color: "#FF5A1F", border: "1px solid rgba(255,90,31,0.4)" }}>
              <Lock size={9} /> Watermarked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a href={deliverable.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10">
            <ExternalLink size={13} /> Open original
          </a>
          <button onClick={onClose} className="text-white/60 hover:text-white hover:bg-white/10 rounded-lg p-1.5 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Embed + watermark */}
      <div className="flex-1 relative">
        {deliverable.embedUrl ? (
          <iframe
            src={deliverable.embedUrl}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            title={deliverable.label}
            style={{ border: "none" }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/50">
            <LinkIcon size={40} />
            <p className="text-sm">This link can't be previewed directly.</p>
            <a href={deliverable.url} target="_blank" rel="noopener noreferrer" className="text-[#FF5A1F] underline text-sm">Open in new tab</a>
          </div>
        )}
        {watermarked && <WatermarkLayer />}
      </div>
    </div>
  );
}

// ── Confetti burst ─────────────────────────────────────────────────────────────
function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const pieces = Array.from({ length: 80 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * 60,
      y: canvas.height * 0.35,
      vx: (Math.random() - 0.5) * 12,
      vy: -(Math.random() * 10 + 5),
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 8,
      size: Math.random() * 8 + 4,
      color: ["#FF5A1F","#FF8C42","#FFD700","#ffffff","#FFA500","#FF6B6B","#4ECDC4"][Math.floor(Math.random()*7)],
      alpha: 1,
      shape: Math.random() > 0.5 ? "rect" : "circle",
    }));
    let raf: number;
    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      let alive = false;
      pieces.forEach(p => {
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.35;
        p.vx *= 0.99;
        p.rot += p.rotV;
        p.alpha -= 0.012;
        if (p.alpha <= 0) return;
        alive = true;
        ctx!.save();
        ctx!.globalAlpha = Math.max(0, p.alpha);
        ctx!.fillStyle = p.color;
        ctx!.translate(p.x, p.y);
        ctx!.rotate((p.rot * Math.PI) / 180);
        if (p.shape === "circle") {
          ctx!.beginPath();
          ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx!.fill();
        } else {
          ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx!.restore();
      });
      if (alive) raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ── Payment success screen ─────────────────────────────────────────────────────
function PaymentSuccessScreen({ amountPence, freelancerName, onDone }: {
  amountPence: number;
  freelancerName: string;
  onDone: () => void;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => { setTimeout(() => setShow(true), 50); }, []);
  return (
    <div className="relative flex flex-col items-center justify-center py-6 px-4 text-center overflow-hidden" style={{ minHeight: 320 }}>
      <ConfettiBurst />
      {/* Glowing ring */}
      <div
        className="relative flex items-center justify-center mb-5"
        style={{
          transition: "transform 0.6s cubic-bezier(0.34,1.56,0.64,1), opacity 0.4s",
          transform: show ? "scale(1)" : "scale(0.4)",
          opacity: show ? 1 : 0,
        }}
      >
        <div className="absolute w-24 h-24 rounded-full animate-ping" style={{ background: "rgba(255,90,31,0.15)", animationDuration: "1.5s" }} />
        <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)", boxShadow: "0 0 40px rgba(255,90,31,0.5)" }}>
          <CheckCircle size={36} className="text-white" strokeWidth={2.5} />
        </div>
      </div>

      {/* Text */}
      <div
        style={{
          transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.15s, opacity 0.4s 0.15s",
          transform: show ? "translateY(0)" : "translateY(16px)",
          opacity: show ? 1 : 0,
        }}
      >
        <p className="text-2xl font-bold mb-1">Payment sent!</p>
        <p className="text-sm text-muted-foreground leading-relaxed mb-1">
          <span className="font-semibold text-foreground">£{(amountPence / 100).toFixed(2)}</span> is on its way to {freelancerName}.
        </p>
        <p className="text-xs text-muted-foreground">The watermark has been removed — your files are fully released.</p>
      </div>

      {/* Unlock pill */}
      <div
        className="mt-5 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
        style={{
          background: "rgba(34,197,94,0.12)", color: "#16a34a",
          border: "1px solid rgba(34,197,94,0.3)",
          transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.3s, opacity 0.4s 0.3s",
          transform: show ? "translateY(0)" : "translateY(12px)",
          opacity: show ? 1 : 0,
        }}
      >
        <Sparkles size={12} /> Files unlocked
      </div>

      <Button
        className="mt-6 rounded-full px-8 text-white font-semibold"
        style={{
          background: "linear-gradient(135deg,#FF5A1F,#FF8C42)",
          transition: "opacity 0.4s 0.5s, transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.5s",
          transform: show ? "translateY(0)" : "translateY(12px)",
          opacity: show ? 1 : 0,
        }}
        onClick={onDone}
      >
        Done
      </Button>
    </div>
  );
}

// ── Inner card form (must be inside <Elements>) ────────────────────────────────
function CardForm({
  amountPence,
  projectId,
  clientUserId,
  clientEmail,
  paymentIntentId,
  onSuccess,
  onError,
}: {
  amountPence: number;
  projectId: number;
  clientUserId: number | undefined;
  clientEmail: string;
  paymentIntentId: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const stripe    = useStripe();
  const elements  = useElements();
  const [paying, setPaying] = useState(false);
  const [ready,  setReady]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
          payment_method_data: {
            billing_details: { email: clientEmail },
          },
        },
        redirect: "if_required",
      });
      if (error) {
        onError(error.message || "Payment failed");
        setPaying(false);
        return;
      }
      if (paymentIntent?.status === "succeeded") {
        // Confirm on backend
        const res = await apiRequest("POST", "/api/stripe/confirm-intent", {
          paymentIntentId,
          projectId,
          clientUserId,
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          onError(b.error || "Payment confirmed but failed to update project");
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
        onSuccess();
      } else {
        onError("Payment was not completed. Please try again.");
        setPaying(false);
      }
    } catch (e: any) {
      onError(e.message || "Something went wrong");
      setPaying(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Summary pill */}
      <div className="flex items-center justify-between px-4 py-3 rounded-2xl" style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.2)" }}>
        <span className="text-xs text-muted-foreground font-medium">Total due</span>
        <span className="text-lg font-bold" style={{ color: "#FF5A1F" }}>£{(amountPence / 100).toFixed(2)}</span>
      </div>

      {/* Stripe card element */}
      <div
        className="rounded-2xl overflow-hidden border border-border transition-all"
        style={{ opacity: ready ? 1 : 0.4, transition: "opacity 0.3s" }}
      >
        <PaymentElement
          onReady={() => setReady(true)}
          options={{
            layout: "tabs",
            fields: { billingDetails: { name: "auto", email: "never" } },
            terms: { card: "never" },
          }}
        />
      </div>

      {/* Security badge */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck size={11} className="text-primary" />
        Secured by Stripe · 256-bit encryption
      </div>

      <button
        type="submit"
        disabled={paying || !ready}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-full font-semibold text-white text-sm transition-all"
        style={{
          background: paying || !ready ? "rgba(255,90,31,0.4)" : "linear-gradient(135deg,#FF5A1F,#FF8C42)",
          boxShadow: paying || !ready ? "none" : "0 4px 20px rgba(255,90,31,0.35)",
          cursor: paying || !ready ? "not-allowed" : "pointer",
          transform: paying ? "scale(0.98)" : "scale(1)",
          transition: "all 0.2s cubic-bezier(0.16,1,0.3,1)",
        }}
        data-testid="btn-pay-now"
      >
        {paying
          ? <><Loader2 size={15} className="animate-spin" /> Processing payment…</>
          : <><CreditCard size={15} /> Pay £{(amountPence / 100).toFixed(2)} now</>}
      </button>
    </form>
  );
}

// ── Stripe Payment Dialog (full native experience) ─────────────────────────────
function StripePaymentDialog({
  open,
  projectId,
  projectTitle,
  freelancerName,
  clientUserId,
  agreedAmountPence,
  onClose,
  onPaymentDone,
}: {
  open: boolean;
  projectId: number;
  projectTitle: string;
  freelancerName: string;
  clientUserId: number | undefined;
  agreedAmountPence?: number;
  onClose: () => void;
  onPaymentDone?: () => void;
}) {
  const { user } = useAuth();
  const clientEmail = user?.email ?? "";

  type Step = "amount" | "card" | "success";
  const [step, setStep]         = useState<Step>("amount");
  // Pre-fill with agreed amount if available
  const [amountStr, setAmountStr] = useState(
    agreedAmountPence ? (agreedAmountPence / 100).toFixed(2) : ""
  );
  const [error, setError]         = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [paymentIntentId, setPaymentIntentId] = useState("");
  const [paidAmountPence, setPaidAmountPence] = useState(0);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const stripePromiseRef = useRef<ReturnType<typeof loadStripe> | null>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep("amount");
        setAmountStr(agreedAmountPence ? (agreedAmountPence / 100).toFixed(2) : "");
        setError("");
        setClientSecret(""); setPublishableKey(""); setPaymentIntentId("");
      }, 300);
    }
  }, [open, agreedAmountPence]);

  // Load Stripe instance lazily when key is known
  useEffect(() => {
    if (publishableKey && !stripePromiseRef.current) {
      stripePromiseRef.current = loadStripe(publishableKey);
    }
  }, [publishableKey]);

  async function handleAmountContinue() {
    setError("");
    const pounds = parseFloat(amountStr);
    if (!amountStr.trim() || isNaN(pounds)) { setError("Please enter an amount"); return; }
    if (pounds < 0.50) { setError("Minimum is £0.50"); return; }
    if (!clientUserId) { setError("Could not identify your account"); return; }
    setLoadingIntent(true);
    try {
      const amountPence = Math.round(pounds * 100);
      const res = await apiRequest("POST", "/api/stripe/create-payment-intent", {
        projectId, amountPence, clientUserId,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not initialise payment");
      }
      const data = await res.json();
      setClientSecret(data.clientSecret);
      setPublishableKey(data.publishableKey);
      setPaymentIntentId(data.paymentIntentId);
      setPaidAmountPence(amountPence);
      // Pre-load Stripe immediately
      stripePromiseRef.current = loadStripe(data.publishableKey);
      setStep("card");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoadingIntent(false);
    }
  }

  const isDismissable = step !== "card";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && isDismissable) onClose(); }}>
      <DialogContent
        className="p-0 flex flex-col"
        style={{ maxWidth: 420, borderRadius: 24, maxHeight: "90vh", overflow: "hidden" }}
      >
        {/* ── Step: Amount ── */}
        {step === "amount" && (
          <div className="p-6 overflow-y-auto">
            {/* Header — no manual close button, DialogContent renders its own */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,90,31,0.1)" }}>
                <CreditCard size={20} style={{ color: "#FF5A1F" }} />
              </div>
              <div>
                <p className="font-bold text-base">Pay {freelancerName}</p>
                <p className="text-xs text-muted-foreground truncate max-w-[260px]">{projectTitle}</p>
              </div>
            </div>

            {/* Amount input */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-foreground mb-2 block">
                {agreedAmountPence ? "Project amount" : "Agreed amount"}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-light text-muted-foreground">£</span>
                <input
                  type="number"
                  min="0.50"
                  step="0.01"
                  placeholder="0.00"
                  value={amountStr}
                  onChange={e => { if (!agreedAmountPence) { setAmountStr(e.target.value); setError(""); } }}
                  onKeyDown={e => e.key === "Enter" && handleAmountContinue()}
                  className="w-full pl-10 pr-4 py-3.5 text-2xl font-semibold rounded-2xl border border-border bg-secondary/40 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    "--tw-ring-color": "rgba(255,90,31,0.4)",
                    cursor: agreedAmountPence ? "default" : "text",
                    opacity: agreedAmountPence ? 0.85 : 1,
                  } as any}
                  readOnly={!!agreedAmountPence}
                  disabled={loadingIntent}
                  data-testid="input-payment-amount"
                  autoFocus={!agreedAmountPence}
                />
              </div>
              {agreedAmountPence && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Amount set by project — cannot be changed
                </p>
              )}
              {error && (
                <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-destructive inline-block" />{error}
                </p>
              )}
            </div>

            {/* Trust badges */}
            <div className="flex items-center gap-3 mb-5">
              {[["🔒","Secure payment"],["⚡","Instant release"],["🏦","Stripe protected"]].map(([icon, label]) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-center" style={{ background: "rgba(255,90,31,0.05)", border: "1px solid rgba(255,90,31,0.1)" }}>
                  <span className="text-base">{icon}</span>
                  <span className="text-[10px] font-medium text-muted-foreground leading-tight">{label}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleAmountContinue}
              disabled={loadingIntent || !amountStr.trim()}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-semibold text-white text-sm"
              style={{
                background: loadingIntent || !amountStr.trim() ? "rgba(255,90,31,0.35)" : "linear-gradient(135deg,#FF5A1F,#FF8C42)",
                boxShadow: loadingIntent || !amountStr.trim() ? "none" : "0 4px 20px rgba(255,90,31,0.3)",
                cursor: loadingIntent || !amountStr.trim() ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
              data-testid="btn-continue-to-card"
            >
              {loadingIntent
                ? <><Loader2 size={15} className="animate-spin" /> Setting up payment…</>
                : <>Continue to payment →</>}
            </button>
          </div>
        )}

        {/* ── Step: Card ── */}
        {step === "card" && clientSecret && stripePromiseRef.current && (
          <div className="flex flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
            {/* Card header — back button only, DialogContent X handles close */}
            <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
              <button
                onClick={() => setStep("amount")}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary"
                title="Back"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12L4 7l5-5" />
                </svg>
              </button>
              <div className="flex-1 text-center">
                <p className="text-sm font-semibold">Card details</p>
                <p className="text-xs text-muted-foreground">£{parseFloat(amountStr).toFixed(2)} · {freelancerName}</p>
              </div>
              {/* Spacer to balance back button — DialogContent X is top-right */}
              <div className="w-7" />
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1">
              <Elements
                stripe={stripePromiseRef.current}
                options={{
                  clientSecret,
                  appearance: {
                    theme: "stripe",
                    variables: {
                      colorPrimary: "#FF5A1F",
                      colorBackground: "var(--background, #ffffff)",
                      colorText: "#1a1a1a",
                      colorDanger: "#dc2626",
                      fontFamily: "'Satoshi', system-ui, sans-serif",
                      borderRadius: "12px",
                      spacingUnit: "4px",
                    },
                    rules: {
                      ".Input": {
                        border: "1.5px solid #e5e7eb",
                        boxShadow: "none",
                        padding: "12px 14px",
                        fontSize: "14px",
                        transition: "border-color 0.15s",
                      },
                      ".Input:focus": {
                        border: "1.5px solid #FF5A1F",
                        boxShadow: "0 0 0 3px rgba(255,90,31,0.12)",
                        outline: "none",
                      },
                      ".Label": { fontSize: "11px", fontWeight: "600", letterSpacing: "0.05em", textTransform: "uppercase", color: "#6b7280" },
                      ".Tab": { border: "1.5px solid #e5e7eb", borderRadius: "10px" },
                      ".Tab--selected": { border: "1.5px solid #FF5A1F", boxShadow: "0 0 0 2px rgba(255,90,31,0.15)" },
                    },
                  },
                }}
              >
                <CardForm
                  amountPence={paidAmountPence}
                  projectId={projectId}
                  clientUserId={clientUserId}
                  clientEmail={clientEmail}
                  paymentIntentId={paymentIntentId}
                  onSuccess={() => setStep("success")}
                  onError={msg => setError(msg)}
                />
              </Elements>
              {error && (
                <p className="text-xs text-destructive mt-3 text-center">{error}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Step: Success ── */}
        {step === "success" && (
          <PaymentSuccessScreen
            amountPence={paidAmountPence}
            freelancerName={freelancerName}
            onDone={() => { onPaymentDone?.(); onClose(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────
interface Props {
  projectId: number;
  userId: number;
  isFreelancer: boolean;
  projectStatus?: string;       // "active" | "awaiting_payment" | "completed"
  paymentStatus?: string;       // "unpaid" | "paid"
  projectTitle?: string;
  freelancerName?: string;
  clientId?: number;
  agreedAmountPence?: number;   // pre-fills and locks the payment amount
  onPaymentConfirmed?: () => void;
}

const LABEL_OPTIONS = ["Draft cut", "Final files", "Assets", "Presentation", "Feedback request", "Other"];

export default function DeliverablesSection({
  projectId, userId, isFreelancer,
  projectStatus = "active",
  paymentStatus = "unpaid",
  projectTitle = "this project",
  freelancerName = "the freelancer",
  clientId,
  agreedAmountPence,
  onPaymentConfirmed,
}: Props) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [labelInput, setLabelInput] = useState(LABEL_OPTIONS[0]);
  const [customLabel, setCustomLabel] = useState("");
  const [embedTarget, setEmbedTarget] = useState<Deliverable | null>(null);
  const [urlError, setUrlError] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Watermark is active when project is awaiting payment and not yet paid
  const isWatermarked = projectStatus === "awaiting_payment" && paymentStatus !== "paid";
  const isClient = !isFreelancer;

  const { data: deliverables = [] } = useQuery<Deliverable[]>({
    queryKey: ["/api/projects", projectId, "deliverables"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/deliverables`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const info = detectPlatform(urlInput.trim());
      const finalLabel = labelInput === "Other" ? customLabel.trim() : labelInput;
      const res = await fetch(`/api/projects/${projectId}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim(), label: finalLabel, platform: info.name, embedUrl: info.embedUrl ?? urlInput.trim(), createdBy: userId }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "deliverables"] });
      setUrlInput(""); setLabelInput(LABEL_OPTIONS[0]); setCustomLabel("");
      setShowAdd(false); setUrlError("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/deliverables/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "deliverables"] }),
  });

  // (legacy confirm-payment mutation removed — now handled by Stripe dialog)

  function handleAdd() {
    setUrlError("");
    if (!urlInput.trim()) { setUrlError("Please paste a link"); return; }
    try { new URL(urlInput.trim()); } catch { setUrlError("That doesn't look like a valid URL"); return; }
    if (labelInput === "Other" && !customLabel.trim()) { setUrlError("Please enter a label"); return; }
    addMutation.mutate();
  }

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const hrs = Math.floor(diff / 3600000);
    if (hrs < 1) return "just now";
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <>
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">
            Work Delivered
          </p>
          {isFreelancer && !showAdd && projectStatus !== "completed" && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus size={12} /> Share work
            </Button>
          )}
        </div>

        {/* ── Client: awaiting payment banner ───────────────────────────────── */}
        {isClient && isWatermarked && deliverables.length > 0 && (
          <div
            className="rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 border"
            style={{ background: "linear-gradient(135deg,rgba(255,90,31,0.08),rgba(255,140,66,0.06))", borderColor: "rgba(255,90,31,0.3)" }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,90,31,0.15)" }}>
              <Lock size={18} style={{ color: "#FF5A1F" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Work delivered — payment required</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Pay <span className="font-medium text-foreground">{freelancerName}</span> to remove the watermark and receive your files.
              </p>
            </div>
            <Button
              className="flex-shrink-0 text-white rounded-full gap-2 font-semibold text-xs"
              style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
              onClick={() => setPaymentDialogOpen(true)}
            >
              <CreditCard size={13} /> Pay {freelancerName} to unlock →
            </Button>
          </div>
        )}

        {/* ── Freelancer: awaiting payment status ───────────────────────────── */}
        {isFreelancer && isWatermarked && deliverables.length > 0 && (
          <div
            className="rounded-2xl p-3.5 flex items-center gap-3 border"
            style={{ background: "rgba(255,90,31,0.06)", borderColor: "rgba(255,90,31,0.2)" }}
          >
            <ShieldCheck size={16} style={{ color: "#FF5A1F" }} className="flex-shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your work is shared with a watermark. It will be fully released once the client confirms final payment.
            </p>
          </div>
        )}

        {/* ── Completed: released banner ─────────────────────────────────────── */}
        {projectStatus === "completed" && deliverables.length > 0 && (
          <div
            className="rounded-2xl p-3.5 flex items-center gap-3 border"
            style={{ background: "rgba(34,197,94,0.06)", borderColor: "rgba(34,197,94,0.25)" }}
          >
            <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
            <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed font-medium">
              Payment confirmed — final files fully released.
            </p>
          </div>
        )}

        {/* ── Add form (freelancer only) ─────────────────────────────────────── */}
        {isFreelancer && showAdd && (
          <div className="bg-secondary/40 rounded-xl p-4 space-y-3 border border-border">
            <p className="text-xs font-semibold text-foreground">Share a link to your work</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Paste a link from YouTube, Vimeo, Google Drive, Dropbox, Figma or Frame.io — the client will see it with a watermark until payment is confirmed.
            </p>
            <Input value={urlInput} onChange={e => { setUrlInput(e.target.value); setUrlError(""); }} placeholder="https://vimeo.com/… or drive.google.com/…" className="text-sm h-9" />
            {urlInput.trim() && (() => {
              try {
                new URL(urlInput.trim());
                const info = detectPlatform(urlInput.trim());
                return (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{info.logo}</span>
                    <span>Detected: <span className="font-semibold text-foreground">{info.name}</span></span>
                    {info.embedUrl ? <span className="text-green-500">· Embeds in Viewrr ✓</span> : <span className="text-amber-500">· Will open in new tab</span>}
                  </div>
                );
              } catch { return null; }
            })()}
            <div className="flex flex-wrap gap-2">
              {LABEL_OPTIONS.map(l => (
                <button key={l} onClick={() => setLabelInput(l)} className={`text-xs px-3 py-1 rounded-full border transition-colors ${labelInput === l ? "bg-[#FF5A1F] border-[#FF5A1F] text-white" : "border-border text-muted-foreground hover:border-[#FF5A1F] hover:text-foreground"}`}>{l}</button>
              ))}
            </div>
            {labelInput === "Other" && (
              <Input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="Custom label…" className="text-sm h-9" />
            )}
            {urlError && <p className="text-xs text-destructive">{urlError}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => { setShowAdd(false); setUrlInput(""); setUrlError(""); }}>Cancel</Button>
              <Button size="sm" className="flex-1 text-xs text-white" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} onClick={handleAdd} disabled={addMutation.isPending}>
                <Upload size={12} className="mr-1.5" />{addMutation.isPending ? "Sharing…" : "Share"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Deliverables list ──────────────────────────────────────────────── */}
        {deliverables.length === 0 && !showAdd ? (
          <p className="text-xs text-muted-foreground italic">
            {isFreelancer
              ? "Share a link to your work above — the client will see it with a watermark until payment is confirmed."
              : "The freelancer hasn't shared any work yet."}
          </p>
        ) : (
          <div className="space-y-2">
            {deliverables.map(d => {
              const info = detectPlatform(d.url);
              return (
                <div key={d.id} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 group">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${info.color}18` }}>
                    {info.logo}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{d.label}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{info.name} · {timeAgo(d.createdAt)}</p>
                      {isWatermarked && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: "#FF5A1F" }}>
                          <Lock size={8} /> Watermarked
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 text-white"
                      style={{ background: `linear-gradient(135deg,#FF5A1F,#FF8C42)` }}
                      onClick={() => setEmbedTarget(d)}
                    >
                      <Play size={11} fill="white" /> View
                    </Button>
                    {isFreelancer && d.createdBy === userId && projectStatus !== "completed" && (
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deleteMutation.mutate(d.id)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Client: bottom-of-list pay button (if they scrolled past banner) */}
        {isClient && isWatermarked && deliverables.length > 2 && (
          <Button
            className="w-full text-white rounded-full gap-2 font-semibold mt-1 text-xs"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
            onClick={() => setPaymentDialogOpen(true)}
          >
            <CreditCard size={13} /> Pay {freelancerName} to unlock →
          </Button>
        )}
      </div>

      {/* ── Embed viewer ────────────────────────────────────────────────────── */}
      {embedTarget && (
        <EmbedModal
          deliverable={embedTarget}
          watermarked={isWatermarked}
          onClose={() => setEmbedTarget(null)}
        />
      )}

      {/* ── Stripe payment dialog ─────────────────────────────────────────── */}
      <StripePaymentDialog
        open={paymentDialogOpen}
        projectId={projectId}
        projectTitle={projectTitle}
        freelancerName={freelancerName}
        clientUserId={clientId}
        agreedAmountPence={agreedAmountPence}
        onClose={() => setPaymentDialogOpen(false)}
        onPaymentDone={() => {
          setPaymentDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/projects", userId] });
          onPaymentConfirmed?.();
        }}
      />
    </>
  );
}
