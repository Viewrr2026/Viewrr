import { useRouter } from "expo-router";
import { Bell, CheckCheck } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/api/notifications";
import type { Notification } from "@/api/types";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { relativeTime } from "@/lib/time";
import { resolveNotificationTarget, targetingFromNotification } from "@/navigation/linkResolver";
import { useNotifications } from "@/notifications/NotificationsProvider";
import { useSession } from "@/session/SessionProvider";
import { hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * The notification centre — the one real feature surface in this build.
 *
 * Everything on screen comes from GET /api/notifications/:userId. There is no
 * seeded row, no sample copy and no placeholder count: an account with no
 * notifications sees the empty state, which is the truthful answer.
 *
 * Read state is updated optimistically, because the round-trip is a PATCH the
 * user has already decided the outcome of by tapping. If it fails the row is
 * put back, and the shell badge is corrected from the server on the next
 * refresh rather than left guessing.
 */
export default function NotificationCentre() {
  const { user } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const { unread, refresh: refreshBadge, setUnread } = useNotifications();
  const [markingAll, setMarkingAll] = useState(false);

  const userId = user?.id ?? null;

  const load = useCallback(
    (signal: AbortSignal) => {
      if (userId === null) return Promise.resolve<Notification[]>([]);
      return fetchNotifications(userId, signal);
    },
    [userId],
  );

  const { resource, refreshing, refresh, reload, mutate } = useAsyncResource(load, {
    enabled: userId !== null,
  });

  const rows = resource.phase === "ready" ? resource.data : [];
  const unreadCount = useMemo(() => rows.filter((row) => row.read !== 1).length, [rows]);

  const markOne = useCallback(
    (notification: Notification) => {
      if (notification.read === 1) return;

      mutate((current) =>
        current.map((row) => (row.id === notification.id ? { ...row, read: 1 } : row)),
      );
      setUnread(Math.max(0, (unread ?? unreadCount) - 1));

      void markNotificationRead(notification.id).catch(() => {
        // Put the row back and let the server settle the badge.
        mutate((current) =>
          current.map((row) => (row.id === notification.id ? { ...row, read: 0 } : row)),
        );
        refreshBadge();
      });
    },
    [mutate, refreshBadge, setUnread, unread, unreadCount],
  );

  const openNotification = useCallback(
    (notification: Notification) => {
      markOne(notification);
      // targetingFromNotification reads the additive targetType/targetId fields
      // (Decision 14) straight off the row when the server has written them and
      // falls back to type + web link when it has not, so a row from before
      // migration 0006 still resolves.
      const target = resolveNotificationTarget(
        targetingFromNotification(notification, user?.role),
      );
      router.push(target);
    },
    [markOne, router, user?.role],
  );

  const markAll = useCallback(() => {
    if (userId === null || unreadCount === 0 || markingAll) return;

    setMarkingAll(true);
    mutate((current) => current.map((row) => ({ ...row, read: 1 })));
    setUnread(0);

    void markAllNotificationsRead(userId)
      .catch(() => {
        reload();
        refreshBadge();
      })
      .finally(() => setMarkingAll(false));
  }, [markingAll, mutate, refreshBadge, reload, setUnread, unreadCount, userId]);

  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader
        title="Notifications"
        back
        bell={false}
        action={
          unreadCount > 0 ? (
            <Pressable
              onPress={markAll}
              disabled={markingAll}
              hitSlop={hitSlop}
              accessibilityRole="button"
              accessibilityLabel={`Mark all ${unreadCount} notifications as read`}
              style={({ pressed }) => [
                styles.markAll,
                { borderColor: colors.border, backgroundColor: colors.secondary },
                (pressed || markingAll) && styles.pressed,
              ]}
            >
              <CheckCheck size={15} color={colors.primary} strokeWidth={2.2} />
              <Text style={[styles.markAllLabel, { color: colors.primary }]}>Mark all</Text>
            </Pressable>
          ) : undefined
        }
      />

      <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={6}>
        {(data) =>
          data.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Nothing yet"
              body="When someone messages you, responds to a brief or moves a project on, it lands here."
            />
          ) : (
            <FlatList
              data={data}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: colors.border }]} />
              )}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    refresh();
                    refreshBadge();
                  }}
                  tintColor={colors.mutedForeground}
                  colors={[colors.primary]}
                />
              }
              renderItem={({ item }) => (
                <ListRow
                  title={item.actorName || "Viewrr"}
                  subtitle={item.message}
                  subtitleLines={2}
                  meta={relativeTime(item.createdAt)}
                  highlighted={item.read !== 1}
                  leading={
                    <View>
                      <Avatar name={item.actorName || "Viewrr"} uri={item.actorAvatar} size="md" />
                      {item.read !== 1 ? (
                        <View
                          style={[
                            styles.unreadDot,
                            { backgroundColor: colors.primary, borderColor: colors.background },
                          ]}
                        />
                      ) : null}
                    </View>
                  }
                  onPress={() => openNotification(item)}
                  accessibilityHint="Opens the related screen and marks this as read"
                />
              )}
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
  },
  markAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    height: 34,
    paddingHorizontal: spacing[3],
    borderRadius: radii.full,
    borderWidth: 1,
  },
  markAllLabel: {
    ...typography.captionBold,
  },
  unreadDot: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: radii.full,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.6,
  },
});
