/**
 * PRD-008 — User-facing money timeline component.
 * Shows a vertical timeline of payment events for client or freelancer.
 */

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, AlertTriangle, Circle, Loader2, RefreshCw } from "lucide-react";

interface TimelineEvent {
  id: number;
  event_type: string;
  visibility: string;
  title: string;
  description: string;
  amount_pence?: number | null;
  occurred_at: string;
}

type EventStatus = "confirmed" | "pending" | "failed" | "info";

function eventStatus(type: string): EventStatus {
  if (type.includes("confirmed") || type.includes("paid") || type.includes("allocated")) return "confirmed";
  if (type.includes("failed") || type.includes("dispute")) return "failed";
  if (type.includes("processing") || type.includes("scheduled") || type.includes("transit") || type.includes("requested")) return "pending";
  return "info";
}

function EventIcon({ type }: { type: string }) {
  const status = eventStatus(type);
  if (status === "confirmed") return <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />;
  if (status === "failed") return <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />;
  if (status === "pending") return <Clock size={16} className="text-amber-500 shrink-0 mt-0.5" />;
  return <Circle size={16} className="text-zinc-400 shrink-0 mt-0.5" />;
}

function fmtGBP(pence: number) {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

interface PaymentTimelineProps {
  paymentPublicId: string;
  userId: number;
}

export default function PaymentTimeline({ paymentPublicId, userId }: PaymentTimelineProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payment-timeline", paymentPublicId, userId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/${paymentPublicId}/timeline?userId=${userId}`);
      if (!res.ok) throw new Error("Failed to load timeline");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000, // Auto-refresh every minute to catch webhook updates
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Loading payment timeline…
      </div>
    );
  }

  if (isError || !data?.events?.length) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Circle size={14} />
        No timeline events yet.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payment timeline</p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-[7px] top-3 bottom-3 w-px bg-border" aria-hidden />

        <ol className="space-y-4">
          {(data.events as TimelineEvent[]).map((event, i) => (
            <li key={event.id} className="flex gap-3 relative">
              <EventIcon type={event.event_type} />
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">{event.title}</p>
                  {event.amount_pence != null && (
                    <span className="text-xs font-bold text-[#FF5A1F] shrink-0">{fmtGBP(event.amount_pence)}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{event.description}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtDate(event.occurred_at)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * Inline payment status banner — for checkout success/delay/failure states.
 */
export function PaymentStatusBanner({ status, amountPence }: { status: "processing" | "confirmed" | "delayed" | "failed"; amountPence?: number }) {
  if (status === "confirmed") return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-green-50 dark:bg-green-950/20 border border-green-200">
      <CheckCircle2 size={18} className="text-green-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-green-900 dark:text-green-200">Payment confirmed</p>
        <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
          {amountPence ? `Your payment of ${fmtGBP(amountPence)} has been confirmed.` : "Your payment has been confirmed."} You can view the receipt and payment timeline below.
        </p>
      </div>
    </div>
  );

  if (status === "processing") return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200">
      <Loader2 size={18} className="text-blue-600 mt-0.5 shrink-0 animate-spin" />
      <div>
        <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Payment received by Stripe</p>
        <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
          Viewrr is confirming the payment against your invoice. You do not need to pay again.
        </p>
      </div>
    </div>
  );

  if (status === "delayed") return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200">
      <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">We're still confirming this payment</p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
          Stripe has received the payment attempt, but Viewrr has not completed the final update. Please do not pay again.
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200">
      <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-red-900 dark:text-red-200">Payment not completed</p>
        <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
          Something went wrong with this payment. Please try again or contact support.
        </p>
      </div>
    </div>
  );
}

/**
 * Payout wording for freelancer — PRD-008 §11.4
 */
export function AutoPayoutExplainer() {
  return (
    <div className="p-4 rounded-2xl border border-border bg-card">
      <p className="text-sm font-semibold mb-1">Automatic payouts</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Eligible earnings are paid out automatically through Stripe. The arrival date depends on Stripe
        availability, verification, weekends and your bank. "Daily" describes payout scheduling and does not
        guarantee next-day receipt.
      </p>
    </div>
  );
}
