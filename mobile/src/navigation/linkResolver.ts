/**
 * Server link → native destination.
 *
 * Backend notifications carry web paths, written for wouter routes in
 * client/src/App.tsx. The full vocabulary emitted by notify() at origin/main is:
 *
 *   /your-work            13×   project + stage activity
 *   /dashboard            10×   new message, brief interest
 *   /profile/:id           1×   profile view
 *   /invoice/:projectId    1×   invoice issued
 *   /feed, /feed/:id       3×   social feed (out of Mobile V1)
 *
 * Two rules make this safe:
 *   1. The notification `type` is consulted before the path. "/dashboard" means
 *      different things for a message and for a brief interest, and the type
 *      says which — the path alone would send both to the same screen.
 *   2. Anything unrecognised resolves to Home. An unknown link must never
 *      throw, and must never navigate to a route that does not exist: a future
 *      backend link or push payload can appear at any time without a client
 *      release, so the resolver treats the input as untrusted.
 *
 * Paths the backend does not emit today (/project/:id, /messages/:id,
 * /briefs/:id) are accepted too, so push payloads can use direct native paths
 * later without another resolver change.
 */

export type NativeLink =
  | { pathname: "/(app)" }
  | { pathname: "/(app)/work" }
  | { pathname: "/(app)/work/[projectId]"; params: { projectId: string } }
  | { pathname: "/(app)/messages" }
  | { pathname: "/(app)/messages/[conversationId]"; params: { conversationId: string } }
  | { pathname: "/(app)/briefs" }
  | { pathname: "/(app)/briefs/[briefId]"; params: { briefId: string } }
  | { pathname: "/(app)/discover" }
  | { pathname: "/(app)/discover/[profileId]"; params: { profileId: string } }
  | { pathname: "/(app)/notifications" };

export const HOME_LINK: NativeLink = { pathname: "/(app)" };

/** Notification types that are always about a conversation. */
const MESSAGE_TYPES = new Set(["message", "message_received"]);

/** Notification types that are always about a brief interest / negotiation. */
const INTEREST_TYPES = new Set([
  "interest",
  "interest_accepted",
  "interest_declined",
  "counter_offered",
  "counter_accepted",
]);

/** Notification types that are always about a live project. */
const PROJECT_TYPES = new Set([
  "project",
  "project_created",
  "project_completed",
  "stage_submitted",
  "stage_approved",
  "stage_changes_requested",
  "plan_confirmed",
  "plan_approved",
  "payment",
  "payment_received",
  "invoice",
]);

/** Strip origin, query and hash, collapse slashes, drop the trailing slash. */
function segmentsOf(link: string): string[] {
  const withoutOrigin = link.replace(/^https?:\/\/[^/]+/i, "");
  const path = (withoutOrigin.split(/[?#]/)[0] ?? "").trim();
  return path.split("/").filter(Boolean);
}

function numericSegment(value: string | undefined): string | null {
  return value !== undefined && /^\d+$/.test(value) ? value : null;
}

/**
 * @param link   The notification's `link` field, or a push payload path.
 * @param type   The notification's `type`, when known. Takes priority.
 * @param role   Used only to disambiguate a bare "/dashboard" interest link:
 *               a creative applied to a brief, a client received an applicant.
 */
export function resolveNotificationLink(
  link: string | null | undefined,
  type?: string | null,
  role?: "client" | "freelancer" | "admin" | null,
): NativeLink {
  const segments = segmentsOf(link ?? "");
  const [head, second] = segments;
  const id = numericSegment(second);

  // ── 1. Type-led resolution ───────────────────────────────────────────────
  if (type && MESSAGE_TYPES.has(type)) {
    return { pathname: "/(app)/messages" };
  }

  if (type && INTEREST_TYPES.has(type)) {
    // The link is "/dashboard" for all of these, so the role decides: the
    // creative's applications live under Briefs, the client's applicants sit
    // against the work they will become.
    if (head === "briefs" && id) return { pathname: "/(app)/briefs/[briefId]", params: { briefId: id } };
    return role === "freelancer" ? { pathname: "/(app)/briefs" } : { pathname: "/(app)/work" };
  }

  if (type && PROJECT_TYPES.has(type)) {
    if ((head === "invoice" || head === "project" || head === "projects") && id) {
      return { pathname: "/(app)/work/[projectId]", params: { projectId: id } };
    }
    return { pathname: "/(app)/work" };
  }

  // ── 2. Path-led resolution ───────────────────────────────────────────────
  switch (head) {
    case undefined:
      return HOME_LINK;

    case "your-work":
    case "workspace":
      return { pathname: "/(app)/work" };

    case "project":
    case "projects":
    case "invoice":
      return id
        ? { pathname: "/(app)/work/[projectId]", params: { projectId: id } }
        : { pathname: "/(app)/work" };

    case "messages":
      return id
        ? { pathname: "/(app)/messages/[conversationId]", params: { conversationId: id } }
        : { pathname: "/(app)/messages" };

    case "briefs":
      return id
        ? { pathname: "/(app)/briefs/[briefId]", params: { briefId: id } }
        : { pathname: "/(app)/briefs" };

    case "profile":
    case "marketplace":
      return id
        ? { pathname: "/(app)/discover/[profileId]", params: { profileId: id } }
        : { pathname: "/(app)/discover" };

    case "notifications":
      return { pathname: "/(app)/notifications" };

    // /dashboard with no usable type, /feed, /pro, /agency-hq, /founder/*, and
    // anything a future backend invents: Home is always a valid destination.
    default:
      return HOME_LINK;
  }
}

/**
 * True when the resolver had something real to work with. Used to decide
 * whether a notification row should look tappable at all.
 */
export function isResolvable(link: string | null | undefined, type?: string | null): boolean {
  const resolved = resolveNotificationLink(link, type);
  return resolved.pathname !== HOME_LINK.pathname;
}
