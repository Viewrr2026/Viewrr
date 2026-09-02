import { X } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { createPost } from "@/api/feed";
import { ApiError } from "@/api/errors";
import type { FeedItem } from "@/api/types";
import { Button } from "@/components/Button";
import { isHttpUrl, parseVideoUrl } from "@/lib/media";
import { gutter, hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Post composer.
 *
 * Scope is set by the backend, not by taste: `POST /api/feed` accepts a caption,
 * ONE optional media URL, a media type and a JSON tag string, and there is no
 * upload endpoint that will take a post image. `/api/upload/portfolio` exists
 * but its `resourceType` enum excludes posts (`routes.ts:762`), so a native
 * photo picker would have nowhere to send the file. The website has the same
 * limit and asks for a pasted link, which is what this does.
 *
 * → Reported as a product gap, not solved here: native media capture/upload for
 *   feed posts needs a backend upload path first.
 */

const MAX_CAPTION = 2000;
const MAX_TAGS = 5;

export function Composer({
  visible,
  onClose,
  onPosted,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted: (item: FeedItem) => void;
}) {
  const { colors } = useTheme();

  const [caption, setCaption] = useState("");
  const [link, setLink] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tags = useMemo(
    () =>
      tagInput
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
        .slice(0, MAX_TAGS),
    [tagInput],
  );

  const trimmedLink = link.trim();
  const video = parseVideoUrl(trimmedLink);
  const linkValid = trimmedLink.length === 0 || Boolean(video) || isHttpUrl(trimmedLink);
  const canPost = caption.trim().length > 0 && linkValid && !posting;

  const reset = useCallback(() => {
    setCaption("");
    setLink("");
    setTagInput("");
    setError(null);
  }, []);

  const dismiss = useCallback(() => {
    if (posting) return;
    reset();
    onClose();
  }, [onClose, posting, reset]);

  const submit = useCallback(async () => {
    if (!canPost) return;
    setPosting(true);
    setError(null);

    try {
      const created = await createPost({
        caption: caption.trim(),
        ...(trimmedLink
          ? { mediaUrl: trimmedLink, mediaType: video ? ("video" as const) : ("image" as const) }
          : {}),
        tags,
      });
      onPosted(created);
      reset();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof ApiError && (cause.kind === "network" || cause.kind === "timeout")
          ? "Your post did not send — check your connection and try again."
          : "Your post did not send. Try again.",
      );
    } finally {
      setPosting(false);
    }
  }, [canPost, caption, onClose, onPosted, reset, tags, trimmedLink, video]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={dismiss}
    >
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={[styles.bar, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={dismiss}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <X size={20} color={colors.mutedForeground} strokeWidth={2.2} />
          </Pressable>
          <Text style={[styles.barTitle, { color: colors.foreground }]}>Share an update</Text>
          <View style={styles.close} />
        </View>

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <TextInput
              value={caption}
              onChangeText={(next) => setCaption(next.slice(0, MAX_CAPTION))}
              placeholder="What have you been working on?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              autoFocus
              accessibilityLabel="Post caption"
              style={[
                styles.caption,
                Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
                { color: colors.foreground },
              ]}
            />

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                LINK (OPTIONAL)
              </Text>
              <TextInput
                value={link}
                onChangeText={setLink}
                placeholder="Vimeo, YouTube or image URL"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="Media link"
                style={[
                  styles.input,
                  Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
                  {
                    backgroundColor: colors.card,
                    borderColor: linkValid ? colors.input : colors.destructive,
                    color: colors.foreground,
                  },
                ]}
              />
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {video
                  ? `${video.provider === "vimeo" ? "Vimeo" : "YouTube"} video recognised.`
                  : linkValid
                    ? "Viewrr posts link to work hosted elsewhere — file upload is not available yet."
                    : "That does not look like a web address."}
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                TAGS (OPTIONAL)
              </Text>
              <TextInput
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="Wedding, London, Drone"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                accessibilityLabel="Tags, separated by commas"
                style={[
                  styles.input,
                  Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.input,
                    color: colors.foreground,
                  },
                ]}
              />
              {tags.length ? (
                <View style={styles.tags}>
                  {tags.map((tag) => (
                    <View
                      key={tag}
                      style={[
                        styles.tag,
                        {
                          backgroundColor: colors.primaryWash,
                          borderColor: colors.primaryWashBorder,
                        },
                      ]}
                    >
                      <Text style={[styles.tagLabel, { color: colors.primary }]}>#{tag}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  Separate with commas. Up to {MAX_TAGS}.
                </Text>
              )}
            </View>

            {error ? (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Button
              label="Post"
              onPress={() => void submit()}
              loading={posting}
              disabled={!canPost}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: gutter,
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  close: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
  barTitle: {
    ...typography.h3,
  },
  body: {
    padding: gutter,
    gap: spacing[5],
  },
  caption: {
    ...typography.body,
    minHeight: 120,
    textAlignVertical: "top",
  },
  field: {
    gap: spacing[2],
  },
  label: {
    ...typography.eyebrow,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    ...typography.small,
  },
  hint: {
    ...typography.caption,
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
  error: {
    ...typography.small,
  },
  footer: {
    padding: gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
