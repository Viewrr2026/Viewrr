import { API_BASE_URL } from "@/config/env";
import { mediaKind } from "@/lib/mediaPlayback";
/** Shared rendering rules for public R2 media and external video links. */

export type VideoProvider = "vimeo" | "youtube" | "upload";

export type ParsedVideo = {
  provider: VideoProvider;
  id: string;
  /** Poster frame, served by the provider. */
  thumbnailUrl: string;
  /** Canonical media/watch URL; playback stays inside Viewrr. */
  watchUrl: string;
};

export function parseVideoUrl(url: string | null | undefined): ParsedVideo | null {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();
  const clean = trimmed.startsWith(`${API_BASE_URL}/api/media/`) ? trimmed.slice(API_BASE_URL.length) : trimmed;

  if (/^\/api\/media\/\d+\/[a-f0-9-]+\/(original|preview)\.(jpg|mp4)$/.test(clean)) return {provider:"upload",id:clean,watchUrl:`${API_BASE_URL}${clean}`,thumbnailUrl:clean.endsWith(".jpg")?`${API_BASE_URL}${clean}`:""};
  if (/^https?:\/\//i.test(trimmed) && mediaKind(trimmed) === "video") {
    return { provider: "upload", id: trimmed, watchUrl: trimmed, thumbnailUrl: "" };
  }
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
    const match = parsed.pathname.match(/^\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/\d+\/video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?\/?$/);
    if (!match?.[1]) return null;
    return {
      provider: "vimeo",
      id: match[1],
      thumbnailUrl: `https://vumbnail.com/${match[1]}.jpg`,
      watchUrl: parsed.href,
    };
  }

  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be", "www.youtu.be"].includes(host)) {
    const id = host.endsWith("youtu.be") ? parsed.pathname.split("/")[1]
      : parsed.pathname === "/watch" ? parsed.searchParams.get("v")
      : parsed.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})\/?$/)?.[1];
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    return {
      provider: "youtube",
      id,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  return null;
}

/** Provider-owned players; only feed previews autoplay, muted and on a loop. */
export function videoEmbedUrl(video: ParsedVideo, autoplay = false): string | null {
  if (video.provider === "upload") return null;
  const url = new URL(video.provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${video.id}`
    : `https://player.vimeo.com/video/${video.id}`);
  url.searchParams.set("playsinline", "1");
  if (video.provider === "youtube") {
    url.searchParams.set("fs", "0");
    url.searchParams.set("rel", "0");
    if (autoplay) {
      url.searchParams.set("mute", "1");
      // A one-video playlist is required for YouTube single-video looping.
      url.searchParams.set("playlist", video.id);
    }
  } else {
    const original = new URL(video.watchUrl);
    const hash = original.searchParams.get("h") ?? original.pathname.match(/\/\d+\/([a-zA-Z0-9]+)/)?.[1];
    if (hash) url.searchParams.set("h", hash);
    url.searchParams.set("fullscreen", "0");
    url.searchParams.set("dnt", "1");
    if (autoplay) url.searchParams.set("muted", "1");
  }
  if (autoplay) {
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("loop", "1");
  }
  return url.href;
}

/** True for a URL this app can render as an image. */
export function isHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/^\/api\/media\/\d+\/[a-f0-9-]+\/(original|preview)\.(jpg|mp4)$/.test(url.trim())) return true;
  return /^https?:\/\//i.test(url.trim());
}

export type PostMedia =
  | { kind: "image"; uri: string }
  | { kind: "video"; video: ParsedVideo }
  | null;

/**
 * Decide how a post's single media slot should render.
 *
 * `mediaType` is free text with no server-side validation, so the URL is the
 * authority: a recognised video URL is a video whatever the column says, and
 * anything else only renders if it is a plausible http(s) image.
 */
export function postMedia(
  mediaUrl: string | null | undefined,
  mediaType: string | null | undefined,
): PostMedia {
  if (!mediaUrl) return null;

  const video = parseVideoUrl(mediaUrl);
  if (video && !mediaUrl.trim().endsWith(".jpg")) return { kind: "video", video };

  if (mediaType === "video") return null; // claimed video, unrecognised host
  return isHttpUrl(mediaUrl) ? { kind: "image", uri: mediaUrl.startsWith("/api/media/") ? `${API_BASE_URL}${mediaUrl}` : mediaUrl.trim() } : null;
}
