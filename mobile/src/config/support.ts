/**
 * In-app support contact — Apple guideline 1.2 (Safety / User-Generated
 * Content) requires a way for a user to reach the operator from inside the app.
 * The web app already publishes this address; mobile had no route to it.
 *
 * This lives beside `config/env.ts` rather than inside a screen so the address
 * appears exactly once in the bundle. It is a published contact address, not an
 * environment secret, and it is intentionally NOT environment-dependent: a
 * staging build must still reach a real human.
 */

export const SUPPORT_EMAIL = "support@viewrr.co.uk";

/**
 * A `mailto:` URL with a subject prefilled so an inbound message arrives
 * already triaged. Nothing about the user is embedded — the account is
 * identified by the address they send from.
 */
export function supportMailto(subject: string, body?: string): string {
  const params = [`subject=${encodeURIComponent(`Viewrr app — ${subject}`)}`];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${SUPPORT_EMAIL}?${params.join("&")}`;
}
