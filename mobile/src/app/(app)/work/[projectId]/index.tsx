import { useLocalSearchParams } from "expo-router";
import { Briefcase } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Project detail. Registered now because /your-work and /invoice/:projectId
 * notification links both resolve into this route.
 */
export default function ProjectDetail() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Project" back />
      <ComingNext
        icon={Briefcase}
        title="Project detail coming next"
        body="Stage tracking, approvals, files and payment status for this project arrive with the workspace release."
        meanwhile={projectId ? `Project reference: ${projectId}` : undefined}
      />
    </Screen>
  );
}
