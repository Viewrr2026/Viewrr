/** Normalised API failure shape so screens never branch on raw fetch errors. */
export type ApiErrorKind =
  | "network" // no connectivity / DNS / TLS
  | "timeout" // exceeded API_TIMEOUT_MS
  | "unauthorized" // 401 — no native credential yet, expected for now
  | "forbidden" // 403
  | "not_found" // 404
  | "server" // 5xx
  | "client" // other 4xx
  | "parse" // response body was not the expected JSON
  | "unknown";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly url: string;

  constructor(kind: ApiErrorKind, message: string, url: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.url = url;
    this.status = status;
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
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "unknown";
}
