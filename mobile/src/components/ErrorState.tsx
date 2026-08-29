import { AlertTriangle } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { radii, spacing, typography, useTheme } from "@/theme";

type ErrorStateProps = {
  title?: string;
  /** User-facing copy. Never pass raw error messages or URLs. */
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Compact inline treatment instead of a full-screen state. */
  inline?: boolean;
};

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  inline = false,
}: ErrorStateProps) {
  const { colors, scheme } = useTheme();

  return (
    <View
      style={[
        styles.container,
        inline
          ? [
              styles.inline,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]
          : styles.fill,
      ]}
      accessibilityRole="alert"
    >
      <View
        style={[
          styles.badge,
          {
            backgroundColor:
              scheme === "dark" ? "rgba(220, 40, 40, 0.18)" : "rgba(239, 67, 67, 0.12)",
          },
        ]}
      >
        <AlertTriangle size={22} color={colors.destructive} strokeWidth={2.2} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text>
      </View>
      {onRetry ? (
        <Button label={retryLabel} variant="secondary" onPress={onRetry} block={false} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
  },
  fill: {
    flex: 1,
    padding: spacing[6],
  },
  inline: {
    padding: spacing[4],
    borderRadius: radii.xl,
    borderWidth: 1,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    gap: spacing[2],
    alignItems: "center",
  },
  title: {
    ...typography.h3,
    textAlign: "center",
  },
  message: {
    ...typography.small,
    textAlign: "center",
    maxWidth: 300,
  },
});
