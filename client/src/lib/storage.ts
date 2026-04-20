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

// ── Connections helpers ───────────────────────────────────────────────────────
const CONN_KEY = "viewrr_connections";

function getConnections(): number[] {
  try { return JSON.parse(safeGet(CONN_KEY) || "[]"); } catch { return []; }
}
function saveConnections(ids: number[]): void {
  safeSet(CONN_KEY, JSON.stringify(ids));
}

export function isConnected(profileId: number): boolean {
  return getConnections().includes(profileId);
}

export function toggleConnection(profileId: number): boolean {
  const list = getConnections();
  const idx = list.indexOf(profileId);
  if (idx === -1) {
    saveConnections([...list, profileId]);
    return true; // now connected
  } else {
    saveConnections(list.filter(id => id !== profileId));
    return false; // disconnected
  }
}

export function connectionCount(profileId: number): number {
  // Returns a stable demo count seeded from profileId + stored connections
  const base = 40 + (profileId * 17 % 460);
  return isConnected(profileId) ? base + 1 : base;
}
