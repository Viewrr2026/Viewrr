import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Card language ported from client/src/components/ui/card.tsx:
 *   rounded-xl (12pt) + 1px border + bg-card + shadow-sm, header padding p-6.
 * Feature surfaces on web often step up to rounded-2xl, hence `size="feature"`.
 */

type CardProps = {
  children: React.ReactNode;
  size?: "default" | "feature";
  /** Brand-tinted surface — web uses bg-primary/10 + border-primary/20. */
  tone?: "default" | "brand";
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, size = "default", tone = "default", style }: CardProps) {
  const { colors, shadows } = useTheme();

  return (
    <View
      style={[
        styles.base,
        {
          borderRadius: size === "feature" ? radii["2xl"] : radii.xl,
          backgroundColor: tone === "brand" ? colors.primaryWash : colors.card,
          borderColor: tone === "brand" ? colors.primaryWashBorder : colors.border,
        },
        tone === "default" && shadows.sm,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Uppercase section label — the web's small caps card headers. */
export function CardLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.label, { color: colors.mutedForeground }]}>
      {typeof children === "string" ? children.toUpperCase() : children}
    </Text>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.title, { color: colors.cardForeground }]}>{children}</Text>;
}

export function CardBody({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: colors.mutedForeground }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    padding: spacing[5],
    gap: spacing[3],
  },
  label: {
    ...typography.eyebrow,
  },
  title: {
    ...typography.h3,
  },
  body: {
    ...typography.small,
  },
});
