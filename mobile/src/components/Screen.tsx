import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { gutter, spacing, useTheme } from "@/theme";

type ScreenProps = {
  children: ReactNode;
  /** Wrap content in a ScrollView. Off by default — most shells are flex layouts. */
  scroll?: boolean;
  /** Safe-area edges to inset. Tab screens usually omit "bottom". */
  edges?: readonly Edge[];
  /** Remove default horizontal padding (for edge-to-edge lists). */
  flush?: boolean;
  /** Use the muted app-chrome surface instead of --background. */
  tone?: "background" | "muted";
  style?: StyleProp<ViewStyle>;
};

/** Screen container: themed --background surface, safe-area aware, web gutters. */
export function Screen({
  children,
  scroll = false,
  edges = ["top", "bottom", "left", "right"],
  flush = false,
  tone = "background",
  style,
}: ScreenProps) {
  const { colors } = useTheme();
  const padding = flush ? undefined : styles.gutter;
  const backgroundColor = tone === "muted" ? colors.muted : colors.background;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]} edges={edges}>
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[styles.scrollContent, padding, style]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, padding, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  gutter: {
    paddingHorizontal: gutter,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing[8],
  },
});
