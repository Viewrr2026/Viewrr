import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { fetchUnreadCount } from "@/api/notifications";
import { useSession } from "@/session/SessionProvider";

/**
 * The single source of truth for the unread-notification badge.
 *
 * The bell lives in the header of every authenticated screen, so the count is
 * held once at shell level rather than re-fetched per screen. Reads use
 * GET /api/notifications/:userId/unread-count — the endpoint the backend
 * comments describe as the polling endpoint, and the cheapest read available.
 *
 * Refresh policy, deliberately conservative:
 *   • once when the shell mounts with a signed-in user;
 *   • when the app returns to the foreground, and no more than once a minute;
 *   • on demand, when the notification centre changes read state.
 * There is no timer. Background polling is a battery and rate-limit cost that
 * only pays off once push exists, and push is a later phase.
 */

const FOREGROUND_MIN_INTERVAL_MS = 60_000;

type NotificationsValue = {
  /** Unread count from the backend. Null until the first read resolves. */
  unread: number | null;
  refresh: () => void;
  /** Apply a locally known change without waiting for a round-trip. */
  setUnread: (next: number) => void;
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  const [unread, setUnreadState] = useState<number | null>(null);

  const mounted = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  const lastFetchedAt = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  const userId = status === "signed-in" ? (user?.id ?? null) : null;

  const refresh = useCallback(() => {
    if (userId === null) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    lastFetchedAt.current = Date.now();

    void (async () => {
      try {
        const result = await fetchUnreadCount(userId, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setUnreadState(Number.isFinite(result?.count) ? result.count : 0);
      } catch {
        // A badge is not worth an error state. Keep the last known value and
        // let the next refresh correct it; a 401 is handled globally.
      }
    })();
  }, [userId]);

  useEffect(() => {
    if (userId === null) {
      setUnreadState(null);
      return;
    }
    refresh();
  }, [refresh, userId]);

  useEffect(() => {
    if (userId === null) return;

    const onChange = (next: AppStateStatus) => {
      if (next !== "active") return;
      if (Date.now() - lastFetchedAt.current < FOREGROUND_MIN_INTERVAL_MS) return;
      refresh();
    };

    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [refresh, userId]);

  const setUnread = useCallback((next: number) => {
    setUnreadState(Math.max(0, next));
  }, []);

  const value = useMemo<NotificationsValue>(
    () => ({ unread, refresh, setUnread }),
    [refresh, setUnread, unread],
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error("useNotifications must be used inside <NotificationsProvider>");
  }
  return value;
}
