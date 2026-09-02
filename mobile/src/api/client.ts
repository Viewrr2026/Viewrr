import { API_BASE_URL, API_PREFIX, API_TIMEOUT_MS } from "@/config/env";
import { ApiError, kindForStatus } from "@/api/errors";
import { getToken } from "@/session/tokenStore";

/**
 * Viewrr Mobile API client.
 *
 * Deliberate boundaries:
 *   • Absolute base URL only. Never same-origin/relative like the web client.
 *   • `credentials` is NOT set. Cookie-based `vr_sess` auth is a web-only
 *     security model (HttpOnly + SameSite=Strict) and stays that way — this
 *     client never sends or receives that cookie.
 *   • Native auth is Bearer-only, per PRD-019. `attachCredential` below is the
 *     single seam that reads the stored credential; nothing else in the app
 *     knows how it is stored.
 *   • Tokens are never logged and never placed in an ApiError.
 */

export type Query = Record<string, string | number | boolean | undefined | null>;

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-serialisable body. */
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Skip the Authorization header. Used by the login endpoint, which must be
   * callable while a stale credential is still in storage.
   */
  anonymous?: boolean;
};

/**
 * Credential seam — the single place a stored credential becomes a header.
 * Reads from expo-secure-store (see session/tokenStore).
 */
async function attachCredential(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Global 401 hook. SessionProvider registers here at mount so any authenticated
 * request that meets a revoked or expired session clears secure storage and
 * returns the user to sign-in, regardless of which screen made the call.
 */
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function buildUrl(path: string, query?: Query): string {
  const prefixed = path.startsWith(API_PREFIX)
    ? path
    : `${API_PREFIX}/${path.replace(/^\/+/, "")}`;

  const url = `${API_BASE_URL}${prefixed}`;

  if (!query) return url;

  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);

  return params.length ? `${url}?${params.join("&")}` : url;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    query,
    headers = {},
    signal,
    timeoutMs = API_TIMEOUT_MS,
    anonymous = false,
  } = options;

  const url = buildUrl(path, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(anonymous ? {} : await attachCredential()),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    clearTimeout(timer);
    const aborted = controller.signal.aborted;
    throw new ApiError(
      aborted ? "timeout" : "network",
      aborted ? `Request timed out after ${timeoutMs}ms` : String(cause),
      url,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = response.statusText;
    let payload: unknown;
    try {
      const text = await response.text();
      if (text) {
        detail = text.slice(0, 300);
        try {
          payload = JSON.parse(text);
        } catch {
          // non-JSON error body (HTML proxy page, empty) — detail is enough
        }
      }
    } catch {
      // body already consumed or unreadable — status alone is enough
    }

    // A 401 on an authenticated request means the session is gone server-side.
    // The login endpoint's own 401 (bad credentials) must not sign anyone out.
    if (response.status === 401 && !anonymous) {
      unauthorizedHandler?.();
    }

    throw new ApiError(kindForStatus(response.status), detail, url, response.status, payload);
  }

  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ApiError("parse", `Expected JSON: ${String(cause)}`, url, response.status);
  }
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),
  /** PATCH is the verb the notification and profile endpoints use. */
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  /** DELETE is used by the feed's own-post removal. No body is sent. */
  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

/** Exposed for diagnostics screens only. */
export const __buildUrl = buildUrl;
