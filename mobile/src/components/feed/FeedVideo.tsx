import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { request } from "@/api/client";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { API_BASE_URL } from "@/config/env";
import { parseVideoUrl, videoEmbedUrl } from "@/lib/media";
import { resolveMediaSource, type ResolvedMedia } from "@/lib/mediaPlayback";

/** Mounted only for the selected visible card; unmounting stops its player. */
export function FeedVideo({ url }: { url: string }) {
  const [attempt, setAttempt] = useState(0);
  const [media, setMedia] = useState<ResolvedMedia | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setMedia(null);
    setFailed(false);
    // Preserve the authorised variant, resolving fresh signatures on retry/re-entry.
    void resolveMediaSource({ kind: "url", url }, API_BASE_URL, request, controller.signal)
      .then(result => { if (!controller.signal.aborted) setMedia(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url, attempt]);

  const retry = () => setAttempt(value => value + 1);
  const video = media && parseVideoUrl(media.uri);
  const embed = video ? videoEmbedUrl(video, true) : null;
  if (failed || (media && media.kind !== "video" && !embed)) {
    return <View style={styles.message}>
      <Text accessibilityRole="alert" style={styles.text}>This video couldn’t load. It may be private or unavailable.</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
        <Text style={styles.text}>Try again</Text>
      </Pressable>
    </View>;
  }
  if (!media) return <View style={styles.message}>
    <ActivityIndicator color="white" />
    <Text style={styles.text}>Loading video…</Text>
  </View>;
  if (media.kind === "video") return <NativeVideoPlayer uri={media.uri} feedPreview onRetry={retry} />;

  // Provider-owned embeds receive only a public referrer, never Viewrr auth.
  // Inactive cards have no WebView, so hidden embeds cannot keep playing.
  return <WebView
    key={`${url}:${attempt}`}
    source={{ uri: embed!, headers: { Referer: `${API_BASE_URL}/` } }}
    style={styles.player}
    allowsInlineMediaPlayback
    allowsFullscreenVideo={false}
    mediaPlaybackRequiresUserAction={false}
    sharedCookiesEnabled={false}
    thirdPartyCookiesEnabled={false}
    incognito
    scrollEnabled={false}
    originWhitelist={["https://*"]}
    onOpenWindow={() => {}}
    onShouldStartLoadWithRequest={navigation => {
      if (navigation.url === "about:blank") return true;
      try {
        const target = new URL(navigation.url);
        const player = new URL(embed!);
        return target.origin === player.origin && target.pathname === player.pathname;
      } catch { return false; }
    }}
    startInLoadingState
    renderLoading={() => <View pointerEvents="none" style={styles.loading}><ActivityIndicator color="white" /></View>}
    onError={() => setFailed(true)}
    onHttpError={event => {
      // Android reports subresource errors too; ignore failed ad/tracker requests.
      if (event.nativeEvent.url.split("?")[0] === embed!.split("?")[0]) setFailed(true);
    }}
    onContentProcessDidTerminate={() => setFailed(true)}
    onRenderProcessGone={() => setFailed(true)}
  />;
}

const styles = StyleSheet.create({
  player: { flex: 1, backgroundColor: "#111" },
  message: { flex: 1, padding: 16, backgroundColor: "#111", alignItems: "center", justifyContent: "center", gap: 12 },
  text: { color: "white", fontSize: 14, textAlign: "center", lineHeight: 20 },
  button: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", backgroundColor: "#292929", borderRadius: 12 },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "#111" },
});
