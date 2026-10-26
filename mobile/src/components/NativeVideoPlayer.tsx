import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";

/** Receives only a media URL, never the Viewrr session credential. */
export function NativeVideoPlayer({ uri, onRetry }: { uri: string; onRetry: () => void }) {
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(null, player => {
    player.staysActiveInBackground = false;
    player.showNowPlayingNotification = false;
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    let active = true;
    setFailed(false);
    // Async loading keeps large remote videos off the UI thread. Streaming
    // avoids downloading the full (potentially 5 GB) original into JS memory.
    void player.replaceAsync({ uri, useCaching: false }).then(() => {
      if (active && AppState.currentState === "active") player.play();
    }).catch(() => { if (active) setFailed(true); });
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") player.pause();
    });
    return () => {
      active = false;
      subscription.remove();
      // useVideoPlayer releases the player when this view closes/unmounts.
    };
  }, [player, uri]);

  const error = failed || status === "error";
  return <View style={styles.fill}>
    <VideoView
      player={player}
      style={styles.fill}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
      accessibilityLabel="Video player"
    />
    {!error && (status === "idle" || status === "loading") && (
      <View pointerEvents="none" style={styles.loading}>
        <ActivityIndicator color="white" />
        <Text style={styles.text}>Loading video…</Text>
      </View>
    )}
    {error && <View style={styles.error}>
      <Text accessibilityRole="alert" style={styles.text}>This video couldn’t play. Check your connection and try again.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
        <Text style={styles.text}>Try again</Text>
      </Pressable>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#111" },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 12 },
  error: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 20, padding: 24, backgroundColor: "#111" },
  text: { color: "white", fontSize: 16, textAlign: "center", lineHeight: 24 },
  button: { minHeight: 48, justifyContent: "center", paddingHorizontal: 20, backgroundColor: "#292929", borderRadius: 12 },
});
