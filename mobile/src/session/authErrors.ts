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
  reason: "credentials" | "offline" | "rate_limited" | "server" | "unknown";
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
