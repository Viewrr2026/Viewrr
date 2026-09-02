import { Stack } from "expo-router";

import { useTheme } from "@/theme";

/**
 * Project stack: overview, stages, activity, deliverables.
 *
 * Headers stay off here for the same reason as the rest of the app — AppHeader
 * inside each screen is the single header implementation, so there is no second
 * one to drift out of sync. Each child is a push, which keeps the back gesture
 * returning to the project overview rather than out to the Work list.
 */
export default function ProjectLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
