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
 * PRD 1 (Decision 4) adds native registration and email verification, against
 * the frozen contract in /tmp/prd1/CONTRACT.md section D:
 *
 *   POST /api/auth/mobile/register              { name, email, password, role }
 *                                  → 201 { user, profile, token,
 *                                          emailVerificationRequired: true }
 *   POST /api/auth/mobile/verify-email        Bearer { code } → { verified }
 *   POST /api/auth/mobile/resend-verification  Bearer → { sent }
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

/* ── Registration (PRD 1, Decision 4) ─────────────────────────────────────── */

/** The two roles a self-service native sign-up may choose. Admin is never one. */
export type RegistrationRole = "freelancer" | "client";

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
  role: RegistrationRole;
};

/**
 * POST /api/auth/mobile/register.
 *
 * `profile` is the freshly created profile row. Mobile does not consume it — the
 * profile surfaces re-read it from their own endpoints — so it is deliberately
 * left as `unknown` rather than given a shape this client cannot verify.
 */
export type RegisterResponse = {
  token: string;
  user: LoginResponse["user"];
  profile?: unknown;
  /** True for every newly created account; existing accounts are grandfathered. */
  emailVerificationRequired?: boolean;
};

export type VerifyEmailResponse = { verified: boolean };
export type ResendVerificationResponse = { sent: boolean };

/**
 * Create an account and receive a Bearer token in one round-trip.
 *
 * `anonymous: true` for the same reason as login: a stale credential must not
 * be attached, and a 4xx here is a form problem, not a dead session.
 */
export function mobileRegister(input: RegisterInput) {
  return api.post<RegisterResponse>(
    "/api/auth/mobile/register",
    {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      role: input.role,
    },
    { anonymous: true },
  );
}

/** Submit the emailed verification code. Authenticated — the token is the identity. */
export function verifyEmail(code: string) {
  return api.post<VerifyEmailResponse>("/api/auth/mobile/verify-email", {
    code: code.trim(),
  });
}

/** Ask the server to send a fresh verification code. */
export function resendVerification() {
  return api.post<ResendVerificationResponse>("/api/auth/mobile/resend-verification");
}

/* ── Client-side mirror of the server password policy ─────────────────────── */

/**
 * Contract section D: "min 10 chars, not in a small common-password list".
 *
 * Mirrored here so the form can refuse locally instead of spending a round-trip
 * to be told the obvious. The SERVER remains authoritative — this is a
 * convenience check, never a substitute, and its failures are worded the same
 * way the backend words them.
 */
export const PASSWORD_MIN_LENGTH = 10;

const COMMON_PASSWORDS: readonly string[] = [
  "password",
  "password1",
  "password123",
  "passw0rd123",
  "1234567890",
  "12345678910",
  "qwertyuiop",
  "letmein123",
  "iloveyou123",
  "welcome123",
  "admin12345",
  "viewrr1234",
  "viewrr12345",
];

/** Returns user-facing copy for an unacceptable password, or null when it passes. */
export function describePasswordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
    return "That password is too common. Choose something harder to guess.";
  }
  return null;
}

/** Deliberately permissive — the server's Zod email check is authoritative. */
export function looksLikeEmail(email: string): boolean {
  const value = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}


export type ForgotPasswordResponse = {
  message?: string;
};

export async function requestPasswordReset(
  email: string,
): Promise<ForgotPasswordResponse> {
  return api.post<ForgotPasswordResponse>("/api/auth/forgot-password", {
    email: email.trim().toLowerCase(),
  });
}
