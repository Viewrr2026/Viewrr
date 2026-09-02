import { StyleSheet, Text, View } from "react-native";

import type { ActivityEntry } from "@/api/work";
import { Avatar } from "@/components/Avatar";
import { relativeTime } from "@/lib/time";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * One entry in the merged project activity feed.
 *
 * Two kinds arrive from `GET /api/projects/:id/activity`: stage events from
 * `project_stage_events` and notes from `project_updates`. They are shown in
 * one chronological list, newest first, exactly as the server ordered them.
 *
 * What this row deliberately does NOT do: place an update against a stage.
 * `project_updates.stage` is the legacy 0–5 index and cannot be correlated with
 * a dynamic `project_stages.id`, so any "on stage X" line built from it would
 * be a guess. A stage label is rendered only when the server sent one.
 */

type ActivityRowProps = {
  entry: ActivityEntry;
};

export function ActivityRow({ entry }: ActivityRowProps) {
  const { colors } = useTheme();

  const actorName = entry.actor?.name ?? "Viewrr";
  const when = relativeTime(entry.at);
  const isEvent = entry.kind === "stage_event";

  return (
    <View style={styles.row}>
      <Avatar name={actorName} uri={entry.actor?.avatar ?? null} size="sm" />

      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
            {entry.title}
          </Text>
          {when ? (
            <Text style={[styles.when, { color: colors.mutedForeground }]}>{when}</Text>
          ) : null}
        </View>

        {entry.body ? (
          <Text style={[styles.copy, { color: colors.mutedForeground }]}>{entry.body}</Text>
        ) : null}

        <View style={styles.meta}>
          <View
            style={[
              styles.kind,
              {
                backgroundColor: isEvent ? colors.primaryWash : colors.secondary,
                borderColor: isEvent ? colors.primaryWashBorder : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.kindLabel,
                { color: isEvent ? colors.primary : colors.mutedForeground },
              ]}
            >
              {isEvent ? "Stage" : "Update"}
            </Text>
          </View>

          {entry.stageLabel ? (
            <Text style={[styles.stage, { color: colors.mutedForeground }]} numberOfLines={1}>
              {entry.stageLabel}
            </Text>
          ) : null}

          {entry.actor ? (
            <Text style={[styles.stage, { color: colors.mutedForeground }]} numberOfLines={1}>
              {actorName}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  body: {
    flex: 1,
    gap: spacing[1],
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  title: {
    ...typography.smallBold,
    flexShrink: 1,
  },
  when: {
    ...typography.caption,
  },
  copy: {
    ...typography.small,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
    paddingTop: 2,
  },
  kind: {
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
  },
  kindLabel: {
    ...typography.captionBold,
  },
  stage: {
    ...typography.caption,
    flexShrink: 1,
  },
});
