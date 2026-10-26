const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;

// Exercise the production components with native services replaced at their
// boundaries. Actual decoding/AVKit presentation remains a device smoke test.
function loadSource(path, mocks = {}) {
  const filename = resolve(__dirname, "..", path);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(dirname(filename));
  loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : Module.prototype.require.call(loaded, id);
  loaded._compile(code, filename);
  return loaded.exports;
}

const base = "https://www.viewrr.co.uk";
const preview = "/api/media/42/12345678-abcd/preview.mp4";
const original = preview.replace("preview", "original");
const storageUrl = "https://media.example.r2.cloudflarestorage.com/private/key.preview?signature=temporary";
const playback = loadSource("src/lib/mediaPlayback.ts");
const media = loadSource("src/lib/media.ts", { "@/config/env": { API_BASE_URL: base }, "@/lib/mediaPlayback": playback });

test("relative and absolute uploads resolve to streaming URLs without changing the selected variant", async () => {
  for (const path of [preview, original]) {
    for (const url of [path, base + path]) {
      const calls = [];
      const result = await playback.resolveMediaSource({ kind: "url", url }, base, async (...args) => {
        calls.push(args); return { url: storageUrl };
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], path);
      assert.deepEqual(calls[0][1].query, { resolve: 1 });
      assert.deepEqual(result, { uri: storageUrl, kind: "video" });
      assert.equal("headers" in result, false);
    }
  }
});

test("access denials propagate without trying another variant or browser fallback", async () => {
  let calls = 0;
  const denied = new Error("Verified payment is required");
  await assert.rejects(playback.resolveMediaSource({ kind: "url", url: original }, base, async () => {
    calls++; throw denied;
  }), error => error === denied);
  assert.equal(calls, 1);
});

test("custom retainer previews and originals retain the server access decision and media type", async () => {
  for (const original of [false, true]) {
    const source = { kind: "retainer", retainerId: "agreement", mediaId: "asset", original, mimeType: "video/quicktime" };
    const signal = new AbortController().signal;
    const result = await playback.resolveMediaSource(source, base, async (path, options) => {
      assert.equal(path, "/api/custom-retainers/agreement/media/asset");
      assert.deepEqual(options.query, { original: String(original) });
      assert.equal(options.signal, signal);
      return { url: storageUrl };
    }, signal);
    assert.deepEqual(result, { uri: storageUrl, kind: "video" });
  }
});

test("legacy retainer preview selection accepts absolute URLs and never upgrades a preview", () => {
  assert.equal(playback.retainerMediaSource(base + original, false, base).url, preview);
  assert.equal(playback.retainerMediaSource(original, true, base).url, original);
  assert.equal(playback.retainerMediaSource(preview, true, base).url, preview);
});

test("external hosts never receive an authenticated media-resolution request", async () => {
  const request = async () => assert.fail("An external host must not use the Viewrr API client");
  for (const url of [`https://www.viewrr.co.uk.example.com${preview}`, `https://elsewhere.test${preview}`, "https://cdn.test/movie.MOV?sig=value"]) {
    const result = await playback.resolveMediaSource({ kind: "url", url }, base, request);
    assert.deepEqual(result, { uri: url, kind: "video" });
  }
  await assert.rejects(playback.resolveMediaSource({ kind: "url", url: "javascript:alert(1)" }, base, request));
  await assert.rejects(playback.resolveMediaSource({ kind: "url", url: "file:///private/video.mp4" }, base, request));
});

test("signed video URLs, processed uploads, still images and embedded links are classified correctly", () => {
  for (const url of [preview, base + preview, "https://cdn.test/movie.mp4?signature=temporary"]) {
    assert.equal(media.postMedia(url, "video").kind, "video");
  }
  assert.equal(media.postMedia(preview.replace("mp4", "jpg"), "image").kind, "image");
  assert.equal(media.parseVideoUrl("https://www.youtube.com/watch?v=abcdefghijk").provider, "youtube");
  assert.equal(playback.mediaKind(storageUrl, "image/png"), "image");
});

const rn = {
  View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: value => value, absoluteFillObject: {}, absoluteFill: {}, hairlineWidth: 1 },
  Alert: { alert: () => {} }, Linking: { openURL: () => assert.fail("Uploaded videos must not open a browser") },
};
const theme = { useTheme: () => ({ colors: {} }), radii: {}, spacing: {}, typography: {} };
const mocks = { "react-native": rn, "expo-image": { Image: "Image" }, "@/lib/media": media, "@/lib/mediaPlayback": playback,
  "@/components/MediaViewer": { MediaViewer: "MediaViewer" }, "@/theme": theme,
  "lucide-react-native": { Play: "Play", Eye: "Eye", ExternalLink: "ExternalLink", Lock: "Lock" } };

test("tapping an uploaded feed video opens the in-app viewer and Close returns to the card", async () => {
  const { PostMediaView } = loadSource("src/components/feed/PostMedia.tsx", mocks);
  let tree;
  await act(async () => { tree = create(React.createElement(PostMediaView, { mediaUrl: preview, mediaType: "video" })); });
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  const viewer = tree.root.findByType("MediaViewer");
  assert.deepEqual(viewer.props.source, { kind: "url", url: preview });
  await act(async () => viewer.props.onClose());
  assert.equal(tree.root.findAllByType("MediaViewer").length, 0);
  await act(async () => tree.unmount());
});

test("locked deliveries open only their preview, and missing previews stay unopenable", async () => {
  const { DeliverableRow } = loadSource("src/components/work/DeliverableRow.tsx", mocks);
  let tree;
  const deliverable = { id: 1, label: "Film", platform: "Video", locked: true, previewUrl: preview, url: original };
  await act(async () => { tree = create(React.createElement(DeliverableRow, { deliverable, lockCopy: "Awaiting payment" })); });
  await act(async () => tree.root.findByType("Pressable").props.onPress());
  assert.equal(tree.root.findByType("MediaViewer").props.source.url, preview);
  await act(async () => tree.update(React.createElement(DeliverableRow, { deliverable: { ...deliverable, previewUrl: undefined }, lockCopy: "Awaiting payment" })));
  assert.equal(tree.root.findAllByType("Pressable").length, 0);
  assert.equal(tree.root.findAllByType("MediaViewer").length, 0);
  await act(async () => tree.unmount());
});

test("viewer retries obtain a fresh signed URL and closing cancels pending access", async () => {
  let calls = 0, signal;
  const { MediaViewer } = loadSource("src/components/MediaViewer.tsx", {
    ...mocks, "expo-router": { useIsFocused: () => true },
    "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" },
    "react-native-webview": { WebView: "WebView" },
    "@/components/NativeVideoPlayer": { NativeVideoPlayer: "NativeVideoPlayer" },
    "@/config/env": { API_BASE_URL: base }, "@/api/errors": { ApiError: class extends Error {} },
    "@/api/client": { request: async (_, options) => { calls++; signal = options.signal; return { url: `${storageUrl}-${calls}` }; } },
  });
  let tree;
  const props = { source: { kind: "url", url: preview }, title: "Video", onClose: () => {} };
  await act(async () => { tree = create(React.createElement(MediaViewer, props)); });
  assert.equal(tree.root.findByType("NativeVideoPlayer").props.uri, `${storageUrl}-1`);
  await act(async () => tree.update(React.createElement(MediaViewer, { ...props, source: { ...props.source } })));
  assert.equal(calls, 1, "A parent refresh must not restart playback");
  await act(async () => tree.root.findByType("NativeVideoPlayer").props.onRetry());
  assert.equal(calls, 2);
  assert.equal(tree.root.findByType("NativeVideoPlayer").props.uri, `${storageUrl}-2`);
  await act(async () => tree.unmount());
  assert.equal(signal.aborted, true);
});

test("native playback streams without session headers, pauses in background and releases on close", async () => {
  const listeners = new Set();
  const appState = { currentState: "active", addEventListener: (_, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } };
  const player = { status: "readyToPlay", plays: 0, pauses: 0, released: false,
    replaceAsync: async source => { player.source = source; }, play: () => player.plays++, pause: () => player.pauses++ };
  const { NativeVideoPlayer } = loadSource("src/components/NativeVideoPlayer.tsx", {
    "react-native": { ...rn, AppState: appState }, "expo": { useEvent: (_, __, initial) => initial },
    "expo-video": { VideoView: "VideoView", useVideoPlayer: (_, setup) => {
      const [value] = React.useState(() => { setup(player); return player; });
      React.useEffect(() => () => { player.released = true; }, []);
      return value;
    } },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(NativeVideoPlayer, { uri: storageUrl, onRetry: () => {} })); });
  assert.deepEqual(player.source, { uri: storageUrl, useCaching: false });
  assert.equal(player.plays, 1);
  assert.equal(player.staysActiveInBackground, false);
  assert.equal(tree.root.findByType("VideoView").props.contentFit, "contain");
  await act(async () => { appState.currentState = "background"; listeners.forEach(fn => fn("background")); });
  assert.equal(player.pauses, 1);
  await act(async () => { appState.currentState = "active"; listeners.forEach(fn => fn("active")); });
  assert.equal(player.plays, 1, "Returning to the app must not override the pause");
  await act(async () => tree.unmount());
  assert.equal(player.released, true);
  assert.equal(listeners.size, 0);
});

test("closing during video loading prevents a late load from starting playback", async () => {
  let finishLoading;
  const player = { status: "loading", plays: 0,
    replaceAsync: () => new Promise(resolve => { finishLoading = resolve; }),
    play: () => player.plays++, pause: () => {} };
  const { NativeVideoPlayer } = loadSource("src/components/NativeVideoPlayer.tsx", {
    "react-native": { ...rn, AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } },
    "expo": { useEvent: (_, __, initial) => initial },
    "expo-video": { VideoView: "VideoView", useVideoPlayer: () => player },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(NativeVideoPlayer, { uri: storageUrl, onRetry: () => {} })); });
  await act(async () => tree.unmount());
  await act(async () => finishLoading());
  assert.equal(player.plays, 0);
});
