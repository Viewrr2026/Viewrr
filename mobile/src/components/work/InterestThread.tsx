import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";

import { loadInterestMessages, type InterestMessage } from "@/api/work";
import { DataState } from "@/components/DataState";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { relativeTime } from "@/lib/time";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * The negotiation thread attached to one brief interest.
 *
 * Decision 17: these messages live in Brief/Work context, never in the Messages
 * inbox. They are fetched through the brief-scoped, participant-checked route
 * `GET /api/briefs/:id/interest-messages/:interestId` rather than the DM list.
 *
 * Read-only in V1. The contract exposes no send endpoint for this thread, and
 * a composer that cannot deliver is worse than no composer — so the screen says
 * where replies happen instead of pretending to take one.
 */

type InterestThreadProps = {
  briefId: number;
  interestId: number;
  /** The signed-in user, so their own messages sit on the right. */
  viewerId: number;
};

export function InterestThread({ briefId, interestId, viewerId }: InterestThreadProps) {
  const { colors } = useTheme();

  const loader = useCallback(
    (signal: AbortSignal) => loadInterestMessages(briefId, interestId, signal),
    [briefId, interestId],
  );
  const { resource, reload } = useAsyncResource<InterestMessage[]>(loader, {
    deps: [briefId, interestId],
  });

  return (
    <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={2}>
      {(messages) => {
        if (messages.length === 0) {
          return (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No messages on this interest yet.
            </Text>
          );
        }

        return (
          <View style={styles.thread}>
            {messages.map((message) => {
              const mine = message.fromId === viewerId;

              return (
                <View
                  key={message.id}
                  style={[
                    styles.bubble,
                    mine ? styles.mine : styles.theirs,
                    {
                      backgroundColor: mine ? colors.primary : colors.secondary,
                      borderColor: mine ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.copy,
                      { color: mine ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {message.content}
                  </Text>
                  {relativeTime(message.createdAt) ? (
                    <Text
                      style={[
                        styles.when,
                        { color: mine ? colors.primaryForeground : colors.mutedForeground },
                      ]}
                    >
                      {relativeTime(message.createdAt)}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
              Replies and counter-offers are handled on the Viewrr website for now.
            </Text>
          </View>
        );
      }}
    </DataState>
  );
}

const styles = StyleSheet.create({
  thread: {
    gap: spacing[2],
  },
  bubble: {
    maxWidth: "88%",
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: 2,
  },
  mine: {
    alignSelf: "flex-end",
  },
  theirs: {
    alignSelf: "flex-start",
  },
  copy: {
    ...typography.small,
  },
  when: {
    ...typography.caption,
  },
  empty: {
    ...typography.caption,
  },
  footnote: {
    ...typography.caption,
    paddingTop: spacing[1],
  },
});
