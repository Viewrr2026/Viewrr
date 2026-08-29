import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Session state — PLACEHOLDER for Alpha 0.1.
 *
 * There is intentionally NO real authentication here:
 *   • no credential is persisted (expo-secure-store is not wired up)
 *   • no network call is made
 *   • the web cookie model (HttpOnly `vr_sess`, SameSite=Strict) is untouched
 *
 * Native auth will be built against a separate reviewed native-auth endpoint
 * with a Bearer credential. When that lands, only `restore` and `signIn` below
 * change — screens consume this context and should not need edits.
 */

export type SessionUser = {
  displayName: string;
  /** Mirrors the web platform's role vocabulary: client | freelancer | admin. */
  role: "client" | "freelancer" | "admin";
};

export type SessionStatus = "restoring" | "signed-out" | "signed-in";

type SessionValue = {
  status: SessionStatus;
  user: SessionUser | null;
  /** Placeholder: establishes a local-only stub session. No network, no token. */
  signInPlaceholder: (user?: SessionUser) => void;
  signOut: () => void;
};

const STUB_USER: SessionUser = { displayName: "Preview User", role: "freelancer" };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("restoring");
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    // Credential restore seam. No secure store yet, so we resolve to signed-out.
    let cancelled = false;
    const restore = async () => {
      if (cancelled) return;
      setStatus("signed-out");
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const signInPlaceholder = useCallback((next: SessionUser = STUB_USER) => {
    setUser(next);
    setStatus("signed-in");
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, user, signInPlaceholder, signOut }),
    [status, user, signInPlaceholder, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return context;
}
