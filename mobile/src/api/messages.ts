import { api } from "@/api/client";
import { ApiError } from "@/api/errors";

/**
 * Direct messages — the mobile data layer for the Messages tab.
 *
 * WHY THE LEGACY ROUTES ARE NOT USED
 * ----------------------------------
 * `GET /api/messages/:fromId/:toId` marks rows read as a SIDE EFFECT of a read,
 * and it does so in ONE direction only: it clears `read` for messages whose
 * recipient is `:toId`. Called the natural mobile way —
 * `/api/messages/{me}/{them}` — it therefore clears the OTHER party's unread
 * count and leaves the caller's own untouched. Swapping the ids to "fix" that
 * makes a GET silently mutate state on a screen that may only be polling.
 *
 * So mobile uses none of it. Reads are pure, and read state is changed only by
 * an explicit `POST /api/messages/read`. The endpoints below are the frozen
 * PRD-1 contract (CONTRACT.md section D):
 *
 *   GET  /api/conversations                                   → inbox (DM only)
 *   GET  /api/conversations/:otherUserId/messages?after=&before=&limit=
 *   POST /api/messages/read        { otherUserId, upToMessageId? }
 *   GET  /api/messages/unread-count                           → { count }  DM only
 *   POST /api/messages             { fromId, toId, content }
 *
 * Cursors are MESSAGE IDS, never timestamps: `messages.created_at` is a text
 * column with no reliable ordering (CONTRACT.md section A), so it is safe to
 * display and unsafe to sort or page by.
 *
 * Interest / negotiation threads are excluded from this inbox server-side
 * (Decision 17) — they belong to Brief/Work. Nothing here re-adds them.
 *
 * Types are declared locally on purpose: `api/types.ts` is read-only for every
 * agent, so new shapes live in the domain module that owns them.
 */

/* ── Wire shapes ──────────────────────────────────────────────────────────── */

/** One row of `GET /api/conversations`. The counterparty, not the thread. */
export type ConversationListItem = {
  otherUserId: number;
  name: string;
  avatar: string | null;
  headline: string | null;
  /** Preview text of the newest message. May be absent on an empty thread. */
  lastMessage: string | null;
  /** Newest message id — the read receipt watermark and the paging anchor. */
  lastMessageId: number | null;
  /** ISO-ish text column. Display only; never sort by it. */
  lastMessageAt: string | null;
  /** Unread messages addressed to the signed-in user. */
  unread: number;
};

export type ConversationList = {
  items: ConversationListItem[];
  /** DM unread total. NOT the notification-centre count (Decision 18). */
  unreadTotal: number;
};

/** One message in a thread. `read` is a Postgres integer column (0 | 1). */
export type DirectMessage = {
  id: number;
  fromId: number;
  toId: number;
  body: string;
  createdAt: string;
  read: number;
};

export type MessagePage = {
  items: DirectMessage[];
  /** Id to pass as `before=` for the next older page. Null when exhausted. */
  nextCursor: number | null;
  hasMore: boolean;
};

export type MarkReadResult = { markedRead: number };

export type DmUnreadCount = { count: number };

/* ── Defensive normalisation ──────────────────────────────────────────────── */

/**
 * The contract names the text field `body`; the underlying column is `content`
 * and `POST /api/messages` echoes the raw row back. Both are accepted so a send
 * can be rendered immediately without waiting for the next poll. Nothing is
 * invented — a row with neither field yields an empty string, not filler.
 */
type RawMessage = Partial<Record<keyof DirectMessage, unknown>> & { content?: unknown };

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normaliseMessage(raw: RawMessage): DirectMessage {
  const text = typeof raw.body === "string" ? raw.body : typeof raw.content === "string" ? raw.content : "";
  return {
    id: toNumber(raw.id),
    fromId: toNumber(raw.fromId),
    toId: toNumber(raw.toId),
    body: text,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    // `read` is nullable in the database; absent means unread.
    read: raw.read === 1 || raw.read === true ? 1 : 0,
  };
}

/* ── Loaders ──────────────────────────────────────────────────────────────── */

/** The inbox. DM conversations only — interest threads are excluded server-side. */
export async function loadConversations(signal?: AbortSignal): Promise<ConversationList> {
  const response = await api.get<Partial<ConversationList>>("/api/conversations", { signal });
  const items = Array.isArray(response?.items) ? response.items : [];
  return {
    items,
    unreadTotal: toNumber(response?.unreadTotal),
  };
}

export type MessagePageQuery = {
  /** Strictly newer than this message id — the polling cursor. */
  after?: number;
  /** Strictly older than this message id — the history cursor. */
  before?: number;
  /** Server default 40, hard max 100. */
  limit?: number;
  signal?: AbortSignal;
};

/**
 * One page of a thread. Returned items are normalised and sorted OLDEST FIRST
 * by id, so callers never depend on the server's ordering: `items[0]` is always
 * the oldest of the page and the last entry always the newest.
 */
export async function loadMessages(
  otherUserId: number,
  { after, before, limit = 40, signal }: MessagePageQuery = {},
): Promise<MessagePage> {
  const response = await api.get<{
    items?: RawMessage[];
    nextCursor?: unknown;
    hasMore?: unknown;
  }>(`/api/conversations/${otherUserId}/messages`, {
    query: { after, before, limit },
    signal,
  });

  const items = (Array.isArray(response?.items) ? response.items : [])
    .map(normaliseMessage)
    .sort((a, b) => a.id - b.id);

  return {
    items,
    nextCursor:
      typeof response?.nextCursor === "number" && Number.isFinite(response.nextCursor)
        ? response.nextCursor
        : null,
    hasMore: response?.hasMore === true,
  };
}

/**
 * The explicit, side-effect-free mark-read. Marks rows where
 * `to_id = signed-in user AND from_id = otherUserId`, optionally capped at
 * `upToMessageId` so a message that arrived after the user looked away is not
 * silently swallowed.
 */
export async function markConversationRead(
  otherUserId: number,
  upToMessageId?: number,
): Promise<MarkReadResult> {
  const result = await api.post<Partial<MarkReadResult>>("/api/messages/read", {
    otherUserId,
    ...(upToMessageId != null ? { upToMessageId } : {}),
  });
  return { markedRead: toNumber(result?.markedRead) };
}

/**
 * DM unread total, for the Messages TAB badge only.
 *
 * Decision 18: this is a different quantity from the notification-centre
 * unread count that the header bell reads through NotificationsProvider. The
 * two are never added together and never share a store.
 */
export async function loadDmUnreadCount(signal?: AbortSignal): Promise<number> {
  const result = await api.get<Partial<DmUnreadCount>>("/api/messages/unread-count", { signal });
  return toNumber(result?.count);
}

/** Send a direct message. `fromId` is validated against the session server-side. */
export async function sendMessage(input: {
  fromId: number;
  toId: number;
  body: string;
}): Promise<DirectMessage> {
  const raw = await api.post<RawMessage>("/api/messages", {
    fromId: input.fromId,
    toId: input.toId,
    content: input.body,
    read: 0,
  });
  return normaliseMessage(raw ?? {});
}

/* ── Blocking (Decision 3) ────────────────────────────────────────────────── */

/**
 * True when a failure is the server refusing the send because one party has
 * blocked the other. A block never breaks an in-flight project — the server
 * exempts users who share an active engagement — so reaching this branch means
 * there genuinely is no permitted channel, and the user is told so rather than
 * watching a message vanish.
 */
export function isBlockedError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const code = error.serverCode ?? "";
  if (/BLOCK/i.test(code)) return true;
  return error.kind === "forbidden" && /block/i.test(error.serverMessage ?? "");
}

/** Safe, user-facing copy for a failed send. Never a raw body, URL or stack. */
export function describeSendFailure(error: unknown): string {
  if (isBlockedError(error)) {
    return "This message couldn't be sent. You and this person can no longer message each other directly.";
  }
  if (error instanceof ApiError) {
    return error.serverMessage ?? error.userMessage;
  }
  return "That message didn't send. Try again.";
}
