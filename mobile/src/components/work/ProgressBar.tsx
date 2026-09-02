import { StyleSheet, Text, View } from "react-native";

import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * A stage-progress bar.
 *
 * `percent` is `number | null`, and null is drawn as an unfilled track with an
 * em dash rather than 0%. "We could not read the progress" and "no stage is
 * finished" are different facts, and only the server computes the first one
 * (`plan-summary.progress`) — mobile never recomputes a figure and presents it
 * as if it came from the backend.
 */

type ProgressBarProps = {
  /** 0–100, server-computed. Null when unknown. */
  percent: number | null;
  /** e.g. "2 of 5 stages complete" — supplied by the caller, never invented. */
  caption?: string;
};

export function ProgressBar({ percent, caption }: ProgressBarProps) {
  const { colors } = useTheme();

  const clamped =
    percent === null ? null : Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityValue={clamped === null ? { text: "Unknown" } : { now: clamped, min: 0, max: 100 }}
    >
      <View style={styles.header}>
        <Text style={[styles.caption, { color: colors.mutedForeground }]} numberOfLines={1}>
          {caption ?? "Stage progress"}
        </Text>
        <Text style={[styles.value, { color: colors.foreground }]}>
          {clamped === null ? "—" : `${clamped}%`}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        {clamped !== null && clamped > 0 ? (
          <View
            style={[styles.fill, { width: `${clamped}%`, backgroundColor: colors.primary }]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  caption: {
    ...typography.caption,
    flexShrink: 1,
  },
  value: {
    ...typography.smallBold,
  },
  track: {
    height: 6,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radii.full,
  },
});
