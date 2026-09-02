import { Heart, MessageCircle, Trash2 } from "lucide-react-native";
import { memo, useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import type { FeedItem } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { CommentThread } from "@/components/feed/CommentThread";
import { PostMediaView } from "@/components/feed/PostMedia";
import { parseJsonArray } from "@/lib/format";
import { relativeTime } from "@/lib/time";
import { hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * One feed post.
 *
 * Deliberately narrower than the web card, and the omissions are the point:
 *
 *   • Share       — web copies `window.location.href`, which is the feed URL,
 *                   not a permalink. There is no `GET /api/feed/:id` and no
 *                   `/feed/:id` route, so there is nothing to share.
 *   • Repost      — web keeps it in `useState`; it survives no refresh and hits
 *                   no endpoint. It is a mock, so it is not ported.
 *   • Message     — web's DM modal toasts "Message sent" without calling
 *                   `/api/messages`. Native messaging is Stage 3.
 *   • Edit        — `PATCH /api/feed/:id` is a full replace that wipes any field
 *                   the caller omits; a native editor is deferred with the rest
 *                   of composition polish.
 *   • Admin remove — founder moderation stays on web this release.
 *
 * Everything present here is backed by a real endpoint. Likes are optimistic
 * with rollback, and the toggle is never auto-retried: the endpoint flips
 * rather than sets, so a blind retry would un-like the post.
 */

type PostCardProps = {
  item: FeedItem;
  /** The signed-in user, so the card can offer owner actions. */
  viewerId: number;
  onOpenAuthor: (userId: number) => void;
  onToggleLike: (postId: number) => void;
  onCommentAdded: (postId: number) => void;
  onDelete: (postId: number) => void;
};

function PostCardBase({
  item,
  viewerId,
  onOpenAuthor,
  onToggleLike,
  onCommentAdded,
  onDelete,
}: PostCardProps) {
  const { colors, shadows } = useTheme();
  const [showComments, setShowComments] = useState(false);

  const { post, user, liked } = item;
  const isOwner = post.userId === viewerId;

  const tags = parseJsonArray(post.tags).filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
  );

  const byline = [user.headline, user.location].filter(Boolean).join(" · ");

  const confirmDelete = useCallback(() => {
    Alert.alert("Delete post", "This removes the post for everyone. It cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(post.id) },
    ]);
  }, [onDelete, post.id]);

  return (
    <View
      style={[
        styles.card,
        shadows.sm,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => onOpenAuthor(user.id)}
          accessibilityRole="button"
          accessibilityLabel={`View ${user.name}'s profile`}
          style={({ pressed }) => [styles.author, pressed && styles.pressed]}
        >
          <Avatar name={user.name} uri={user.avatar} size="md" />
          <View style={styles.authorCopy}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {user.name}
            </Text>
            {byline ? (
              <Text style={[styles.byline, { color: colors.mutedForeground }]} numberOfLines={1}>
                {byline}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.headerRight}>
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {relativeTime(post.createdAt)}
          </Text>
          {isOwner ? (
            <Pressable
              onPress={confirmDelete}
              hitSlop={hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Delete this post"
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Trash2 size={16} color={colors.mutedForeground} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {post.caption ? (
        <Text style={[styles.caption, { color: colors.foreground }]}>{post.caption}</Text>
      ) : null}

      {tags.length ? (
        <View style={styles.tags}>
          {tags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.tag,
                { backgroundColor: colors.primaryWash, borderColor: colors.primaryWashBorder },
              ]}
            >
              <Text style={[styles.tagLabel, { color: colors.primary }]}>#{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <PostMediaView mediaUrl={post.mediaUrl} mediaType={post.mediaType} />

      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={() => onToggleLike(post.id)}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel={liked ? "Unlike this post" : "Like this post"}
          accessibilityState={{ selected: liked }}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Heart
            size={18}
            color={liked ? colors.primary : colors.mutedForeground}
            fill={liked ? colors.primary : "transparent"}
            strokeWidth={2}
          />
          <Text
            style={[styles.actionLabel, { color: liked ? colors.primary : colors.mutedForeground }]}
          >
            {post.likeCount > 0 ? post.likeCount : "Like"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setShowComments((open) => !open)}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel={showComments ? "Hide comments" : "Show comments"}
          accessibilityState={{ expanded: showComments }}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <MessageCircle size={18} color={colors.mutedForeground} strokeWidth={2} />
          <Text style={[styles.actionLabel, { color: colors.mutedForeground }]}>
            {post.commentCount > 0 ? post.commentCount : "Comment"}
          </Text>
        </Pressable>
      </View>

      {showComments ? (
        <CommentThread postId={post.id} onCommentAdded={() => onCommentAdded(post.id)} />
      ) : null}
    </View>
  );
}

export const PostCard = memo(PostCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    gap: spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  author: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flexShrink: 1,
  },
  authorCopy: {
    flexShrink: 1,
    gap: 1,
  },
  name: {
    ...typography.smallBold,
  },
  byline: {
    ...typography.caption,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  time: {
    ...typography.caption,
  },
  iconButton: {
    padding: spacing[1],
  },
  pressed: {
    opacity: 0.7,
  },
  caption: {
    ...typography.body,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1.5],
  },
  tag: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagLabel: {
    ...typography.caption,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[5],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[3],
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: 28,
  },
  actionLabel: {
    ...typography.smallMedium,
  },
});
