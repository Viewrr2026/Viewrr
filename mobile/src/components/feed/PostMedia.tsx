import { Image } from "expo-image";
import { Play } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MediaViewer } from "@/components/MediaViewer";
import { postMedia } from "@/lib/media";
import { radii, spacing, typography, useTheme } from "@/theme";

/** Uploaded videos use native playback; provider links stay embedded in-app. */
export function PostMediaView({
  mediaUrl,
  mediaType,
}: {
  mediaUrl: string | null;
  mediaType: string | null;
}) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  const media = postMedia(mediaUrl, mediaType);
  if (!media) return null;

  if (media.kind === "image") {
    if (failed) return null;
    return (
      <Image
        source={{ uri: media.uri }}
        style={[styles.frame, { backgroundColor: colors.muted }]}
        contentFit="cover"
        transition={160}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const { video } = media;
  const label = "Play video";

  return (
    <>
    {playing && <MediaViewer source={{ kind: "url", url: mediaUrl! }} title="Feed video" backLabel="Back to feed" onClose={() => setPlaying(false)} />}
    <Pressable
      onPress={() => setPlaying(true)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.videoWrap, pressed && styles.pressed]}
    >
      {failed || !video.thumbnailUrl ? (
        <View style={[styles.frame, styles.fallback, { backgroundColor: colors.muted }]} />
      ) : (
        <Image
          source={{ uri: video.thumbnailUrl }}
          style={[styles.frame, { backgroundColor: colors.muted }]}
          contentFit="cover"
          transition={160}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      )}

      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <View style={styles.playBadge}>
          <Play size={20} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
        </View>
      </View>

      <View style={[styles.provider, { backgroundColor: colors.overlay }]}>
        <Text style={styles.providerLabel}>{label}</Text>
      </View>
    </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radii.lg,
  },
  fallback: {
    // No poster frame available — the play affordance still reads as video.
  },
  videoWrap: {
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  pressed: {
    opacity: 0.92,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  playBadge: {
    width: 52,
    height: 52,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    paddingLeft: 3,
  },
  provider: {
    position: "absolute",
    left: spacing[2],
    bottom: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
  },
  providerLabel: {
    ...typography.caption,
    color: "#FFFFFF",
  },
});
