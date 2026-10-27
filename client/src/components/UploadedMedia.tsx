import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';

/** Resolve the selected private variant with the session; stream without credentials. */
export default function UploadedMedia({ url, title }: { url: string; title: string }) {
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<{ source: string; uri: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setResolved(null); setError(''); setLoading(true);
    async function resolve() {
      try {
        if (!/^\/api\/media\/\d+\/[a-f0-9-]+\/(original|preview)\.(jpg|mp4)$/.test(url)) throw new Error('Invalid media reference.');
        const response = await apiRequest('GET', `${url}?resolve=1`);
        const data = await response.json();
        const target = new URL(data.url);
        if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid playback URL.');
        if (active) setResolved({ source: url, uri: target.href });
      } catch {
        if (active) { setError('This media could not be loaded. Please try again.'); setLoading(false); }
      }
    }
    void resolve();
    return () => { active = false; };
  }, [url, attempt]);
  const uri = resolved?.source === url ? resolved.uri : null;
  const failed = () => { setError('This media could not be played. Please try again.'); setLoading(false); };
  return <div className="relative h-full w-full min-h-0 flex items-center justify-center text-white">
    {!error && uri && (url.endsWith('.mp4')
      ? <video key={`${url}:${attempt}`} src={uri} controls playsInline autoPlay preload="auto" onLoadedData={() => setLoading(false)} onError={failed} className="block h-full w-full min-h-0 object-contain" aria-label={title} />
      : <img key={`${url}:${attempt}`} src={uri} alt={title} onLoad={() => setLoading(false)} onError={failed} className="block h-full w-full min-h-0 object-contain" />)}
    {!error && loading && <p role="status" className="absolute pointer-events-none rounded bg-black/70 px-4 py-2 text-sm">Loading media…</p>}
    {error && <div className="text-center p-6 space-y-4"><p role="alert">{error}</p><button type="button" className="rounded border border-white/50 px-4 py-2" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
  </div>;
}
