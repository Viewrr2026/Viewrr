import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ProjectStage } from "@/api/work";
import { StatusBadge } from "@/components/StatusBadge";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * One stage in the timeline.
 *
 * Timeline rail on the left, stage content on the right, and whatever actions
 * the caller passes in `children` — the row itself never decides what may be
 * done to a stage. That belongs to `gateStage`.
 *
 * `approvalRequired` and `revisionAllowance` are shown as plan facts because
 * they change what happens next and the server enforces neither: a client who
 * can see "needs your approval" understands why the stage is waiting.
 */

type StageRowProps = {
  stage: ProjectStage;
  /** 1-based, for display only. */
  index: number;
  total: number;
  /** The stage work is currently sitting on. */
  active: boolean;
  /** True when this is the last row, so the rail stops. */
  last: boolean;
  children?: ReactNode;
};

function isDone(status: string): boolean {
  return status === "completed" || status === "approved";
}

export function StageRow({ stage, index, total, active, last, children }: StageRowProps) {
  const { colors } = useTheme();

  const done = isDone(stage.status);
  const dotColor = done ? colors.primary : active ? colors.primary : colors.border;

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor: done || active ? dotColor : colors.card,
              borderColor: dotColor,
            },
          ]}
        />
        {last ? null : <View style={[styles.line, { backgroundColor: colors.border }]} />}
      </View>

      <View
        style={[
          styles.body,
          {
            backgroundColor: active ? colors.primaryWash : colors.card,
            borderColor: active ? colors.primaryWashBorder : colors.border,
          },
        ]}
      >
        <Text style={[styles.position, { color: colors.mutedForeground }]}>
          STAGE {index} OF {total}
        </Text>

        <Text style={[styles.title, { color: colors.foreground }]}>{stage.title}</Text>

        <View style={styles.badges}>
          <StatusBadge status={stage.status} />
          {stage.approvalRequired === 1 ? (
            <Text style={[styles.flag, { color: colors.mutedForeground }]}>
              Client approval required
            </Text>
          ) : null}
        </View>

        {stage.description ? (
          <Text style={[styles.copy, { color: colors.mutedForeground }]}>
            {stage.description}
          </Text>
        ) : null}

        {stage.expectedDeliverable ? (
          <Text style={[styles.copy, { color: colors.mutedForeground }]}>
            Deliverable: {stage.expectedDeliverable}
          </Text>
        ) : null}

        {stage.targetDate ? (
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            Target: {stage.targetDate}
          </Text>
        ) : null}

        {stage.clientChangeRequest ? (
          <View style={[styles.quote, { borderColor: colors.border }]}>
            <Text style={[styles.quoteLabel, { color: colors.mutedForeground }]}>
              CHANGES REQUESTED
            </Text>
            <Text style={[styles.copy, { color: colors.foreground }]}>
              {stage.clientChangeRequest}
            </Text>
          </View>
        ) : null}

        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing[3],
  },
  rail: {
    width: 14,
    alignItems: "center",
    paddingTop: spacing[4],
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: radii.full,
    borderWidth: 2,
  },
  line: {
    flex: 1,
    width: StyleSheet.hairlineWidth * 2,
    marginTop: spacing[1],
  },
  body: {
    flex: 1,
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing[4],
    gap: spacing[2],
  },
  position: {
    ...typography.eyebrow,
  },
  title: {
    ...typography.h3,
  },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  flag: {
    ...typography.caption,
  },
  copy: {
    ...typography.small,
  },
  meta: {
    ...typography.caption,
  },
  quote: {
    borderLeftWidth: 2,
    paddingLeft: spacing[3],
    gap: 2,
  },
  quoteLabel: {
    ...typography.eyebrow,
  },
});
