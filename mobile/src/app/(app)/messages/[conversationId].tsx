import { MessageCircle } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/** A single conversation. Target for message notification links. */
export default function Conversation() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Conversation" back />
      <ComingNext
        icon={MessageCircle}
        title="Thread coming next"
        body="The full conversation, attachments and replies arrive with the Messages release."
      />
    </Screen>
  );
}
