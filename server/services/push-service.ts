/**
 * push-service.ts — native push (Decision 15) + structured targeting (Decision 14)
 * ─────────────────────────────────────────────────────────────────────────────
 * PRD 1 backend wave 4. This is the entire server side of native push:
 *
 *   • the `push_tokens` / `push_preferences` data layer behind the four
 *     `/api/me/push-*` endpoints in `server/routes.ts`;
 *   • the type → preference-key → target mapping;
 *   • the Expo dispatcher used by `notify()`.
 *
 * NO NEW DEPENDENCY. Expo's HTTP API is called with the platform `fetch`
 * (Node 18+). `expo-server-sdk` is deliberately NOT installed: the only things
 * it adds over a `fetch` call are chunking (12 lines below) and receipt
 * polling (not needed — the ticket response already carries
 * `DeviceNotRegistered`, which is the one error that requires an action).
 *
 * DEGRADED MODE. `push_tokens`, `push_preferences` and
 * `notifications.target_type/target_id` are created by migration
 * `0006_prd1_mobile_v1.sql`, which has NOT been applied to production. This
 * branch can therefore run against a database where none of them exist. Every
 * function here treats "relation does not exist" (SQLSTATE 42P01) as
 * "push is not provisioned yet": it logs once and returns a safe value.
 * NOTHING in this file may ever throw into a request handler — a push is never
 * worth failing a message send, a stage transition or a payment for.
 *
 * PUSH PREFERENCES ARE NOT EMAIL PREFERENCES. The eight `notification_preferences`
 * keys (`emailMessages`, …) gate email and are read in `notify()`'s email
 * branch. The five keys here gate device push and nothing else. This module
 * never reads, writes or aliases the email model.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../storage";
import * as schema from "@shared/schema";

// ─── Preferences: the five push keys, distinct from the eight email keys ─────

export const PUSH_PREFERENCE_KEYS = [
  "pushMessages",
  "pushProjectUpdates",
  "pushInterests",
  "pushPayments",
  "pushSocial",
] as const;

export type PushPreferenceKey = (typeof PUSH_PREFERENCE_KEYS)[number];

export type PushPreferencesDTO = Record<PushPreferenceKey, boolean>;

/**
 * Mirrors the DEFAULTs in migration 0006 and
 * `mobile/src/api/push.ts#PUSH_PREFERENCE_DEFAULTS`. `pushSocial` is off:
 * likes, comments, follows and profile views are the highest-volume and
 * lowest-value pushes, and opt-in is the honest default for them.
 */
export const PUSH_PREFERENCE_DEFAULTS: PushPreferencesDTO = {
  pushMessages: true,
  pushProjectUpdates: true,
  pushInterests: true,
  pushPayments: true,
  pushSocial: false,
};

export type PushPlatform = "ios" | "android";

export type PushTokenDTO = {
  id: number | null;
  userId: number;
  token: string;
  platform: string;
  deviceId: string | null;
  appVersion: string | null;
};

// ─── Degraded-mode plumbing ──────────────────────────────────────────────────

/**
 * True when the error is Postgres "relation does not exist" — i.e. migration
 * 0006 has not run yet. Matched on SQLSTATE first; the message is only a
 * fallback because the neon driver does not always surface `code`.
 */
function isMissingRelation(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === "42P01") return true;
  const msg = String(err.message ?? "");
  return /relation .* does not exist/i.test(msg) || /column .* does not exist/i.test(msg);
}

const warnedOnce = new Set<string>();

/** One log line per distinct condition per process, so this cannot spam. */
function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

function noteMissingTables(where: string): void {
  warnOnce(
    "push-tables-missing",
    `[push] push_tokens/push_preferences not present (migration 0006 not applied) — ` +
      `push is inert. First seen in ${where}. This is not an error on this branch.`,
  );
}

// ─── Preference read / write ─────────────────────────────────────────────────

function rowToPrefs(row: schema.PushPreferences | undefined | null): PushPreferencesDTO {
  if (!row) return { ...PUSH_PREFERENCE_DEFAULTS };
  return {
    pushMessages: row.pushMessages !== false,
    pushProjectUpdates: row.pushProjectUpdates !== false,
    pushInterests: row.pushInterests !== false,
    // Note the asymmetry: pushSocial defaults OFF, so a null/absent value must
    // read as false, not as "not-false".
    pushSocial: row.pushSocial === true,
    pushPayments: row.pushPayments !== false,
  };
}

/**
 * Read a user's push preferences, creating the defaults row on first read.
 *
 * `created` is reported so the route can stay silent about it while the caller
 * (and a future audit) can tell a real answer from a default. When the table is
 * absent we return the documented defaults rather than throwing — the settings
 * screen then renders correctly and a PATCH is the thing that reports failure.
 */
export async function getOrCreatePushPreferences(
  userId: number,
): Promise<{ prefs: PushPreferencesDTO; created: boolean; degraded: boolean }> {
  try {
    const existing = await db
      .select()
      .from(schema.pushPreferences)
      .where(eq(schema.pushPreferences.userId, userId))
      .limit(1);

    if (existing.length) {
      return { prefs: rowToPrefs(existing[0]), created: false, degraded: false };
    }

    // First read: materialise the defaults so a later PATCH of one key does not
    // have to guess the other four.
    const inserted = await db
      .insert(schema.pushPreferences)
      .values({ userId, ...PUSH_PREFERENCE_DEFAULTS })
      .onConflictDoNothing({ target: schema.pushPreferences.userId })
      .returning();

    if (inserted.length) {
      return { prefs: rowToPrefs(inserted[0]), created: true, degraded: false };
    }

    // Lost an insert race with a concurrent first read — re-read the winner.
    const reread = await db
      .select()
      .from(schema.pushPreferences)
      .where(eq(schema.pushPreferences.userId, userId))
      .limit(1);
    return { prefs: rowToPrefs(reread[0]), created: false, degraded: false };
  } catch (e: any) {
    if (isMissingRelation(e)) {
      noteMissingTables("getOrCreatePushPreferences");
      return { prefs: { ...PUSH_PREFERENCE_DEFAULTS }, created: false, degraded: true };
    }
    console.warn("[push] getOrCreatePushPreferences failed:", e?.message);
    return { prefs: { ...PUSH_PREFERENCE_DEFAULTS }, created: false, degraded: true };
  }
}

/**
 * Explicit five-key whitelist for `PATCH /api/me/push-preferences`.
 *
 * B2 closed exactly this hole on the email endpoint (`sanitiseNotifPrefs`):
 * the old code spread `req.body` into a Drizzle `.set()`, so a caller could
 * write `id` or `user_id` and re-point someone else's preference row. Nothing
 * outside these five keys is readable from the body here — not `id`, not
 * `userId`, and not any of the eight email keys.
 *
 * Non-boolean values are dropped rather than coerced: `"false"` is a client
 * bug, and coercing it to `true` would silently switch a channel on.
 */
export function sanitisePushPrefs(body: unknown): Partial<PushPreferencesDTO> {
  const record: Record<string, unknown> =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const out: Partial<PushPreferencesDTO> = {};
  for (const key of PUSH_PREFERENCE_KEYS) {
    const value = record[key];
    if (typeof value === "boolean") out[key] = value;
    else if (value === 1 || value === 0) out[key] = value === 1;
  }
  return out;
}

/** Upsert the whitelisted subset. Returns the full five-key row afterwards. */
export async function updatePushPreferences(
  userId: number,
  patch: Partial<PushPreferencesDTO>,
): Promise<{ prefs: PushPreferencesDTO; degraded: boolean }> {
  const clean = sanitisePushPrefs(patch);

  try {
    if (Object.keys(clean).length === 0) {
      const { prefs, degraded } = await getOrCreatePushPreferences(userId);
      return { prefs, degraded };
    }

    const rows = await db
      .insert(schema.pushPreferences)
      .values({ userId, ...PUSH_PREFERENCE_DEFAULTS, ...clean })
      .onConflictDoUpdate({ target: schema.pushPreferences.userId, set: clean })
      .returning();

    if (rows.length) return { prefs: rowToPrefs(rows[0]), degraded: false };

    const reread = await db
      .select()
      .from(schema.pushPreferences)
      .where(eq(schema.pushPreferences.userId, userId))
      .limit(1);
    return { prefs: rowToPrefs(reread[0]), degraded: false };
  } catch (e: any) {
    if (isMissingRelation(e)) {
      noteMissingTables("updatePushPreferences");
      return { prefs: { ...PUSH_PREFERENCE_DEFAULTS, ...clean }, degraded: true };
    }
    throw e;
  }
}

// ─── Token registration ──────────────────────────────────────────────────────

function normalisePlatform(value: unknown): PushPlatform | null {
  const p = String(value ?? "").trim().toLowerCase();
  return p === "ios" || p === "android" ? p : null;
}

export type RegisterPushTokenInput = {
  token: string;
  platform: PushPlatform;
  deviceId?: string | null;
  appVersion?: string | null;
};

/**
 * Upsert on `(user_id, token)` and prune the install's stale rows.
 *
 * Two prunes, for two different real problems:
 *
 *  1. **Other users, same device** (`deviceId` match, different `user_id`).
 *     M5 flagged this and it is genuinely unfixable client-side: if account A
 *     signs out and account B signs in on the same install, the DELETE issued
 *     under B's credential cannot remove A's row — B must never be able to
 *     delete rows it does not own by token alone. Server-side, with A's row
 *     identified by the install rather than by the caller, the prune is safe
 *     and scoped. Without it, every notification for A would keep landing on
 *     B's phone.
 *  2. **Same user, same device, rotated token.** Expo rotates push tokens; the
 *     old row would otherwise accumulate and receive `DeviceNotRegistered`
 *     forever.
 *
 * A prune failure never fails the registration — the upsert is the part the
 * client is waiting on.
 */
export async function registerPushToken(
  userId: number,
  input: RegisterPushTokenInput,
): Promise<{ record: PushTokenDTO; degraded: boolean; prunedForeign: number; prunedStale: number }> {
  const token = String(input.token ?? "").trim();
  const platform = normalisePlatform(input.platform);
  const deviceId = input.deviceId ? String(input.deviceId).trim().slice(0, 200) || null : null;
  const appVersion = input.appVersion ? String(input.appVersion).trim().slice(0, 64) || null : null;

  if (!token || !platform) throw new Error("INVALID_PUSH_TOKEN_INPUT");

  const fallback: PushTokenDTO = { id: null, userId, token, platform, deviceId, appVersion };

  try {
    const rows = await db
      .insert(schema.pushTokens)
      .values({ userId, token, platform, deviceId, appVersion, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.pushTokens.userId, schema.pushTokens.token],
        set: { platform, deviceId, appVersion, lastSeenAt: new Date() },
      })
      .returning();

    const row = rows[0];
    const record: PushTokenDTO = row
      ? {
          id: row.id,
          userId: row.userId,
          token: row.token,
          platform: row.platform,
          deviceId: row.deviceId ?? null,
          appVersion: row.appVersion ?? null,
        }
      : fallback;

    let prunedForeign = 0;
    let prunedStale = 0;

    if (deviceId) {
      try {
        // (1) Other accounts' rows for THIS install.
        const foreign = await db
          .delete(schema.pushTokens)
          .where(and(eq(schema.pushTokens.deviceId, deviceId), ne(schema.pushTokens.userId, userId)))
          .returning({ id: schema.pushTokens.id });
        prunedForeign = foreign.length;

        // (2) This account's superseded tokens for THIS install.
        const stale = await db
          .delete(schema.pushTokens)
          .where(
            and(
              eq(schema.pushTokens.deviceId, deviceId),
              eq(schema.pushTokens.userId, userId),
              ne(schema.pushTokens.token, token),
            ),
          )
          .returning({ id: schema.pushTokens.id });
        prunedStale = stale.length;

        if (prunedForeign > 0) {
          console.log(
            `[push] device ${deviceId.slice(0, 8)}… reassigned to user ${userId}; ` +
              `pruned ${prunedForeign} token row(s) belonging to other accounts`,
          );
        }
      } catch (pruneErr: any) {
        console.warn("[push] device prune failed (registration still succeeded):", pruneErr?.message);
      }
    }

    return { record, degraded: false, prunedForeign, prunedStale };
  } catch (e: any) {
    if (isMissingRelation(e)) {
      noteMissingTables("registerPushToken");
      // Report success to the client: the device is correctly configured, the
      // server simply has nowhere to persist it yet. Failing here would make
      // M5's provider show a permanent "push could not be set up" error for a
      // condition the user cannot act on.
      return { record: fallback, degraded: true, prunedForeign: 0, prunedStale: 0 };
    }
    throw e;
  }
}

/**
 * Deregistration. Scoped to `userId` — a caller can only ever delete its own
 * rows, so a leaked token cannot be used to silence someone else's device.
 */
export async function deletePushTokenForUser(
  userId: number,
  rawToken: string,
): Promise<{ deleted: number; degraded: boolean }> {
  const token = String(rawToken ?? "").trim();
  if (!token) return { deleted: 0, degraded: false };

  try {
    const rows = await db
      .delete(schema.pushTokens)
      .where(and(eq(schema.pushTokens.userId, userId), eq(schema.pushTokens.token, token)))
      .returning({ id: schema.pushTokens.id });
    return { deleted: rows.length, degraded: false };
  } catch (e: any) {
    if (isMissingRelation(e)) {
      noteMissingTables("deletePushTokenForUser");
      return { deleted: 0, degraded: true };
    }
    throw e;
  }
}

// ─── Notification type → preference key → target mapping (Decision 14/15) ────

/**
 * The structured target vocabulary from the frozen contract §D. Kept in step
 * with `mobile/src/navigation/linkResolver.ts#NotificationTargetType`.
 */
export type NotificationTargetType = "project" | "brief" | "conversation" | "post" | "profile";

export const NOTIFICATION_TARGET_TYPES: readonly NotificationTargetType[] = [
  "project",
  "brief",
  "conversation",
  "post",
  "profile",
];

export function asTargetType(value: unknown): NotificationTargetType | null {
  return typeof value === "string" && (NOTIFICATION_TARGET_TYPES as readonly string[]).includes(value)
    ? (value as NotificationTargetType)
    : null;
}

/**
 * Exact type → preference key. Prefix families are handled after this map, so
 * a type the product adds later (`payment_disputed`, `project_paused`, …)
 * still lands in the right bucket instead of silently defaulting to "send".
 */
const TYPE_TO_PREF: Record<string, PushPreferenceKey> = {
  // ── Messages
  message: "pushMessages",

  // ── Project + stage activity
  stage_advanced: "pushProjectUpdates",
  project_invitation: "pushProjectUpdates",
  project_accepted: "pushProjectUpdates",
  project_started: "pushProjectUpdates",
  project_completed: "pushProjectUpdates",
  stage_submitted: "pushProjectUpdates",
  stage_approved: "pushProjectUpdates",
  deliverable_added: "pushProjectUpdates",
  review_requested: "pushProjectUpdates",

  // ── Brief interest / negotiation
  interest: "pushInterests",
  interest_accepted: "pushInterests",
  interest_declined: "pushInterests",
  counter_offered: "pushInterests",

  // ── Money
  payment_confirmed: "pushPayments",
  payment_requested: "pushPayments",
  payment_received: "pushPayments",
  invoice_sent: "pushPayments",
  invoice_paid: "pushPayments",

  // ── Social (default OFF)
  like: "pushSocial",
  comment: "pushSocial",
  profile_view: "pushSocial",
  connection_request: "pushSocial",
  connection_accepted: "pushSocial",
  follow: "pushSocial",
  agency_join_request: "pushSocial",
};

/**
 * Which of the five keys gates this notification type.
 *
 * `null` means "not gated by a user toggle": today that is only `system`,
 * which carries moderation decisions and account notices. The mobile settings
 * screen has no toggle for it, and `notify()` already refuses to suppress it
 * for a block for the same reason — a user must not be able to hide an
 * enforcement notice. Documented in impl-B4.md as a deliberate choice.
 */
export function pushPreferenceKeyForType(rawType: unknown): PushPreferenceKey | null {
  const type = String(rawType ?? "").trim();
  if (!type) return null;
  if (type === "system") return null;

  const exact = TYPE_TO_PREF[type];
  if (exact) return exact;

  // Prefix families, mirroring the mobile resolver's `familyOf()`.
  if (type.startsWith("message")) return "pushMessages";
  if (type.startsWith("stage_") || type.startsWith("project_") || type.startsWith("plan_")) {
    return "pushProjectUpdates";
  }
  if (type.startsWith("interest") || type.startsWith("counter_")) return "pushInterests";
  if (type.startsWith("payment_") || type.startsWith("invoice_") || type.startsWith("payout_")) {
    return "pushPayments";
  }
  if (type.startsWith("connection_") || type.startsWith("profile_")) return "pushSocial";

  // Unknown and unfamilied: treat as social, i.e. default OFF. An unmapped
  // type must not be able to push its way past a user's settings.
  return "pushSocial";
}

/**
 * Best-effort targeting derived from `type` + the existing web `link`, used
 * when a producer did not pass explicit targeting. Purely additive: the `link`
 * is only READ here, never rewritten (Decision 14 — the web notification
 * centre routes off it and must not change).
 */
export function deriveTargeting(
  type: unknown,
  link: unknown,
  actorId: unknown,
): { targetType: NotificationTargetType | null; targetId: number | null } {
  const t = String(type ?? "").trim();
  const segments = String(link ?? "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean);
  const head = segments[0];
  const pathId = /^\d+$/.test(segments[1] ?? "") ? Number(segments[1]) : null;
  const actor = Number(actorId);
  const actorNum = Number.isInteger(actor) && actor > 0 ? actor : null;

  const key = pushPreferenceKeyForType(t);

  // A DM thread is addressed by the counterparty's user id in this product, so
  // the actor IS the conversation id from the recipient's point of view.
  if (key === "pushMessages") return { targetType: "conversation", targetId: actorNum };

  if (head === "feed" && pathId) return { targetType: "post", targetId: pathId };
  if (head === "profile" || head === "marketplace") {
    return { targetType: "profile", targetId: pathId ?? actorNum };
  }
  if (head === "briefs" && pathId) return { targetType: "brief", targetId: pathId };
  if ((head === "project" || head === "projects" || head === "invoice") && pathId) {
    return { targetType: "project", targetId: pathId };
  }
  if (key === "pushSocial" && (t === "profile_view" || t.startsWith("connection_"))) {
    return { targetType: "profile", targetId: actorNum };
  }

  // `/your-work` and `/dashboard` carry no id. Returning the neighbourhood
  // without an id is still useful: the mobile resolver has an explicit
  // "structured type, no id" branch that lands on the right tab.
  if (key === "pushProjectUpdates" || key === "pushPayments") {
    return { targetType: "project", targetId: null };
  }
  if (key === "pushInterests") return { targetType: "brief", targetId: null };

  return { targetType: null, targetId: null };
}

// ─── Expo dispatch ───────────────────────────────────────────────────────────

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo's documented hard limit per request. */
const EXPO_BATCH_LIMIT = 100;

const EXPO_TIMEOUT_MS = 10_000;

function expoAccessToken(): string | null {
  const token = (process.env.EXPO_ACCESS_TOKEN ?? process.env.EXPO_PUSH_ACCESS_TOKEN ?? "").trim();
  return token || null;
}

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data: Record<string, unknown>;
  channelId?: string;
  badge?: number;
};

type ExpoTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string } | null;
};

/** Short, push-shaped titles. The notification `message` becomes the body. */
const PUSH_TITLES: Record<string, string> = {
  message: "New message",
  interest: "New interest",
  interest_accepted: "Interest accepted",
  interest_declined: "Interest update",
  counter_offered: "Counter offer",
  stage_advanced: "Project update",
  project_invitation: "Project invitation",
  project_accepted: "Invitation accepted",
  project_started: "Project started",
  project_completed: "Project completed",
  payment_confirmed: "Payment confirmed",
  payment_requested: "Payment requested",
  payment_received: "Payment received",
  invoice_sent: "Invoice ready",
  invoice_paid: "Invoice paid",
  like: "New like",
  comment: "New comment",
  profile_view: "Profile view",
  connection_request: "Connection request",
  connection_accepted: "Connection accepted",
  agency_join_request: "Agency request",
  system: "Viewrr",
};

function titleFor(type: string): string {
  return PUSH_TITLES[type] ?? "Viewrr";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PushDispatchInput = {
  recipientId: number;
  type: string;
  message: string;
  link?: string | null;
  actorId?: number | null;
  actorName?: string | null;
  targetType?: NotificationTargetType | string | null;
  targetId?: number | null;
  notificationId?: number | null;
};

export type PushDispatchResult = {
  sent: number;
  skipped: "no-credentials" | "no-tokens" | "preference-off" | "degraded" | null;
  invalidated: number;
};

/**
 * Send one notification to every device the recipient has registered.
 *
 * Awaited only by tests and by `dispatchPushAsync` below. Route handlers must
 * use `dispatchPushAsync`, which cannot throw.
 */
export async function dispatchPush(input: PushDispatchInput): Promise<PushDispatchResult> {
  const accessToken = expoAccessToken();
  if (!accessToken) {
    // Exactly one line for the lifetime of the process. Push being unconfigured
    // is the normal state of a dev machine and of this branch before Expo
    // credentials are provisioned; it is not an error and must not look like a
    // per-notification failure.
    warnOnce(
      "expo-not-configured",
      "[push] EXPO_ACCESS_TOKEN is not set — native push is disabled (no-op). " +
        "In-app notification rows and emails are unaffected.",
    );
    return { sent: 0, skipped: "no-credentials", invalidated: 0 };
  }

  // 1. Preference gate.
  const prefKey = pushPreferenceKeyForType(input.type);
  if (prefKey) {
    const { prefs, degraded } = await getOrCreatePushPreferences(input.recipientId);
    if (degraded) return { sent: 0, skipped: "degraded", invalidated: 0 };
    if (prefs[prefKey] === false) return { sent: 0, skipped: "preference-off", invalidated: 0 };
  }

  // 2. Devices.
  let tokenRows: { token: string; platform: string }[];
  try {
    tokenRows = await db
      .select({ token: schema.pushTokens.token, platform: schema.pushTokens.platform })
      .from(schema.pushTokens)
      .where(eq(schema.pushTokens.userId, input.recipientId));
  } catch (e: any) {
    if (isMissingRelation(e)) {
      noteMissingTables("dispatchPush");
      return { sent: 0, skipped: "degraded", invalidated: 0 };
    }
    throw e;
  }

  const tokens = Array.from(new Set(tokenRows.map((r) => r.token).filter(Boolean)));
  if (!tokens.length) return { sent: 0, skipped: "no-tokens", invalidated: 0 };

  // 3. Payload. `targetType`/`targetId` ride in `data` so M5's `linkResolver`
  //    (`targetingFromPush`) can route a tap with NO second fetch — the whole
  //    point of Decision 14 on the push path.
  const targetType = asTargetType(input.targetType);
  const data: Record<string, unknown> = {
    type: input.type,
    link: input.link ?? null,
    actorId: input.actorId ?? null,
    targetType,
    targetId: input.targetId ?? null,
  };
  if (input.notificationId != null) data.notificationId = input.notificationId;

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title: titleFor(input.type),
    body: input.message,
    sound: "default",
    // Must match ANDROID_CHANNEL_ID in mobile/src/push/PushProvider.tsx — Android
    // 8+ drops a notification whose channel the app never created.
    channelId: "default",
    data,
  }));

  let sent = 0;
  let invalidated = 0;

  for (const batch of chunk(messages, EXPO_BATCH_LIMIT)) {
    const tickets = await postToExpo(batch, accessToken);
    if (!tickets) continue;

    for (let i = 0; i < batch.length; i++) {
      const ticket = tickets[i];
      if (!ticket) continue;
      if (ticket.status === "ok") {
        sent++;
        continue;
      }
      invalidated += await handleTicketError(batch[i].to, ticket);
    }
  }

  return { sent, skipped: null, invalidated };
}

/**
 * One HTTP round trip. Returns the ticket array, or null when the whole request
 * failed (network, 5xx, malformed body) — a whole-request failure says nothing
 * about any individual token, so no token is ever deleted on this path.
 */
async function postToExpo(batch: ExpoMessage[], accessToken: string): Promise<ExpoTicket[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPO_TIMEOUT_MS);
  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });

    const payload = (await res.json().catch(() => null)) as
      | { data?: ExpoTicket[]; errors?: { code?: string; message?: string }[] }
      | null;

    if (!res.ok) {
      // 429 at the request level is Expo throttling us, not a bad token.
      console.warn(
        `[push] Expo send failed: HTTP ${res.status}`,
        payload?.errors?.map((e) => e.message).join("; ") ?? "",
      );
      return null;
    }
    if (payload?.errors?.length) {
      console.warn("[push] Expo returned request-level errors:", JSON.stringify(payload.errors));
    }
    return Array.isArray(payload?.data) ? payload!.data! : null;
  } catch (e: any) {
    const why = e?.name === "AbortError" ? `timed out after ${EXPO_TIMEOUT_MS}ms` : e?.message;
    console.warn("[push] Expo send failed:", why);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-ticket error handling. Returns how many token rows were deleted.
 *
 * The four documented `details.error` values are handled distinctly, because
 * only ONE of them means the token is dead:
 *
 *   DeviceNotRegistered  the token is permanently invalid (app uninstalled,
 *                        notifications revoked, token rotated) → DELETE the row.
 *   MessageTooBig        our payload is too large → our bug. NEVER delete: the
 *                        device is fine and would silently stop receiving
 *                        everything else.
 *   MessageRateExceeded  we are sending too fast to this device → transient.
 *                        NEVER delete; the next notification will go through.
 *   MismatchSenderId     Android FCM credentials do not match the token →
 *                        a configuration fault, not a device fault. Never
 *                        delete; deleting would hide a misconfiguration that
 *                        affects every Android device at once.
 */
async function handleTicketError(token: string, ticket: ExpoTicket): Promise<number> {
  const code = ticket.details?.error ?? "";
  const shortToken = token.slice(0, 24);

  if (code === "DeviceNotRegistered") {
    try {
      // Deleted by token value across users on purpose: an Expo token is
      // globally invalid once it is unregistered, so any row holding it is
      // dead — including a row left behind by a previous account on the same
      // install that the device-id prune did not catch.
      const removed = await db
        .delete(schema.pushTokens)
        .where(eq(schema.pushTokens.token, token))
        .returning({ id: schema.pushTokens.id });
      if (removed.length) {
        console.log(`[push] DeviceNotRegistered — removed ${removed.length} token row(s) for ${shortToken}…`);
      }
      return removed.length;
    } catch (e: any) {
      if (isMissingRelation(e)) {
        noteMissingTables("handleTicketError");
        return 0;
      }
      console.warn("[push] failed to delete unregistered token:", e?.message);
      return 0;
    }
  }

  if (code === "MessageTooBig") {
    console.warn(
      `[push] MessageTooBig for ${shortToken}… — payload exceeds Expo's 4KiB limit. ` +
        "Token KEPT; shorten the notification body/data.",
    );
    return 0;
  }

  if (code === "MessageRateExceeded") {
    console.warn(
      `[push] MessageRateExceeded for ${shortToken}… — transient throttle, token KEPT. ` +
        "Notification dropped; the next one will deliver.",
    );
    return 0;
  }

  if (code === "MismatchSenderId") {
    console.warn(
      `[push] MismatchSenderId for ${shortToken}… — FCM credentials do not match this token. ` +
        "Token KEPT; this is a server/app configuration fault.",
    );
    return 0;
  }

  console.warn(`[push] Expo ticket error for ${shortToken}…:`, ticket.message ?? code ?? "unknown");
  return 0;
}

/**
 * Fire-and-forget entry point. THE ONLY ONE ROUTES SHOULD CALL.
 *
 * Returns `void` synchronously and swallows everything: a push must never fail
 * the request that produced it, and must never delay the response. Called from
 * `notify()` in `server/routes.ts`.
 */
export function dispatchPushAsync(input: PushDispatchInput): void {
  try {
    void dispatchPush(input).catch((e: any) => {
      console.warn("[push] dispatch failed (non-fatal):", e?.message);
    });
  } catch (e: any) {
    // A synchronous throw (bad input) must not escape either.
    console.warn("[push] dispatch could not start (non-fatal):", e?.message);
  }
}

/** Test/ops helper: how many devices a user has registered. 0 when degraded. */
export async function countPushTokens(userId: number): Promise<number> {
  try {
    const rows = await db
      .select({ id: schema.pushTokens.id })
      .from(schema.pushTokens)
      .where(eq(schema.pushTokens.userId, userId));
    return rows.length;
  } catch (e: any) {
    if (isMissingRelation(e)) {
      noteMissingTables("countPushTokens");
      return 0;
    }
    return 0;
  }
}

/** Kept exported for a future admin sweep; `inArray` import stays honest. */
export async function deleteTokensByValues(tokens: string[]): Promise<number> {
  if (!tokens.length) return 0;
  try {
    const rows = await db
      .delete(schema.pushTokens)
      .where(inArray(schema.pushTokens.token, tokens))
      .returning({ id: schema.pushTokens.id });
    return rows.length;
  } catch (e: any) {
    if (isMissingRelation(e)) {
      noteMissingTables("deleteTokensByValues");
      return 0;
    }
    return 0;
  }
}
