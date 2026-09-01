import { Activity } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/** Project activity feed. Part of the workspace release. */
export default function ProjectActivity() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Activity" back />
      <ComingNext
        icon={Activity}
        title="Activity coming next"
        body="A running record of updates, uploads and decisions on this project."
      />
    </Screen>
  );
}
