import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { radii, spacing, useTheme } from "@/theme";

/**
 * Branded loading placeholders.
 *
 * A spinner tells the user to wait; a skeleton tells them what is coming. Home
 * and the notification centre use these instead of ActivityIndicator so the
 * first paint already has the shape of the screen — no blank surface, no
 * layout jump when data lands.
 *
 * The pulse runs on the native driver, so it costs nothing on the JS thread
 * while the real request is in flight.
 */

function usePulse() {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);

  return value.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
}

type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ width = "100%", height = 12, radius, style }: SkeletonProps) {
  const { colors } = useTheme();
  const opacity = usePulse();

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? radii.md,
          backgroundColor: colors.muted,
          opacity,
        },
        style,
      ]}
    />
  );
}

/** Card-shaped placeholder — matches the Card surface it will be replaced by. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  const { colors } = useTheme();

  return (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Skeleton width="40%" height={10} />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          width={index === lines - 1 ? "60%" : "100%"}
          height={index === 0 ? 18 : 12}
        />
      ))}
    </View>
  );
}

/** Row-shaped placeholder for list surfaces. */
export function SkeletonRow() {
  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Skeleton width={44} height={44} radius={radii.full} />
      <View style={styles.rowCopy}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="85%" height={11} />
      </View>
    </View>
  );
}

/**
 * Whole-screen loading state: what a screen shows for its very first paint.
 * `variant` picks the silhouette so the placeholder resembles its destination.
 */
export function ScreenSkeleton({
  variant = "list",
  rows = 5,
}: {
  variant?: "list" | "dashboard";
  rows?: number;
}) {
  if (variant === "dashboard") {
    return (
      <View
        style={styles.screen}
        accessibilityRole="progressbar"
        accessibilityLabel="Loading"
      >
        <View style={styles.metrics}>
          <View style={styles.metricCell}>
            <Skeleton height={76} radius={radii.xl} />
          </View>
          <View style={styles.metricCell}>
            <Skeleton height={76} radius={radii.xl} />
          </View>
        </View>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </View>
    );
  }

  return (
    <View style={styles.screen} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing[4],
    paddingTop: spacing[2],
  },
  metrics: {
    flexDirection: "row",
    gap: spacing[3],
  },
  metricCell: {
    flex: 1,
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing[5],
    gap: spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  rowCopy: {
    flex: 1,
    gap: spacing[2],
  },
});
