import { useIsFocused } from "expo-router";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { request } from "@/api/client";
import { ApiError } from "@/api/errors";
import { NativeVideoPlayer } from "@/components/NativeVideoPlayer";
import { API_BASE_URL } from "@/config/env";
import { parseVideoUrl } from "@/lib/media";
import { resolveMediaSource, type MediaSource, type ResolvedMedia } from "@/lib/mediaPlayback";

// Keep provider videos inline so the native Back control remains reachable.
const inlinePlaybackScript = `
(function () {
  if (window.__viewrrInlinePlayback) return;
  window.__viewrrInlinePlayback = true;
  function keepInline() {
    document.querySelectorAll('video').forEach(function (video) {
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.setAttribute('controlsList', 'nofullscreen');
    });
  }
  keepInline();
  new MutationObserver(keepInline).observe(document, { childList: true, subtree: true });
})();
true;
`;

/** One dismissible viewer for feed, portfolio and authorised work media. */
export function MediaViewer({ source, title, onClose, backLabel = "Back" }: {
  source: MediaSource;
  title: string;
  onClose: () => void;
  backLabel?: string;
}) {
  const focused = useIsFocused();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (!focused) onClose(); }, [focused, onClose]);
  if (!focused) return null;

  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close media and ${backLabel.toLowerCase()}`}
              onPress={onClose} style={styles.button}>
              <Text style={styles.text}>‹ {backLabel}</Text>
            </Pressable>
            <Text numberOfLines={2} style={styles.title}>{title}</Text>
          </View>
          <MediaContent key={`${JSON.stringify(source)}:${attempt}`} source={source} onRetry={() => setAttempt(value => value + 1)} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

function MediaContent({ source, onRetry }: { source: MediaSource; onRetry: () => void }) {
  const [media, setMedia] = useState<ResolvedMedia | null>(null);
  const [error, setError] = useState("");
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    const controller = new AbortController();
    void resolveMediaSource(JSON.parse(sourceKey) as MediaSource, API_BASE_URL, request, controller.signal).then(result => {
      if (!controller.signal.aborted) setMedia(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError
        ? cause.serverMessage ?? cause.userMessage : "This file couldn’t load. Please try again.");
    });
    return () => controller.abort();
  }, [sourceKey]);

  if (error) return <View style={styles.message}>
    <Text accessibilityRole="alert" style={styles.text}>{error}</Text>
    <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}><Text style={styles.text}>Try again</Text></Pressable>
  </View>;
  if (!media) return <View style={styles.message}><ActivityIndicator color="white" /><Text style={styles.text}>Loading media…</Text></View>;
  if (media.kind === "video") return <NativeVideoPlayer uri={media.uri} onRetry={onRetry} />;
  if (media.kind === "image") return <Image source={{ uri: media.uri }} contentFit="contain" style={styles.player}
    accessibilityLabel="Uploaded image" onError={() => setError("This image couldn’t load. Please try again.")} />;

  const video = parseVideoUrl(media.uri);
  const vimeoHash = (() => { try { const url = new URL(media.uri); return url.searchParams.get("h") ?? url.pathname.match(/\/\d+\/([a-zA-Z0-9]+)/)?.[1]; } catch { return null; } })();
  const embed = video?.provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${video.id}?playsinline=1&fs=0&rel=0`
    : video?.provider === "vimeo" ? `https://player.vimeo.com/video/${video.id}?playsinline=1&fullscreen=0&dnt=1${vimeoHash ? `&h=${encodeURIComponent(vimeoHash)}` : ""}` : null;
  if (!embed) return <View style={styles.message}><Text style={styles.text}>This file type cannot be previewed here.</Text></View>;

  // External video providers stay embedded inside the app. Never send the
  // Viewrr bearer token or cookies to either an embed or a storage host.
  return <WebView source={{ uri: embed, headers: { Referer: "https://www.viewrr.co.uk/" } }} style={styles.player}
    allowsInlineMediaPlayback allowsFullscreenVideo={false} mediaPlaybackRequiresUserAction
    injectedJavaScriptBeforeContentLoaded={inlinePlaybackScript} injectedJavaScript={inlinePlaybackScript}
    startInLoadingState renderLoading={() => <View pointerEvents="none" style={styles.loading}><ActivityIndicator color="white" /></View>}
    sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} incognito originWhitelist={["*"]} onOpenWindow={() => {}}
    onShouldStartLoadWithRequest={navigation => /^https:\/\//i.test(navigation.url) || navigation.url === "about:blank"}
    onError={() => setError("This video could not load. It may be private or unavailable for embedded playback.")} />;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", paddingHorizontal: 16 },
  sheet: { height: "90%", width: "100%", maxWidth: 760, alignSelf: "center", backgroundColor: "#111", borderRadius: 20, overflow: "hidden" },
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#333" },
  button: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#292929" },
  text: { color: "white", fontSize: 16, lineHeight: 24 },
  title: { color: "white", fontSize: 17, marginTop: 12, marginBottom: 4 },
  player: { flex: 1, backgroundColor: "#111" },
  message: { flex: 1, padding: 24, justifyContent: "center", gap: 20 },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "#111" },
});
