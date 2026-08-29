import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { control, gradients, opacity, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Button treatment ported from web:
 *   • primary   → the CTA gradient linear-gradient(135deg,#FF5A1F,#FF8C42)
 *                 (58 uses in client/src) with white label, brand-tinted glow
 *                 (shadow-primary/25)
 *   • secondary → shadcn `secondary`: bg-secondary + border, foreground text
 *   • outline   → shadcn `outline`: transparent fill, border only
 *   • ghost     → shadcn `ghost`: transparent, transparent border
 *
 * Shape follows the website's CTA convention: the landing and marketplace
 * buttons are `rounded-full` (573 rounded-full uses across client/src), so that
 * is the default here; `shape="rounded"` gives the shadcn rounded-md form used
 * inside dense forms.
 *
 * Mobile adaptation: 48pt height, because the web's h-9 (36pt) is below the iOS
 * HIG 44pt / Android 48dp minimum touch target.
 */

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "default" | "compact";
type Shape = "pill" | "rounded";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  shape?: Shape;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "default",
  shape = "pill",
  loading = false,
  disabled = false,
  block = true,
  style,
  accessibilityHint,
}: ButtonProps) {
  const { colors, shadows } = useTheme();
  const isInactive = disabled || loading;

  const height = size === "compact" ? control.heightCompact : control.height;

  const surface: Record<Variant, ViewStyle> = {
    primary: {},
    secondary: {
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    outline: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.border,
    },
    ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "transparent" },
    destructive: { backgroundColor: colors.destructive },
  };

  const labelColor: Record<Variant, string> = {
    primary: "#FFFFFF",
    secondary: colors.secondaryForeground,
    outline: colors.foreground,
    ghost: colors.mutedForeground,
    destructive: colors.destructiveForeground,
  };

  const content = (
    <View style={styles.content}>
      {loading ? (
        <ActivityIndicator size="small" color={labelColor[variant]} />
      ) : (
        <Text style={[styles.label, { color: labelColor[variant] }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { minHeight: height, borderRadius: shape === "pill" ? radii.full : radii.md },
        surface[variant],
        variant === "primary" && !isInactive && shadows.brand,
        block && styles.block,
        pressed && !isInactive && styles.pressed,
        isInactive && { opacity: opacity.disabled },
        style,
      ]}
    >
      {variant === "primary" ? (
        <LinearGradient
          colors={[...gradients.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, { minHeight: height }]}
        >
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    justifyContent: "center",
    overflow: "hidden",
  },
  block: {
    alignSelf: "stretch",
  },
  fill: {
    justifyContent: "center",
    paddingHorizontal: spacing[6],
  },
  pressed: {
    opacity: opacity.pressed,
    transform: [{ scale: 0.99 }],
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
  },
  label: {
    ...typography.bodyBold,
  },
});
