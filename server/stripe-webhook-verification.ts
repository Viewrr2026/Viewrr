import type Stripe from "stripe";

const connectEvents = new Set([
  "account.updated", "balance.available", "payout.created",
  "payout.updated", "payout.paid", "payout.failed",
]);

/** Verify the unchanged raw payload before trusting any event fields. */
export function verifyStripeWebhook(
  stripe: Stripe,
  payload: Buffer,
  signature: string,
  secrets: { platform?: string; connect?: string },
): Stripe.Event {
  if (secrets.platform) {
    try {
      return stripe.webhooks.constructEvent(payload, signature, secrets.platform);
    } catch {
      // A separate Connect destination has its own signing secret.
    }
  }
  if (secrets.connect) {
    const event = stripe.webhooks.constructEvent(payload, signature, secrets.connect);
    if (!event.account || !connectEvents.has(event.type)) {
      throw new Error("Unexpected Connect webhook scope");
    }
    return event;
  }
  throw new Error("Invalid webhook signature or missing secret");
}
