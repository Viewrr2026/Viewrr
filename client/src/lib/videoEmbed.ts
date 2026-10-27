/** Parse supported provider links without losing private Vimeo link hashes. */
export type VideoProvider = "vimeo" | "youtube" | "upload" | null;
export interface ParsedVideo {
  provider: VideoProvider;
  id: string;
  embedUrl: string;
  thumbnailUrl: string;
}

export function parseVideoUrl(input: string): ParsedVideo | null {
  const clean = input?.trim();
  if (!clean) return null;
  if (/^\/api\/media\/\d+\/[a-f0-9-]+\/(original|preview)\.(jpg|mp4)$/.test(clean)) {
    return { provider: "upload", id: clean, embedUrl: clean, thumbnailUrl: clean.endsWith('.jpg') ? clean : '' };
  }
  let url: URL;
  try { url = new URL(clean); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const match = url.pathname.match(/^\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/\d+\/video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?\/?$/);
    if (!match) return null;
    const id = match[1];
    const params = new URLSearchParams();
    const hash = url.searchParams.get('h') || match[2];
    if (hash) params.set('h', hash);
    params.set('autoplay', '0'); params.set('title', '0'); params.set('byline', '0'); params.set('portrait', '0'); params.set('color', 'FF5A1F');
    return { provider: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}?${params}`, thumbnailUrl: `https://vumbnail.com/${id}.jpg` };
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
    const id = host.endsWith('youtu.be') ? url.pathname.split('/')[1]
      : url.pathname === '/watch' ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})\/?$/)?.[1];
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    return { provider: 'youtube', id, embedUrl: `https://www.youtube.com/embed/${id}?rel=0&playsinline=1`, thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
  }
  return null;
}

export function isValidVideoUrl(url: string): boolean { return parseVideoUrl(url) !== null; }
export function providerLabel(url: string): string {
  const provider = parseVideoUrl(url)?.provider;
  return provider === 'vimeo' ? 'Vimeo' : provider === 'youtube' ? 'YouTube' : provider === 'upload' ? 'Viewrr upload' : '';
}
