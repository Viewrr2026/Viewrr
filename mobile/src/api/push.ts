import { api, request } from "@/api/client";

/**
 * Push token + push preference endpoints (Decision 15, frozen contract § D).
 *
 *   POST   /api/me/push-tokens        { token, platform, deviceId?, appVersion? }
 *   DELETE /api/me/push-tokens        { token }
 *   GET    /api/me/push-preferences   → PushPreferences
 *   PATCH  /api/me/push-preferences   → PushPreferences
 *
 * PUSH PREFERENCES ARE NOT EMAIL PREFERENCES.
 * The eight keys on /api/notifications/preferences/:userId control email and
 * in-app notification delivery. The five keys here control device push, and
 * nothing else. Never read one set and present it as the other — a user who
 * turned off marketing email has not turned off a message push, and a user who
 * disabled push messages still gets the in-app notification row (Decision 18).
 *
 * The token endpoints are called by src/push/PushProvider; the preference
 * endpoints exist for the settings UI (M2) to import.
 */

export type PushPlatform = "ios" | "android";

/** POST /api/me/push-tokens body. */
export type PushTokenRegistration = {
  /** Expo push token, e.g. "ExponentPushToken[...]". */
  token: string;
  platform: PushPlatform;
  /** Stable per-install id, so one account's devices can be told apart. */
  deviceId?: string;
  /** App version string, for invalid-token triage server-side. */
  appVersion?: string;
};

export type PushTokenRegistered = { registered: boolean };
export type PushTokenRemoved = { ok: boolean };

/**
 * The five push keys. Distinct from the eight email keys — see the header.
 *
 *   pushMessages        direct messages
 *   pushProjectUpdates  project + stage activity
 *   pushInterests       brief interest / negotiation activity
 *   pushPayments        payments and invoices
 *   pushSocial          likes, comments, follows, profile views (default off)
 */
export type PushPreferences = {
  pushMessages: boolean;
  pushProjectUpdates: boolean;
  pushInterests: boolean;
  pushPayments: boolean;
  pushSocial: boolean;
};

export type PushPreferenceKey = keyof PushPreferences;

/** Declared as a value so a settings screen can render rows without a literal. */
export const PUSH_PREFERENCE_KEYS: readonly PushPreferenceKey[] = [
  "pushMessages",
  "pushProjectUpdates",
  "pushInterests",
  "pushPayments",
  "pushSocial",
] as const;

/** Human labels for the five keys, so every surface words them identically. */
export const PUSH_PREFERENCE_LABELS: Record<
  PushPreferenceKey,
  { title: string; description: string }
> = {
  pushMessages: {
    title: "Messages",
    description: "When someone sends you a direct message.",
  },
  pushProjectUpdates: {
    title: "Project updates",
    description: "Stage changes, approvals and project activity.",
  },
  pushInterests: {
    title: "Brief interest",
    description: "Applications, counter-offers and interest replies.",
  },
  pushPayments: {
    title: "Payments",
    description: "Invoices issued, payments received and released.",
  },
  pushSocial: {
    title: "Social",
    description: "Likes, comments, follows and profile views.",
  },
};

/**
 * Server defaults from migration 0006, mirrored so a settings screen can
 * render controls before the first GET resolves. Only used as a placeholder —
 * never written back as if it were the user's saved answer.
 */
export const PUSH_PREFERENCE_DEFAULTS: PushPreferences = {
  pushMessages: true,
  pushProjectUpdates: true,
  pushInterests: true,
  pushPayments: true,
  pushSocial: false,
};

export function registerPushToken(
  body: PushTokenRegistration,
  signal?: AbortSignal,
): Promise<PushTokenRegistered> {
  return api.post<PushTokenRegistered>("/api/me/push-tokens", body, { signal });
}

/**
 * Deregistration. DELETE carries a body here because the contract addresses the
 * token in the body rather than the path (a token is not URL-safe as a path
 * segment), so this uses `request` directly — `api.delete` sends no body.
 */
export function deletePushToken(token: string, signal?: AbortSignal): Promise<PushTokenRemoved> {
  return request<PushTokenRemoved>("/api/me/push-tokens", {
    method: "DELETE",
    body: { token },
    signal,
  });
}

export function fetchPushPreferences(signal?: AbortSignal): Promise<PushPreferences> {
  return api.get<PushPreferences>("/api/me/push-preferences", { signal });
}

/** Partial update — send only the keys the user changed. */
export function updatePushPreferences(
  patch: Partial<PushPreferences>,
  signal?: AbortSignal,
): Promise<PushPreferences> {
  return api.patch<PushPreferences>("/api/me/push-preferences", patch, { signal });
}

/**
 * Normalise a preferences response. The endpoint is new on both sides; a
 * missing key is read as the documented default rather than as `false`, so a
 * partial payload never silently claims a channel is off.
 */
export function normalisePushPreferences(input: unknown): PushPreferences {
  const record: Record<string, unknown> =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

  const read = (key: PushPreferenceKey): boolean => {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === 0) return value === 1;
    return PUSH_PREFERENCE_DEFAULTS[key];
  };

  return {
    pushMessages: read("pushMessages"),
    pushProjectUpdates: read("pushProjectUpdates"),
    pushInterests: read("pushInterests"),
    pushPayments: read("pushPayments"),
    pushSocial: read("pushSocial"),
  };
}
