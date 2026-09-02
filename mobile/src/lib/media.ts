/**
 * Vimeo / YouTube URL parsing.
 *
 * Ported by value from client/src/lib/videoEmbed.ts — the same regexes, the
 * same thumbnail hosts — because Viewrr has no video upload path anywhere in
 * the product: posts and portfolio items store a Vimeo or YouTube URL and the
 * web app renders an iframe. /mobile is an isolated package, so the logic is
 * transcribed rather than imported.
 *
 * Mobile difference: there is no iframe. A parsed video renders as its poster
 * frame with a play affordance and opens in the system browser / native app on
 * tap. Embedding would need react-native-webview, which is not a dependency and
 * is not worth adding for Stage 2.
 */

export type VideoProvider = "vimeo" | "youtube";

export type ParsedVideo = {
  provider: VideoProvider;
  id: string;
  /** Poster frame, served by the provider. */
  thumbnailUrl: string;
  /** The canonical watch page, opened externally. */
  watchUrl: string;
};

const VIMEO =
  /(?:vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/[^/]+\/video\/)?|player\.vimeo\.com\/video\/)(\d+)/;

const YOUTUBE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function parseVideoUrl(url: string | null | undefined): ParsedVideo | null {
  if (!url || !url.trim()) return null;
  const clean = url.trim();

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
  if (video) return { kind: "video", video };

  if (mediaType === "video") return null; // claimed video, unrecognised host
  return isHttpUrl(mediaUrl) ? { kind: "image", uri: mediaUrl.trim() } : null;
}
