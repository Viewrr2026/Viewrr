import { api } from "@/api/client";
import { ApiError } from "@/api/errors";

/**
 * Backend reachability probe.
 *
 * Uses GET /api/profiles/featured — an existing PUBLIC, read-only endpoint on
 * the Viewrr Express backend. It requires no credential, so it proves transport
 * (DNS → TLS → Express → JSON) without touching authentication.
 *
 * When a dedicated /api/health endpoint exists, point this at it instead.
 */

const PROBE_PATH = "/api/profiles/featured";

export type Connectivity =
  | { state: "reachable"; latencyMs: number }
  | { state: "unreachable"; reason: string; latencyMs: number };

export async function checkBackend(signal?: AbortSignal): Promise<Connectivity> {
  const started = Date.now();
  try {
    await api.get<unknown>(PROBE_PATH, { signal, timeoutMs: 8_000 });
    return { state: "reachable", latencyMs: Date.now() - started };
  } catch (error) {
    const reason = error instanceof ApiError ? error.userMessage : "Unexpected error";
    return { state: "unreachable", reason, latencyMs: Date.now() - started };
  }
}
