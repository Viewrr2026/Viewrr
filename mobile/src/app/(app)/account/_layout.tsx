import { Stack } from "expo-router";

import { useTheme } from "@/theme";

/**
 * Stack for this tab. Headers are drawn by AppHeader inside each screen, so the
 * navigator's own header stays off — that keeps one header implementation for
 * the whole app rather than two that drift apart.
 */
export default function SectionLayout() {
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
