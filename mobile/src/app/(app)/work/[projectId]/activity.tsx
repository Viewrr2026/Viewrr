import { useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { loadActivity, type ActivityEntry } from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Screen } from "@/components/Screen";
import { ActivityRow } from "@/components/work/ActivityRow";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { gutter, spacing, typography, useTheme } from "@/theme";

/**
 * Project activity — stage events and project updates in one list.
 *
 * The merge happens server-side (`GET /api/projects/:id/activity`) and this
 * screen keeps the order it was given: newest first, chronological only.
 *
 * It is chronological ONLY, and that is a correctness decision rather than a
 * layout one. `project_updates.stage` holds the legacy 0–5 index, which has no
 * relationship to a dynamic `project_stages.id`; grouping updates under stage
 * headings would attach real notes to the wrong stage and look authoritative
 * doing it. So no grouping, no "on stage 3 of 5" line, and a stage label only
 * where the server attached one to the entry itself.
 */

export default function ProjectActivity() {
  const { colors } = useTheme();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  const id = Number(projectId);
  const valid = Number.isInteger(id) && id > 0;

  const loader = useCallback((signal: AbortSignal) => loadActivity(id, signal), [id]);
  const { resource, refreshing, refresh, reload } = useAsyncResource<ActivityEntry[]>(loader, {
    enabled: valid,
    deps: [id],
  });

  if (!valid) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <AppHeader title="Activity" back />
        <ErrorState
          title="Project not found"
          message="That project reference isn't valid. Open the project from your Work list."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]} flush>
      <View style={styles.gutter}>
        <AppHeader title="Activity" back />
      </View>

      <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={5}>
        {(entries) => (
          <FlatList
            data={entries}
            keyExtractor={(entry) => entry.id}
            renderItem={({ item }) => (
              <View style={styles.gutter}>
                <ActivityRow entry={item} />
              </View>
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
            )}
            ListHeaderComponent={
              entries.length > 0 ? (
                <View style={styles.gutter}>
                  <Text style={[styles.blurb, { color: colors.mutedForeground }]}>
                    Everything that&apos;s happened on this project, newest first.
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.gutter}>
                <EmptyState
                  title="Nothing yet"
                  body="Stage changes and project updates will appear here as the work moves."
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

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: gutter,
  },
  list: {
    paddingBottom: spacing[10],
  },
  blurb: {
    ...typography.caption,
    paddingBottom: spacing[3],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing[1],
  },
});
