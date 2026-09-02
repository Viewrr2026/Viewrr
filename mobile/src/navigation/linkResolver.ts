/**
 * Notification → native destination.
 *
 * Two inputs, one resolver
 * ------------------------
 * A notification reaches mobile twice: as a row in the notification centre and
 * as a push payload. Both must land on the same screen, so both are funnelled
 * through `resolveNotificationTarget`. The in-app row and the push `data`
 * object are normalised by `targetingFromNotification` / `targetingFromPush`
 * first, which read defensively from untyped records — the field set can grow
 * server-side at any time without a client release.
 *
 * Resolution order (Decision 14)
 * ------------------------------
 *   1. `targetType` + `targetId` — the additive structured fields the backend
 *      now writes alongside the existing web `link`. When present they win:
 *      they are the only source that reliably carries an id.
 *   2. The notification `type` — "/dashboard" means one thing for a message
 *      and another for a brief interest, so the type is consulted before the
 *      path. The type also supplies the SHAPE of the destination (a stage
 *      notification wants the stages tab of a project, not the project head).
 *   3. The web `link` path — untouched for web, still useful here.
 *   4. Home. An unknown link must never throw and must never navigate to a
 *      route that does not exist.
 *
 * What this fixes
 * ---------------
 *   • `stage_advanced` is the most-emitted project event and its web link is a
 *     bare "/your-work", which dropped the project id entirely. With
 *     `targetType: "project"` it now reaches /(app)/work/[projectId]/stages.
 *   • `message` reaches the thread /(app)/messages/[conversationId] using the
 *     counterparty id (conversation target, else the actor) instead of the
 *     inbox.
 *   • `interest*` reaches the brief or the work it belongs to.
 *   • `project_*`, `payment_*` and `invoice_sent` reach the project detail.
 *   • `profile_view` still reaches /(app)/discover/[profileId].
 *
 * Feed destinations stay Home: post and comment notifications carry a
 * `targetType: "post"`, but feed media/detail is out of mobile V1, so there is
 * no post route to send them to. Home is a real, valid screen — a dead end
 * would not be.
 */

export type NativeLink =
  | { pathname: "/(app)" }
  | { pathname: "/(app)/work" }
  | { pathname: "/(app)/work/[projectId]"; params: { projectId: string } }
  | { pathname: "/(app)/work/[projectId]/stages"; params: { projectId: string } }
  | { pathname: "/(app)/messages" }
  | { pathname: "/(app)/messages/[conversationId]"; params: { conversationId: string } }
  | { pathname: "/(app)/briefs" }
  | { pathname: "/(app)/briefs/[briefId]"; params: { briefId: string } }
  | { pathname: "/(app)/discover" }
  | { pathname: "/(app)/discover/[profileId]"; params: { profileId: string } }
  | { pathname: "/(app)/notifications" };

export const HOME_LINK: NativeLink = { pathname: "/(app)" };

/** The structured target vocabulary from the frozen contract. */
export type NotificationTargetType =
  | "project"
  | "brief"
  | "conversation"
  | "post"
  | "profile";

export type ViewerRole = "client" | "freelancer" | "admin" | null | undefined;

/**
 * Everything the resolver can use. Every field is optional: a notification row
 * written before migration 0006 has no targeting, and a push payload from a
 * future server build may carry more than this.
 */
export type NotificationTargeting = {
  type?: string | null;
  link?: string | null;
  /** Who caused it. The fallback id for message and profile destinations. */
  actorId?: number | null;
  targetType?: NotificationTargetType | string | null;
  targetId?: number | string | null;
  role?: ViewerRole;
};

const TARGET_TYPES: readonly string[] = [
  "project",
  "brief",
  "conversation",
  "post",
  "profile",
];

/** Notification types that are always about a conversation. */
const MESSAGE_TYPES = new Set(["message", "message_received", "new_message"]);

/** Notification types that are always about a brief interest / negotiation. */
const INTEREST_TYPES = new Set([
  "interest",
  "interest_received",
  "interest_accepted",
  "interest_declined",
  "interest_withdrawn",
  "counter_offered",
  "counter_accepted",
  "counter_declined",
]);

/**
 * Project-stage types. These want the stage timeline, not the project head —
 * the user is being told a stage moved, and `stage_advanced` is the single
 * most-emitted project event.
 */
const STAGE_TYPES = new Set([
  "stage_advanced",
  "stage_submitted",
  "stage_approved",
  "stage_completed",
  "stage_changes_requested",
  "stage_rejected",
  "plan_confirmed",
  "plan_approved",
]);

/** Types that are about a project as a whole (detail screen). */
const PROJECT_TYPES = new Set([
  "project",
  "project_created",
  "project_started",
  "project_updated",
  "project_completed",
  "project_cancelled",
  "payment",
  "payment_received",
  "payment_released",
  "payment_failed",
  "payment_due",
  "invoice",
  "invoice_sent",
  "invoice_paid",
  "deliverable_added",
  "retainer_updated",
]);

/** Types about a person rather than a piece of work. */
const PROFILE_TYPES = new Set([
  "profile_view",
  "profile_viewed",
  "connection_request",
  "connection_accepted",
  "follow",
]);

/** Prefix families, so a type the backend adds later still lands correctly. */
function familyOf(type: string): "stage" | "project" | "interest" | "message" | "profile" | null {
  if (STAGE_TYPES.has(type) || type.startsWith("stage_")) return "stage";
  if (MESSAGE_TYPES.has(type)) return "message";
  if (INTEREST_TYPES.has(type) || type.startsWith("interest_")) return "interest";
  if (
    PROJECT_TYPES.has(type) ||
    type.startsWith("project_") ||
    type.startsWith("payment_") ||
    type.startsWith("invoice_")
  ) {
    return "project";
  }
  if (PROFILE_TYPES.has(type)) return "profile";
  return null;
}

/** Strip origin, query and hash, collapse slashes, drop the trailing slash. */
function segmentsOf(link: string): string[] {
  const withoutOrigin = link.replace(/^https?:\/\/[^/]+/i, "");
  const path = (withoutOrigin.split(/[?#]/)[0] ?? "").trim();
  return path.split("/").filter(Boolean);
}

/** Accepts "12", 12 — rejects "", null, "abc", 0 and negatives. */
function asId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const trimmed = value.trim();
    return trimmed === "0" ? null : trimmed;
  }
  return null;
}

function asTargetType(value: unknown): NotificationTargetType | null {
  return typeof value === "string" && TARGET_TYPES.includes(value)
    ? (value as NotificationTargetType)
    : null;
}

// ── Destination builders ───────────────────────────────────────────────────

const projectDetail = (projectId: string): NativeLink => ({
  pathname: "/(app)/work/[projectId]",
  params: { projectId },
});

const projectStages = (projectId: string): NativeLink => ({
  pathname: "/(app)/work/[projectId]/stages",
  params: { projectId },
});

const conversation = (conversationId: string): NativeLink => ({
  pathname: "/(app)/messages/[conversationId]",
  params: { conversationId },
});

const briefDetail = (briefId: string): NativeLink => ({
  pathname: "/(app)/briefs/[briefId]",
  params: { briefId },
});

const profileDetail = (profileId: string): NativeLink => ({
  pathname: "/(app)/discover/[profileId]",
  params: { profileId },
});

/** Where a work-shaped notification goes when no id survived. */
function workFallback(role: ViewerRole): NativeLink {
  return role === "freelancer" ? { pathname: "/(app)/briefs" } : { pathname: "/(app)/work" };
}

// ── The resolver ───────────────────────────────────────────────────────────

/**
 * The single resolution entry point, used by the notification centre and by a
 * tapped push alike.
 */
export function resolveNotificationTarget(input: NotificationTargeting): NativeLink {
  const type = typeof input.type === "string" ? input.type.trim() : "";
  const family = type ? familyOf(type) : null;
  const targetType = asTargetType(input.targetType);
  const targetId = asId(input.targetId);
  const actorId = asId(input.actorId);
  const role = input.role;

  const segments = segmentsOf(input.link ?? "");
  const [head, second] = segments;
  const pathId = asId(second);

  // ── 1. Structured targeting wins (Decision 14) ───────────────────────────
  if (targetType && targetId) {
    switch (targetType) {
      case "project":
        // The type decides which face of the project: a stage event wants the
        // timeline, everything else the project head.
        return family === "stage" ? projectStages(targetId) : projectDetail(targetId);
      case "brief":
        return briefDetail(targetId);
      case "conversation":
        return conversation(targetId);
      case "profile":
        return profileDetail(targetId);
      case "post":
        // Feed detail is out of mobile V1 — Home is the honest destination.
        return HOME_LINK;
    }
  }

  // A structured type with no usable id still tells us the neighbourhood.
  if (targetType && !targetId) {
    switch (targetType) {
      case "project":
        return { pathname: "/(app)/work" };
      case "brief":
        return { pathname: "/(app)/briefs" };
      case "conversation":
        return { pathname: "/(app)/messages" };
      case "profile":
        return { pathname: "/(app)/discover" };
      case "post":
        return HOME_LINK;
    }
  }

  // ── 2. Type-led resolution, with the web link as the id source ───────────
  const linkProjectId =
    head === "invoice" || head === "project" || head === "projects" ? pathId : null;

  switch (family) {
    case "message":
      // The counterparty id IS the conversation id in this app: threads are
      // addressed by the other user. Prefer an explicit id, fall back to the
      // actor who sent the message.
      return actorId ? conversation(actorId) : { pathname: "/(app)/messages" };

    case "interest": {
      // Interest / negotiation threads live in Brief or Work context
      // (Decision 17) — never the DM inbox.
      if (head === "briefs" && pathId) return briefDetail(pathId);
      if (linkProjectId) return projectDetail(linkProjectId);
      return workFallback(role);
    }

    case "stage":
      return linkProjectId ? projectStages(linkProjectId) : { pathname: "/(app)/work" };

    case "project":
      return linkProjectId ? projectDetail(linkProjectId) : { pathname: "/(app)/work" };

    case "profile": {
      if ((head === "profile" || head === "marketplace") && pathId) return profileDetail(pathId);
      return actorId ? profileDetail(actorId) : { pathname: "/(app)/discover" };
    }

    case null:
      break;
  }

  // ── 3. Path-led resolution ───────────────────────────────────────────────
  switch (head) {
    case undefined:
      return HOME_LINK;

    case "your-work":
    case "workspace":
      return { pathname: "/(app)/work" };

    case "project":
    case "projects":
    case "invoice":
      return pathId ? projectDetail(pathId) : { pathname: "/(app)/work" };

    case "messages":
      return pathId ? conversation(pathId) : { pathname: "/(app)/messages" };

    case "briefs":
      return pathId ? briefDetail(pathId) : { pathname: "/(app)/briefs" };

    case "profile":
    case "marketplace":
      return pathId ? profileDetail(pathId) : { pathname: "/(app)/discover" };

    case "notifications":
      return { pathname: "/(app)/notifications" };

    // /dashboard with no usable type, /feed, /pro, /agency-hq, /founder/*, and
    // anything a future backend invents: Home is always a valid destination.
    default:
      return HOME_LINK;
  }
}

/**
 * Back-compatible positional form. Kept because it reads well at call sites
 * that only have a link and a type.
 */
export function resolveNotificationLink(
  link: string | null | undefined,
  type?: string | null,
  role?: ViewerRole,
): NativeLink {
  return resolveNotificationTarget({ link, type, role });
}

/**
 * Normalise an API notification row. `targetType` / `targetId` are additive
 * server-side fields that the read-only mobile `Notification` type does not
 * declare, so they are read defensively rather than cast into existence.
 */
export function targetingFromNotification(
  row: unknown,
  role?: ViewerRole,
): NotificationTargeting {
  const record: Record<string, unknown> =
    typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};

  return {
    type: typeof record["type"] === "string" ? record["type"] : null,
    link: typeof record["link"] === "string" ? record["link"] : null,
    actorId: asNumber(record["actorId"]),
    targetType: asTargetType(record["targetType"]),
    targetId: asId(record["targetId"]),
    role,
  };
}

/**
 * Normalise a push notification's `data` payload. The dispatcher sends the
 * same targeting fields it writes on the notification row, so a tapped push
 * lands exactly where the in-app row would.
 */
export function targetingFromPush(data: unknown, role?: ViewerRole): NotificationTargeting {
  const record: Record<string, unknown> =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};

  const link =
    typeof record["link"] === "string"
      ? record["link"]
      : typeof record["url"] === "string"
        ? record["url"]
        : null;

  return {
    type: typeof record["type"] === "string" ? record["type"] : null,
    link,
    actorId: asNumber(record["actorId"]),
    targetType: asTargetType(record["targetType"]),
    targetId: asId(record["targetId"]),
    role,
  };
}

function asNumber(value: unknown): number | null {
  const id = asId(value);
  return id === null ? null : Number(id);
}

/** Resolve a push payload straight to a destination. */
export function resolvePushTarget(data: unknown, role?: ViewerRole): NativeLink {
  return resolveNotificationTarget(targetingFromPush(data, role));
}

/**
 * True when the resolver had something real to work with. Used to decide
 * whether a notification row should look tappable at all. Note that Home is a
 * valid destination, not a dead end — this only reports specificity.
 */
export function isResolvable(input: NotificationTargeting): boolean {
  return resolveNotificationTarget(input).pathname !== HOME_LINK.pathname;
}
