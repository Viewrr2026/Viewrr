// Safe localStorage wrappers — sandbox-safe, never throws
export function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}
export function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

// ── Connections are now fully server-side (connection_requests table) ──────────
// These stubs are kept for backward compatibility but all logic is in the API.

/** @deprecated — use /api/connections/status instead */
export function isConnected(_id: number): boolean {
  return false; // always false — use server API
}

/** @deprecated — use /api/connections/request instead */
export function toggleConnection(_id: number, _userId?: number): boolean {
  return false;
}

/** @deprecated — use /api/connections instead */
export function getConnectionUserIds(): number[] {
  return [];
}

export function connectionCount(id: number): number {
  // Stable demo seed — real count served from API
  return 40 + (id * 17 % 460);
}
