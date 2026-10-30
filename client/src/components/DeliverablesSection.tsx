import { InvoiceComposer } from "@/components/invoice/InvoiceComposer";
import UploadedMedia from "@/components/UploadedMedia";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { InvoicePaymentForm } from "@/components/InvoicePaymentForm";
import { createPortal } from "react-dom";
import { MediaUpload } from "@/components/MediaUpload";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  X, ExternalLink, Play, Trash2, Plus, Upload, Link as LinkIcon,
  Lock, CheckCircle, CreditCard, ShieldCheck, Loader2, Sparkles, FileText, Eye, Banknote,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
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
    if (url.startsWith("/api/media/")) return {name:"Viewrr upload",color:"#FF5A1F",embedUrl:url,logo:"📁"};
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    const video = parseVideoUrl(url);
    if (video?.provider === "youtube") return { name: "YouTube", color: "#FF0000", embedUrl: video.embedUrl, logo: "🎬" };
    if (video?.provider === "vimeo") return { name: "Vimeo", color: "#1AB7EA", embedUrl: video.embedUrl, logo: "🎞️" };
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
// PRD-1 Decision 10: `GET /api/projects/:id/deliverables` now returns a GATED
// DTO. When the viewer is the client and the project is not paid, the server
// does not send `url` / `embedUrl` at all — so both are OPTIONAL here and every
// consumer must cope with their absence. Previews are separate encoded files.
interface Deliverable {
  id: number;
  label: string;
  platform: string;
  locked?: boolean;
  previewUrl?: string;
  url?: string;
  embedUrl?: string;
  lockReason?: "awaiting_payment";
  // Present only on the row echoed back by POST; never relied on for rendering.
  projectId?: number;
  createdBy?: number;
  createdAt?: string;
}

// ── Embed modal (with optional watermark) ─────────────────────────────────────
function EmbedModal({
  deliverable,
  watermarked,
  fullyRefunded = false,
  onClose,
}: {
  deliverable: Deliverable;
  watermarked: boolean;
  fullyRefunded?: boolean;
  onClose: () => void;
}) {
  // The URL may be absent entirely (locked server-side). `detectPlatform`
  // expects a string, so fall back to the stored platform label.
  const info = deliverable.url
    ? detectPlatform(deliverable.url)
    : { name: deliverable.platform || "Link", color: "#FF5A1F", embedUrl: null, logo: "\u{1F512}" };
  const isLocked = fullyRefunded || deliverable.locked === true || !deliverable.url;
  const preview = (isLocked || watermarked) ? deliverable.previewUrl : undefined;
  const uploaded = preview || (!isLocked && deliverable.url?.startsWith('/api/media/') ? deliverable.url : undefined);
  const video = !isLocked && deliverable.url ? parseVideoUrl(deliverable.url) : null;

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={deliverable.label}
      className="fixed inset-0 z-[9999] flex min-h-0 flex-col overflow-hidden bg-black/95"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="text-lg">{info.logo}</span>
          <div>
            <p className="font-semibold text-white text-sm">{deliverable.label}</p>
            <p className="text-xs text-white/70">{preview ? "Watermarked preview · Original available after payment" : `${info.name} · External provider access and sign-in may be required`}</p>
          </div>
          {isLocked ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(255,90,31,0.2)", color: "#FF5A1F", border: "1px solid rgba(255,90,31,0.4)" }}>
              <Lock size={9} /> {fullyRefunded ? "Delivery access withdrawn" : "Locked until payment"}
            </span>
          ) : preview ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(255,90,31,0.2)", color: "#FF5A1F", border: "1px solid rgba(255,90,31,0.4)" }}>
              <Lock size={9} /> Watermarked
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!isLocked && deliverable.url && (
            <a href={deliverable.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10">
              <ExternalLink size={13} /> Open original
            </a>
          )}
          <button aria-label="Close preview" onClick={onClose} className="text-white/60 hover:text-white hover:bg-white/10 rounded-lg p-1.5 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Embed + watermark */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {uploaded ? (
          <div className="absolute inset-0 flex items-center justify-center p-2 sm:p-4"><UploadedMedia key={uploaded} url={uploaded} title={deliverable.label} /></div>
        ) : !isLocked && video ? (
          <div className="absolute inset-0 flex items-center justify-center"><VideoEmbed url={deliverable.url!} className="w-full max-h-full" showBadge={false} /></div>
        ) : !isLocked && deliverable.embedUrl ? (
          <iframe src={deliverable.embedUrl} className="absolute inset-0 w-full h-full" allow="autoplay; fullscreen; picture-in-picture; clipboard-write" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" title={deliverable.label} style={{ border: "none" }} />
        ) : isLocked ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/60 text-center px-8">
            <Lock size={40} />
            <p className="text-sm font-semibold text-white">{fullyRefunded ? "Fully refunded — delivery access withdrawn." : "A review preview hasn’t been added yet"}</p>
            <p className="text-xs text-white/50 max-w-sm">
              {fullyRefunded
                ? "The original invoice and refund history remain available in the project."
                : "Ask your freelancer to add a review preview. The original file will unlock after Viewrr verifies payment."}
            </p>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/50">
            <LinkIcon size={40} />
            <p className="text-sm">This link can't be previewed directly.</p>
            {!isLocked && deliverable.url && (
              <a href={deliverable.url} target="_blank" rel="noopener noreferrer" className="text-[#FF5A1F] underline text-sm">Open in new tab</a>
            )}
          </div>
        )}
      </div>
    </div>, document.body
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
function PaymentSuccessScreen({
  amountPence,
  freelancerName,
  projectId,
  onDone,
  onViewInvoice,
}: {
  amountPence: number;
  freelancerName: string;
  projectId?: number;
  onDone: () => void;
  onViewInvoice?: () => void;
}) {
  const [show, setShow] = useState(false);
  const [, navigate] = useLocation();
  useEffect(() => { setTimeout(() => setShow(true), 50); }, []);
  return (
    <div className="relative flex flex-col items-center justify-center py-6 px-4 text-center overflow-hidden" style={{ minHeight: 360 }}>
      <ConfettiBurst />

      {/* Glowing ring */}
      <div
        className="relative flex items-center justify-center mb-4"
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
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">✓ Payment Confirmed</p>
        <p className="text-2xl font-bold mb-1">Payment confirmed.</p>
        <p className="text-sm text-muted-foreground leading-relaxed mb-1">
          Stripe has confirmed your payment of{" "}
          <span className="font-semibold text-foreground">£{(amountPence / 100).toFixed(2)}</span>.
        </p>
        <p className="text-xs text-muted-foreground">Earnings will be allocated to {freelancerName}'s Stripe balance. Arrival depends on Stripe and their bank.</p>
      </div>

      {/* Unlock pill */}
      <div
        className="mt-4 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
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

      {/* CTAs */}
      <div
        className="flex flex-col gap-2 w-full mt-5 px-4"
        style={{
          transition: "opacity 0.4s 0.5s, transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.5s",
          transform: show ? "translateY(0)" : "translateY(12px)",
          opacity: show ? 1 : 0,
        }}
      >
        <Button
          className="w-full rounded-full text-white font-semibold"
          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
          onClick={onDone}
        >
          Return to Project
        </Button>
        {onViewInvoice && (
          <Button
            variant="outline"
            className="w-full rounded-full font-medium"
            onClick={() => {
              onViewInvoice();
              if (projectId) navigate(`/invoice/${projectId}`);
            }}
          >
            View Invoice
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Invoice checkout (must be inside <Elements>) ────────────────────────────────
function InvoiceForm({ amountPence, projectId, clientEmail, onSuccess }: {
  amountPence: number;
  projectId: number;
  clientEmail: string;
  onSuccess: () => void;
}) {
  return <InvoicePaymentForm amountPence={amountPence} email={clientEmail}
    verify={async intentId => {
      const response = await apiRequest("POST", "/api/stripe/confirm-intent", { paymentIntentId: intentId, projectId });
      const result = await response.json();
      return result.ok === true && result.status === "succeeded";
    }}
    onPaid={() => { queryClient.invalidateQueries({ queryKey: ["/api/projects"] }); onSuccess(); }}
  />;
}

// ── Stripe Payment Dialog (full native experience) ─────────────────────────────
export function StripePaymentDialog({
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
  const [error, setError]         = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [paidAmountPence, setPaidAmountPence] = useState(0);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const stripePromiseRef = useRef<ReturnType<typeof loadStripe> | null>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep("amount");
        setError("");
        setClientSecret(""); setPublishableKey("");
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
    if (!clientUserId) { setError("Could not identify your account"); return; }
    setLoadingIntent(true);
    try {
      // FR-01: send only projectId + invoiceId — backend derives the amount
      // For backward compat when no invoiceId is available, fall back to legacy endpoint
      const res = await apiRequest("POST", "/api/stripe/create-payment-intent", {
        projectId, clientUserId,
        // Do NOT send amountPence — server derives it from the invoice
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not initialise payment");
      }
      const data = await res.json();
      setClientSecret(data.clientSecret);
      setPublishableKey(data.publishableKey);
      // Use server-derived amount (not client-entered)
      const serverAmountPence = data.amountPence;
      if (!Number.isSafeInteger(serverAmountPence) || serverAmountPence <= 0) throw new Error("The invoice amount is unavailable. Reopen the invoice.");
      setPaidAmountPence(serverAmountPence);
      // Pre-load Stripe immediately
      stripePromiseRef.current = loadStripe(data.publishableKey);
      setStep("card");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoadingIntent(false);
    }
  }

  const isDismissable = true; // Closing does not cancel or confirm a payment.

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && isDismissable) onClose(); }}>
      <DialogContent
        className="p-0 flex flex-col"
        style={{ maxWidth: 420, borderRadius: 24, maxHeight: "90vh", overflow: "hidden" }}
      >
        {/* ── Step: Amount (server-derives amount — FR-01) ── */}
        {step === "amount" && (
          <div className="px-6 py-4 space-y-5">
            {/* Summary header */}
            <div className="flex items-center gap-3 pb-3 border-b border-border">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,90,31,0.1)" }}>
                <Banknote size={17} style={{ color: "#FF5A1F" }} />
              </div>
              <div>
                <p className="text-sm font-semibold">{projectTitle}</p>
                <p className="text-xs text-muted-foreground">Paying {freelancerName}</p>
              </div>
            </div>

            {/* Amount is fixed by the invoice — not editable by client (FR-01) */}
            <div
              className="flex items-center justify-between px-4 py-3 rounded-2xl"
              style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.2)" }}
            >
              <span className="text-xs text-muted-foreground font-medium">Invoice total</span>
              <span className="text-lg font-bold" style={{ color: "#FF5A1F" }}>
                {agreedAmountPence ? `£${(agreedAmountPence / 100).toFixed(2)}` : "Loading…"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              This amount is confirmed by the agreed invoice and verified by Viewrr.
            </p>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <Button
              onClick={handleAmountContinue}
              disabled={loadingIntent || !agreedAmountPence}
              className="w-full rounded-full text-white font-semibold"
              style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
              data-testid="btn-continue-to-card"
            >
              {loadingIntent ? <><Loader2 size={14} className="animate-spin mr-2" />Setting up payment…</> : "Continue to payment"}
            </Button>
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
                <p className="text-sm font-semibold">Payment method</p>
                <p className="text-xs text-muted-foreground">£{(paidAmountPence / 100).toFixed(2)} · {freelancerName}</p>
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
                <InvoiceForm
                  amountPence={paidAmountPence}
                  projectId={projectId}
                  clientEmail={clientEmail}
                  onSuccess={() => setStep("success")}
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
            projectId={projectId}
            onDone={() => { onPaymentDone?.(); onClose(); }}
            onViewInvoice={() => { onPaymentDone?.(); onClose(); }}
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
  projectStatus?: string;
  paymentStatus?: string;
  projectTitle?: string;
  freelancerName?: string;
  clientId?: number;
  clientName?: string;
  clientEmail?: string;
  agreedAmountPence?: number;
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
  clientName: clientNameProp,
  clientEmail: clientEmailProp,
  agreedAmountPence,
  onPaymentConfirmed,
}: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showAdd, setShowAdd] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [previewUploadUrl, setPreviewUploadUrl] = useState("");
  const [previewTarget, setPreviewTarget] = useState<Deliverable | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [labelInput, setLabelInput] = useState(LABEL_OPTIONS[0]);
  const [customLabel, setCustomLabel] = useState("");
  const [embedTarget, setEmbedTarget] = useState<Deliverable | null>(null);
  const [urlError, setUrlError] = useState("");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  // Invoice state
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  // The server decides original access; this chooses the freelancer review copy.
  const isWatermarked = projectStatus === "awaiting_payment" && paymentStatus !== "paid";
  const isClient = !isFreelancer;

  const { data: deliverables = [] } = useQuery<Deliverable[]>({
    queryKey: ["/api/projects", projectId, "deliverables"],
    queryFn: async () => {
      // Must go through apiRequest: the route is requireAuth-guarded and
      // apiRequest is what attaches API_BASE and `credentials: "include"`. A
      // bare same-origin fetch 401s on a split-origin deploy.
      const res = await apiRequest("GET", `/api/projects/${projectId}/deliverables`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  // Server-decided lock state, used for the payment prompt so the prompt cannot
  // drift from what the server actually withheld.
  const hasLockedFiles = deliverables.some(d => d.locked === true || !d.url);

  const { data: existingInvoice } = useQuery<{ invoice: any; template: any; refunds?: { status: string; amount_pence: number }[] } | null>({
    queryKey: ['/api/projects', projectId, 'invoice'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/projects/${projectId}/invoice`);
      if (res.status === 404) return null;
      return res.json();
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: true,
  });
  const refundedPence = (existingInvoice?.refunds ?? [])
    .filter(refund => refund.status === "succeeded")
    .reduce((sum, refund) => sum + Number(refund.amount_pence), 0);
  const invoiceTotal = Number(existingInvoice?.invoice?.totalPence ?? 0);
  const fullyRefunded = invoiceTotal > 0 && refundedPence >= invoiceTotal;

  useEffect(() => {
    if (fullyRefunded) setPaymentDialogOpen(false);
  }, [fullyRefunded]);

  const addMutation = useMutation({
    mutationFn: async () => {
      const info = detectPlatform(urlInput.trim());
      const finalLabel = labelInput === "Other" ? customLabel.trim() : labelInput;
      // POST is now requireAuth + project-party guarded, so it must carry the
      // session (apiRequest sets API_BASE + credentials). `createdBy` is
      // ignored server-side — it comes from the session.
      const res = await apiRequest("POST", `/api/projects/${projectId}/deliverables`, {
        url: urlInput.trim(),
        label: finalLabel,
        platform: info.name,
        embedUrl: info.embedUrl ?? urlInput.trim(),
        ...(previewUploadUrl ? { previewUploadUrl } : {}),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onError: () => setUrlError("Could not share this delivery. Please try again."),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "deliverables"] });
      setUrlInput(""); setPreviewUploadUrl(""); setLabelInput(LABEL_OPTIONS[0]); setCustomLabel("");
      setShowAdd(false); setUrlError("");
      // Auto-open Send Invoice dialog after sharing work
      if (isFreelancer && !existingInvoice) {
        setInvoiceOpen(true);
      }
    },
  });

  const attachPreviewMutation = useMutation({
    mutationFn: async () => {
      if (!previewTarget || !attachmentUrl) throw new Error("Choose a preview file first.");
      await apiRequest("PATCH", `/api/projects/${projectId}/deliverables/${previewTarget.id}/preview`, { previewUploadUrl: attachmentUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "deliverables"] });
      setPreviewTarget(null); setAttachmentUrl("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/deliverables/${id}`, { userId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "deliverables"] }),
  });

  // (legacy confirm-payment mutation removed — now handled by Stripe dialog)

  function handleAdd() {
    setUrlError("");
    if (!urlInput.trim()) { setUrlError("Please paste a link"); return; }
    try { new URL(urlInput.trim(), window.location.origin); } catch { setUrlError("That doesn't look like a valid URL"); return; }
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
              <Plus size={12} /> Upload work
            </Button>
          )}
        </div>

        {isFreelancer && !existingInvoice && <Button variant="outline" size="sm" onClick={() => setInvoiceOpen(true)}><FileText size={14} /> Create invoice</Button>}
        {existingInvoice && <Button variant="outline" size="sm" onClick={() => setLocation(`/invoice/${projectId}`)}><FileText size={14} /> View invoice and refund history</Button>}
        {fullyRefunded && (
          <div className="rounded-2xl p-4 border border-border bg-secondary/30" role="status">
            <p className="text-sm font-semibold">Fully refunded — delivery access withdrawn.</p>
            <p className="text-xs text-muted-foreground mt-1">The original invoice and refund history remain available above.</p>
          </div>
        )}
        {/* ── Client: awaiting payment banner ───────────────────────────────── */}
        {isClient && !fullyRefunded && (isWatermarked || hasLockedFiles) && deliverables.length > 0 && (
          <div className="space-y-2">
            <div
              className="rounded-2xl p-4 flex items-center gap-3 border"
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
            </div>
            {existingInvoice ? (
              <div className="flex flex-col gap-2 px-1">
                <Button
                  className="w-full text-white rounded-xl gap-2 font-semibold text-sm h-10"
                  style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                  onClick={() => setLocation(`/invoice/${projectId}`)}
                  data-testid="btn-view-invoice"
                >
                  <FileText size={14} /> View &amp; Pay Invoice
                </Button>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
                  disabled={!existingInvoice} onClick={() => setPaymentDialogOpen(true)}
                >
                  Open payment options
                </button>
              </div>
            ) : (
              <Button
                className="w-full text-white rounded-xl gap-2 font-semibold text-sm h-10"
                style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                disabled={!existingInvoice} onClick={() => setPaymentDialogOpen(true)}
              >
                <FileText size={14} /> Waiting for the freelancer’s invoice
              </Button>
            )}
          </div>
        )}

        {/* ── Freelancer: awaiting payment status ───────────────────────────── */}
        {isFreelancer && !fullyRefunded && isWatermarked && deliverables.length > 0 && (
          <div
            className="rounded-2xl p-3.5 flex items-center gap-3 border"
            style={{ background: "rgba(255,90,31,0.06)", borderColor: "rgba(255,90,31,0.2)" }}
          >
            <ShieldCheck size={16} style={{ color: "#FF5A1F" }} className="flex-shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed flex-1">
              Your client can review attached watermarked previews. Original files and final links unlock after Viewrr verifies payment.
            </p>
            {existingInvoice && (
              <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
                <CheckCircle size={11} /> Invoice sent
              </span>
            )}
          </div>
        )}

        {/* ── Completed: released banner ─────────────────────────────────────── */}
        {projectStatus === "completed" && !fullyRefunded && !hasLockedFiles && deliverables.length > 0 && (
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
          <div className="rounded-2xl border border-border bg-background p-4 space-y-4 shadow-sm">
            <p className="text-xs font-semibold text-foreground">Share work for review</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Add a file, choose a label, then share it with your client.
            </p>
            <MediaUpload scope="delivery" projectId={projectId} onUploaded={url=>{setPreviewUploadUrl(url);setUrlInput(current => /^https:\/\//.test(current.trim()) ? current : url);setUrlError("");}} />
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground"><span className="h-px flex-1 bg-border" />Final delivery link (optional)<span className="h-px flex-1 bg-border" /></div>
            <Input value={urlInput} onChange={e => { setUrlInput(e.target.value); setUrlError(""); }} placeholder="https://vimeo.com/… or drive.google.com/…" className="text-sm h-9" />
            {urlInput.trim() && (() => {
              try {
                new URL(urlInput.trim(), window.location.origin);
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
            <p className="text-xs text-muted-foreground">Uploaded files get a watermarked review copy. For a hosted final link, upload a preview file above as well.</p>
            {previewUploadUrl && <p className="text-xs text-green-600">Review preview ready.</p>}
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
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => { setShowAdd(false); setUrlInput(""); setPreviewUploadUrl(""); setUrlError(""); }}>Cancel</Button>
              <Button size="sm" className="flex-1 text-xs text-white" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }} onClick={handleAdd} disabled={addMutation.isPending}>
                <Upload size={12} className="mr-1.5" />{addMutation.isPending ? "Sharing…" : "Share"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Deliverables list ──────────────────────────────────────────────── */}
        {deliverables.length === 0 && !showAdd ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center space-y-1.5">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto">
              <FileText size={18} className="text-muted-foreground opacity-40" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {isFreelancer ? "No files shared yet." : "No files uploaded yet."}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isFreelancer
                ? "Upload work above for a watermarked preview, or share an external link."
                : `${"Stage"} ${"One"} hasn't started yet. Once your freelancer uploads work, it will appear here.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {deliverables.map(d => {
              // PRD-1 Decision 10: `url` is absent when the server locked the
              // row, so platform detection falls back to the stored label.
              const info = d.url
                ? detectPlatform(d.url)
                : { name: d.platform || "Link", color: "#FF5A1F", embedUrl: null, logo: "\u{1F512}" };
              const rowLocked = d.locked === true || !d.url;
              return (
                <div key={d.id} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 group">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${info.color}18` }}>
                    {info.logo}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{d.label}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{info.name}{d.createdAt ? ` · ${timeAgo(d.createdAt)}` : ""}</p>
                      {rowLocked ? (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: "#FF5A1F" }}>
                          <Lock size={8} /> {fullyRefunded ? "Delivery access withdrawn" : "Locked until payment"}
                        </span>
                      ) : isWatermarked && d.previewUrl ? (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: "#FF5A1F" }}>
                          <Lock size={8} /> Watermarked
                        </span>
                      ) : null}
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
                    {isFreelancer && d.createdBy === userId && !d.previewUrl && !["completed", "cancelled"].includes(projectStatus) && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setPreviewTarget(d); setAttachmentUrl(""); attachPreviewMutation.reset(); }}>Add preview</Button>
                    )}
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
        {isClient && !fullyRefunded && isWatermarked && deliverables.length > 2 && (
          existingInvoice ? (
            <div className="flex flex-col gap-1.5 mt-1">
              <Button
                className="w-full text-white rounded-xl gap-2 font-semibold text-sm h-10"
                style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                onClick={() => setLocation(`/invoice/${projectId}`)}
              >
                <FileText size={14} /> View &amp; Pay Invoice
              </Button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
                disabled={!existingInvoice} onClick={() => setPaymentDialogOpen(true)}
              >
                Open payment options
              </button>
            </div>
          ) : (
            <Button
              className="w-full text-white rounded-xl gap-2 font-semibold mt-1 text-sm h-10"
              style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
              disabled={!existingInvoice} onClick={() => setPaymentDialogOpen(true)}
            >
              <FileText size={14} /> Waiting for the freelancer’s invoice
            </Button>
          )
        )}
      </div>

      <Dialog open={!!previewTarget} onOpenChange={open => { if (!open && !attachPreviewMutation.isPending) setPreviewTarget(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Add review preview</DialogTitle><DialogDescription>Upload a copy of this delivery. Your client can review a watermarked version before payment; the final link stays protected.</DialogDescription></DialogHeader>
          {previewTarget && <MediaUpload key={previewTarget.id} scope="delivery" projectId={projectId} onUploaded={setAttachmentUrl} />}
          {attachmentUrl && <p className="text-sm text-muted-foreground">Preview ready to attach.</p>}
          {attachPreviewMutation.isError && <p role="alert" className="text-sm text-destructive">Could not attach this preview. Please try again.</p>}
          <Button disabled={!attachmentUrl || attachPreviewMutation.isPending} onClick={() => attachPreviewMutation.mutate()}>{attachPreviewMutation.isPending ? "Attaching…" : "Attach preview"}</Button>
        </DialogContent>
      </Dialog>

      {/* ── Embed viewer ────────────────────────────────────────────────────── */}
      {embedTarget && (
        <EmbedModal
          deliverable={deliverables.find(d => d.id === embedTarget.id) ?? embedTarget}
          watermarked={isWatermarked}
          fullyRefunded={isClient && fullyRefunded}
          onClose={() => setEmbedTarget(null)}
        />
      )}

      {/* ── Stripe payment dialog ─────────────────────────────────────────── */}
      <StripePaymentDialog
        open={paymentDialogOpen && !fullyRefunded}
        projectId={projectId}
        projectTitle={projectTitle}
        freelancerName={freelancerName}
        clientUserId={clientId}
        agreedAmountPence={existingInvoice?.invoice?.totalPence ?? agreedAmountPence}
        onClose={() => setPaymentDialogOpen(false)}
        onPaymentDone={() => {
          setPaymentDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/projects", userId] });
          onPaymentConfirmed?.();
        }}
      />

      {isFreelancer && <InvoiceComposer open={invoiceOpen} onClose={() => setInvoiceOpen(false)}
        projectId={projectId} projectTitle={projectTitle} clientName={clientNameProp} clientEmail={clientEmailProp} agreedAmountPence={agreedAmountPence}
        onSent={() => {setInvoiceOpen(false);toast({title:'Invoice sent',description:'Your client can now view and pay this invoice.'});setLocation(`/invoice/${projectId}`);}} />}
    </>
  );
}
