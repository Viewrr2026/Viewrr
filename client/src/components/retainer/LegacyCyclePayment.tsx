import { useEffect, useMemo, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { apiRequest } from "@/lib/queryClient";
import { InvoicePaymentForm } from "@/components/InvoicePaymentForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function LegacyCyclePayment({ cycleId, onChanged }: { cycleId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [checkout, setCheckout] = useState<any>(null), [pending, setPending] = useState(false);
  const stripe = useMemo(() => checkout?.publishableKey ? loadStripe(checkout.publishableKey) : null, [checkout?.publishableKey]);
  useEffect(() => {
    if (!open || !pending) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await (await apiRequest("GET", `/api/retainer-cycles/${cycleId}/payment`)).json();
        if (result.verified || ["refunded", "partially_refunded", "disputed"].includes(result.status)) { setOpen(false); onChanged(); }
        else if (["requires_payment_method", "requires_confirmation"].includes(result.status)) { setPending(false); setMessage("Payment wasn't completed. You can try again."); }
      } catch { /* Keep the invoice pending while its payment status is unknown. */ }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open, pending, cycleId]);
  async function start() {
    if (busy) return;
    setOpen(true); setBusy(true); setMessage(""); setCheckout(null);
    try {
      const result = await (await apiRequest("POST", `/api/retainer-cycles/${cycleId}/payments`, {})).json();
      if (result.status === "confirming") { setPending(true); return; }
      if (!result.clientSecret || !result.publishableKey) throw new Error("Checkout is not configured.");
      setPending(false); setCheckout(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Checkout couldn't open."); }
    finally { setBusy(false); }
  }
  return <>
    <Button type="button" size="sm" disabled={busy} onClick={() => void start()}>Pay cycle</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) onChanged(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Pay cycle invoice</DialogTitle></DialogHeader>
        {busy && <p role="status">Opening checkout…</p>}
        {pending && <p role="status">We're checking your payment. Please don't pay again.</p>}
        {checkout && stripe && !pending && <Elements stripe={stripe} options={{ clientSecret: checkout.clientSecret }}>
          <InvoicePaymentForm amountPence={checkout.amountPence} onSubmitted={() => { setPending(true); setCheckout(null); onChanged(); }} />
        </Elements>}
        {message && <p role="alert">{message}</p>}
        {!busy && !checkout && !pending && <Button onClick={() => void start()}>Reopen checkout</Button>}
      </DialogContent>
    </Dialog>
  </>;
}
