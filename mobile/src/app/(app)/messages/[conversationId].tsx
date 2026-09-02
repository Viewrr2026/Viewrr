import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type AppStateStatus,
} from "react-native";

import {
  describeSendFailure,
  loadMessages,
  markConversationRead,
  sendMessage,
  type DirectMessage,
  type MessagePage,
} from "@/api/messages";
import { loadTalentDetail } from "@/api/talent";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { MessageBubble } from "@/components/messages/MessageBubble";
import { MessageComposer } from "@/components/messages/MessageComposer";
import { refreshDmUnread } from "@/components/messages/useDmUnread";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useSession } from "@/session/SessionProvider";
import { spacing, useTheme } from "@/theme";

/**
 * One conversation.
 *
 * `conversationId` is the COUNTERPARTY USER ID — that is what
 * discover/[profileId].tsx already routes to (`/(app)/messages/${user.id}`),
 * and what the contract's conversation endpoints key on. There is no separate
 * conversation entity to look up.
 *
 * Read state — the trap this screen exists to avoid
 * -------------------------------------------------
 * The legacy GET /api/messages/:fromId/:toId marks messages read as a side
 * effect, and only for the recipient named by `:toId`. Called the natural way
 * it clears the OTHER party's unread count and leaves the caller's intact.
 * This screen never touches it. Reads are pure
 * (GET /api/conversations/:otherUserId/messages) and read state is changed only
 * by the explicit, direction-correct POST /api/messages/read, sent:
 *   • on focus, watermarked at the newest inbound message on screen; and
 *   • whenever a poll brings new inbound messages in.
 * The watermark (`upToMessageId`) means a message that arrives after the user
 * looks away is not silently marked read.
 *
 * Paging and polling both use MESSAGE IDS, never timestamps:
 * `messages.created_at` is a text column with no reliable ordering, so it is
 * shown and never sorted by.
 *   • history  → `before=<oldest id on screen>` when the list is pulled back;
 *   • new mail → `after=<newest id on screen>`, so a poll costs one small
 *     delta rather than refetching the whole thread every few seconds.
 */

const PAGE_SIZE = 40;
const POLL_INTERVAL_MS = 5_000;

/** Local ids for messages the server has not confirmed yet. Always negative. */
let pendingSeq = 0;

export default function Conversation() {
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const { user } = useSession();
  const { colors } = useTheme();

  const otherUserId = Number(params.conversationId);
  const valid = Number.isInteger(otherUserId) && otherUserId > 0;
  const meId = user?.id ?? null;

  /* ── Thread state ──────────────────────────────────────────────────────── */

  const [thread, setThread] = useState<DirectMessage[]>([]);
  const [pending, setPending] = useState<DirectMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [counterparty, setCounterparty] = useState<{ name: string; avatar: string | null } | null>(
    null,
  );

  const loadFirstPage = useCallback(
    (signal: AbortSignal) => {
      if (!valid) return Promise.resolve<MessagePage>({ items: [], nextCursor: null, hasMore: false });
      return loadMessages(otherUserId, { limit: PAGE_SIZE, signal });
    },
    [otherUserId, valid],
  );

  const { resource, reload } = useAsyncResource<MessagePage>(loadFirstPage, {
    enabled: valid,
    deps: [otherUserId],
  });

  useEffect(() => {
    if (resource.phase !== "ready") return;
    const page = resource.data;
    setThread(page.items);
    setHasMore(page.hasMore);
    setOlderCursor(page.nextCursor ?? page.items[0]?.id ?? null);
  }, [resource]);

  /* ── Counterparty identity for the header ──────────────────────────────── */

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const detail = await loadTalentDetail(otherUserId, controller.signal);
        if (controller.signal.aborted) return;
        const name = detail.user?.name;
        if (typeof name === "string" && name.length > 0) {
          setCounterparty({ name, avatar: detail.user?.avatar ?? null });
        }
      } catch {
        // The header falls back to "Conversation". A missing or forbidden
        // profile is not worth an error state on a working thread, and a name
        // is never guessed.
      }
    })();

    return () => controller.abort();
  }, [otherUserId, valid]);

  /* ── Derived ids ───────────────────────────────────────────────────────── */

  const newestId = thread.length > 0 ? (thread[thread.length - 1]?.id ?? null) : null;
  const newestInboundId = useMemo(() => {
    for (let index = thread.length - 1; index >= 0; index -= 1) {
      const message = thread[index];
      if (message && message.fromId === otherUserId) return message.id;
    }
    return null;
  }, [otherUserId, thread]);

  /* ── Mark read (explicit, never a GET side effect) ─────────────────────── */

  const markedUpTo = useRef<number>(0);

  const markRead = useCallback(
    (upToMessageId: number | null) => {
      if (!valid || upToMessageId === null) return;
      if (upToMessageId <= markedUpTo.current) return;

      markedUpTo.current = upToMessageId;
      void markConversationRead(otherUserId, upToMessageId)
        .then(() => {
          // Locally reflect the receipt, then let the DM badge re-read the
          // authoritative count for the whole inbox.
          setThread((current) =>
            current.map((message) =>
              message.toId === meId && message.id <= upToMessageId && message.read !== 1
                ? { ...message, read: 1 }
                : message,
            ),
          );
          void refreshDmUnread();
        })
        .catch(() => {
          // Allow a later attempt to retry the same watermark.
          markedUpTo.current = Math.min(markedUpTo.current, upToMessageId - 1);
        });
    },
    [meId, otherUserId, valid],
  );

  // On focus, and whenever a newer inbound message is on screen.
  useEffect(() => {
    markRead(newestInboundId);
  }, [markRead, newestInboundId]);

  /* ── Polling for new messages (delta only) ─────────────────────────────── */

  const newestIdRef = useRef<number | null>(newestId);
  newestIdRef.current = newestId;
  const pollingRef = useRef(false);

  const pollNew = useCallback(async () => {
    if (!valid || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const cursor = newestIdRef.current;
      const page = await loadMessages(otherUserId, {
        limit: PAGE_SIZE,
        ...(cursor !== null ? { after: cursor } : {}),
      });
      if (page.items.length === 0) return;

      setThread((current) => {
        const known = new Set(current.map((message) => message.id));
        const additions = page.items.filter((message) => !known.has(message.id));
        if (additions.length === 0) return current;
        return [...current, ...additions].sort((a, b) => a.id - b.id);
      });
    } catch {
      // A dropped poll is not an error state — the thread on screen is still
      // valid and the next tick retries.
    } finally {
      pollingRef.current = false;
    }
  }, [otherUserId, valid]);

  useFocusEffect(
    useCallback(() => {
      if (!valid) return;

      // Re-read on focus so a thread opened from a notification is current, and
      // so returning to it clears anything that arrived while away.
      void pollNew();

      let timer: ReturnType<typeof setInterval> | null = null;
      const start = () => {
        if (timer !== null) return;
        timer = setInterval(() => void pollNew(), POLL_INTERVAL_MS);
      };
      const stop = () => {
        if (timer === null) return;
        clearInterval(timer);
        timer = null;
      };

      const onAppStateChange = (next: AppStateStatus) => {
        if (next === "active") {
          void pollNew();
          start();
        } else {
          stop();
        }
      };

      if (AppState.currentState === "active") start();
      const subscription = AppState.addEventListener("change", onAppStateChange);

      return () => {
        stop();
        subscription.remove();
      };
    }, [pollNew, valid]),
  );

  /* ── History paging ────────────────────────────────────────────────────── */

  const loadOlder = useCallback(() => {
    if (!valid || loadingOlder || !hasMore) return;
    const before = olderCursor ?? thread[0]?.id ?? null;
    if (before === null) return;

    setLoadingOlder(true);
    void loadMessages(otherUserId, { before, limit: PAGE_SIZE })
      .then((page) => {
        setThread((current) => {
          const known = new Set(current.map((message) => message.id));
          const additions = page.items.filter((message) => !known.has(message.id));
          return additions.length === 0 ? current : [...additions, ...current].sort((a, b) => a.id - b.id);
        });
        setHasMore(page.hasMore);
        setOlderCursor(page.nextCursor ?? page.items[0]?.id ?? null);
      })
      .catch(() => {
        // Leave the thread as it is; the user can pull again.
      })
      .finally(() => setLoadingOlder(false));
  }, [hasMore, loadingOlder, olderCursor, otherUserId, thread, valid]);

  /* ── Sending ───────────────────────────────────────────────────────────── */

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      if (!valid || meId === null) return false;
      setSendError(null);

      pendingSeq -= 1;
      const localId = pendingSeq;
      const optimistic: DirectMessage = {
        id: localId,
        fromId: meId,
        toId: otherUserId,
        body,
        createdAt: new Date().toISOString(),
        read: 0,
      };
      setPending((current) => [...current, optimistic]);

      try {
        const saved = await sendMessage({ fromId: meId, toId: otherUserId, body });
        setPending((current) => current.filter((message) => message.id !== localId));
        setThread((current) =>
          current.some((message) => message.id === saved.id)
            ? current
            : [...current, saved].sort((a, b) => a.id - b.id),
        );
        return true;
      } catch (error) {
        // Decision 3: a block is surfaced honestly. A block never breaks an
        // in-flight project — the server exempts parties who share an active
        // engagement — so a refusal here means there really is no DM channel.
        setPending((current) => current.filter((message) => message.id !== localId));
        setSendError(describeSendFailure(error));
        return false;
      }
    },
    [meId, otherUserId, valid],
  );

  /* ── Render ────────────────────────────────────────────────────────────── */

  const rows = useMemo(
    () => [...thread, ...pending].reverse(),
    [pending, thread],
  );

  const title = counterparty?.name ?? "Conversation";

  if (!valid) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <AppHeader title="Conversation" back />
        <EmptyState
          icon={MessageCircle}
          title="Conversation not found"
          body="That link didn't point at a person we can open a thread with."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader
        title={title}
        back
        action={
          counterparty ? (
            <Avatar name={counterparty.name} uri={counterparty.avatar} size="sm" />
          ) : undefined
        }
      />

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={6}>
          {() =>
            rows.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title="No messages yet"
                body={`Say hello. ${counterparty?.name ?? "They"} will see your message in their inbox.`}
              />
            ) : (
              <FlatList
                // Inverted: newest at the bottom, and scrolling up loads history.
                inverted
                data={rows}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item, index }) => {
                  const newer = rows[index - 1];
                  return (
                    <MessageBubble
                      message={item}
                      mine={item.fromId === meId}
                      pending={item.id < 0}
                      showTime={!newer || newer.fromId !== item.fromId}
                    />
                  );
                }}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                onEndReached={loadOlder}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                  loadingOlder ? (
                    <View style={styles.olderSpinner}>
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    </View>
                  ) : null
                }
              />
            )
          }
        </DataState>

        <MessageComposer
          onSend={send}
          error={sendError}
          placeholder={counterparty ? `Message ${counterparty.name.split(" ")[0]}` : "Write a message"}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  list: {
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
  },
  olderSpinner: {
    paddingVertical: spacing[4],
    alignItems: "center",
  },
});
