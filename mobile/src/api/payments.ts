import { api } from "@/api/client";

export type PaymentTarget = { kind: "project"; projectId: number } |
  { kind: "cycle"; projectId: number; cycleId: string };
export type Checkout = { clientSecret: string; publishableKey: string; reference: string; amountPence: number };
export type PaymentState = "paid" | "confirming" | "payable" | "unavailable";

export async function createInvoicePayment(target: PaymentTarget): Promise<Checkout | { status: "confirming" }> {
  // Both endpoints derive the amount and parties from the session and invoice.
  const result = await api.post<any>(target.kind === "project" ? "/api/stripe/create-payment-intent" :
    `/api/retainer-cycles/${encodeURIComponent(target.cycleId)}/payments`,
  target.kind === "project" ? { projectId: target.projectId } : {});
  if (result.status === "confirming") return { status: "confirming" };
  const reference = target.kind === "project" ? result.paymentIntentId : result.paymentPublicId;
  if (typeof result.clientSecret !== "string" || !result.clientSecret.startsWith("pi_") ||
      typeof result.publishableKey !== "string" || !/^pk_(test|live)_/.test(result.publishableKey) ||
      typeof reference !== "string" || !reference || !Number.isSafeInteger(result.amountPence) || result.amountPence <= 0) {
    throw new Error("Checkout is not available. Please reopen the invoice.");
  }
  return { clientSecret: result.clientSecret, publishableKey: result.publishableKey, reference, amountPence: result.amountPence };
}

export async function verifyInvoicePayment(target: PaymentTarget, reference: string): Promise<PaymentState> {
  if (target.kind === "project") {
    const result = await api.post<{ ok: boolean; status: string }>("/api/stripe/confirm-intent", {
      projectId: target.projectId, paymentIntentId: reference,
    });
    if (result.ok === true && result.status === "succeeded") return "paid";
    return ["requires_payment_method", "requires_confirmation", "canceled"].includes(result.status) ? "payable" : "confirming";
  }
  const result = await api.get<{ status: string; verified?: boolean }>(`/api/retainer-cycles/${encodeURIComponent(target.cycleId)}/payment`);
  if (result.status === "succeeded" && result.verified === true) return "paid";
  if (["refunded", "partially_refunded", "disputed"].includes(result.status)) return "unavailable";
  return ["requires_payment_method", "requires_confirmation", "canceled", "not_started"].includes(result.status) ? "payable" : "confirming";
}
