import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * rounded-full badge — the single most common shape on the website
 * (rounded-full appears 573× in client/src). Web pattern for the brand tone is
 * `bg-primary/10 text-primary` with text-xs font-semibold; availability tones
 * come straight from the .badge-* classes in client/src/index.css.
 */

type Tone = "brand" | "neutral" | "available" | "busy" | "unavailable";

type PillProps = {
  label: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
};

export function Pill({ label, tone = "neutral", style }: PillProps) {
  const { colors, badge } = useTheme();

  const palette: Record<Tone, { background: string; text: string; border: string }> = {
    brand: {
      background: colors.primaryWash,
      text: colors.primary,
      border: colors.primaryWashBorder,
    },
    neutral: {
      background: colors.secondary,
      text: colors.secondaryForeground,
      border: colors.border,
    },
    available: {
      background: badge.available.background,
      text: badge.available.text,
      border: "transparent",
    },
    busy: { background: badge.busy.background, text: badge.busy.text, border: "transparent" },
    unavailable: {
      background: badge.unavailable.background,
      text: badge.unavailable.text,
      border: "transparent",
    },
  };

  const tones = palette[tone];

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: tones.background, borderColor: tones.border },
        style,
      ]}
    >
      <Text style={[styles.label, { color: tones.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    borderRadius: radii.full,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
  },
  label: {
    ...typography.captionBold,
  },
});
