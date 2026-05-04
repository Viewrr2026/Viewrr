import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, ExternalLink, Play, Trash2, Plus, Upload, Link as LinkIcon } from "lucide-react";

// ── Platform detection ────────────────────────────────────────────────────────
interface PlatformInfo {
  name: string;
  color: string;
  embedUrl: string | null;
  logo: string;
}

function detectPlatform(url: string): PlatformInfo {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    // YouTube
    if (host.includes("youtube.com") || host === "youtu.be") {
      let id = u.searchParams.get("v");
      if (!id && host === "youtu.be") id = u.pathname.slice(1);
      if (!id) {
        const m = u.pathname.match(/\/embed\/([^/?]+)/);
        if (m) id = m[1];
      }
      return {
        name: "YouTube",
        color: "#FF0000",
        embedUrl: id ? `https://www.youtube.com/embed/${id}?rel=0&autoplay=0` : null,
        logo: "🎬",
      };
    }

    // Vimeo
    if (host.includes("vimeo.com")) {
      const m = u.pathname.match(/\/(\d+)/);
      const id = m?.[1];
      return {
        name: "Vimeo",
        color: "#1AB7EA",
        embedUrl: id ? `https://player.vimeo.com/video/${id}?title=0&byline=0` : null,
        logo: "🎞️",
      };
    }

    // Google Drive
    if (host.includes("drive.google.com")) {
      const m = u.pathname.match(/\/d\/([^/]+)/);
      const id = m?.[1];
      return {
        name: "Google Drive",
        color: "#4285F4",
        embedUrl: id ? `https://drive.google.com/file/d/${id}/preview` : null,
        logo: "📁",
      };
    }

    // Google Docs / Sheets / Slides
    if (host.includes("docs.google.com")) {
      const isDoc = u.pathname.includes("/document/");
      const isSheet = u.pathname.includes("/spreadsheets/");
      const isSlides = u.pathname.includes("/presentation/");
      const m = u.pathname.match(/\/d\/([^/]+)/);
      const id = m?.[1];
      const type = isDoc ? "document" : isSheet ? "spreadsheets" : "presentation";
      return {
        name: isSlides ? "Google Slides" : isSheet ? "Google Sheets" : "Google Docs",
        color: "#4285F4",
        embedUrl: id ? `https://docs.google.com/${type}/d/${id}/preview` : null,
        logo: isSlides ? "📊" : isSheet ? "📈" : "📄",
      };
    }

    // Dropbox — convert share link to direct embed
    if (host.includes("dropbox.com")) {
      const embedUrl = url.replace("www.dropbox.com", "www.dropbox.com").replace("?dl=0", "?raw=1").replace("dl=0", "raw=1");
      return {
        name: "Dropbox",
        color: "#0061FF",
        embedUrl: embedUrl,
        logo: "📦",
      };
    }

    // Frame.io
    if (host.includes("frame.io") || host.includes("app.frame.io")) {
      return {
        name: "Frame.io",
        color: "#FF6B35",
        embedUrl: url,
        logo: "🎥",
      };
    }

    // Figma
    if (host.includes("figma.com")) {
      return {
        name: "Figma",
        color: "#F24E1E",
        embedUrl: `https://www.figma.com/embed?embed_host=viewrr&url=${encodeURIComponent(url)}`,
        logo: "🎨",
      };
    }

    // Default — try to embed anyway
    return {
      name: host,
      color: "#FF5A1F",
      embedUrl: url,
      logo: "🔗",
    };
  } catch {
    return { name: "Link", color: "#FF5A1F", embedUrl: null, logo: "🔗" };
  }
}

// ── Deliverable type ──────────────────────────────────────────────────────────
interface Deliverable {
  id: number;
  projectId: number;
  url: string;
  label: string;
  platform: string;
  embedUrl: string;
  createdBy: number;
  createdAt: string;
}

// ── Embed modal ───────────────────────────────────────────────────────────────
function EmbedModal({ deliverable, onClose }: { deliverable: Deliverable; onClose: () => void }) {
  const info = detectPlatform(deliverable.url);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-black/95"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg">{info.logo}</span>
          <div>
            <p className="font-semibold text-white text-sm">{deliverable.label}</p>
            <p className="text-xs text-white/50">{info.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={deliverable.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
          >
            <ExternalLink size={13} /> Open original
          </a>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white hover:bg-white/10 rounded-lg p-1.5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Embed */}
      <div className="flex-1 relative">
        {deliverable.embedUrl ? (
          <iframe
            src={deliverable.embedUrl}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            title={deliverable.label}
            style={{ border: "none" }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/50">
            <LinkIcon size={40} />
            <p className="text-sm">This link can't be previewed directly.</p>
            <a
              href={deliverable.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#FF5A1F] underline text-sm"
            >
              Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────
interface Props {
  projectId: number;
  userId: number;
  isFreelancer: boolean;
}

const LABEL_OPTIONS = ["Draft cut", "Final files", "Assets", "Presentation", "Feedback request", "Other"];

export default function DeliverablesSection({ projectId, userId, isFreelancer }: Props) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [labelInput, setLabelInput] = useState(LABEL_OPTIONS[0]);
  const [customLabel, setCustomLabel] = useState("");
  const [embedTarget, setEmbedTarget] = useState<Deliverable | null>(null);
  const [urlError, setUrlError] = useState("");

  const { data: deliverables = [] } = useQuery<Deliverable[]>({
    queryKey: ["/api/projects", projectId, "deliverables"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/deliverables`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const info = detectPlatform(urlInput.trim());
      const finalLabel = labelInput === "Other" ? customLabel.trim() : labelInput;
      const res = await fetch(`/api/projects/${projectId}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlInput.trim(),
          label: finalLabel,
          platform: info.name,
          embedUrl: info.embedUrl ?? urlInput.trim(),
          createdBy: userId,
        }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "deliverables"] });
      setUrlInput(""); setLabelInput(LABEL_OPTIONS[0]); setCustomLabel("");
      setShowAdd(false); setUrlError("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/deliverables/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "deliverables"] }),
  });

  function handleAdd() {
    setUrlError("");
    if (!urlInput.trim()) { setUrlError("Please paste a link"); return; }
    try { new URL(urlInput.trim()); } catch { setUrlError("That doesn't look like a valid URL"); return; }
    if (labelInput === "Other" && !customLabel.trim()) { setUrlError("Please enter a label"); return; }
    addMutation.mutate();
  }

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const hrs = Math.floor(diff / 3600000);
    if (hrs < 1) return "just now";
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <>
      {/* Section */}
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">
            Work Delivered
          </p>
          {isFreelancer && !showAdd && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => setShowAdd(true)}
            >
              <Plus size={12} /> Share work
            </Button>
          )}
        </div>

        {/* Add form — freelancer only */}
        {isFreelancer && showAdd && (
          <div className="bg-secondary/40 rounded-xl p-4 space-y-3 border border-border">
            <p className="text-xs font-semibold text-foreground">Share a link to your work</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Paste a link from YouTube, Vimeo, Google Drive, Dropbox, Figma or Frame.io — the client will be able to view it without leaving Viewrr.
            </p>

            {/* URL input */}
            <Input
              value={urlInput}
              onChange={e => { setUrlInput(e.target.value); setUrlError(""); }}
              placeholder="https://vimeo.com/… or drive.google.com/…"
              className="text-sm h-9"
            />

            {/* Live platform detection */}
            {urlInput.trim() && (() => {
              try {
                new URL(urlInput.trim());
                const info = detectPlatform(urlInput.trim());
                return (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{info.logo}</span>
                    <span>Detected: <span className="font-semibold text-foreground">{info.name}</span></span>
                    {info.embedUrl
                      ? <span className="text-green-500">· Embeds in Viewrr ✓</span>
                      : <span className="text-amber-500">· Will open in new tab</span>
                    }
                  </div>
                );
              } catch { return null; }
            })()}

            {/* Label selector */}
            <div className="flex flex-wrap gap-2">
              {LABEL_OPTIONS.map(l => (
                <button
                  key={l}
                  onClick={() => setLabelInput(l)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    labelInput === l
                      ? "bg-[#FF5A1F] border-[#FF5A1F] text-white"
                      : "border-border text-muted-foreground hover:border-[#FF5A1F] hover:text-foreground"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            {labelInput === "Other" && (
              <Input
                value={customLabel}
                onChange={e => setCustomLabel(e.target.value)}
                placeholder="Custom label…"
                className="text-sm h-9"
              />
            )}

            {urlError && <p className="text-xs text-destructive">{urlError}</p>}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => { setShowAdd(false); setUrlInput(""); setUrlError(""); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 text-xs text-white"
                style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                onClick={handleAdd}
                disabled={addMutation.isPending}
              >
                <Upload size={12} className="mr-1.5" />
                {addMutation.isPending ? "Sharing…" : "Share"}
              </Button>
            </div>
          </div>
        )}

        {/* Deliverables list */}
        {deliverables.length === 0 && !showAdd ? (
          <p className="text-xs text-muted-foreground italic">
            {isFreelancer
              ? "Share a link to your work-in-progress above — the client will be able to view it here."
              : "The freelancer hasn't shared any work yet."}
          </p>
        ) : (
          <div className="space-y-2">
            {deliverables.map(d => {
              const info = detectPlatform(d.url);
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 group"
                >
                  {/* Platform logo */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: `${info.color}18` }}
                  >
                    {info.logo}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{d.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {info.name} · {timeAgo(d.createdAt)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5 text-white"
                      style={{ background: `linear-gradient(135deg,#FF5A1F,#FF8C42)` }}
                      onClick={() => setEmbedTarget(d)}
                    >
                      <Play size={11} fill="white" /> View
                    </Button>
                    {isFreelancer && d.createdBy === userId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deleteMutation.mutate(d.id)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Embed modal */}
      {embedTarget && (
        <EmbedModal deliverable={embedTarget} onClose={() => setEmbedTarget(null)} />
      )}
    </>
  );
}
