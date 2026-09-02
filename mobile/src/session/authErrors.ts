import { ApiError } from "@/api/errors";

/**
 * Maps a sign-in failure to user-facing copy.
 *
 * Rules:
 *   • Never echoes a raw response body, URL, stack or header — only the
 *     backend's own `{ error }` string, which PRD-019 writes for end users, or
 *     a fixed local string.
 *   • Distinguishes the four states the task requires: bad credentials,
 *     no network, 429 rate limit, server error.
 */

export type AuthFailure = {
  /** Coarse bucket, useful for tests and analytics. Never shown raw. */
  reason: "credentials" | "offline" | "rate_limited" | "server" | "conflict" | "unknown";
  title: string;
  message: string;
  /** True when the message belongs under the password field, not in a banner. */
  fieldLevel: boolean;
};

const FALLBACK: AuthFailure = {
  reason: "unknown",
  title: "Sign-in failed",
  message: "Something went wrong. Please try again.",
  fieldLevel: false,
};

export function describeAuthFailure(error: unknown): AuthFailure {
  if (!(error instanceof ApiError)) return FALLBACK;

  switch (error.kind) {
    case "unauthorized":
      return {
        reason: "credentials",
        title: "Check your details",
        // NO_PASSWORD_SET is a real PRD-019 response for accounts created
        // before passwords existed — it needs its own instruction.
        message:
          error.serverCode === "NO_PASSWORD_SET"
            ? "This account has no password yet. Use 'Forgot password' on viewrr.co.uk to set one."
            : (error.serverMessage ?? "Invalid email or password."),
        fieldLevel: error.serverCode !== "NO_PASSWORD_SET",
      };

    case "rate_limited":
      return {
        reason: "rate_limited",
        title: "Too many attempts",
        message:
          error.serverMessage ??
          "Too many login attempts. Please wait 15 minutes before trying again.",
        fieldLevel: false,
      };

    case "network":
    case "timeout":
      return {
        reason: "offline",
        title: "No connection",
        message: "You appear to be offline. Check your network and try again.",
        fieldLevel: false,
      };

    case "server":
      return {
        reason: "server",
        title: "Viewrr is having a problem",
        message: "Our servers are not responding. Please try again shortly.",
        fieldLevel: false,
      };

    case "client":
      return {
        reason: "credentials",
        title: "Check your details",
        message: error.serverMessage ?? "Please enter your email and password.",
        fieldLevel: true,
      };

    default:
      return FALLBACK;
  }
}


/* ── Registration and verification (PRD 1, Decision 4) ────────────────────── */

const REGISTER_FALLBACK: AuthFailure = {
  reason: "unknown",
  title: "Account not created",
  message: "Something went wrong. Please try again.",
  fieldLevel: false,
};

const OFFLINE: AuthFailure = {
  reason: "offline",
  title: "No connection",
  message: "You appear to be offline. Check your network and try again.",
  fieldLevel: false,
};

const SERVER: AuthFailure = {
  reason: "server",
  title: "Viewrr is having a problem",
  message: "Our servers are not responding. Please try again shortly.",
  fieldLevel: false,
};

/**
 * Maps a POST /api/auth/mobile/register failure to user-facing copy.
 *
 * Same rules as describeAuthFailure: only the backend's own `{ error }` string
 * or a fixed local string is ever shown. The one shape needing its own branch
 * is the duplicate-email 409, which belongs under the email field rather than
 * in a banner.
 */
export function describeRegistrationFailure(error: unknown): AuthFailure {
  if (!(error instanceof ApiError)) return REGISTER_FALLBACK;

  if (error.status === 409) {
    return {
      reason: "conflict",
      title: "That email is already registered",
      message: error.serverMessage ?? "An account already uses that email. Sign in instead.",
      fieldLevel: true,
    };
  }

  switch (error.kind) {
    case "client":
      // Zod rejection — the backend's message names the offending field.
      return {
        reason: "credentials",
        title: "Check your details",
        message: error.serverMessage ?? "Please check the details you entered.",
        fieldLevel: false,
      };

    case "rate_limited":
      return {
        reason: "rate_limited",
        title: "Too many attempts",
        message:
          error.serverMessage ??
          "Too many sign-up attempts. Please wait a few minutes and try again.",
        fieldLevel: false,
      };

    case "network":
    case "timeout":
      return OFFLINE;

    case "server":
      return SERVER;

    default:
      return REGISTER_FALLBACK;
  }
}

const VERIFY_FALLBACK: AuthFailure = {
  reason: "unknown",
  title: "Verification failed",
  message: "Something went wrong. Please try again.",
  fieldLevel: false,
};

/**
 * Maps a verify-email / resend-verification failure.
 *
 * A wrong or expired code arrives as a 4xx carrying the backend's own
 * explanation, so it is shown under the code field. A 401 needs no branch: the
 * API client's global hook has already torn the session down.
 */
export function describeVerificationFailure(error: unknown): AuthFailure {
  if (!(error instanceof ApiError)) return VERIFY_FALLBACK;

  switch (error.kind) {
    case "client":
    case "not_found":
      return {
        reason: "credentials",
        title: "Check the code",
        message:
          error.serverMessage ?? "That code is not valid or has expired. Request a new one.",
        fieldLevel: true,
      };

    case "rate_limited":
      return {
        reason: "rate_limited",
        title: "Too many attempts",
        message:
          error.serverMessage ?? "Too many attempts. Please wait a few minutes and try again.",
        fieldLevel: false,
      };

    case "network":
    case "timeout":
      return OFFLINE;

    case "server":
      return SERVER;

    default:
      return VERIFY_FALLBACK;
  }
}
