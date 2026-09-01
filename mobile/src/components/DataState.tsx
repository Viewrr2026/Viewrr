import { CloudOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { ScreenSkeleton } from "@/components/Skeleton";
import type { Resource } from "@/hooks/useAsyncResource";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Renders the loading and failure halves of the four-state contract so no
 * screen has to re-implement them. The screen supplies `children` for the
 * ready state and decides for itself what emptiness means.
 *
 * Offline is drawn differently from a server failure on purpose: one is the
 * user's problem to solve and the other is ours, and telling them apart is the
 * difference between "check your signal" and "it's not you".
 */

type DataStateProps<T> = {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
  onRetry: () => void;
  /** Silhouette for the first paint. */
  skeleton?: "list" | "dashboard";
  skeletonRows?: number;
};

export function DataState<T>({
  resource,
  children,
  onRetry,
  skeleton = "list",
  skeletonRows,
}: DataStateProps<T>) {
  const { colors } = useTheme();

  if (resource.phase === "loading") {
    return <ScreenSkeleton variant={skeleton} rows={skeletonRows} />;
  }

  if (resource.phase === "error") {
    const { failure } = resource;

    if (failure.kind === "offline") {
      return (
        <View style={styles.offline} accessibilityRole="alert">
          <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
            <CloudOff size={22} color={colors.mutedForeground} strokeWidth={2.2} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.foreground }]}>You&apos;re offline</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Viewrr couldn&apos;t be reached. Check your connection and try again.
            </Text>
          </View>
          <Button label="Try again" variant="secondary" block={false} onPress={onRetry} />
        </View>
      );
    }

    return (
      <ErrorState
        title={failure.rateLimited ? "Too many requests" : "Couldn't load this"}
        message={failure.message}
        onRetry={onRetry}
      />
    );
  }

  return <>{children(resource.data)}</>;
}

const styles = StyleSheet.create({
  offline: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
    padding: spacing[6],
  },
  badge: {
    width: 48,
    height: 48,
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
  body: {
    ...typography.small,
    textAlign: "center",
    maxWidth: 300,
  },
});
