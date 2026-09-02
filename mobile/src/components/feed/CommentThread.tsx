import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SendHorizontal } from "lucide-react-native";

import { addComment, loadComments } from "@/api/feed";
import { ApiError } from "@/api/errors";
import type { CommentItem } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { relativeTime } from "@/lib/time";
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
 */
export function CommentThread({
  postId,
  onCommentAdded,
}: {
  postId: number;
  onCommentAdded: () => void;
}) {
  const { colors } = useTheme();

  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

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
  }, [draft, onCommentAdded, postId, sending]);

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
        items.map(({ comment, user }) => (
          <View key={comment.id} style={styles.comment}>
            <Avatar name={user.name} uri={user.avatar} size="sm" />
            <View style={styles.commentBody}>
              <View style={styles.commentHead}>
                <Text style={[styles.commentName, { color: colors.foreground }]} numberOfLines={1}>
                  {user.name}
                </Text>
                <Text style={[styles.commentTime, { color: colors.mutedForeground }]}>
                  {relativeTime(comment.createdAt)}
                </Text>
              </View>
              <Text style={[styles.commentText, { color: colors.foreground }]}>
                {comment.content}
              </Text>
            </View>
          </View>
        ))
      )}

      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

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
    flexShrink: 1,
  },
  commentTime: {
    ...typography.caption,
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
  send: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
