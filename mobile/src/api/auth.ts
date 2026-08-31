import { api } from "@/api/client";

/**
 * PRD-019 native auth endpoints, exactly as implemented in server/routes.ts.
 *
 *   POST /api/auth/mobile/login   { email, password } → { user, token }
 *                                  401 { error, code? } on bad credentials
 *                                  429 { error } from loginLimiter
 *   GET  /api/auth/me             Bearer → { authenticated, user }
 *                                  401 { error } when revoked/expired
 *   POST /api/auth/logout         Bearer → { ok: true } (revokes the session)
 *
 * The mobile login endpoint sets no cookie (server/tests/security.test.ts T13),
 * so the web HttpOnly `vr_sess` model is entirely untouched by this client.
 */

export type AuthRole = "client" | "freelancer" | "admin";

/** Shape of `safeUserDto(user)` — the fields the app actually consumes. */
export type LoginResponse = {
  token: string;
  user: {
    id: number;
    name?: string | null;
    email?: string | null;
    role?: string | null;
    avatar?: string | null;
    isAdmin?: boolean | number | null;
  };
};

/** Shape returned by GET /api/auth/me. */
export type MeResponse = {
  authenticated: boolean;
  user: {
    id: number;
    name: string | null;
    email: string | null;
    role: string | null;
    avatar: string | null;
    isAdmin: boolean | number | null;
    sessionType: "web" | "mobile";
  };
};

/**
 * Exchange credentials for a Bearer token.
 *
 * `anonymous: true` — a login attempt must never carry an existing (possibly
 * revoked) Authorization header, and its 401 must not trigger the global
 * sign-out hook, because a wrong password is not a dead session.
 */
export function mobileLogin(email: string, password: string) {
  return api.post<LoginResponse>(
    "/api/auth/mobile/login",
    { email, password },
    { anonymous: true },
  );
}

/** Validate the stored credential and fetch the current user. */
export function fetchMe(signal?: AbortSignal) {
  return api.get<MeResponse>("/api/auth/me", { signal });
}

/** Revoke the current mobile session server-side. */
export function logout() {
  return api.post<{ ok: boolean }>("/api/auth/logout");
}
