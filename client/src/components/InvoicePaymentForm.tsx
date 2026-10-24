import { useRef, useState } from "react";
import { ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";

/** Wallets and cards confirm the same server-priced intent. This form never marks an invoice paid. */
export function InvoicePaymentForm({ amountPence, email, verify, onSubmitted, onPaid }: {
  amountPence?: number;
  email?: string;
  verify?: (intentId: string) => Promise<boolean>;
  onSubmitted?: () => void;
  onPaid?: () => void;
}) {
  const stripe = useStripe(), elements = useElements();
  const submitting = useRef(false), verificationRequired = useRef(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false), [wallets, setWallets] = useState(false);
  const [message, setMessage] = useState("");

  function awaitingConfirmation() {
    verificationRequired.current = true;
    setPending(true);
    setMessage("We're checking your payment. Please don't pay again. Reopen the invoice to check its status.");
    onSubmitted?.();
  }

  async function pay(walletEvent?: StripeExpressCheckoutElementConfirmEvent) {
    if (!stripe || !elements || submitting.current || verificationRequired.current || pending) {
      walletEvent?.paymentFailed({ reason: "fail" });
      return;
    }
    submitting.current = true;
    setBusy(true); setMessage("");
    let confirmationStarted = false;
    try {
      const validation = await elements.submit();
      if (validation.error) {
        walletEvent?.paymentFailed({ reason: "fail" });
        setMessage(validation.error.message ?? "Check your payment details.");
        return;
      }
      confirmationStarted = true;
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
          ...(email ? { payment_method_data: { billing_details: { email } } } : {}),
        },
        redirect: "if_required",
      });
      if (error) {
        if (error.type === "card_error" || error.type === "validation_error") {
          setMessage(error.message ?? "Payment could not be completed. Please check your payment details.");
        } else awaitingConfirmation();
        return;
      }
      if (paymentIntent?.status === "succeeded" && verify && await verify(paymentIntent.id)) {
        verificationRequired.current = true;
        setPending(true);
        onPaid?.();
      } else awaitingConfirmation();
    } catch {
      if (confirmationStarted) awaitingConfirmation();
      else {
        walletEvent?.paymentFailed({ reason: "fail" });
        setMessage("Checkout couldn't load. Please try again.");
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (pending) return <div className="space-y-4" role="status">
    <p>{message || "Payment verified. Refreshing your invoice…"}</p>
    <Button type="button" className="w-full" onClick={() => window.location.reload()}>Check invoice status</Button>
  </div>;

  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); void pay(); }}>
    {amountPence != null && <div className="flex justify-between rounded-2xl bg-primary/5 p-4">
      <span>Total due</span><strong>£{(amountPence / 100).toFixed(2)}</strong>
    </div>}
    <div aria-busy={busy} style={{ pointerEvents: busy ? "none" : undefined }}>
      <ExpressCheckoutElement
        options={{ paymentMethods: { applePay: "always", googlePay: "auto", link: "never", paypal: "never", amazonPay: "never", klarna: "never" } }}
        onReady={({ availablePaymentMethods }) => setWallets(Boolean(availablePaymentMethods?.applePay || availablePaymentMethods?.googlePay))}
        onConfirm={event => void pay(event)}
      />
    </div>
    {wallets && <p className="text-center text-xs text-muted-foreground">Or pay by card</p>}
    <PaymentElement onReady={() => setReady(true)} options={{
      layout: "tabs", wallets: { applePay: "never", googlePay: "never" },
      ...(email ? { fields: { billingDetails: { email: "never" as const } } } : {}),
    }} />
    <p className="text-xs text-muted-foreground">Secured by Stripe. Originals unlock after Viewrr verifies payment.</p>
    <Button type="submit" className="w-full rounded-full" disabled={!stripe || !elements || !ready || busy}>
      {busy ? "Processing payment…" : amountPence != null ? `Pay £${(amountPence / 100).toFixed(2)}` : "Pay securely"}
    </Button>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
  </form>;
}
