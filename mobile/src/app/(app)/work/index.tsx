import { Briefcase } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Work. Home already surfaces active projects from the real projects endpoint;
 * the full workspace — stages, approvals, deliverables — is a later phase.
 */
export default function WorkIndex() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Work" brand />
      <ComingNext
        icon={Briefcase}
        title="Your project workspace"
        body="Stages, approvals, deliverables and project activity in one place, for every job you have on."
        meanwhile="Your active projects are listed on Home in the meantime."
      />
    </Screen>
  );
}
