import { Linking } from "react-native";
import type { PaymentTarget, PaymentState } from "@/api/payments";
import { webProjectUrl } from "@/components/work/webLinks";
export type CheckoutOutcome = PaymentState | "cancelled" | "busy";
export async function checkPendingInvoice(_userId: number, _target: PaymentTarget): Promise<PaymentState | null> { return null; }
export async function payInvoice(_userId: number, target: PaymentTarget): Promise<CheckoutOutcome> {
  await Linking.openURL(webProjectUrl(target.projectId));
  return "cancelled";
}
