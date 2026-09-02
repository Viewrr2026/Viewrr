import { api } from "@/api/client";
import type { TalentDetail, TalentItem } from "@/api/types";

/**
 * Browse Talent, natively.
 *
 * ⚠ NO SERVER PAGINATION. `GET /api/profiles` reads exactly three query params
 * and no others — `const { specialism, availability, search } = req.query`
 * (`server/routes.ts:949`) — and `storage.getProfiles` does an unbounded
 * `SELECT *` over both `profiles` and `users` before filtering in Node
 * (`storage.ts:391-393`). There is no `limit`, `offset`, `page` or cursor to
 * send, and no `total` or `hasMore` on the way back.
 *
 * So this module does what the web marketplace does: ONE request that returns
 * the whole matching set. It does not slice the array client-side and present
 * that as paging, and the Discover screen shows no "Load more" — simulating
 * server pagination the backend does not implement would misrepresent the
 * contract and hide the scaling problem. See the Stage 2 report:
 * BLOCKED — BACKEND HARDENING REQUIRED (pagination for /api/profiles).
 *
 * The three real filters are all applied server-side. Sorting is client-side,
 * as on web, because no sort parameter exists.
 */

export type TalentQuery = {
  /** Exact specialism name, or "all"/undefined for no filter. */
  specialism?: string;
  /** "available" | "busy" | "unavailable", or "all"/undefined. */
  availability?: string;
  /** Matches name, bio, location, skills and specialisms (server-side). */
  search?: string;
  signal?: AbortSignal;
};

export async function loadTalent({
  specialism,
  availability,
  search,
  signal,
}: TalentQuery = {}): Promise<TalentItem[]> {
  return api.get<TalentItem[]>("/api/profiles", {
    query: {
      specialism: specialism && specialism !== "all" ? specialism : undefined,
      availability: availability && availability !== "all" ? availability : undefined,
      search: search?.trim() ? search.trim() : undefined,
    },
    signal,
  });
}

/**
 * One creative. The path segment accepts a profile id or a user id — the
 * handler resolves both (`routes.ts:1058-1066`), which is what lets a feed
 * author (a user id) open the same screen.
 *
 * Reviews arrive inlined and unpaginated in this same response; there is no
 * separate reviews endpoint.
 */
export async function loadTalentDetail(id: number, signal?: AbortSignal): Promise<TalentDetail> {
  return api.get<TalentDetail>(`/api/profiles/${id}`, { signal });
}

/**
 * Save / unsave a creative. Correctly hardened: `requireAuth` with the actor
 * taken from the session, body limited to `profileId` (`routes.ts:1337-1342`).
 *
 * The matching READ endpoints (`GET /api/saved/:clientId`) are unauthenticated
 * and trust the id in the path, so the saved set of any user is public. Mobile
 * only ever asks for the signed-in user's own id — it does not exploit that —
 * but the endpoint is flagged for hardening in the Stage 2 report.
 */
export async function toggleSaved(
  profileId: number,
  signal?: AbortSignal,
): Promise<{ saved: boolean }> {
  return api.post<{ saved: boolean }>("/api/saved/toggle", { profileId }, { signal });
}

/** Saved profile ids for the signed-in client. Used to seed the save control. */
export async function loadSavedProfiles(
  clientId: number,
  signal?: AbortSignal,
): Promise<TalentItem[]> {
  return api.get<TalentItem[]>(`/api/saved/${clientId}`, { signal });
}
