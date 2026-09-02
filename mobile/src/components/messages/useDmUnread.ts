import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { loadDmUnreadCount } from "@/api/messages";
import { useSession } from "@/session/SessionProvider";

/**
 * The DM unread count — the Messages TAB badge, and nothing else.
 *
 * Decision 18, stated plainly: inbox unread state and notification-centre
 * events are DIFFERENT quantities and must never be summed into one number.
 *
 *   • header bell   → notification unread  → NotificationsProvider
 *                     (GET /api/notifications/:userId/unread-count)
 *   • Messages tab  → DM unread            → this module
 *                     (GET /api/messages/unread-count, DM only)
 *
 * They live in separate stores with separate endpoints and separate refresh
 * policies. NotificationsProvider is not owned by this agent and is not
 * touched; nothing here reads from or writes to it. A message that produced a
 * notification row legitimately increments both counters, because they measure
 * two different things — one "conversations awaiting your reply", the other
 * "events you have not looked at". Adding them would double-count by design.
 *
 * A tiny module-level store rather than a provider, because:
 *   • the tab bar lives in app/(app)/_layout.tsx, which is owned by M5 — a hook
 *     that needs no provider mount can be adopted there without a merge;
 *   • the Messages screens can push a locally known value (the `unreadTotal`
 *     the inbox just fetched, or a zero after mark-read) so the badge settles
 *     immediately instead of waiting for the next poll.
 */

const POLL_INTERVAL_MS = 30_000;
const FOREGROUND_MIN_INTERVAL_MS = 10_000;

let current: number | null = null;
let lastFetchedAt = 0;
let inFlight: AbortController | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number | null {
  return current;
}

/** Apply a locally known count — e.g. the inbox's own `unreadTotal`. */
export function setDmUnread(next: number): void {
  const clamped = Math.max(0, Math.trunc(next));
  if (clamped === current) return;
  current = clamped;
  emit();
}

/** Fetch the authoritative count. Failures keep the last known value. */
export async function refreshDmUnread(): Promise<void> {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  lastFetchedAt = Date.now();

  try {
    const count = await loadDmUnreadCount(controller.signal);
    if (controller.signal.aborted) return;
    setDmUnread(count);
  } catch {
    // A badge is never worth an error state; the next refresh corrects it and
    // a 401 is handled globally by the API client.
  }
}

/** Clear the badge on sign-out so a new session never inherits a stale number. */
export function resetDmUnread(): void {
  inFlight?.abort();
  inFlight = null;
  if (current === null) return;
  current = null;
  emit();
}

export type DmUnread = {
  /** Null until the first read resolves — never rendered as a zero badge. */
  count: number | null;
  refresh: () => void;
  set: (next: number) => void;
};

/**
 * Reads the DM unread count. Safe to mount in more than one place: the store is
 * shared, and the poll is per-consumer but cheap and de-duplicated by the
 * abort-on-refresh above.
 */
export function useDmUnread({ poll = true }: { poll?: boolean } = {}): DmUnread {
  const { status } = useSession();
  const signedIn = status === "signed-in";
  const count = useSyncExternalStore(subscribe, snapshot, snapshot);

  const refresh = useCallback(() => {
    if (!signedIn) return;
    void refreshDmUnread();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) {
      resetDmUnread();
      return;
    }
    refresh();
  }, [refresh, signedIn]);

  useEffect(() => {
    if (!signedIn || !poll) return;
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll, refresh, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const onChange = (next: AppStateStatus) => {
      if (next !== "active") return;
      if (Date.now() - lastFetchedAt < FOREGROUND_MIN_INTERVAL_MS) return;
      refresh();
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [refresh, signedIn]);

  return { count, refresh, set: setDmUnread };
}
