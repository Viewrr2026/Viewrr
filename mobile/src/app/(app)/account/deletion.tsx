import { Trash2 } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Account deletion.
 *
 * The backend already implements the two-step flow (POST /api/me/request-deletion,
 * which answers 409 with a reason when live projects or unsettled payments block
 * it, then POST /api/me/confirm-deletion). Wiring the destructive confirmation
 * UI is a deliberate separate pass: it is the one flow in the app that cannot be
 * undone, so it ships with its own review rather than inside a shell build.
 */
export default function AccountDeletion() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Delete account" back />
      <ComingNext
        icon={Trash2}
        title="Deletion from the app is coming next"
        body="Viewrr checks for live projects and unsettled payments first, then permanently removes your account."
        meanwhile="You can request deletion today at viewrr.co.uk or by emailing support@viewrr.co.uk."
      />
    </Screen>
  );
}
