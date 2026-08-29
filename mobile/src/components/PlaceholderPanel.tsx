import { StyleSheet, Text, View } from "react-native";

import { radii, spacing, typography, useTheme } from "@/theme";

/** Honest empty state for shell tabs that have no feature behind them yet. */
export function PlaceholderPanel({ title, body }: { title: string; body: string }) {
  const { colors, shadows } = useTheme();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.frame,
          { backgroundColor: colors.card, borderColor: colors.border },
          shadows.sm,
        ]}
      >
        <View style={[styles.bar, { backgroundColor: colors.muted }]} />
        <View style={[styles.bar, styles.barShort, { backgroundColor: colors.muted }]} />
        <View style={[styles.bar, styles.barShorter, { backgroundColor: colors.primaryWash }]} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    paddingBottom: spacing[12],
  },
  frame: {
    width: 132,
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  bar: {
    height: 8,
    borderRadius: radii.full,
  },
  barShort: {
    width: "70%",
  },
  barShorter: {
    width: "45%",
  },
  title: {
    ...typography.h3,
  },
  body: {
    ...typography.small,
    textAlign: "center",
    maxWidth: 260,
  },
});
