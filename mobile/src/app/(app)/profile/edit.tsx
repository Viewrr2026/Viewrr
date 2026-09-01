import { Pencil } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Profile editing. The write endpoints exist (PATCH /api/users/:id and
 * PATCH /api/profiles/:id, both authorised), but the form, image upload and
 * validation ship together in the profile release rather than half now.
 */
export default function EditProfile() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Edit profile" back />
      <ComingNext
        icon={Pencil}
        title="Editing coming next"
        body="Photo, headline, bio, specialisms, rates and showreel, all editable from your phone."
        meanwhile="You can update your profile on viewrr.co.uk today."
      />
    </Screen>
  );
}
