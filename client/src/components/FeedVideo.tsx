import { useEffect, useRef, useState } from "react";
import { Film, Loader2, Play, Volume2, VolumeX } from "lucide-react";
import { feedPlayback } from "@/lib/feedPlayback";

type Connection = EventTarget & { saveData?: boolean };
type Playback = ReturnType<typeof feedPlayback.register>;

/** Inline playback for Viewrr uploads; the URL remains the watermarked preview. */
export default function FeedVideo({ url, label }: { url: string; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef<Playback | null>(null);
  const wantedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tapToPlay, setTapToPlay] = useState(false);
  const [muted, setMuted] = useState(true);
  const [ratio, setRatio] = useState(16 / 9);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const video = videoRef.current!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    let disposed = false;
    let blocked = false;
    let near = false;
    let playAttempt = 0;
    setReady(false);
    setLoading(false);
    setFailed(false);
    setRatio(16 / 9);
    setMuted(true);
    video.muted = true;
    video.defaultMuted = true;

    function attach() {
      if (video.hasAttribute("src")) return;
      setLoading(true);
      // Safari can display a first frame with this fragment even when autoplay
      // is disabled. It does not change the protected media endpoint or asset.
      video.src = `${url}#t=0.001`;
    }

    const playback = feedPlayback.register(active => {
      const attempt = ++playAttempt;
      wantedRef.current = active;
      if (!active) {
        video.pause();
        video.muted = true;
        setMuted(true);
        return;
      }
      attach();
      setTapToPlay(false);
      // Called synchronously for user-initiated playback too, preserving the
      // browser's user gesture when it requires one.
      void video.play().catch(() => {
        if (disposed || attempt !== playAttempt || !wantedRef.current) return;
        blocked = true;
        playback.pause();
        playback.setAutoplay(false);
        setLoading(false);
        setTapToPlay(true);
      });
    });
    playbackRef.current = playback;

    function preferences() {
      const allowed = !motion.matches && !connection?.saveData && !blocked;
      setTapToPlay(!allowed && video.paused);
      playback.setAutoplay(allowed);
      if (near && !connection?.saveData) attach();
    }
    function visibility() {
      feedPlayback.setPageVisible(document.visibilityState !== "hidden");
    }
    visibility();
    preferences();

    let observer: IntersectionObserver | undefined;
    let preloadObserver: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(([entry]) => {
        playback.setVisibility(entry.isIntersecting ? entry.intersectionRatio : 0);
      }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] });
      observer.observe(video);
      preloadObserver = new IntersectionObserver(([entry]) => {
        near = entry.isIntersecting;
        if (near && !connection?.saveData) attach();
      }, { rootMargin: "200px 0px" });
      preloadObserver.observe(video);
    }
    // Old browsers retain manual playback and offscreen pausing.
    function fallbackVisibility() {
      if (observer) return;
      const box = video.getBoundingClientRect();
      playback.setVisibility(box.bottom > 0 && box.top < window.innerHeight ? 0.5 : 0);
      setTapToPlay(true);
    }
    fallbackVisibility();
    window.addEventListener("scroll", fallbackVisibility, { passive: true });
    window.addEventListener("resize", fallbackVisibility);
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", preferences);
    connection?.addEventListener("change", preferences);

    return () => {
      disposed = true;
      observer?.disconnect();
      preloadObserver?.disconnect();
      window.removeEventListener("scroll", fallbackVisibility);
      window.removeEventListener("resize", fallbackVisibility);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", preferences);
      connection?.removeEventListener("change", preferences);
      playback.remove();
      playbackRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [url, retry]);

  return (
    <div className="relative overflow-hidden rounded-xl bg-zinc-950 text-white" data-testid="feed-video">
      <video
        ref={videoRef}
        aria-label={label}
        controls
        playsInline
        loop
        muted={muted}
        preload="metadata"
        className="block w-full object-contain"
        style={{ aspectRatio: ratio, maxHeight: "min(70svh, 560px)" }}
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) setRatio(video.videoWidth / video.videoHeight);
        }}
        onLoadedData={() => { setReady(true); setLoading(false); }}
        onPlaying={() => { setReady(true); setLoading(false); setTapToPlay(false); }}
        onPlay={event => {
          if (event.currentTarget.paused) return;
          if (!wantedRef.current && !playbackRef.current?.play()) event.currentTarget.pause();
        }}
        onPause={event => {
          // Pauses made by the coordinator set wantedRef first. A pause from
          // native controls is remembered so scrolling cannot undo it.
          if (wantedRef.current && event.currentTarget.paused) playbackRef.current?.pause();
        }}
        onVolumeChange={event => setMuted(event.currentTarget.muted)}
        onError={() => {
          playbackRef.current?.pause();
          playbackRef.current?.setAutoplay(false);
          setFailed(true);
          setLoading(false);
        }}
      />
      {!ready && !failed && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 pb-10 text-white/70" aria-hidden="true">
          {loading ? <Loader2 size={28} className="animate-spin motion-reduce:animate-none" /> : <Film size={32} />}
          <span className="text-sm">{loading ? "Loading video…" : "Video preview"}</span>
        </div>
      )}
      {tapToPlay && !failed && (
        <button type="button" onClick={() => playbackRef.current?.play()}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 rounded-full bg-black/80 px-5 py-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          <Play size={18} fill="currentColor" /> Play video
        </button>
      )}
      {ready && !failed && (
        <button type="button" aria-label={muted ? "Unmute video" : "Mute video"}
          onClick={() => {
            const video = videoRef.current!;
            video.muted = !video.muted;
            setMuted(video.muted);
          }}
          className="absolute right-3 top-3 flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-black/70 px-3 text-xs font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          {muted ? "Sound off" : "Sound on"}
        </button>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 px-4 text-center text-sm">
          <Film size={28} className="text-white/60" />
          <p role="status">This video couldn’t load.</p>
          <button type="button" className="rounded-full border border-white/40 px-5 py-2 text-white hover:bg-white/10"
            onClick={() => setRetry(value => value + 1)}>Try again</button>
        </div>
      )}
    </div>
  );
}
