import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { radii, typography, useTheme } from "@/theme";

/**
 * Unread count badge. Shows a real backend number or nothing at all — it never
 * renders a dot for "probably something", and it never renders a zero.
 *
 * Counts above 99 clamp to "99+" so the pill cannot grow wide enough to push
 * the glyph it sits on out of its 44pt target.
 */

const MAX = 99;

type NotificationBadgeProps = {
  count: number | null | undefined;
  /** Overlay position on top of an icon, rather than inline in a row. */
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function NotificationBadge({ count, floating = false, style }: NotificationBadgeProps) {
  const { colors } = useTheme();

  if (!count || count < 1) return null;

  const label = count > MAX ? `${MAX}+` : String(count);

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: colors.primary,
          borderColor: colors.card,
          // A three-character label needs more room than a single digit.
          paddingHorizontal: label.length > 1 ? 5 : 0,
          minWidth: 18,
        },
        floating && styles.floating,
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 18,
    borderRadius: radii.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  floating: {
    position: "absolute",
    top: -6,
    right: -8,
  },
  label: {
    ...typography.captionBold,
    fontSize: 10,
    lineHeight: 13,
    color: "#FFFFFF",
  },
});
