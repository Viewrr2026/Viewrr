/** Normalised API failure shape so screens never branch on raw fetch errors. */
export type ApiErrorKind =
  | "network" // no connectivity / DNS / TLS
  | "timeout" // exceeded API_TIMEOUT_MS
  | "unauthorized" // 401 — missing, expired or revoked credential
  | "forbidden" // 403
  | "not_found" // 404
  | "rate_limited" // 429 — express-rate-limit on the login endpoint
  | "server" // 5xx
  | "client" // other 4xx
  | "parse" // response body was not the expected JSON
  | "unknown";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly url: string;
  /**
   * Parsed JSON error body, when the server sent one. The Viewrr backend
   * returns `{ error, code? }`. Never contains a credential — mobile/login
   * returns no token on failure (server/tests/security.test.ts T14).
   */
  readonly payload?: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    url: string,
    status?: number,
    payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.url = url;
    this.status = status;
    this.payload = payload;
  }

  /** `code` from the backend's `{ error, code }` envelope, if present. */
  get serverCode(): string | null {
    const code = (this.payload as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? code : null;
  }

  /**
   * `error` from the backend's `{ error, code }` envelope. Safe to display:
   * the Viewrr backend's auth errors are written for end users and contain no
   * secrets. Returns null for non-JSON bodies so raw HTML is never shown.
   */
  get serverMessage(): string | null {
    const message = (this.payload as { error?: unknown } | undefined)?.error;
    return typeof message === "string" && message.length > 0 && message.length < 300
      ? message
      : null;
  }

  /** Copy suitable for showing to a user. Never leaks URLs or stack traces. */
  get userMessage(): string {
    switch (this.kind) {
      case "network":
        return "No connection. Check your network and try again.";
      case "timeout":
        return "That took too long. Try again.";
      case "unauthorized":
      case "forbidden":
        return "You need to sign in to do that.";
      case "rate_limited":
        return "Too many attempts. Please wait a few minutes and try again.";
      case "not_found":
        return "We couldn't find that.";
      case "server":
        return "Viewrr is having a problem. Try again shortly.";
      default:
        return "Something went wrong. Try again.";
    }
  }
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "unknown";
}
