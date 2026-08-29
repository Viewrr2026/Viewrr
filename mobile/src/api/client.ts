import { API_BASE_URL, API_PREFIX, API_TIMEOUT_MS } from "@/config/env";
import { ApiError, kindForStatus } from "@/api/errors";

/**
 * Viewrr Mobile API client — FOUNDATION ONLY.
 *
 * Deliberate boundaries for Alpha 0.1:
 *   • Absolute base URL only. Never same-origin/relative like the web client.
 *   • `credentials` is NOT set. Cookie-based `vr_sess` auth is a web-only
 *     security model (HttpOnly + SameSite=Strict) and stays that way.
 *   • No Authorization header is attached, because no native credential exists
 *     yet. Native auth will arrive via a separate reviewed native-auth endpoint
 *     and Bearer architecture — see `attachCredential` below, which is the ONLY
 *     seam that should change when that lands.
 *
 * Do not add authenticated calls to this file until that endpoint is approved.
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
};

/**
 * Credential seam. Returns no headers today, by design.
 *
 * When native auth is approved this becomes the single place that reads the
 * stored Bearer credential (expo-secure-store) and returns
 * `{ Authorization: "Bearer <token>" }`. Nothing else in the app should know
 * how credentials are stored.
 */
async function attachCredential(): Promise<Record<string, string>> {
  return {};
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
  const { method = "GET", body, query, headers = {}, signal, timeoutMs = API_TIMEOUT_MS } = options;

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
        ...(await attachCredential()),
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
    try {
      const text = await response.text();
      if (text) detail = text.slice(0, 300);
    } catch {
      // body already consumed or unreadable — status alone is enough
    }
    throw new ApiError(kindForStatus(response.status), detail, url, response.status);
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
};

/** Exposed for diagnostics screens only. */
export const __buildUrl = buildUrl;
