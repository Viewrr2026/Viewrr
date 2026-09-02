import { useRouter } from "expo-router";
import { PenLine, Rss } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/api/errors";
import { FEED_PAGE, deletePost, loadFeedPage, mergePages, toggleLike } from "@/api/feed";
import type { FeedItem } from "@/api/types";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Screen } from "@/components/Screen";
import { SkeletonCard } from "@/components/Skeleton";
import { Composer } from "@/components/feed/Composer";
import { OpportunitiesCard } from "@/components/feed/OpportunitiesCard";
import { PostCard } from "@/components/feed/PostCard";
import { useSession } from "@/session/SessionProvider";
import { gutter, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Home — the Viewrr Feed.
 *
 * Home is the community feed, not a dashboard: the same LinkedIn-style
 * chronological stream the website serves at /feed, rebuilt as a native list
 * rather than a port of the three-column desktop layout. The desktop page has a
 * left profile rail, a centre column and a right rail of trending tags and
 * CTAs; on a phone only the centre column is the product, so the rails are
 * dropped and the one rail item with real value to a creative — open briefs —
 * becomes a module in the stream.
 *
 * Two deliberate native upgrades over web:
 *   • infinite scroll instead of the web's "Load more posts" button, which the
 *     backend genuinely supports (real LIMIT/OFFSET in storage.getFeedPosts);
 *   • pull to refresh, which resets to page zero.
 *
 * Everything web fakes — Share, Repost, the DM modal, client-derived "Trending
 * now" — is absent. See PostCard for the reasoning on each.
 */
export default function FeedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const viewerId = user?.id;

  const [items, setItems] = useState<FeedItem[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [failure, setFailure] = useState<{ offline: boolean; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const mounted = useRef(true);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  const describe = useCallback((cause: unknown) => {
    const offline =
      cause instanceof ApiError && (cause.kind === "network" || cause.kind === "timeout");
    return {
      offline,
      message:
        cause instanceof ApiError
          ? (cause.serverMessage ?? cause.userMessage)
          : "Something went wrong. Try again.",
    };
  }, []);

  /** Load page zero. `mode` only decides which spinner the user sees. */
  const loadFirstPage = useCallback(
    async (mode: "initial" | "refresh") => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      if (mode === "refresh") setRefreshing(true);
      else setPhase("loading");

      try {
        const page = await loadFeedPage({ offset: 0, viewerUserId: viewerId, signal: controller.signal });
        if (!mounted.current || controller.signal.aborted) return;
        setItems(page);
        setExhausted(page.length < FEED_PAGE);
        setFailure(null);
        setPhase("ready");
      } catch (cause) {
        if (!mounted.current || controller.signal.aborted) return;
        // A 401 is already handled globally by the API client, which tears the
        // session down — no point painting an error over a screen that is about
        // to unmount.
        if (cause instanceof ApiError && cause.kind === "unauthorized") return;
        setFailure(describe(cause));
        setPhase("error");
      } finally {
        if (mounted.current && mode === "refresh") setRefreshing(false);
      }
    },
    [describe, viewerId],
  );

  useEffect(() => {
    void loadFirstPage("initial");
  }, [loadFirstPage]);

  /**
   * Infinite scroll. `offset` is the number of rows already held rather than a
   * page counter, so a post inserted while scrolling shifts the window by one
   * instead of skipping a whole page — and `mergePages` drops the duplicate
   * that the untied `createdAt DESC` sort can hand back at a boundary.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || phase !== "ready" || items.length === 0) return;

    setLoadingMore(true);
    try {
      const page = await loadFeedPage({ offset: items.length, viewerUserId: viewerId });
      if (!mounted.current) return;
      setItems((current) => mergePages(current, page));
      if (page.length < FEED_PAGE) setExhausted(true);
    } catch {
      // A failed page is not a failed screen: keep what is on screen, stop
      // paging, and let a pull-to-refresh recover.
      if (mounted.current) setExhausted(true);
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }, [exhausted, items.length, loadingMore, phase, viewerId]);

  /**
   * Optimistic like with rollback.
   *
   * The endpoint toggles rather than sets, so it is never retried automatically:
   * a blind retry after a timeout would un-like the post. On failure the row
   * simply returns to its previous state.
   */
  const onToggleLike = useCallback(
    (postId: number) => {
      let previous: FeedItem | undefined;

      setItems((current) =>
        current.map((item) => {
          if (item.post.id !== postId) return item;
          previous = item;
          return {
            ...item,
            liked: !item.liked,
            post: {
              ...item.post,
              likeCount: Math.max(0, item.post.likeCount + (item.liked ? -1 : 1)),
            },
          };
        }),
      );

      void toggleLike(postId)
        .then((result) => {
          if (!mounted.current) return;
          // Adopt the server's counter — it is authoritative, and the column is
          // updated non-atomically server-side, so it can differ from ours.
          setItems((current) =>
            current.map((item) =>
              item.post.id === postId
                ? { ...item, liked: result.liked, post: { ...item.post, likeCount: result.likeCount } }
                : item,
            ),
          );
        })
        .catch(() => {
          if (!mounted.current || !previous) return;
          const restore = previous;
          setItems((current) =>
            current.map((item) => (item.post.id === postId ? restore : item)),
          );
        });
    },
    [],
  );

  /** The count column is denormalised, so nudge it locally after a comment. */
  const onCommentAdded = useCallback((postId: number) => {
    setItems((current) =>
      current.map((item) =>
        item.post.id === postId
          ? { ...item, post: { ...item.post, commentCount: item.post.commentCount + 1 } }
          : item,
      ),
    );
  }, []);

  const onDelete = useCallback((postId: number) => {
    const snapshot = items;
    setItems((current) => current.filter((item) => item.post.id !== postId));

    void deletePost(postId).catch(() => {
      // Ownership is enforced server-side; a rejection means the row is still
      // there, so put it back rather than leaving the list lying.
      if (mounted.current) setItems(snapshot);
    });
  }, [items]);

  const openAuthor = useCallback(
    (userId: number) => router.push(`/(app)/discover/${userId}`),
    [router],
  );

  const isCreative = user?.role === "freelancer";

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => setComposerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Share an update"
        style={({ pressed }) => [
          styles.composerRow,
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Avatar name={user?.displayName ?? "You"} size="sm" />
        <Text style={[styles.composerHint, { color: colors.mutedForeground }]} numberOfLines={1}>
          Share an update with the community
        </Text>
        <PenLine size={16} color={colors.primary} strokeWidth={2.2} />
      </Pressable>

      {isCreative ? <OpportunitiesCard /> : null}
    </View>
  );

  if (phase === "loading") {
    return (
      <Screen edges={["top", "left", "right"]} flush>
        <View style={styles.gutter}>
          <AppHeader title="Home" brand />
        </View>
        <View style={styles.skeletons}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={2} />
        </View>
      </Screen>
    );
  }

  if (phase === "error" && failure) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <AppHeader title="Home" brand />
        <ErrorState
          title={failure.offline ? "You're offline" : "The feed didn't load"}
          message={
            failure.offline
              ? "Viewrr can't reach the network right now. Check your connection and try again."
              : failure.message
          }
          onRetry={() => void loadFirstPage("initial")}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]} flush>
      <View style={styles.gutter}>
        <AppHeader title="Home" brand />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.post.id)}
        renderItem={({ item }) => (
          <PostCard
            item={item}
            viewerId={viewerId ?? -1}
            onOpenAuthor={openAuthor}
            onToggleLike={onToggleLike}
            onCommentAdded={onCommentAdded}
            onDelete={onDelete}
          />
        )}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadFirstPage("refresh")}
            tintColor={colors.mutedForeground}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon={Rss}
            title="The feed is quiet"
            body="Posts from creatives and clients you work alongside show up here. Share the first update."
            actionLabel="Share an update"
            onAction={() => setComposerOpen(true)}
            inline
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.mutedForeground} style={styles.footer} />
          ) : exhausted && items.length > 0 ? (
            <Text style={[styles.caughtUp, { color: colors.mutedForeground }]}>
              You&rsquo;re all caught up
            </Text>
          ) : null
        }
      />

      <Composer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPosted={(created) => {
          // Prepend rather than refetch: the server's 2-minute feed cache is not
          // busted by every write, so a refetch can briefly hide the new post.
          setItems((current) => mergePages([created], current));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: gutter,
  },
  list: {
    paddingHorizontal: gutter,
    paddingBottom: spacing[8],
    gap: 0,
  },
  header: {
    gap: spacing[3],
    paddingBottom: spacing[3],
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  composerHint: {
    ...typography.small,
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  separator: {
    height: spacing[3],
  },
  skeletons: {
    paddingHorizontal: gutter,
    gap: spacing[3],
  },
  footer: {
    paddingVertical: spacing[5],
  },
  caughtUp: {
    ...typography.caption,
    textAlign: "center",
    paddingVertical: spacing[6],
  },
});
