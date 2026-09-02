import { PUBLIC_SITE_URL } from "@/config/env";

/**
 * Web hand-off destinations for the flows that are deliberately not on mobile
 * in V1 — retainer cycles (Decision 12) and the Stripe payment path
 * (Decision 10 / payment is read-only here).
 *
 * Built from `config/env.ts`, never written out by hand: no screen in this app
 * is allowed to carry a literal environment URL.
 */

/** The web workspace — /your-work in client/src/App.tsx. */
export const WEB_WORK_URL = `${PUBLIC_SITE_URL}/your-work`;

/** One project on the web. Used for retainer management and payment. */
export function webProjectUrl(projectId: number): string {
  return `${PUBLIC_SITE_URL}/project/${projectId}`;
}
