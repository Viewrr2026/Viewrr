/**
 * PRD-011 — Payment Education & Transparency Centre
 * FR-01: Visual payment journey
 * FR-02: Stripe availability period explainer
 * FR-05: Interactive expandable stages
 * FR-06: Estimated arrival display
 */

import { useState } from "react";
import { CheckCircle2, Circle, Clock, ChevronDown, ChevronUp, Info, Calendar } from "lucide-react";

// ── Stage definitions ─────────────────────────────────────────────────────────

export type JourneyStage =
  | "client_paid"
  | "payment_confirmed"
  | "funds_allocated"
  | "stripe_availability"
  | "automatic_payout"
  | "bank_deposit";

export interface JourneyStep {
  key: JourneyStage;
  label: string;
  shortDesc: string;
  fullDesc: string;
  timestamp?: string | null;
  estimatedDate?: string | null;
}

const STAGE_ORDER: JourneyStage[] = [
  "client_paid",
  "payment_confirmed",
  "funds_allocated",
  "stripe_availability",
  "automatic_payout",
  "bank_deposit",
];

function buildSteps(
  paymentStatus: string,
  transferStatus?: string | null,
  payoutStatus?: string | null,
  timestamps?: {
    paid?: string | null;
    authorised?: string | null;
    transferred?: string | null;
    availableDate?: string | null;
    payoutArrival?: string | null;
  },
): JourneyStep[] {
  const s = paymentStatus ?? "pending";
  const ts = transferStatus ?? null;
  const ps = payoutStatus ?? null;
  const t = timestamps ?? {};

  const fmtDate = (iso?: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch { return null; }
  };

  return [
    {
      key: "client_paid",
      label: "Client Paid",
      shortDesc: "The client has submitted their payment.",
      fullDesc:
        "Your client has completed their payment through Viewrr's secure checkout. The funds have left the client's account and are being processed by Stripe.",
      timestamp: fmtDate(t.paid ?? t.authorised),
    },
    {
      key: "payment_confirmed",
      label: "Payment Confirmed",
      shortDesc: "Stripe has confirmed the payment was successful.",
      fullDesc:
        "Stripe has verified the payment and confirmed that the funds have cleared. Your Viewrr commission has been collected at this stage.",
      timestamp: fmtDate(t.authorised),
    },
    {
      key: "funds_allocated",
      label: "Funds Allocated",
      shortDesc: "Your earnings have been set aside inside Stripe.",
      fullDesc:
        "Stripe has allocated your earnings. The funds are inside your connected Stripe account and are waiting for the availability period to end before they can be sent to your bank.",
      timestamp: ts === "transferred" ? fmtDate(t.transferred) : null,
    },
    {
      key: "stripe_availability",
      label: "Waiting for Stripe Availability",
      shortDesc: "Stripe is holding the funds during a standard availability period.",
      fullDesc:
        "Your client has successfully paid. Your payment has already reached Stripe. Before Stripe sends money to your bank, it applies an availability period. This helps protect buyers and sellers against fraud and payment disputes. Once this period has ended, Stripe will automatically send your payment to your bank. You do not need to take any further action.",
      estimatedDate: t.availableDate ? `Funds available from ${fmtDate(t.availableDate)}` : null,
    },
    {
      key: "automatic_payout",
      label: "Automatic Payout",
      shortDesc: "Stripe has initiated your automatic bank payout.",
      fullDesc:
        "The availability period has ended and Stripe has automatically initiated a payout to your bank account. This happens automatically — you do not need to do anything.",
      timestamp: ps === "in_transit" || ps === "paid" ? fmtDate(t.payoutArrival) : null,
    },
    {
      key: "bank_deposit",
      label: "Bank Deposit",
      shortDesc: "Your earnings have arrived in your bank account.",
      fullDesc:
        "The funds have successfully arrived in your bank account. Processing times may vary between banks, but typically appear the same day as the payout is initiated.",
      estimatedDate: t.payoutArrival
        ? `Estimated arrival: ${fmtDate(t.payoutArrival)}`
        : null,
      timestamp: ps === "paid" ? fmtDate(t.payoutArrival) : null,
    },
  ];
}

function currentStageIndex(
  paymentStatus: string,
  transferStatus?: string | null,
  payoutStatus?: string | null,
): number {
  const s = paymentStatus;
  const ts = transferStatus;
  const ps = payoutStatus;

  if (ps === "paid") return 5; // bank_deposit
  if (ps === "in_transit" || ps === "pending") return 4; // automatic_payout
  if (ts === "transferred") return 3; // stripe_availability
  if (s === "succeeded") return 2; // funds_allocated
  if (s === "authorised" || s === "processing") return 1; // payment_confirmed
  return 0; // client_paid
}

// ── PaymentJourneyBar component ───────────────────────────────────────────────

interface PaymentJourneyBarProps {
  paymentStatus: string;
  transferStatus?: string | null;
  payoutStatus?: string | null;
  grossPence?: number;
  freelancerPence?: number;
  platformFeePence?: number;
  timestamps?: {
    paid?: string | null;
    authorised?: string | null;
    transferred?: string | null;
    availableDate?: string | null;
    payoutArrival?: string | null;
  };
  role?: "client" | "freelancer" | "founder";
  /** Compact mode — used inside tables/rows */
  compact?: boolean;
}

export function PaymentJourneyBar({
  paymentStatus,
  transferStatus,
  payoutStatus,
  grossPence,
  freelancerPence,
  platformFeePence,
  timestamps,
  role = "freelancer",
  compact = false,
}: PaymentJourneyBarProps) {
  const [expandedKey, setExpandedKey] = useState<JourneyStage | null>(null);
  const steps = buildSteps(paymentStatus, transferStatus, payoutStatus, timestamps);
  const activeIdx = currentStageIndex(paymentStatus, transferStatus, payoutStatus);
  const fmt = (p: number) =>
    `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (compact) {
    // Compact horizontal pill bar for table rows
    return (
      <div className="flex items-center gap-1">
        {steps.map((step, i) => {
          const done = i <= activeIdx;
          const active = i === activeIdx;
          return (
            <div
              key={step.key}
              className={`flex-1 h-1.5 rounded-full transition-all ${
                done
                  ? active
                    ? "bg-primary"
                    : "bg-green-500"
                  : "bg-border"
              }`}
              title={step.label}
            />
          );
        })}
        <span className="text-[10px] text-muted-foreground ml-1 whitespace-nowrap">
          {steps[activeIdx]?.label}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* FR-06: Estimated arrival note */}
      {activeIdx === 3 && timestamps?.availableDate && (
        <div
          className="flex items-start gap-2 px-4 py-3 rounded-xl mb-3 text-xs"
          style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.2)" }}
        >
          <Calendar size={13} className="shrink-0 mt-0.5" style={{ color: "#FF5A1F" }} />
          <div>
            <p className="font-semibold" style={{ color: "#FF5A1F" }}>
              Funds available from{" "}
              {new Date(timestamps.availableDate).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </p>
            {timestamps?.payoutArrival && (
              <p className="text-muted-foreground mt-0.5">
                Estimated bank arrival:{" "}
                {new Date(timestamps.payoutArrival).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
              </p>
            )}
            <p className="text-muted-foreground mt-1">
              Estimated arrival dates are provided for guidance only and depend on Stripe and your bank.
            </p>
          </div>
        </div>
      )}

      {/* Amount breakdown */}
      {grossPence != null && role !== "client" && (
        <div className="flex items-center gap-4 px-1 pb-3 text-xs text-muted-foreground">
          {grossPence != null && (
            <span>
              Total: <span className="font-semibold text-foreground">{fmt(grossPence)}</span>
            </span>
          )}
          {platformFeePence != null && (
            <span>
              Viewrr fee: <span className="font-semibold">{fmt(platformFeePence)}</span>
            </span>
          )}
          {freelancerPence != null && (
            <span>
              Your earnings: <span className="font-semibold text-foreground">{fmt(freelancerPence)}</span>
            </span>
          )}
        </div>
      )}

      {steps.map((step, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        const future = i > activeIdx;
        const isExpanded = expandedKey === step.key;
        const isStripeWaiting = step.key === "stripe_availability";

        return (
          <div key={step.key} className="flex gap-3">
            {/* Connector column */}
            <div className="flex flex-col items-center" style={{ minWidth: 20 }}>
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                  done
                    ? "bg-green-500"
                    : active
                    ? "border-2 border-primary bg-primary/10"
                    : "border-2 border-border bg-background"
                }`}
              >
                {done ? (
                  <CheckCircle2 size={12} className="text-white" />
                ) : active ? (
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                ) : (
                  <Circle size={10} className="text-muted-foreground/40" />
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`w-px flex-1 mt-1 mb-0 transition-all ${
                    done ? "bg-green-400" : "bg-border"
                  }`}
                  style={{ minHeight: 24 }}
                />
              )}
            </div>

            {/* Content */}
            <div className={`pb-4 flex-1 ${future ? "opacity-50" : ""}`}>
              <button
                className="w-full flex items-start justify-between gap-2 text-left group"
                onClick={() => setExpandedKey(isExpanded ? null : step.key)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        active ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </span>
                    {active && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white"
                        style={{ background: "#FF5A1F" }}
                      >
                        Now
                      </span>
                    )}
                    {/* FR-02: special "Why?" hint on Stripe availability stage */}
                    {isStripeWaiting && active && (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Info size={10} /> Tap to learn why
                      </span>
                    )}
                  </div>
                  {!isExpanded && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{step.shortDesc}</p>
                  )}
                  {step.timestamp && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      <Clock size={9} className="inline mr-1" />
                      {step.timestamp}
                    </p>
                  )}
                  {!step.timestamp && step.estimatedDate && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      <Calendar size={9} className="inline mr-1" />
                      {step.estimatedDate}
                    </p>
                  )}
                </div>
                <div className="shrink-0 mt-0.5 text-muted-foreground">
                  {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </div>
              </button>

              {/* FR-05: Expanded detail */}
              {isExpanded && (
                <div
                  className="mt-2 px-3 py-3 rounded-xl text-xs text-muted-foreground leading-relaxed space-y-1"
                  style={{ background: "rgba(255,90,31,0.04)", border: "1px solid rgba(255,90,31,0.12)" }}
                >
                  {isStripeWaiting ? (
                    <>
                      <p className="font-semibold text-foreground">Why haven't I received my money yet?</p>
                      {step.fullDesc.split(". ").filter(Boolean).map((sentence, si) => (
                        <p key={si}>{sentence.trim()}.</p>
                      ))}
                      <p className="mt-2 text-[10px] italic">
                        This delay may reduce over time as your account builds a successful payment history.
                      </p>
                    </>
                  ) : (
                    <p>{step.fullDesc}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── StripeAvailabilityExplainer (FR-02 standalone banner) ────────────────────

export function StripeAvailabilityExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl px-4 py-3 text-xs cursor-pointer"
      style={{ background: "rgba(255,90,31,0.06)", border: "1px solid rgba(255,90,31,0.18)" }}
      onClick={() => setOpen(o => !o)}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold" style={{ color: "#FF5A1F" }}>
          Why haven't I received my money yet?
        </span>
        {open ? <ChevronUp size={13} style={{ color: "#FF5A1F" }} /> : <ChevronDown size={13} style={{ color: "#FF5A1F" }} />}
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 text-muted-foreground leading-relaxed">
          <p>Your client has successfully paid.</p>
          <p>Your payment has already reached Stripe.</p>
          <p>
            Before Stripe sends money to your bank, it applies an <strong className="text-foreground">availability period</strong>.
            This helps protect buyers and sellers against fraud and payment disputes.
          </p>
          <p>
            Once this period has ended, Stripe will automatically send your payment to your bank.{" "}
            <strong className="text-foreground">You do not need to take any further action.</strong>
          </p>
        </div>
      )}
    </div>
  );
}
