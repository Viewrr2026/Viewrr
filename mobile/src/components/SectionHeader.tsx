import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { hitSlop, spacing, typography, useTheme } from "@/theme";

/**
 * Section title with an optional count and an optional "see all" affordance.
 * The count is always a real number passed by the caller — sections do not
 * invent totals, and a section with nothing in it is not rendered at all.
 */

type SectionHeaderProps = {
  title: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, count, actionLabel, onAction }: SectionHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {typeof count === "number" ? (
          <Text style={[styles.count, { color: colors.mutedForeground }]}>{count}</Text>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={[styles.actionLabel, { color: colors.primary }]}>{actionLabel}</Text>
          <ChevronRight size={14} color={colors.primary} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    minHeight: 28,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing[2],
    flexShrink: 1,
  },
  title: {
    ...typography.h3,
    flexShrink: 1,
  },
  count: {
    ...typography.smallMedium,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  actionLabel: {
    ...typography.smallBold,
  },
  pressed: {
    opacity: 0.6,
  },
});
