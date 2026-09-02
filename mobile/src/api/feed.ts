import { api } from "@/api/client";
import type { CommentItem, FeedItem, LikeResult } from "@/api/types";

/**
 * The Viewrr Feed, natively.
 *
 * This module is a faithful client for the eight endpoints the web Feed uses
 * (`server/routes.ts:1445-1587`) and nothing more. Where the web page fakes a
 * feature — Share copies the page URL, Repost is local state, the DM modal
 * toasts without calling `/api/messages` — mobile does not reproduce the fake:
 * there is no endpoint behind it, and §13 forbids inventing one.
 *
 * Pagination is REAL here, unlike Browse Talent: `storage.getFeedPosts` issues
 * a genuine `LIMIT/OFFSET` (`storage.ts:617-626`), so native infinite scroll is
 * honest. Two contract details make the client defensive:
 *
 *   • the response is a bare array with no `total` / `hasMore` / cursor, so the
 *     end of the feed is inferred from a short page, exactly as web does;
 *   • ordering is `createdAt DESC` on a TEXT column with no id tiebreaker, so
 *     rows can repeat across page boundaries — `mergePages` dedupes by post id.
 */

/** Matches the web Feed's page size (`Feed.tsx` PAGE_SIZE). */
export const FEED_PAGE = 10;

export type FeedPageRequest = {
  offset: number;
  /**
   * Drives the per-row `liked` flag. The backend reads this from the QUERY
   * STRING rather than the session (`routes.ts:1447`), which is a real defect —
   * see the Stage 2 report. Mobile only ever sends the signed-in user's own id.
   */
  viewerUserId?: number;
  signal?: AbortSignal;
};

export async function loadFeedPage({
  offset,
  viewerUserId,
  signal,
}: FeedPageRequest): Promise<FeedItem[]> {
  return api.get<FeedItem[]>("/api/feed", {
    query: { limit: FEED_PAGE, offset, viewerUserId },
    signal,
  });
}

/**
 * Append a page, dropping any post already held.
 *
 * Necessary because the server sorts on a string timestamp with no tiebreaker:
 * two posts written in the same millisecond can swap order between requests and
 * arrive on both pages. Rendering a duplicate key would crash the list.
 */
export function mergePages(current: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const seen = new Set(current.map((item) => item.post.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.post.id))];
}

/**
 * Toggle a like. Session-derived (`routes.ts:1536`) — the body the web client
 * sends is ignored, so mobile sends none.
 *
 * NOT idempotent: the endpoint flips state rather than setting it, so a retry
 * after a timeout silently un-likes. The Feed therefore never auto-retries this
 * call; a failure rolls the optimistic update back and leaves it to the user.
 */
export async function toggleLike(postId: number, signal?: AbortSignal): Promise<LikeResult> {
  return api.post<LikeResult>(`/api/feed/${postId}/like`, undefined, { signal });
}

/**
 * Comments for one post. Public, unpaginated and N+1 on the server
 * (`storage.ts:836-848`), so this is loaded lazily per post — never prefetched
 * for the whole page.
 */
export async function loadComments(postId: number, signal?: AbortSignal): Promise<CommentItem[]> {
  return api.get<CommentItem[]>(`/api/feed/${postId}/comments`, { signal });
}

export async function addComment(
  postId: number,
  content: string,
  signal?: AbortSignal,
): Promise<CommentItem> {
  return api.post<CommentItem>(`/api/feed/${postId}/comments`, { content }, { signal });
}

export type NewPost = {
  caption: string;
  /** A pasted image, YouTube or Vimeo URL. There is no upload endpoint. */
  mediaUrl?: string;
  mediaType?: "image" | "video";
  tags: string[];
};

/**
 * Create a post. `userId` is overwritten from the session server-side
 * (`routes.ts:1476`), so it is not sent.
 *
 * `tags` goes over the wire as a JSON *string* because the column is TEXT.
 */
export async function createPost(input: NewPost, signal?: AbortSignal): Promise<FeedItem> {
  return api.post<FeedItem>(
    "/api/feed",
    {
      caption: input.caption,
      ...(input.mediaUrl ? { mediaUrl: input.mediaUrl, mediaType: input.mediaType } : {}),
      tags: JSON.stringify(input.tags),
    },
    { signal },
  );
}

/** Delete own post. Ownership is enforced in storage; 403 otherwise. */
export async function deletePost(postId: number, signal?: AbortSignal): Promise<void> {
  await api.delete<{ success: boolean }>(`/api/feed/${postId}`, { signal });
}
