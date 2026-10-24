import { initStripe, initPaymentSheet, presentPaymentSheet } from "@stripe/stripe-react-native";
import * as SecureStore from "expo-secure-store";
import { createInvoicePayment, verifyInvoicePayment, type PaymentTarget, type PaymentState } from "@/api/payments";
import { APPLE_MERCHANT_ID, PAYMENT_URL_SCHEME } from "@/config/env";

export type CheckoutOutcome = PaymentState | "cancelled" | "busy";
// The SDK has one payment sheet. Serialize checkout across all invoice buttons.
let active = false;
const keyFor = (userId: number, target: PaymentTarget) =>
  `invoice-payment.${userId}.${target.kind}.${target.kind === "project" ? target.projectId : target.cycleId}`;

async function readPendingInvoice(userId: number, target: PaymentTarget): Promise<PaymentState | null> {
  const key = keyFor(userId, target);
  const reference = await SecureStore.getItemAsync(key);
  if (!reference) return null;
  const state = await verifyInvoicePayment(target, reference);
  if (state !== "confirming") await SecureStore.deleteItemAsync(key);
  return state;
}

export async function checkPendingInvoice(userId: number, target: PaymentTarget): Promise<PaymentState | null> {
  return active ? "confirming" : readPendingInvoice(userId, target);
}

export async function payInvoice(userId: number, target: PaymentTarget): Promise<CheckoutOutcome> {
  if (active) return "busy";
  active = true;
  let submitted = false;
  const key = keyFor(userId, target);
  try {
    const previous = await readPendingInvoice(userId, target);
    if (previous && previous !== "payable") return previous;
    const checkout = await createInvoicePayment(target);
    if ("status" in checkout) { await SecureStore.setItemAsync(key, "pending-cycle"); return "confirming"; }
    await initStripe({ publishableKey: checkout.publishableKey, merchantIdentifier: APPLE_MERCHANT_ID, urlScheme: PAYMENT_URL_SCHEME });
    const initialized = await initPaymentSheet({
      merchantDisplayName: "Viewrr",
      paymentIntentClientSecret: checkout.clientSecret,
      returnURL: `${PAYMENT_URL_SCHEME}://stripe-redirect`,
      applePay: { merchantCountryCode: "GB" },
      allowsDelayedPaymentMethods: false,
      primaryButtonLabel: `Pay £${(checkout.amountPence / 100).toFixed(2)}`,
    });
    if (initialized.error) throw new Error("Checkout couldn't open. Please try again.");
    // Persist the public reference before presenting; never store the client secret or card data.
    await SecureStore.setItemAsync(key, checkout.reference);
    submitted = true;
    const result = await presentPaymentSheet();
    const state = await verifyInvoicePayment(target, checkout.reference);
    if (state === "paid" || state === "unavailable") {
      await SecureStore.deleteItemAsync(key);
      return state;
    }
    if (result.error && state === "payable") {
      await SecureStore.deleteItemAsync(key);
      if (result.error.code === "Canceled") return "cancelled";
      submitted = false;
      throw new Error("Payment wasn't completed. Please try again or choose another card.");
    }
    return "confirming";
  } catch (error) {
    if (submitted) return "confirming";
    throw error;
  } finally { active = false; }
}
