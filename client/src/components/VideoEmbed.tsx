/**
 * VideoEmbed
 * Renders a Vimeo or YouTube video as a clean responsive iframe.
 * Videos are hosted on Vimeo/YouTube — zero file storage on Viewrr servers.
 */
import { parseVideoUrl } from "@/lib/videoEmbed";
import { Film } from "lucide-react";

interface VideoEmbedProps {
  url: string;
  className?: string;
  /** Whether to show the provider badge (Vimeo / YouTube). Default true. */
  showBadge?: boolean;
}

export default function VideoEmbed({ url, className = "", showBadge = true }: VideoEmbedProps) {
  const parsed = parseVideoUrl(url);

  if (!parsed) {
    return (
      <div className={`flex flex-col items-center justify-center bg-muted rounded-xl aspect-video gap-2 text-muted-foreground text-sm ${className}`}>
        <Film size={24} className="opacity-40" />
        <span>Invalid video link</span>
      </div>
    );
  }

  return (
    <div className={`relative aspect-video rounded-xl overflow-hidden bg-black ${className}`}>
      <iframe
        src={parsed.embedUrl}
        title="Video"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
        loading="lazy"
        style={{ border: 0 }}
      />
      {showBadge && (
        <span className="absolute top-2 left-2 text-[10px] font-semibold bg-black/70 text-white px-2 py-0.5 rounded-full pointer-events-none z-10 uppercase tracking-wide">
          {parsed.provider === "vimeo" ? "Vimeo" : "YouTube"}
        </span>
      )}
    </div>
  );
}
