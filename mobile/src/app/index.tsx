import { Redirect } from "expo-router";

import { LoadingState } from "@/components/LoadingState";
import { Screen } from "@/components/Screen";
import { useSession } from "@/session/SessionProvider";

/**
 * Entry gate. Runs immediately after the native splash hands off and routes to
 * the signed-out or signed-in stack. Deliberately renders no branding of its
 * own — the native splash covers this moment.
 */
export default function Index() {
  const { status } = useSession();

  if (status === "restoring") {
    return (
      <Screen>
        <LoadingState message="Starting Viewrr" />
      </Screen>
    );
  }

  return <Redirect href={status === "signed-in" ? "/(app)" : "/(auth)/welcome"} />;
}
