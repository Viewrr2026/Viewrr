import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Flag,
  MoreHorizontal,
  SendHorizontal,
  UserX,
} from "lucide-react-native";

import { addComment, loadComments } from "@/api/feed";
import { ApiError } from "@/api/errors";
import { blockUser } from "@/api/trust";
import type { CommentItem } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { Avatar } from "@/components/Avatar";
import { ReportDialog } from "@/components/ReportDialog";
import { SignInPrompt } from "@/components/SignInPrompt";
import { relativeTime } from "@/lib/time";
import { useSession } from "@/session/SessionProvider";
import { control, hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Comments for one post, loaded on demand.
 *
 * `GET /api/feed/:id/comments` is unpaginated and does one user lookup per
 * comment server-side (`storage.ts:836-848`), so it is fetched only when the
 * reader actually opens a thread — never prefetched for a whole feed page.
 * That single decision is the difference between one query and thirty on
 * every scroll.
 *
 * The composer posts `{ content }` only; the author and post id are both
 * derived server-side (`routes.ts:1565`).
 *
 * Gating (PRD 1, Decision 1): the GET is optional-auth, so a signed-out reader
 * sees the thread in full. Posting requires a credential, so with no session
 * the composer is replaced by a single gate row that opens SignInPrompt. The
 * input is not merely disabled — there is no draft to lose and no way to type a
 * comment that would then fail to send, and nothing is ever appended to the
 * list optimistically.
 */
export function CommentThread({
  postId,
  onCommentAdded,
}: {
  postId: number;
  onCommentAdded: () => void;
}) {
  const { colors } = useTheme();
  const { status, user: viewer } = useSession();
  const signedIn = status === "signed-in";

  const [gateOpen, setGateOpen] = useState(false);
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedComment, setSelectedComment] = useState<CommentItem | null>(null);
  const [reportingComment, setReportingComment] = useState<CommentItem | null>(null);
  const [blockingUserId, setBlockingUserId] = useState<number | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await loadComments(postId);
      if (mounted.current) setItems(data);
    } catch (cause) {
      if (!mounted.current) return;
      setItems([]);
      setError(
        cause instanceof ApiError && (cause.kind === "network" || cause.kind === "timeout")
          ? "Comments could not load — you appear to be offline."
          : "Comments could not load.",
      );
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    if (!signedIn) {
      // Defensive: the composer is not rendered without a session, so this can
      // only be reached if the session ends mid-draft. Prompt, never post.
      setGateOpen(true);
      return;
    }

    setSending(true);
    setError(null);
    try {
      const created = await addComment(postId, content);
      if (!mounted.current) return;
      setItems((current) => [...(current ?? []), created]);
      setDraft("");
      onCommentAdded();
    } catch {
      if (mounted.current) setError("Your comment did not send. Try again.");
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [draft, onCommentAdded, postId, sending, signedIn]);

  const confirmBlockCommentAuthor = useCallback(
    (item: CommentItem) => {
      if (blockingUserId !== null) return;

      const target = item.user;
      setSelectedComment(null);

      Alert.alert(
        `Block ${target.name}?`,
        "You won't see each other's profiles, posts or normal direct messages. Existing Viewrr projects remain available so active work and payment obligations can still be completed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Block",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setBlockingUserId(target.id);

                try {
                  await blockUser(target.id);

                  if (!mounted.current) return;

                  setItems((current) =>
                    (current ?? []).filter((entry) => entry.user.id !== target.id),
                  );
                  setBlockingUserId(null);

                  Alert.alert(
                    "Account blocked",
                    `${target.name} has been blocked. You can undo this later in Settings → Blocked accounts.`,
                  );
                } catch {
                  if (!mounted.current) return;

                  setBlockingUserId(null);
                  Alert.alert(
                    "Couldn't block account",
                    "We couldn't block this account just now. Please try again.",
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [blockingUserId],
  );

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>
      {items === null ? (
        <ActivityIndicator color={colors.mutedForeground} style={styles.loading} />
      ) : items.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          No comments yet. Be the first to reply.
        </Text>
      ) : (
        items.map((item) => {
          const { comment, user } = item;
          const canModerate =
            signedIn && viewer?.id != null && user.id !== viewer.id;

          return (
            <View key={comment.id} style={styles.comment}>
              <Avatar name={user.name} uri={user.avatar} size="sm" />

              <View style={styles.commentBody}>
                <View style={styles.commentHead}>
                  <Text
                    style={[styles.commentName, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {user.name}
                  </Text>

                  <Text style={[styles.commentTime, { color: colors.mutedForeground }]}>
                    {relativeTime(comment.createdAt)}
                  </Text>

                  {canModerate ? (
                    <Pressable
                      onPress={() => setSelectedComment(item)}
                      disabled={blockingUserId !== null}
                      hitSlop={hitSlop}
                      accessibilityRole="button"
                      accessibilityLabel={`More options for ${user.name}'s comment`}
                      accessibilityHint="Report this comment or block its author"
                      accessibilityState={{ disabled: blockingUserId !== null }}
                      style={({ pressed }) => [
                        styles.commentMore,
                        pressed && styles.gatePressed,
                      ]}
                    >
                      <MoreHorizontal
                        size={17}
                        color={colors.mutedForeground}
                        strokeWidth={2}
                      />
                    </Pressable>
                  ) : null}
                </View>

                <Text style={[styles.commentText, { color: colors.foreground }]}>
                  {comment.content}
                </Text>
              </View>
            </View>
          );
        })
      )}

      {selectedComment ? (
        <ActionSheet
          visible
          title={`Comment by ${selectedComment.user.name}`}
          message="Choose how you want to manage this content."
          onClose={() => setSelectedComment(null)}
          actions={[
            {
              label: "Report comment",
              icon: Flag,
              description: "Send this specific comment to the Viewrr moderation team",
              disabled: blockingUserId !== null,
              onPress: () => {
                const item = selectedComment;
                setSelectedComment(null);
                setReportingComment(item);
              },
            },
            {
              label: `Block ${selectedComment.user.name}`,
              icon: UserX,
              tone: "destructive",
              description:
                "Hide this person's social content and stop normal direct-message contact",
              disabled: blockingUserId !== null,
              onPress: () => confirmBlockCommentAuthor(selectedComment),
            },
          ]}
        />
      ) : null}

      {reportingComment ? (
        <ReportDialog
          visible
          subjectType="comment"
          subjectId={reportingComment.comment.id}
          subjectLabel={`this comment by ${reportingComment.user.name}`}
          onClose={() => setReportingComment(null)}
        />
      ) : null}

      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

      {!signedIn ? (
        <Pressable
          onPress={() => setGateOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Sign in to comment"
          style={({ pressed }) => [
            styles.gate,
            { backgroundColor: colors.background, borderColor: colors.input },
            pressed && styles.gatePressed,
          ]}
        >
          <Text style={[styles.gateLabel, { color: colors.mutedForeground }]}>
            Sign in to join the conversation
          </Text>
        </Pressable>
      ) : (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment"
            placeholderTextColor={colors.mutedForeground}
            multiline
            accessibilityLabel="Add a comment"
            style={[
              styles.input,
              Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
              {
                backgroundColor: colors.background,
                borderColor: colors.input,
                color: colors.foreground,
              },
            ]}
          />
          <Pressable
            onPress={() => void send()}
            disabled={!canSend}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            accessibilityState={{ disabled: !canSend }}
            style={({ pressed }) => [
              styles.send,
              {
                backgroundColor: canSend ? colors.primary : colors.muted,
                opacity: pressed && canSend ? 0.9 : 1,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <SendHorizontal
                size={17}
                color={canSend ? colors.primaryForeground : colors.mutedForeground}
                strokeWidth={2.2}
              />
            )}
          </Pressable>
        </View>
      )}

      <SignInPrompt
        visible={gateOpen}
        action="comment"
        onClose={() => setGateOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[3],
    paddingTop: spacing[3],
    gap: spacing[3],
  },
  loading: {
    alignSelf: "flex-start",
  },
  empty: {
    ...typography.small,
  },
  comment: {
    flexDirection: "row",
    gap: spacing[2],
  },
  commentBody: {
    flex: 1,
    gap: 2,
  },
  commentHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  commentName: {
    ...typography.smallBold,
    flex: 1,
    minWidth: 0,
  },
  commentTime: {
    ...typography.caption,
  },
  commentMore: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -6,
  },
  commentText: {
    ...typography.small,
  },
  error: {
    ...typography.caption,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  input: {
    flex: 1,
    minHeight: control.minTouchTarget,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    ...typography.small,
  },
  gate: {
    minHeight: control.minTouchTarget,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
  },
  gatePressed: {
    opacity: 0.8,
  },
  gateLabel: {
    ...typography.small,
  },
  send: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
