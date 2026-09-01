import { useLocalSearchParams } from "expo-router";
import { UserRound } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Creative profile. Registered now because notifications carry /profile/:id
 * links — the resolver has to have somewhere honest to land.
 */
export default function CreativeProfile() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();

  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Creative" back />
      <ComingNext
        icon={UserRound}
        title="Profile coming next"
        body="Showreel, portfolio, rates and reviews for this creative arrive with the Discover release."
        meanwhile={profileId ? `Profile reference: ${profileId}` : undefined}
      />
    </Screen>
  );
}
