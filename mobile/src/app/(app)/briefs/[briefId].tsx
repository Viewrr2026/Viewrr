import { useLocalSearchParams } from "expo-router";
import { FileText } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/** Brief detail. Interest, negotiation and counter-offers are a later phase. */
export default function BriefDetail() {
  const { briefId } = useLocalSearchParams<{ briefId: string }>();

  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Brief" back />
      <ComingNext
        icon={FileText}
        title="Brief detail coming next"
        body="The full brief, deliverables and the interest and negotiation flow arrive with the Briefs release."
        meanwhile={briefId ? `Brief reference: ${briefId}` : undefined}
      />
    </Screen>
  );
}
