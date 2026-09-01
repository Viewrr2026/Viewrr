import { Settings } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/** Account settings. Appearance already lives on the Profile tab itself. */
export default function SettingsScreen() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Settings" back />
      <ComingNext
        icon={Settings}
        title="Settings coming next"
        body="Account details, email address and app preferences."
        meanwhile="Light and dark appearance can be set from the Profile tab now."
      />
    </Screen>
  );
}
