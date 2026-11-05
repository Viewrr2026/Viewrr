import { Image } from "expo-image";
import { Film, Play } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FeedVideo } from "@/components/feed/FeedVideo";
import { postMedia } from "@/lib/media";
import { radii, spacing, typography, useTheme } from "@/theme";

/** Uploaded videos use native playback; provider links stay embedded in-app. */
export function PostMediaView({ mediaUrl, mediaType, active = false, onOpenVideo, postId, registerVideo, onVideoLayout }: {
  mediaUrl: string | null;
  mediaType: string | null;
  active?: boolean;
  onOpenVideo: (url: string) => void;
  postId: number;
  registerVideo: (id: number, view: View | null) => void;
  onVideoLayout: () => void;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [mediaUrl]);
  const videoRef = useCallback((view: View | null) => registerVideo(postId, view), [postId, registerVideo]);
  const media = postMedia(mediaUrl, mediaType);
  if (!media) return null;

  if (media.kind === "image") {
    if (failed) return null;
    return <Image source={{ uri: media.uri }} style={[styles.frame, { backgroundColor: colors.muted }]}
      contentFit="cover" transition={160} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />;
  }

  const { video } = media;
  return (
    <View style={styles.videoWrap}>
      <View ref={videoRef} collapsable={false} onLayout={onVideoLayout} style={[styles.frame, styles.videoFrame]}>
        {active ? <FeedVideo key={mediaUrl} url={mediaUrl!} /> : (
          <Pressable onPress={() => onOpenVideo(mediaUrl!)} accessibilityRole="button" accessibilityLabel="Play video"
            style={({ pressed }) => [styles.poster, pressed && styles.pressed]}>
            {failed || !video.thumbnailUrl ? (
              <View style={[styles.poster, styles.fallback]}>
                <Film size={32} color="#FFFFFF" />
                <Text style={styles.providerLabel}>Video preview</Text>
              </View>
            ) : (
              <Image source={{ uri: video.thumbnailUrl }} style={[styles.poster, { backgroundColor: colors.muted }]}
                contentFit="cover" transition={160} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
            )}
            <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
              {video.thumbnailUrl && !failed ? <View style={styles.playBadge}>
                <Play size={20} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
              </View> : null}
            </View>
            <View style={[styles.provider, { backgroundColor: colors.overlay }]}>
              <Text style={styles.providerLabel}>Play video</Text>
            </View>
          </Pressable>
        )}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open video in viewer"
        onPress={() => onOpenVideo(mediaUrl!)} style={[styles.open, { backgroundColor: colors.secondary }]}>
        <Text style={[styles.openLabel, { color: colors.foreground }]}>Open video</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 9, borderRadius: radii.lg },
  // Provider embeds need at least 200px of height, including on smaller iPhones.
  videoFrame: { minHeight: 200, backgroundColor: "#111", overflow: "hidden", borderRadius: 0 },
  poster: { width: "100%", height: "100%" },
  fallback: { alignItems: "center", justifyContent: "center", gap: spacing[2], backgroundColor: "#292929" },
  open: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  openLabel: { ...typography.caption },
  videoWrap: { borderRadius: radii.lg, overflow: "hidden" },
  pressed: { opacity: 0.92 },
  scrim: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  playBadge: { width: 52, height: 52, borderRadius: radii.full, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.55)", paddingLeft: 3 },
  provider: { position: "absolute", left: spacing[2], bottom: spacing[2], paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: radii.full },
  providerLabel: { ...typography.caption, color: "#FFFFFF" },
});
