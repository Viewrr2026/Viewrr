import { useFocusEffect, useRouter } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { AppState, FlatList, RefreshControl, StyleSheet, View, type AppStateStatus } from "react-native";

import { loadConversations, type ConversationList, type ConversationListItem } from "@/api/messages";
import { AppHeader } from "@/components/AppHeader";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { ConversationRow } from "@/components/messages/ConversationRow";
import { setDmUnread } from "@/components/messages/useDmUnread";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { spacing, useTheme } from "@/theme";

/**
 * Messages — the inbox.
 *
 * Data comes from GET /api/conversations and nothing else. That endpoint is
 * pure: unlike the legacy GET /api/messages/:fromId/:toId, reading it changes
 * no read state, which is what makes polling it safe. Read state on this
 * surface only ever changes through the explicit POST /api/messages/read the
 * thread screen calls.
 *
 * Interest / negotiation threads are NOT here (Decision 17). The server
 * excludes them from this list and this screen adds nothing back — those
 * conversations belong to the brief and project surfaces in Brief/Work, where
 * their context lives.
 *
 * Refresh policy:
 *   • an 8s poll while the screen is focused and the app is in the foreground,
 *     matching the web inbox's own interval;
 *   • an immediate refresh on focus, so returning from a thread shows the
 *     unread count that thread just cleared;
 *   • pull-to-refresh;
 *   • the poll is torn down on blur and while backgrounded — a tab the user is
 *     not looking at should not spend their battery or their rate limit.
 *
 * The `unreadTotal` this endpoint returns is pushed into the DM badge store, so
 * the Messages tab badge settles from the same read the list already made
 * instead of firing a second request. It stays strictly separate from the
 * notification-centre count behind the header bell (Decision 18).
 */

const POLL_INTERVAL_MS = 8_000;

export default function MessagesIndex() {
  const router = useRouter();
  const { colors } = useTheme();

  const load = useCallback((signal: AbortSignal) => loadConversations(signal), []);
  const { resource, refreshing, refresh, reload } = useAsyncResource<ConversationList>(load);

  // `refresh` is stable per hook instance but read from a ref inside the timer
  // so restarting the poll never depends on render identity.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Keep the tab badge in step with the list we just loaded.
  useEffect(() => {
    if (resource.phase === "ready") setDmUnread(resource.data.unreadTotal);
  }, [resource]);

  useFocusEffect(
    useCallback(() => {
      refreshRef.current();

      let timer: ReturnType<typeof setInterval> | null = null;

      const start = () => {
        if (timer !== null) return;
        timer = setInterval(() => refreshRef.current(), POLL_INTERVAL_MS);
      };
      const stop = () => {
        if (timer === null) return;
        clearInterval(timer);
        timer = null;
      };

      const onAppStateChange = (next: AppStateStatus) => {
        if (next === "active") {
          refreshRef.current();
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
    }, []),
  );

  const openConversation = useCallback(
    (otherUserId: number) => router.push(`/(app)/messages/${otherUserId}`),
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: ConversationListItem }) => (
      <ConversationRow conversation={item} onPress={() => openConversation(item.otherUserId)} />
    ),
    [openConversation],
  );

  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Messages" brand />

      <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={6}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              body="Messages you exchange with clients and creatives appear here. Start one from someone's profile in Discover."
              actionLabel="Browse talent"
              onAction={() => router.push("/(app)/discover")}
            />
          ) : (
            <FlatList
              data={data.items}
              keyExtractor={(item) => String(item.otherUserId)}
              renderItem={renderItem}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
              )}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refresh}
                  tintColor={colors.mutedForeground}
                  colors={[colors.primary]}
                />
              }
            />
          )
        }
      </DataState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingBottom: spacing[8],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
});
