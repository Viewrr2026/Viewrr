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

import {
  fetchMe,
  logout as logoutRequest,
  mobileLogin,
  mobileRegister,
  type LoginResponse,
  type MeResponse,
  type RegisterInput,
} from "@/api/auth";
import { setUnauthorizedHandler } from "@/api/client";
import { canPersistCredential, clearToken, getToken, setToken } from "@/session/tokenStore";

/**
 * Native session state — PRD-019 Bearer auth.
 *
 * Contract:
 *   • Sign-in POSTs /api/auth/mobile/login and persists the returned raw token
 *     in the Keychain / Keystore (session/tokenStore). Nothing else is stored.
 *   • Cold start reads that token and validates it with GET /api/auth/me. A 401
 *     clears storage and drops to signed-out; a network failure keeps the token
 *     and reports "offline" so a flight-mode launch does not sign the user out.
 *   • Any authenticated 401 anywhere in the app clears the credential through
 *     the global handler registered below.
 *   • Sign-out calls POST /api/auth/logout with the Bearer header (server-side
 *     revocation) and then clears secure storage — in that order, and the local
 *     clear happens even if the network call fails.
 *   • The web platform's HttpOnly `vr_sess` cookie flow is untouched; this
 *     client never sends or stores a cookie.
 *
 * The raw token is never placed in state, props, logs or error copy. It exists
 * only inside tokenStore and the Authorization header.
 *
 * PRD 1 (Decision 4) ADDS `register()` and nothing else: token storage, Bearer
 * handling, SecureStore behaviour, logout semantics and the authenticated
 * routing guards are untouched. `register()` reuses the exact same credential
 * tail as `signIn` (see `adoptCredential`), so there is one code path that ever
 * persists a token.
 */

export type SessionUser = {
  id: number;
  displayName: string;
  /** Mirrors the web platform's role vocabulary: client | freelancer | admin. */
  role: "client" | "freelancer" | "admin";
};

export type SessionStatus = "restoring" | "signed-out" | "signed-in";

/** Why a cold-start restore ended without a session. Drives no UI copy today. */
export type RestoreOutcome = "no-credential" | "restored" | "rejected" | "unreachable";

type SessionValue = {
  status: SessionStatus;
  user: SessionUser | null;
  /** Set when the last restore attempt failed for network reasons. */
  restoreOutcome: RestoreOutcome | null;
  /** Throws ApiError on failure; callers map it with describeAuthFailure. */
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Create an account and adopt the returned credential. Throws ApiError on
   * failure; callers map it with describeRegistrationFailure.
   */
  register: (input: RegisterInput) => Promise<void>;
  /**
   * True only between a registration that reported `emailVerificationRequired`
   * and a successful verification in the same app run. Never set on cold start,
   * so a grandfathered existing account (Decision 4) can never be shown the
   * verification screen.
   */
  emailVerificationRequired: boolean;
  /** Called by the verification screen once the server confirms the code. */
  markEmailVerified: () => void;
  signOut: () => Promise<void>;
  /** True while a sign-out round-trip is in flight. */
  signingOut: boolean;
};

const SessionContext = createContext<SessionValue | null>(null);

function normaliseRole(role: unknown, isAdmin: unknown): SessionUser["role"] {
  if (isAdmin === true || isAdmin === 1) return "admin";
  if (role === "freelancer" || role === "client" || role === "admin") return role;
  return "client";
}

/** Minimum session state the app needs. Email, tokens and hashes are not kept. */
function toSessionUser(input: {
  id: number;
  name?: string | null;
  role?: string | null;
  isAdmin?: boolean | number | null;
}): SessionUser {
  return {
    id: input.id,
    displayName: input.name?.trim() || "Viewrr",
    role: normaliseRole(input.role, input.isAdmin),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("restoring");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoreOutcome, setRestoreOutcome] = useState<RestoreOutcome | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Local-only teardown. Used by cold-start rejection and the 401 handler. */
  const forceSignedOut = useCallback(async () => {
    await clearToken();
    if (!mounted.current) return;
    setUser(null);
    setStatus("signed-out");
  }, []);

  // A 401 on ANY authenticated request means the session was revoked or
  // expired server-side. Clear the credential and return to sign-in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void forceSignedOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [forceSignedOut]);

  // Cold start: restore from secure storage, then validate through /api/auth/me.
  useEffect(() => {
    const controller = new AbortController();

    const restore = async () => {
      if (!canPersistCredential) {
        // Expo web preview holds no credential across reloads by design.
        if (mounted.current) {
          setRestoreOutcome("no-credential");
          setStatus("signed-out");
        }
        return;
      }

      const token = await getToken();
      if (!token) {
        if (mounted.current) {
          setRestoreOutcome("no-credential");
          setStatus("signed-out");
        }
        return;
      }

      try {
        const me: MeResponse = await fetchMe(controller.signal);
        if (!mounted.current) return;
        if (!me.authenticated || !me.user) {
          setRestoreOutcome("rejected");
          await forceSignedOut();
          return;
        }
        setUser(toSessionUser(me.user));
        setRestoreOutcome("restored");
        setStatus("signed-in");
      } catch (error) {
        if (!mounted.current) return;
        const status = (error as { status?: number }).status;
        if (status === 401) {
          // The 401 handler already cleared storage; record the reason.
          setRestoreOutcome("rejected");
          await forceSignedOut();
          return;
        }
        // Offline / timeout / 5xx: keep the credential for the next launch.
        setRestoreOutcome("unreachable");
        setStatus("signed-out");
      }
    };

    void restore();
    return () => controller.abort();
  }, [forceSignedOut]);

  /**
   * The one credential tail. Persists the token, then flips session state.
   * Shared by sign-in and registration so there is a single place a token is
   * ever written and a single definition of "signed in".
   */
  const adoptCredential = useCallback(
    async (result: LoginResponse | null | undefined, context: string) => {
      if (!result?.token || !result.user) {
        // Contract violation rather than a credential problem.
        throw new Error(`${context} response was incomplete.`);
      }
      await setToken(result.token);
      if (!mounted.current) return;
      setUser(toSessionUser(result.user));
      setRestoreOutcome("restored");
      setStatus("signed-in");
    },
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await mobileLogin(email.trim(), password);
      // A sign-in is an existing account: verification is never re-demanded here.
      setEmailVerificationRequired(false);
      await adoptCredential(result, "Sign-in");
    },
    [adoptCredential],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const result = await mobileRegister(input);
      // Read the flag before adopting, so the auth stack sees the pending state
      // in the same render pass that turns the session signed-in.
      setEmailVerificationRequired(result?.emailVerificationRequired === true);
      await adoptCredential(result, "Registration");
    },
    [adoptCredential],
  );

  const markEmailVerified = useCallback(() => {
    setEmailVerificationRequired(false);
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      // Revoke server-side first — while the Bearer header can still be sent.
      await logoutRequest();
    } catch {
      // Network failure must not trap the user in a signed-in shell. The token
      // is discarded locally regardless; the server session expires on its own.
    } finally {
      await clearToken();
      if (mounted.current) {
        setUser(null);
        setRestoreOutcome(null);
        setStatus("signed-out");
        setSigningOut(false);
        setEmailVerificationRequired(false);
      }
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      restoreOutcome,
      signIn,
      register,
      emailVerificationRequired,
      markEmailVerified,
      signOut,
      signingOut,
    }),
    [
      status,
      user,
      restoreOutcome,
      signIn,
      register,
      emailVerificationRequired,
      markEmailVerified,
      signOut,
      signingOut,
    ],
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
