import { ListChecks } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/** Stage timeline for a project. Part of the workspace release. */
export default function ProjectStages() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Stages" back />
      <ComingNext
        icon={ListChecks}
        title="Stages coming next"
        body="Every stage, its status and who it is waiting on, with approvals you can action from your phone."
      />
    </Screen>
  );
}
