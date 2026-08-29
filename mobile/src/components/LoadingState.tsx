import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { spacing, typography, useTheme } from "@/theme";

type LoadingStateProps = {
  /** Short copy explaining the wait. Keep it under ~5 words. */
  message?: string;
  /** Fill the available space and centre. Off for inline use. */
  fill?: boolean;
};

export function LoadingState({ message, fill = true }: LoadingStateProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[styles.container, fill && styles.fill]}
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? "Loading"}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      {message ? (
        <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text>
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
  },
  message: {
    ...typography.small,
  },
});
