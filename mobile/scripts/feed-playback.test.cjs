const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;

// Exercise production screens/hooks; replace only native services and HTTP.
function loadSource(path, mocks = {}) {
  const filename = resolve(__dirname, "..", path);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(dirname(filename));
  mod.require = id => Object.hasOwn(mocks, id) ? mocks[id] : Module.prototype.require.call(mod, id);
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return mod.exports;
}
const base = "https://www.viewrr.co.uk";
const preview = "/api/media/42/12345678-abcd/preview.mp4";
const signedUrl = "https://storage.test/file.preview?signature=short-lived";
const playback = loadSource("src/lib/mediaPlayback.ts");
const media = loadSource("src/lib/media.ts", { "@/config/env": { API_BASE_URL: base }, "@/lib/mediaPlayback": playback });
const rn = { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: value => value, absoluteFill: {} } };
const videoMocks = {
  "react-native": rn, "react-native-webview": { WebView: "WebView" },
  "@/config/env": { API_BASE_URL: base }, "@/lib/media": media, "@/lib/mediaPlayback": playback,
  "@/components/NativeVideoPlayer": { NativeVideoPlayer: "NativeVideoPlayer" },
};
const token = (id, url = preview) => ({ isViewable: true, index: id, item: { post: { id, mediaUrl: url, mediaType: "video" } } });

test("provider URLs autoplay muted, loop, stay inline, and preserve unlisted Vimeo hashes", () => {
  const id = "abcdefghijk";
  for (const input of [`https://youtu.be/${id}`, `https://m.youtube.com/watch?v=${id}`, `https://www.youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) {
    const parsed = media.parseVideoUrl(input);
    const embed = new URL(media.videoEmbedUrl(parsed, true));
    assert.equal(embed.hostname, "www.youtube-nocookie.com");
    for (const key of ["autoplay", "loop", "playsinline", "mute"]) assert.equal(embed.searchParams.get(key), "1");
    assert.equal(embed.searchParams.get("playlist"), id);
    assert.equal(new URL(media.videoEmbedUrl(parsed)).searchParams.has("autoplay"), false);
  }
  for (const input of ["https://vimeo.com/123456789/privatehash", "https://player.vimeo.com/video/123456789?h=privatehash"]) {
    const embed = new URL(media.videoEmbedUrl(media.parseVideoUrl(input), true));
    assert.equal(embed.searchParams.get("h"), "privatehash");
    for (const key of ["autoplay", "loop", "muted", "playsinline"]) assert.equal(embed.searchParams.get(key), "1");
  }
  for (const input of ["https://evil.test/youtube.com/watch?v=abcdefghijk", "https://vimeo.com.evil.test/123456789", "javascript:youtube.com/watch?v=abcdefghijk", "https://user:password@youtube.com/watch?v=abcdefghijk"]) assert.equal(media.parseVideoUrl(input), null);
});

test("coordination measures videos below long captions and stops on blur, background, overlays and reduced motion", async () => {
  let focused = true, enabled = true, value;
  const listeners = new Map();
  const appState = { currentState: "active", addEventListener: (name, fn) => { listeners.set(name, fn); return { remove: () => listeners.delete(name) }; } };
  const { useFeedPlayback } = loadSource("src/components/feed/useFeedPlayback.ts", {
    "expo-router": { useIsFocused: () => focused }, "@/lib/media": media,
    "react-native": { AppState: appState, AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: appState.addEventListener } },
  });
  function Probe() { value = useFeedPlayback(enabled); return null; }
  let tree;
  await act(async () => { tree = create(React.createElement(Probe)); });
  const positions = new Map([[1, 900], [2, 200]]);
  value.viewportRef.current = { measureInWindow: fn => fn(0, 100, 350, 600) };
  await act(async () => {
    for (const id of [1, 2]) value.registerVideo(id, { measureInWindow: fn => fn(0, positions.get(id), 350, 200) });
    value.onViewableItemsChanged({ viewableItems: [token(1), token(2)] });
  });
  assert.equal(value.activePostId, 2, "A visible caption must not start its offscreen video");
  const callback = value.onViewableItemsChanged;
  await act(async () => { positions.set(1, 150); positions.set(2, 250); value.measureVideos(); });
  assert.equal(value.activePostId, 2, "Equal visibility retains the current player");
  await act(async () => { positions.set(2, 620); value.measureVideos(); });
  assert.equal(value.activePostId, 1);
  await act(async () => { positions.set(1, -50); value.measureVideos(); });
  assert.equal(value.activePostId, null);
  await act(async () => { positions.set(1, 150); value.measureVideos(); });
  await act(async () => { focused = false; tree.update(React.createElement(Probe)); });
  assert.equal(value.activePostId, null);
  await act(async () => { focused = true; tree.update(React.createElement(Probe)); });
  assert.equal(value.activePostId, 1);
  await act(async () => listeners.get("change")("background"));
  assert.equal(value.activePostId, null);
  await act(async () => listeners.get("change")("active"));
  assert.equal(value.activePostId, 1);
  await act(async () => { enabled = false; tree.update(React.createElement(Probe)); });
  assert.equal(value.activePostId, null);
  await act(async () => { enabled = true; tree.update(React.createElement(Probe)); listeners.get("reduceMotionChanged")(true); });
  assert.equal(value.activePostId, null);
  await act(async () => listeners.get("reduceMotionChanged")(false));
  assert.equal(value.activePostId, 1);
  assert.equal(value.onViewableItemsChanged, callback);
  await act(async () => value.onViewableItemsChanged({ viewableItems: [token(3, "https://cdn.test/still.jpg")] }));
  assert.equal(value.activePostId, null);
  await act(async () => tree.unmount());
  assert.equal(listeners.size, 0);
});

test("late layout measurements cannot restart a video after scrolling or unmounting", async () => {
  let value, oldMeasurement;
  const { useFeedPlayback } = loadSource("src/components/feed/useFeedPlayback.ts", {
    "expo-router": { useIsFocused: () => true }, "@/lib/media": media,
    "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
      AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) } },
  });
  function Probe() { value = useFeedPlayback(true); return null; }
  let tree;
  await act(async () => { tree = create(React.createElement(Probe)); });
  value.viewportRef.current = { measureInWindow: fn => fn(0, 0, 350, 600) };
  await act(async () => {
    value.registerVideo(1, { measureInWindow: fn => { oldMeasurement = fn; } });
    value.onViewableItemsChanged({ viewableItems: [token(1)] });
  });
  await act(async () => value.onViewableItemsChanged({ viewableItems: [] }));
  await act(async () => oldMeasurement(0, 10, 350, 200));
  assert.equal(value.activePostId, null);
  await act(async () => tree.unmount());
  oldMeasurement(0, 10, 350, 200);
});

test("feed uploads resolve only the authorised variant and retry with fresh signatures", async () => {
  let attempts = 0;
  const signals = [];
  const { FeedVideo } = loadSource("src/components/feed/FeedVideo.tsx", {
    ...videoMocks, "@/api/client": { request: async (path, options) => {
      assert.equal(path, preview); assert.deepEqual(options.query, { resolve: 1 });
      signals.push(options.signal); return { url: `${signedUrl}-${++attempts}` };
    } },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(FeedVideo, { url: preview })); });
  assert.equal(tree.root.findByType("NativeVideoPlayer").props.uri, `${signedUrl}-1`);
  assert.equal(tree.root.findByType("NativeVideoPlayer").props.feedPreview, true);
  await act(async () => tree.root.findByType("NativeVideoPlayer").props.onRetry());
  assert.equal(tree.root.findByType("NativeVideoPlayer").props.uri, `${signedUrl}-2`);
  assert.equal(signals[0].aborted, true);
  await act(async () => tree.unmount());
  assert.equal(signals[1].aborted, true);
});

test("denied media never falls back to originals and offscreen loading is cancelled", async () => {
  const paths = [];
  let fail = true, finish, signal;
  const { FeedVideo } = loadSource("src/components/feed/FeedVideo.tsx", {
    ...videoMocks, "@/api/client": { request: async (path, options) => {
      paths.push(path); signal = options.signal;
      if (fail) throw new Error("Not authorised");
      return new Promise(resolve => { finish = resolve; });
    } },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(FeedVideo, { url: preview })); });
  assert.equal(tree.root.findAllByType("NativeVideoPlayer").length, 0);
  assert.equal(tree.root.findAllByType("WebView").length, 0);
  assert.equal(tree.root.findAllByProps({ accessibilityRole: "alert" }).length, 1);
  fail = false;
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  await act(async () => tree.unmount());
  assert.equal(signal.aborted, true);
  await act(async () => finish({ url: signedUrl }));
  assert.deepEqual(paths, [preview, preview]);
});

test("provider embeds autoplay inline without app credentials and recover from errors", async () => {
  const { FeedVideo } = loadSource("src/components/feed/FeedVideo.tsx", {
    ...videoMocks, "@/api/client": { request: () => assert.fail("Provider embeds must not call the authenticated API") },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(FeedVideo, { url: "https://vimeo.com/123456789/privatehash" })); });
  let web = tree.root.findByType("WebView");
  assert.equal(new URL(web.props.source.uri).searchParams.get("h"), "privatehash");
  assert.deepEqual(web.props.source.headers, { Referer: base + "/" });
  assert.equal(web.props.mediaPlaybackRequiresUserAction, false);
  assert.equal(web.props.allowsInlineMediaPlayback, true);
  assert.equal(web.props.sharedCookiesEnabled, false);
  assert.equal(web.props.thirdPartyCookiesEnabled, false);
  assert.equal(web.props.onShouldStartLoadWithRequest({ url: web.props.source.uri }), true);
  assert.equal(web.props.onShouldStartLoadWithRequest({ url: base + "/api/account" }), false);
  await act(async () => web.props.onHttpError({ nativeEvent: { url: "https://tracker.test/pixel" } }));
  assert.equal(tree.root.findAllByType("WebView").length, 1);
  await act(async () => web.props.onError());
  assert.equal(tree.root.findAllByType("WebView").length, 0);
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  web = tree.root.findByType("WebView");
  assert.equal(new URL(web.props.source.uri).searchParams.get("autoplay"), "1");
  await act(async () => tree.unmount());
});

test("native feed playback loops silently, supports unmuting, and releases on exit", async () => {
  const listeners = new Set();
  const player = { status: "readyToPlay", plays: 0, pauses: 0, released: false,
    replaceAsync: async source => { player.source = source; }, play: () => player.plays++, pause: () => player.pauses++ };
  const { NativeVideoPlayer } = loadSource("src/components/NativeVideoPlayer.tsx", {
    "react-native": { ...rn, AppState: { currentState: "active", addEventListener: (_, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } } },
    "expo": { useEvent: (_, __, initial) => initial },
    "expo-video": { VideoView: "VideoView", useVideoPlayer: (_, setup) => {
      const [value] = React.useState(() => { setup(player); return player; });
      React.useEffect(() => () => { player.released = true; }, []); return value;
    } },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(NativeVideoPlayer, { uri: signedUrl, feedPreview: true, onRetry() {} })); });
  assert.equal(player.loop, true); assert.equal(player.muted, true); assert.equal(player.plays, 1);
  assert.deepEqual(player.source, { uri: signedUrl, useCaching: false });
  assert.equal(tree.root.findByType("VideoView").props.contentFit, "contain");
  await act(async () => tree.root.findByProps({ accessibilityLabel: "Unmute video" }).props.onPress());
  assert.equal(player.muted, false);
  await act(async () => listeners.forEach(fn => fn("background")));
  assert.equal(player.pauses, 1);
  await act(async () => tree.unmount());
  assert.equal(player.released, true); assert.equal(listeners.size, 0);
});

test("the feed hands playback between posts and suspends all cards for the viewer and composer", async () => {
  let coordination;
  const native = { ...rn, RefreshControl: "RefreshControl",
    AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    FlatList: props => React.createElement("FlatList", props, props.ListHeaderComponent,
      ...props.data.map(item => React.createElement(React.Fragment, { key: item.post.id }, props.renderItem({ item })))),
  };
  const router = { useIsFocused: () => true, useRouter: () => ({ push() {} }) };
  const { useFeedPlayback } = loadSource("src/components/feed/useFeedPlayback.ts", {
    "react-native": native, "expo-router": router, "@/lib/media": media,
  });
  const rows = [token(1).item, token(2, "https://youtu.be/abcdefghijk").item];
  const mocks = {
    "react-native": native, "expo-router": router,
    "lucide-react-native": { PenLine: "PenLine", Rss: "Rss" },
    "@/navigation/linkResolver": { profileForUser: id => String(id) },
    "@/api/errors": { ApiError: class extends Error {} },
    "@/api/feed": { FEED_PAGE: 10, loadFeedPage: async () => rows, mergePages: (a, b) => [...a, ...b] },
    "@/session/SessionProvider": { useSession: () => ({ user: { id: 8, role: "client" } }) },
    "@/theme": { useTheme: () => ({ colors: {} }), gutter: 20, radii: {}, spacing: {}, typography: {} },
    "@/components/feed/useFeedPlayback": { useFeedPlayback: enabled => { coordination = useFeedPlayback(enabled); return coordination; } },
    "@/components/Skeleton": { SkeletonCard: "SkeletonCard" },
  };
  for (const name of ["AppHeader", "Avatar", "EmptyState", "ErrorState", "Screen", "MediaViewer"])
    mocks[`@/components/${name}`] = { [name]: name };
  for (const name of ["Composer", "OpportunitiesCard", "PostCard"])
    mocks[`@/components/feed/${name}`] = { [name]: name };
  const Feed = loadSource("src/app/(app)/index.tsx", mocks).default;
  let tree;
  await act(async () => { tree = create(React.createElement(Feed)); });
  coordination.viewportRef.current = { measureInWindow: fn => fn(0, 0, 350, 600) };
  const y = new Map([[1, 100], [2, 700]]);
  await act(async () => {
    for (const id of [1, 2]) coordination.registerVideo(id, { measureInWindow: fn => fn(0, y.get(id), 350, 200) });
    tree.root.findByType("FlatList").props.onViewableItemsChanged({ viewableItems: rows.map((item, index) => ({ item, index, isViewable: true })) });
  });
  const active = () => tree.root.findAllByType("PostCard").filter(card => card.props.mediaActive).map(card => card.props.item.post.id);
  assert.deepEqual(active(), [1]);
  await act(async () => { y.set(1, -250); y.set(2, 100); tree.root.findByType("FlatList").props.onScroll(); });
  assert.deepEqual(active(), [2]);
  await act(async () => tree.root.findAllByType("PostCard")[1].props.onOpenVideo(rows[1].post.mediaUrl));
  assert.deepEqual(active(), []);
  assert.equal(tree.root.findByType("MediaViewer").props.source.url, rows[1].post.mediaUrl);
  await act(async () => tree.root.findByType("MediaViewer").props.onClose());
  assert.deepEqual(active(), [2]);
  await act(async () => tree.root.findByProps({ accessibilityLabel: "Share an update" }).props.onPress());
  assert.equal(tree.root.findByType("Composer").props.visible, true);
  assert.deepEqual(active(), []);
  await act(async () => tree.root.findByType("Composer").props.onClose());
  assert.deepEqual(active(), [2]);
  await act(async () => tree.unmount());
});
