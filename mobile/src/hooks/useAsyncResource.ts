import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/errors";

/**
 * The global four-state contract, in one place.
 *
 * Every data-driven Viewrr screen resolves to exactly one of loading / ready /
 * error, and an error is further split into "offline" and "failed" so the UI
 * can tell a dead network apart from a sick server — the distinction the shell
 * spec requires and the one users actually feel.
 *
 * Emptiness is deliberately NOT a phase here: only the screen knows whether
 * zero rows means "nothing yet" or "nothing matched", so `ready` carries the
 * data and the screen decides.
 */

export type ResourceFailure = {
  /** No usable connection — retrying later is the right advice. */
  kind: "offline" | "failed";
  /** Safe, human copy. Never a raw body, URL or stack. */
  message: string;
  /** Present for rate limiting so screens can soften the tone. */
  rateLimited: boolean;
};

export type Resource<T> =
  | { phase: "loading" }
  | { phase: "ready"; data: T }
  | { phase: "error"; failure: ResourceFailure };

export type AsyncResource<T> = {
  resource: Resource<T>;
  /** True while a pull-to-refresh is in flight over already-rendered data. */
  refreshing: boolean;
  /** Re-run the loader, keeping current data on screen. */
  refresh: () => void;
  /** Re-run the loader from the loading state (used by error retry). */
  reload: () => void;
  /** Replace the data locally — for optimistic updates. */
  mutate: (update: (current: T) => T) => void;
};

function describe(error: unknown): ResourceFailure {
  if (error instanceof ApiError) {
    const offline = error.kind === "network" || error.kind === "timeout";
    return {
      kind: offline ? "offline" : "failed",
      // The backend's own `{ error }` copy is written for end users, so prefer
      // it when present; otherwise fall back to the client's mapped message.
      message: error.serverMessage ?? error.userMessage,
      rateLimited: error.kind === "rate_limited",
    };
  }
  return { kind: "failed", message: "Something went wrong. Try again.", rateLimited: false };
}

/**
 * @param loader  Receives an AbortSignal — pass it to every request so an
 *                unmount or a rapid re-fetch cancels the previous round-trip.
 * @param enabled Skip loading entirely (e.g. before a user id exists).
 */
export function useAsyncResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  { enabled = true }: { enabled?: boolean } = {},
): AsyncResource<T> {
  const [resource, setResource] = useState<Resource<T>>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  // Held in a ref so a caller can pass an inline arrow without re-running the
  // effect on every render.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!enabled) return;

      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;

      if (mode === "refresh") setRefreshing(true);
      else setResource({ phase: "loading" });

      try {
        const data = await loaderRef.current(next.signal);
        if (!mounted.current || next.signal.aborted) return;
        setResource({ phase: "ready", data });
      } catch (error) {
        if (!mounted.current || next.signal.aborted) return;
        // A 401 has already been handled globally by the API client, which
        // tears the session down; there is no point rendering an error for a
        // screen that is about to unmount.
        if (error instanceof ApiError && error.kind === "unauthorized") return;
        setResource({ phase: "error", failure: describe(error) });
      } finally {
        if (mounted.current && mode === "refresh") setRefreshing(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    void run("initial");
  }, [run]);

  const mutate = useCallback((update: (current: T) => T) => {
    setResource((current) =>
      current.phase === "ready" ? { phase: "ready", data: update(current.data) } : current,
    );
  }, []);

  return {
    resource,
    refreshing,
    refresh: useCallback(() => void run("refresh"), [run]),
    reload: useCallback(() => void run("initial"), [run]),
    mutate,
  };
}
