/**
 * videoEmbed.ts
 * Shared utility for parsing Vimeo and YouTube URLs and generating embed iframes.
 * No file uploads — videos are always hosted on Vimeo/YouTube and embedded here.
 */

export type VideoProvider = "vimeo" | "youtube" | null;

export interface ParsedVideo {
  provider: VideoProvider;
  id: string;
  embedUrl: string;
  thumbnailUrl: string;
}

/**
 * Parse a Vimeo or YouTube URL and return embed details.
 * Returns null if the URL is not recognised as either platform.
 */
export function parseVideoUrl(url: string): ParsedVideo | null {
  if (!url || !url.trim()) return null;
  const clean = url.trim();

  // ── Vimeo ────────────────────────────────────────────────────────────────────
  // Formats: https://vimeo.com/123456789
  //          https://vimeo.com/channels/channelname/123456789
  //          https://player.vimeo.com/video/123456789
  const vimeoMatch = clean.match(
    /(?:vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/[^/]+\/video\/)?|player\.vimeo\.com\/video\/)(\d+)/
  );
  if (vimeoMatch) {
    const id = vimeoMatch[1];
    return {
      provider: "vimeo",
      id,
      embedUrl: `https://player.vimeo.com/video/${id}?autoplay=0&title=0&byline=0&portrait=0&color=FF5A1F`,
      thumbnailUrl: `https://vumbnail.com/${id}.jpg`,
    };
  }

  // ── YouTube ───────────────────────────────────────────────────────────────────
  // Formats: https://www.youtube.com/watch?v=XXXXXXXXXXX
  //          https://youtu.be/XXXXXXXXXXX
  //          https://www.youtube.com/embed/XXXXXXXXXXX
  //          https://www.youtube.com/shorts/XXXXXXXXXXX
  const ytMatch = clean.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) {
    const id = ytMatch[1];
    return {
      provider: "youtube",
      id,
      embedUrl: `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`,
      thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    };
  }

  return null;
}

/**
 * Returns true if the URL is a valid Vimeo or YouTube link.
 */
export function isValidVideoUrl(url: string): boolean {
  return parseVideoUrl(url) !== null;
}

/**
 * Returns a short label for the provider — for use in placeholder text / hints.
 */
export function providerLabel(url: string): string {
  const parsed = parseVideoUrl(url);
  if (!parsed) return "";
  return parsed.provider === "vimeo" ? "Vimeo" : "YouTube";
}
