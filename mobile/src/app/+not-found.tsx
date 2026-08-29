import { useRouter } from "expo-router";

import { ErrorState } from "@/components/ErrorState";
import { Screen } from "@/components/Screen";

export default function NotFound() {
  const router = useRouter();

  return (
    <Screen>
      <ErrorState
        title="Screen not found"
        message="That link doesn't lead anywhere in the app yet."
        onRetry={() => router.replace("/")}
        retryLabel="Back to start"
      />
    </Screen>
  );
}
