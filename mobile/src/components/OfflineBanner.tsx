import { CloudOff } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Connectivity notice shown above content the user can still read.
 *
 * Offline is detected from the request itself — an ApiError of kind "network"
 * or "timeout" — rather than from a connectivity subscription. That is a
 * deliberate choice: it needs no additional native module (so no new dev build
 * to install one), and it reports the state that actually matters, which is
 * "Viewrr could not be reached", not "the radio claims it is up".
 */

type OfflineBannerProps = {
  /** Shown when the user last had data and it may now be stale. */
  message?: string;
  onRetry?: () => void;
};

export function OfflineBanner({
  message = "You're offline. Showing the last update.",
  onRetry,
}: OfflineBannerProps) {
  const { colors, scheme } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: scheme === "dark" ? "#2D2725" : "#F1EFEE",
          borderColor: colors.border,
        },
      ]}
      accessibilityRole="alert"
    >
      <CloudOff size={16} color={colors.mutedForeground} strokeWidth={2.2} />
      <Text style={[styles.message, { color: colors.mutedForeground }]} numberOfLines={2}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={[styles.retry, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: spacing[4],
  },
  message: {
    ...typography.caption,
    flex: 1,
  },
  retry: {
    ...typography.captionBold,
  },
  pressed: {
    opacity: 0.6,
  },
});
