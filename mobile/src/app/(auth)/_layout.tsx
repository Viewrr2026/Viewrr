import { Redirect, Stack } from "expo-router";

import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

export default function AuthLayout() {
  const { status, emailVerificationRequired } = useSession();
  const { colors } = useTheme();

  // Mirror of the guard in (app)/_layout — a signed-in session never sits on
  // the auth stack, so sign-in/sign-out flows need no imperative navigation.
  //
  // The one exception is a brand-new account (PRD 1, Decision 4): registration
  // returns a real credential, so the session IS signed in, but the account has
  // not confirmed its email yet. Holding it on the auth stack keeps the code
  // screen reachable without touching the authenticated shell's own guard.
  // `emailVerificationRequired` is set only by register(), never by cold-start
  // restore, so an existing grandfathered account is never held here.
  if (status === "signed-in" && !emailVerificationRequired) {
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
      <Stack.Screen name="sign-up" options={{ presentation: "card" }} />
      {/* No back gesture: a verified email is the exit, not a swipe. */}
      <Stack.Screen name="verify-email" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
