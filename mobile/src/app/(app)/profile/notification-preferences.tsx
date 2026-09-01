import { Bell } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Notification preferences. GET/PATCH /api/notifications/preferences/:userId
 * already exists and is authorised; the toggles ship with push, so that the
 * screen sets expectations it can actually keep.
 */
export default function NotificationPreferences() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Notifications" back bell={false} />
      <ComingNext
        icon={Bell}
        title="Preferences coming next"
        body="Choose which messages, brief responses and project updates reach you, and how."
        meanwhile="Everything still appears in your notification centre in the meantime."
      />
    </Screen>
  );
}
