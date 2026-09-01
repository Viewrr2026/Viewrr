import { MessageCircle } from "lucide-react-native";

import { AppHeader } from "@/components/AppHeader";
import { ComingNext } from "@/components/ComingNext";
import { Screen } from "@/components/Screen";

/**
 * Messages. Deliberately not fetching the conversation list yet: opening a
 * thread marks its messages read server-side, so this surface only ships once
 * the full read model ships with it.
 */
export default function MessagesIndex() {
  return (
    <Screen edges={["top", "left", "right"]}>
      <AppHeader title="Messages" brand />
      <ComingNext
        icon={MessageCircle}
        title="Conversations"
        body="Your Viewrr conversations with clients and creatives, with unread counts and full thread history."
        meanwhile="New message notifications already appear in your notification centre."
      />
    </Screen>
  );
}
