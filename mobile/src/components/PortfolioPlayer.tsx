import { API_BASE_URL } from "@/config/env";
import { useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { parseVideoUrl } from "@/lib/media";

// Hosts may insert their video after the page loads. Keep those videos inline too,
// so playback doesn't cover the native Back to profile control on iPhone.
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

/** Public media only. Never pass Viewrr authentication to a media host. */
export function PortfolioPlayer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const video = parseVideoUrl(url);
  const vimeoHash = (() => { try { const u = new URL(url); return u.searchParams.get('h') ?? u.pathname.match(/\/\d+\/([a-zA-Z0-9]+)/)?.[1]; } catch { return null; } })();
  const source = video?.provider === 'youtube' ? `https://www.youtube-nocookie.com/embed/${video.id}?playsinline=1&fs=0&rel=0`
    : video?.provider === 'vimeo' ? `https://player.vimeo.com/video/${video.id}?playsinline=1&fullscreen=0${vimeoHash ? `&h=${encodeURIComponent(vimeoHash)}` : ''}` : url.startsWith('/api/media/') ? `${API_BASE_URL}${url}` : url;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close video and return to profile" onPress={onClose}
                hitSlop={8} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                <Text style={styles.closeText}>‹ Back to profile</Text>
              </Pressable>
              <Text numberOfLines={2} style={styles.title}>{title}</Text>
            </View>
            <View style={styles.player}>
              {failed ? <View style={styles.error}>
                <Text accessibilityRole="alert" style={styles.errorText}>This video could not load. It may be private or unavailable for embedded playback.</Text>
                <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}><Text style={styles.closeText}>Back to profile</Text></Pressable>
              </View> :
                <WebView source={{ uri: source, headers: { Referer: 'https://www.viewrr.co.uk/' } }} style={styles.player}
                  allowsInlineMediaPlayback allowsFullscreenVideo={false} mediaPlaybackRequiresUserAction
                  injectedJavaScriptBeforeContentLoaded={inlinePlaybackScript} injectedJavaScript={inlinePlaybackScript}
                  startInLoadingState renderLoading={() => <View pointerEvents="none" style={styles.loading}><ActivityIndicator color="white" /></View>}
                  sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} incognito originWhitelist={['*']} onOpenWindow={() => {}}
                  onShouldStartLoadWithRequest={request => /^https:\/\//i.test(request.url) || request.url === 'about:blank'}
                  onError={() => setFailed(true)} />}
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', paddingHorizontal: 16 },
  sheet: { height: '85%', width: '100%', maxWidth: 760, alignSelf: 'center', backgroundColor: '#111', borderRadius: 20, overflow: 'hidden' },
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333' },
  close: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#292929' },
  pressed: { opacity: 0.65 },
  closeText: { color: 'white', fontSize: 16, fontWeight: '600' },
  title: { color: 'white', fontSize: 17, marginTop: 12, marginBottom: 4 },
  player: { flex: 1, backgroundColor: '#111' },
  loading: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  error: { flex: 1, padding: 24, justifyContent: 'center', gap: 20 },
  errorText: { color: 'white', fontSize: 16, lineHeight: 24 },
});
