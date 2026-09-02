import { StyleSheet, Text, View } from "react-native";

import type { ConversationListItem } from "@/api/messages";
import { Avatar } from "@/components/Avatar";
import { ListRow } from "@/components/ListRow";
import { NotificationBadge } from "@/components/NotificationBadge";
import { relativeTime } from "@/lib/time";
import { spacing, typography, useTheme } from "@/theme";

/**
 * One inbox row: counterparty avatar, name, last-message preview, relative
 * time and the unread pill.
 *
 * The row is composed from the shared ListRow rather than re-drawn, so inbox
 * rhythm, touch target and pressed state match every other list in the app.
 * Unread rows are highlighted with the brand wash — the same treatment unread
 * notifications already use — and the name is emphasised, so an unread thread
 * reads as unread without needing the badge to be found first.
 *
 * Nothing is invented: a thread with no message text shows no preview line, a
 * row with an unparseable timestamp shows no time, and a zero unread count
 * renders no badge at all (NotificationBadge refuses to draw a zero).
 */

type ConversationRowProps = {
  conversation: ConversationListItem;
  onPress: () => void;
};

export function ConversationRow({ conversation, onPress }: ConversationRowProps) {
  const { colors } = useTheme();
  const unread = conversation.unread > 0;
  const time = relativeTime(conversation.lastMessageAt);

  return (
    <ListRow
      title={conversation.name}
      subtitle={conversation.lastMessage ?? conversation.headline ?? undefined}
      subtitleLines={2}
      highlighted={unread}
      chevron={false}
      onPress={onPress}
      accessibilityHint={
        unread
          ? `Open conversation. ${conversation.unread} unread ${
              conversation.unread === 1 ? "message" : "messages"
            }.`
          : "Open conversation"
      }
      leading={<Avatar name={conversation.name} uri={conversation.avatar} size="md" />}
      trailing={
        <View style={styles.trailing}>
          {time ? (
            <Text style={[styles.time, { color: colors.mutedForeground }]} numberOfLines={1}>
              {time}
            </Text>
          ) : null}
          <NotificationBadge count={conversation.unread} />
        </View>
      }
      style={styles.row}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing[3],
  },
  trailing: {
    alignItems: "flex-end",
    gap: spacing[1.5],
    minWidth: 52,
  },
  time: {
    ...typography.caption,
  },
});
