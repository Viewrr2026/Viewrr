import { FileText } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/** Briefs (creative slot 2). Full feed and filtering land in the next phase. */
export default function BriefsIndex() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Briefs" brand />
      <ComingNext
        icon={FileText}
        title="The brief feed"
        body="Open briefs matched to your specialisms, with budgets, deadlines and one-tap expressions of interest."
        meanwhile="Your latest open briefs already appear on Home."
      />
    </Screen>
  );
}
