import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { control, radii, spacing, typography, useTheme } from "@/theme";

/**
 * The workhorse row: leading slot, title, optional supporting line, optional
 * trailing slot, optional chevron.
 *
 * Rows are 44pt minimum whether or not they are tappable, so a list keeps an
 * even rhythm and every interactive row clears the iOS target guidance. A row
 * with no `onPress` renders as plain content rather than a fake button, which
 * matters for screen readers.
 */

type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Third line, e.g. a timestamp. Kept visually quieter than the subtitle. */
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Show the disclosure chevron. Defaults to on when tappable. */
  chevron?: boolean;
  /** Draw a subtle brand wash — used for unread notifications. */
  highlighted?: boolean;
  /** Number of lines for the subtitle. Notifications allow two. */
  subtitleLines?: number;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function ListRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  chevron,
  highlighted = false,
  subtitleLines = 1,
  accessibilityHint,
  style,
}: ListRowProps) {
  const { colors } = useTheme();
  const showChevron = chevron ?? Boolean(onPress);

  const content = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}

      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.subtitle, { color: colors.mutedForeground }]}
            numberOfLines={subtitleLines}
          >
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>

      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {showChevron ? (
        <ChevronRight size={18} color={colors.mutedForeground} strokeWidth={2} />
      ) : null}
    </>
  );

  const base: StyleProp<ViewStyle> = [
    styles.row,
    highlighted && {
      backgroundColor: colors.primaryWash,
      borderRadius: radii.lg,
      paddingHorizontal: spacing[3],
    },
    style,
  ];

  if (!onPress) {
    return <View style={base}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [base, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: control.minTouchTarget,
    paddingVertical: spacing[2],
  },
  leading: {
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.smallBold,
  },
  subtitle: {
    ...typography.small,
  },
  meta: {
    ...typography.caption,
  },
  trailing: {
    alignItems: "flex-end",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.65,
  },
});
