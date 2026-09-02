import { useRouter } from "expo-router";
import { FileText } from "lucide-react-native";
import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { BRIEF_PAGE_SIZE, loadBriefs, type Brief } from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatBudget } from "@/lib/format";
import { relativeTime } from "@/lib/time";
import { useSession } from "@/session/SessionProvider";
import { gutter, spacing, typography, useTheme } from "@/theme";

/**
 * Briefs.
 *
 * Two audiences, one list, filtered server-side rather than in the client:
 * a client sees their own briefs (`?clientId=`), a creative sees the open feed.
 * Filtering after the fetch would mean paging through other people's briefs to
 * find your own, and the endpoint already supports the narrower read.
 *
 * This screen exists because brief links from interest notifications used to
 * land on a placeholder — a notification that goes nowhere is a bug, not a
 * missing feature.
 *
 * One page (50) is loaded. No infinite scroll yet: the endpoint is
 * offset-based and nothing here needs deep history, so the honest thing is to
 * show what one page holds rather than fake completeness.
 */

export default function BriefsIndex() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useSession();

  const isClient = user?.role === "client";
  const clientId = user?.id ?? 0;

  const loader = useCallback(
    (signal: AbortSignal) =>
      loadBriefs(
        isClient ? { clientId, limit: BRIEF_PAGE_SIZE } : { limit: BRIEF_PAGE_SIZE },
        signal,
      ),
    [isClient, clientId],
  );

  const { resource, refreshing, refresh, reload } = useAsyncResource<Brief[]>(loader, {
    enabled: Boolean(user),
    deps: [isClient, clientId],
  });

  return (
    <Screen edges={["top", "left", "right"]} flush>
      <View style={styles.gutter}>
        <AppHeader title="Briefs" brand />
      </View>

      <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={5}>
        {(briefs) => (
          <FlatList
            data={briefs}
            keyExtractor={(brief) => String(brief.id)}
            renderItem={({ item }) => (
              <View style={styles.gutter}>
                <ListRow
                  title={item.title}
                  subtitle={item.description}
                  subtitleLines={2}
                  meta={metaFor(item)}
                  leading={<Avatar name={item.clientName} uri={item.clientAvatar} size="md" />}
                  trailing={<StatusBadge status={item.status} />}
                  chevron
                  accessibilityHint="Opens the brief"
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/briefs/[briefId]",
                      params: { briefId: String(item.id) },
                    })
                  }
                />
              </View>
            )}
            ListHeaderComponent={
              <View style={styles.gutter}>
                <Text style={[styles.blurb, { color: colors.mutedForeground }]}>
                  {isClient
                    ? "Briefs you've posted, with the interest each one has attracted."
                    : "Open briefs from clients. Tap one for the full spec and to see where your interest stands."}
                </Text>
              </View>
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.gutter}>
                <EmptyState
                  icon={FileText}
                  title={isClient ? "No briefs posted yet" : "No open briefs right now"}
                  body={
                    isClient
                      ? "Briefs are posted on the Viewrr website. Once they're live, they'll appear here with their applicants."
                      : "Nothing is open at the moment. Pull to refresh — new briefs land throughout the week."
                  }
                  inline
                />
              </View>
            }
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
        )}
      </DataState>
    </Screen>
  );
}

/** Only facts the row actually carries: budget, location, interest count, age. */
function metaFor(brief: Brief): string {
  const parts: string[] = [];

  const budget = formatBudget(brief.budgetMin, brief.budgetMax, brief.budgetType);
  if (budget) parts.push(budget);

  if (brief.remote === 1) parts.push("Remote");
  else if (brief.location) parts.push(brief.location);

  parts.push(
    `${brief.applicationCount} ${brief.applicationCount === 1 ? "interest" : "interests"}`,
  );

  const age = relativeTime(brief.createdAt);
  if (age) parts.push(age);

  return parts.join(" · ");
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: gutter,
  },
  blurb: {
    ...typography.caption,
    paddingBottom: spacing[3],
  },
  list: {
    paddingBottom: spacing[10],
  },
  separator: {
    height: spacing[2],
  },
});
