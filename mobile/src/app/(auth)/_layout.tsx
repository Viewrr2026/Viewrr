import { Redirect, Stack } from "expo-router";

import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

export default function AuthLayout() {
  const { status } = useSession();
  const { colors } = useTheme();

  // Mirror of the guard in (app)/_layout — a signed-in session never sits on
  // the auth stack, so sign-in/sign-out flows need no imperative navigation.
  if (status === "signed-in") {
    return <Redirect href="/(app)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" options={{ presentation: "card" }} />
    </Stack>
  );
}
