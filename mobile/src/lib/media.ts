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

const VIMEO =
  /(?:vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/[^/]+\/video\/)?|player\.vimeo\.com\/video\/)(\d+)/;

const YOUTUBE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function parseVideoUrl(url: string | null | undefined): ParsedVideo | null {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();
  const clean = trimmed.startsWith(`${API_BASE_URL}/api/media/`) ? trimmed.slice(API_BASE_URL.length) : trimmed;

  if (/^\/api\/media\/\d+\/[a-f0-9-]+\/(original|preview)\.(jpg|mp4)$/.test(clean)) return {provider:"upload",id:clean,watchUrl:`${API_BASE_URL}${clean}`,thumbnailUrl:clean.endsWith(".jpg")?`${API_BASE_URL}${clean}`:""};
  if (/^https?:\/\//i.test(trimmed) && mediaKind(trimmed) === "video") {
    return { provider: "upload", id: trimmed, watchUrl: trimmed, thumbnailUrl: "" };
  }
  const vimeo = VIMEO.exec(clean);
  if (vimeo?.[1]) {
    return {
      provider: "vimeo",
      id: vimeo[1],
      thumbnailUrl: `https://vumbnail.com/${vimeo[1]}.jpg`,
      watchUrl: `https://vimeo.com/${vimeo[1]}`,
    };
  }

  const youtube = YOUTUBE.exec(clean);
  if (youtube?.[1]) {
    return {
      provider: "youtube",
      id: youtube[1],
      thumbnailUrl: `https://img.youtube.com/vi/${youtube[1]}/hqdefault.jpg`,
      watchUrl: `https://www.youtube.com/watch?v=${youtube[1]}`,
    };
  }

  return null;
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
