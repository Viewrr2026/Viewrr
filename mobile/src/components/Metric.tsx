import { Pressable, StyleSheet, Text, View } from "react-native";

import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * A single number with its label.
 *
 * `value` is `number | null`. Null renders an em dash, not a zero: "we could
 * not read this" and "this is zero" are different facts, and showing 0 for the
 * first is exactly the kind of invented figure the truthful-data rule forbids.
 */

type MetricProps = {
  label: string;
  value: number | null;
  /** Tint the number with the brand colour when it is worth attention. */
  emphasis?: boolean;
  onPress?: () => void;
};

export function Metric({ label, value, emphasis = false, onPress }: MetricProps) {
  const { colors } = useTheme();

  const display = value === null ? "—" : String(value);
  const body = (
    <>
      <Text
        style={[
          styles.value,
          { color: emphasis && value ? colors.primary : colors.foreground },
        ]}
        numberOfLines={1}
      >
        {display}
      </Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={2}>
        {label}
      </Text>
    </>
  );

  const surface = [
    styles.card,
    { backgroundColor: colors.card, borderColor: colors.border },
  ];

  if (!onPress) {
    return (
      <View style={surface} accessibilityLabel={`${label}: ${display}`}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${display}`}
      style={({ pressed }) => [surface, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 76,
    justifyContent: "center",
    gap: 2,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radii.xl,
    borderWidth: 1,
  },
  value: {
    ...typography.h2,
  },
  label: {
    ...typography.caption,
  },
  pressed: {
    opacity: 0.7,
  },
});
