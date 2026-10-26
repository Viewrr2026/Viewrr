/** Media references stay stable; short-lived storage URLs are resolved on open/retry. */
export type MediaSource =
  | { kind: "url"; url: string }
  | { kind: "retainer"; retainerId: string; mediaId: string; original: boolean; mimeType: string };

export type MediaKind = "video" | "image" | "web";
export type ResolvedMedia = { uri: string; kind: MediaKind };
type ResolveRequest = (path: string, options: {
  query: Record<string, string | number>;
  signal?: AbortSignal;
}) => Promise<{ url: string }>;

export function mediaKind(url: string, mimeType = ""): MediaKind {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  const path = url.split(/[?#]/, 1)[0] ?? "";
  if (/\.(mp4|mov|m4v|webm)$/i.test(path)) return "video";
  if (/\.(jpe?g|png|webp|gif|heic)$/i.test(path)) return "image";
  return "web";
}

function httpUrl(value: string, apiBaseUrl: string): URL {
  const url = new URL(value.trim(), apiBaseUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("This media address is not supported.");
  }
  return url;
}

/** Only Viewrr's own media endpoint can receive the app's authenticated request. */
export function mediaApiPath(value: string, apiBaseUrl: string): string | null {
  const url = httpUrl(value, apiBaseUrl);
  const base = new URL(apiBaseUrl);
  if (url.origin !== base.origin) return null;
  return /^\/api\/media\/\d+\/[a-f0-9-]+\/(original|preview)\.(jpg|mp4)$/.test(url.pathname)
    ? url.pathname : null;
}

/** Used by legacy retainer submissions; never turn a preview into an original. */
export function retainerMediaSource(reference: string, original: boolean, apiBaseUrl: string): MediaSource {
  const path = mediaApiPath(reference, apiBaseUrl);
  return { kind: "url", url: path && !original ? path.replace("/original.", "/preview.") : reference };
}

export async function resolveMediaSource(
  source: MediaSource,
  apiBaseUrl: string,
  request: ResolveRequest,
  signal?: AbortSignal,
): Promise<ResolvedMedia> {
  if (source.kind === "retainer") {
    const result = await request(
      `/api/custom-retainers/${encodeURIComponent(source.retainerId)}/media/${encodeURIComponent(source.mediaId)}`,
      { query: { original: String(source.original) }, signal },
    );
    // Preview encoding can differ from the original, but the media category cannot.
    return { uri: httpUrl(result.url, apiBaseUrl).href, kind: mediaKind(result.url, source.mimeType) };
  }

  const path = mediaApiPath(source.url, apiBaseUrl);
  if (path) {
    // Keep the selected variant. A denied original must never fall back to a
    // reconstructed URL or open the browser. The server decides access.
    const result = await request(path, { query: { resolve: 1 }, signal });
    return { uri: httpUrl(result.url, apiBaseUrl).href, kind: mediaKind(path) };
  }
  const uri = httpUrl(source.url, apiBaseUrl).href;
  return { uri, kind: mediaKind(uri) };
}
