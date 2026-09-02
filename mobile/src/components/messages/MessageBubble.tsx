import { StyleSheet, Text, View } from "react-native";

import type { DirectMessage } from "@/api/messages";
import { relativeTime } from "@/lib/time";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * A single message bubble.
 *
 * Sent and received are told apart three ways at once — side, fill and text
 * colour — so the thread is readable without relying on colour alone. Sent
 * messages use the brand fill with its own foreground token; received messages
 * use the card surface with a hairline border, which keeps them legible on both
 * the light and dark palettes without inventing a new colour.
 *
 * The timestamp is rendered from `createdAt` purely for display. It is never
 * used for ordering: `messages.created_at` is a text column with no reliable
 * ordering, so the thread is sorted by id and an unparseable value simply shows
 * no time rather than "Invalid Date".
 *
 * `pending` marks a locally appended send that the server has not confirmed.
 * It dims the bubble instead of pretending the message has landed.
 */

type MessageBubbleProps = {
  message: DirectMessage;
  /** True when the signed-in user is the sender. */
  mine: boolean;
  /** Awaiting the server's response to POST /api/messages. */
  pending?: boolean;
  /** Show the timestamp — suppressed for consecutive messages in a run. */
  showTime?: boolean;
};

export function MessageBubble({
  message,
  mine,
  pending = false,
  showTime = true,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const time = relativeTime(message.createdAt);

  return (
    <View style={[styles.wrapper, mine ? styles.alignEnd : styles.alignStart]}>
      <View
        style={[
          styles.bubble,
          mine
            ? [styles.mine, { backgroundColor: colors.primary }]
            : [
                styles.theirs,
                { backgroundColor: colors.card, borderColor: colors.border },
              ],
          pending && styles.pending,
        ]}
        accessibilityLabel={`${mine ? "You" : "Them"}: ${message.body}`}
      >
        <Text
          style={[
            styles.body,
            { color: mine ? colors.primaryForeground : colors.foreground },
          ]}
        >
          {message.body}
        </Text>
      </View>

      {showTime && (time || pending) ? (
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {pending ? "Sending…" : time}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 3,
    marginBottom: spacing[3],
    maxWidth: "84%",
  },
  alignStart: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  alignEnd: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubble: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radii["2xl"],
  },
  mine: {
    // A squared corner on the sender's side is the established chat idiom for
    // "this one is yours" and survives greyscale.
    borderBottomRightRadius: radii.sm,
  },
  theirs: {
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: radii.sm,
  },
  pending: {
    opacity: 0.6,
  },
  body: {
    ...typography.body,
  },
  meta: {
    ...typography.caption,
    paddingHorizontal: spacing[2],
  },
});
