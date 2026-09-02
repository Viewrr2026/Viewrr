import { api } from "@/api/client";
import type { PublicUser } from "@/api/types";

/**
 * Account surfaces: deletion, data export, profile writes and the two
 * DISTINCT preference stores.
 *
 * Every signature here is the frozen PRD-1 contract (section D). Nothing is
 * invented locally and nothing is defaulted into existence — where the server
 * may legitimately omit a field, the normalisers below produce an empty value
 * the screen can render honestly rather than a fabricated one.
 *
 * `api/types.ts` and `api/client.ts` are read-only for every agent, so the
 * types this domain needs are declared and exported from here.
 */

/* ── Deletion (Apple 5.1.1(v), Decision 6) ─────────────────────────────── */

/**
 * A real obligation that defers — never refuses — deletion. `label` is short
 * enough for a row title; `detail` is the plain-English explanation.
 */
export type DeletionBlocker = {
  code: string;
  label: string;
  detail: string;
  /** True when the blocker resolves on its own (e.g. a payout clearing). */
  clearsAutomatically: boolean;
};

/** One line of the published retention schedule. */
export type RetentionEntry = {
  category: string;
  /** "deleted" | "anonymised" | "retained" in practice; free text on the wire. */
  action: string;
  periodDays: number;
};

export type DeletionState = "none" | "scheduled" | "blocked";

/** GET /api/me/deletion-status — never 409s, never refuses. */
export type DeletionStatus = {
  state: DeletionState;
  /** ISO timestamp. Present whenever deletion is scheduled rather than immediate. */
  scheduledFor: string | null;
  blockers: DeletionBlocker[];
  retention: RetentionEntry[];
};

/** POST /api/me/request-deletion */
export type DeletionRequestResult = {
  requestId: number | null;
  state: DeletionState | null;
  scheduledFor: string | null;
  /** Server-authored copy, safe to display. */
  message: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asDeletionState(value: unknown): DeletionState | null {
  return value === "none" || value === "scheduled" || value === "blocked" ? value : null;
}

function normaliseBlockers(value: unknown): DeletionBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = raw as Partial<DeletionBlocker> | null;
    const code = asString(row?.code);
    if (!code) return [];
    return [
      {
        code,
        label: asString(row?.label) ?? code,
        detail: asString(row?.detail) ?? "",
        clearsAutomatically: row?.clearsAutomatically === true,
      },
    ];
  });
}

function normaliseRetention(value: unknown): RetentionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = raw as Partial<RetentionEntry> | null;
    const category = asString(row?.category);
    const action = asString(row?.action);
    if (!category || !action) return [];
    return [
      {
        category,
        action,
        periodDays: typeof row?.periodDays === "number" ? row.periodDays : 0,
      },
    ];
  });
}

export async function fetchDeletionStatus(signal?: AbortSignal): Promise<DeletionStatus> {
  const raw = await api.get<unknown>("/api/me/deletion-status", { signal });
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    state: asDeletionState(row.state) ?? "none",
    scheduledFor: asString(row.scheduledFor),
    blockers: normaliseBlockers(row.blockers),
    retention: normaliseRetention(row.retention),
  };
}

export async function requestDeletion(): Promise<DeletionRequestResult> {
  const raw = await api.post<unknown>("/api/me/request-deletion");
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    requestId: typeof row.requestId === "number" ? row.requestId : null,
    state: asDeletionState(row.state),
    scheduledFor: asString(row.scheduledFor),
    message: asString(row.message),
  };
}

/**
 * POST /api/me/confirm-deletion — password re-authentication is mandatory.
 * The password is sent once and never stored, logged or held in a ref.
 */
export function confirmDeletion(password: string) {
  return api.post<{ ok?: boolean; message?: string }>("/api/me/confirm-deletion", { password });
}

/* ── Data export ───────────────────────────────────────────────────────── */

/**
 * GET /api/me/export returns the full export document. Its shape is the
 * server's own compilation, so mobile treats it as opaque JSON: it is shown by
 * section name and record count (both derived from the real payload) and handed
 * to the OS share sheet. Nothing is summarised into invented totals.
 */
export type ExportDocument = Record<string, unknown>;

export type ExportSection = { key: string; count: number | null };

export function fetchDataExport(signal?: AbortSignal) {
  return api.get<ExportDocument>("/api/me/export", { signal });
}

/** Real section inventory of an export payload — counts arrays, nothing else. */
export function describeExport(document: ExportDocument): ExportSection[] {
  return Object.entries(document).map(([key, value]) => ({
    key,
    count: Array.isArray(value) ? value.length : null,
  }));
}

/* ── Email notification preferences (the 8 real keys) ──────────────────── */

/**
 * GET|PATCH /api/notifications/preferences/:userId.
 *
 * These are EMAIL keys — the columns of `notification_preferences`, consumed by
 * the Resend email path only. They do not control push (Decision 15) and this
 * app never labels them as if they did.
 */
export type EmailNotificationPreferences = {
  emailProjectInvitations: boolean;
  emailNewOffers: boolean;
  emailCounterOffers: boolean;
  emailMessages: boolean;
  emailStageUpdates: boolean;
  emailPaymentUpdates: boolean;
  emailReviewRequests: boolean;
  emailProductUpdates: boolean;
};

export const EMAIL_PREFERENCE_KEYS = [
  "emailProjectInvitations",
  "emailNewOffers",
  "emailCounterOffers",
  "emailMessages",
  "emailStageUpdates",
  "emailPaymentUpdates",
  "emailReviewRequests",
  "emailProductUpdates",
] as const;

export type EmailPreferenceKey = (typeof EMAIL_PREFERENCE_KEYS)[number];

function boolAt(row: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = row[key];
  if (typeof value === "boolean") return value;
  // Postgres booleans arrive as booleans here, but a 0/1 integer column would
  // not — accept both rather than silently reading a 0 as `true`.
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
}

function normaliseEmailPreferences(raw: unknown): EmailNotificationPreferences {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    emailProjectInvitations: boolAt(row, "emailProjectInvitations", true),
    emailNewOffers: boolAt(row, "emailNewOffers", true),
    emailCounterOffers: boolAt(row, "emailCounterOffers", true),
    emailMessages: boolAt(row, "emailMessages", true),
    emailStageUpdates: boolAt(row, "emailStageUpdates", true),
    emailPaymentUpdates: boolAt(row, "emailPaymentUpdates", true),
    emailReviewRequests: boolAt(row, "emailReviewRequests", true),
    emailProductUpdates: boolAt(row, "emailProductUpdates", false),
  };
}

export async function fetchEmailPreferences(
  userId: number,
  signal?: AbortSignal,
): Promise<EmailNotificationPreferences> {
  const raw = await api.get<unknown>(`/api/notifications/preferences/${userId}`, { signal });
  return normaliseEmailPreferences(raw);
}

export async function updateEmailPreferences(
  userId: number,
  patch: Partial<EmailNotificationPreferences>,
): Promise<EmailNotificationPreferences> {
  const raw = await api.patch<unknown>(`/api/notifications/preferences/${userId}`, patch);
  return normaliseEmailPreferences(raw);
}

/* ── Push preferences (the 5 real keys) ────────────────────────────────── */

/** GET|PATCH /api/me/push-preferences — separate store, separate semantics. */
export type PushPreferences = {
  pushMessages: boolean;
  pushProjectUpdates: boolean;
  pushInterests: boolean;
  pushPayments: boolean;
  pushSocial: boolean;
};

export const PUSH_PREFERENCE_KEYS = [
  "pushMessages",
  "pushProjectUpdates",
  "pushInterests",
  "pushPayments",
  "pushSocial",
] as const;

export type PushPreferenceKey = (typeof PUSH_PREFERENCE_KEYS)[number];

function normalisePushPreferences(raw: unknown): PushPreferences {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    pushMessages: boolAt(row, "pushMessages", true),
    pushProjectUpdates: boolAt(row, "pushProjectUpdates", true),
    pushInterests: boolAt(row, "pushInterests", true),
    pushPayments: boolAt(row, "pushPayments", true),
    pushSocial: boolAt(row, "pushSocial", false),
  };
}

export async function fetchPushPreferences(signal?: AbortSignal): Promise<PushPreferences> {
  const raw = await api.get<unknown>("/api/me/push-preferences", { signal });
  return normalisePushPreferences(raw);
}

export async function updatePushPreferences(
  patch: Partial<PushPreferences>,
): Promise<PushPreferences> {
  const raw = await api.patch<unknown>("/api/me/push-preferences", patch);
  return normalisePushPreferences(raw);
}

/* ── Profile writes (Decision 13) ──────────────────────────────────────── */

/**
 * PATCH /api/users/:id — the server whitelist is exactly
 * { name, email, bio, avatar, banner, headline, location }.
 *
 * `email` is deliberately absent below: changing an email address is deferred
 * (Decision 16), so mobile never sends it. `users.phone` is not in the server
 * whitelist at all and is therefore not offered anywhere in the app.
 */
export type UserFieldsPatch = {
  name?: string;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  /** JPEG data URL, produced client-side. Data-URL parity with web (Decision 13). */
  avatar?: string | null;
  banner?: string | null;
};

export function updateUserFields(userId: number, patch: UserFieldsPatch) {
  return api.patch<PublicUser>(`/api/users/${userId}`, patch);
}

/**
 * PATCH /api/profiles/:id — the server whitelist is
 * { specialisms, skills, hourlyRate, dayRate, availability, yearsExperience,
 *   reelUrl, portfolioItems, socialLinks, cardThumbnail }.
 *
 * `skills` and `portfolioItems` are JSON-encoded arrays in TEXT columns, so the
 * caller passes real arrays and this module does the encoding once.
 */
export type ProfileFieldsPatch = {
  skills?: string[];
  hourlyRate?: number | null;
  dayRate?: number | null;
  availability?: string;
  reelUrl?: string | null;
  portfolioItems?: { url: string; title?: string }[];
};

export function updateProfileFields(profileId: number, patch: ProfileFieldsPatch) {
  const body: Record<string, unknown> = {};
  if (patch.skills !== undefined) body.skills = JSON.stringify(patch.skills);
  if (patch.hourlyRate !== undefined) body.hourlyRate = patch.hourlyRate;
  if (patch.dayRate !== undefined) body.dayRate = patch.dayRate;
  if (patch.availability !== undefined) body.availability = patch.availability;
  if (patch.reelUrl !== undefined) body.reelUrl = patch.reelUrl;
  if (patch.portfolioItems !== undefined) {
    body.portfolioItems = JSON.stringify(patch.portfolioItems);
  }
  return api.patch<unknown>(`/api/profiles/${profileId}`, body);
}

/** Decode a JSON-encoded TEXT array column without throwing on bad data. */
export function decodeJsonArray<T>(encoded: string | null | undefined): T[] {
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(encoded);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
