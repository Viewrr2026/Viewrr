import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
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
  /**
   * Native pull-to-refresh. Only meaningful with `scroll`; list screens that
   * own their own FlatList pass a RefreshControl to the list instead.
   */
  refreshing?: boolean;
  onRefresh?: () => void;
  /**
   * Lift content above the keyboard. Opt-in, because a padding-based avoider
   * on a screen with no inputs just introduces layout jitter.
   */
  keyboard?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Screen container: themed --background surface, safe-area aware, web gutters. */
export function Screen({
  children,
  scroll = false,
  edges = ["top", "bottom", "left", "right"],
  flush = false,
  tone = "background",
  refreshing,
  onRefresh,
  keyboard = false,
  style,
}: ScreenProps) {
  const { colors } = useTheme();
  const padding = flush ? undefined : styles.gutter;
  const backgroundColor = tone === "muted" ? colors.muted : colors.background;

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.scrollContent, padding, style]}
      keyboardShouldPersistTaps="handled"
      // Dragging a list dismisses the keyboard, as it does everywhere else on
      // iOS. Cheap to set here once rather than per screen.
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={colors.mutedForeground}
            colors={[colors.primary]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padding, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor }]} edges={edges}>
      {keyboard ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
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
