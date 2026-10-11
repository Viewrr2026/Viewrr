import { useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { parseVideoUrl } from "@/lib/media";
/** Public media only. Never pass Viewrr authentication to a media host. */
export function PortfolioPlayer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const video = parseVideoUrl(url);
  const vimeoHash = (() => { try { const u = new URL(url); return u.searchParams.get('h') ?? u.pathname.match(/\/\d+\/([a-zA-Z0-9]+)/)?.[1]; } catch { return null; } })();
  const source = video?.provider === 'youtube' ? `https://www.youtube-nocookie.com/embed/${video.id}?playsinline=1&rel=0`
    : video?.provider === 'vimeo' ? `https://player.vimeo.com/video/${video.id}${vimeoHash ? `?h=${encodeURIComponent(vimeoHash)}` : ''}` : url;
  return <Modal animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: '#111' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 }}>
        <Text numberOfLines={2} style={{ color: 'white', flex: 1, fontSize: 17 }}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close video" onPress={onClose} style={{ padding: 12 }}><Text style={{ color: 'white', fontWeight: '600' }}>Done</Text></Pressable>
      </View>
      {failed ? <Text accessibilityRole="alert" style={{ color: 'white', padding: 24 }}>This video could not load. It may be private or unavailable for embedded playback. Close and try again.</Text> :
        <WebView source={{ uri: source, headers: { Referer: 'https://www.viewrr.co.uk/' } }} style={{ flex: 1, backgroundColor: '#111' }}
          allowsInlineMediaPlayback allowsFullscreenVideo mediaPlaybackRequiresUserAction startInLoadingState renderLoading={() => <ActivityIndicator color="white" />}
          sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} incognito originWhitelist={['*']} onOpenWindow={() => {}}
          onShouldStartLoadWithRequest={request => /^https:\/\//i.test(request.url) || request.url === 'about:blank'}
          onError={() => setFailed(true)} />}
    </SafeAreaView>
  </Modal>;
}
