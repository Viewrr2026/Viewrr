import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MediaUpload } from "@/components/MediaUpload";
import EmailVerificationPanel from "@/components/EmailVerificationPanel";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { displayRole } from "@/lib/utils";
import { parseVideoUrl, isValidVideoUrl } from "@/lib/videoEmbed";
import VideoEmbed from "@/components/VideoEmbed";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Film, Hash, ImagePlus, X } from "lucide-react";

// ── Media input (Vimeo/YouTube link OR image URL) ────────────────────────────
function MediaInput({ onMedia }: { onMedia: (url: string, type: "image" | "video") => void }) {
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [tab, setTab] = useState<"video" | "image">("video");
  const [videoError, setVideoError] = useState("");

  function handleVideoSubmit() {
    if (!isValidVideoUrl(videoUrl)) {
      setVideoError("Please paste a valid Vimeo or YouTube link.");
      return;
    }
    setVideoError("");
    onMedia(videoUrl.trim(), "video");
  }

  function handleImageSubmit() {
    if (!imageUrl.trim()) return;
    onMedia(imageUrl.trim(), "image");
  }

  return (
    <div className="space-y-3">
      <MediaUpload scope="feed" onUploaded={(url,mime)=>onMedia(url,mime.startsWith("video/")?"video":"image")} />
      {/* Tab switcher */}
      <div className="flex rounded-xl border border-border overflow-hidden">
        <button
          onClick={() => setTab("video")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
            tab === "video" ? "bg-primary text-white" : "bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <Film size={14} /> Video (Vimeo / YouTube)
        </button>
        <button
          onClick={() => setTab("image")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
            tab === "image" ? "bg-primary text-white" : "bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <ImagePlus size={14} /> Image URL
        </button>
      </div>

      {tab === "video" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="Paste Vimeo or YouTube link..."
              value={videoUrl}
              onChange={e => { setVideoUrl(e.target.value); setVideoError(""); }}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={handleVideoSubmit}
              className="bg-primary hover:bg-primary/90 text-white px-4 rounded-xl flex-shrink-0"
              disabled={!videoUrl.trim()}
            >
              Add
            </Button>
          </div>
          {videoError && <p className="text-xs text-destructive">{videoError}</p>}
          <p className="text-xs text-muted-foreground">
            e.g. <span className="font-mono">https://vimeo.com/123456789</span> or <span className="font-mono">https://youtu.be/abc123</span>
          </p>
        </div>
      )}

      {tab === "image" && (
        <div className="flex gap-2">
          <Input
            placeholder="Paste image URL (JPG, PNG, WebP)..."
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={handleImageSubmit}
            className="bg-primary hover:bg-primary/90 text-white px-4 rounded-xl flex-shrink-0"
            disabled={!imageUrl.trim()}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

// ── New post modal ─────────────────────────────────────────────────────────────
export default function FeedPostComposer({ open, onClose, initialCaption = "", initialMediaUrl = "", projectTitle, onPublished }: {
  open: boolean;
  onClose: () => void;
  initialCaption?: string;
  initialMediaUrl?: string;
  projectTitle?: string;
  onPublished?: () => void;
}) {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const [caption, setCaption] = useState(initialCaption);
  const [mediaUrl, setMediaUrl] = useState(initialMediaUrl);
  const [mediaType, setMediaType] = useState<"image" | "video">(initialMediaUrl ? "video" : "image");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const needsVerification = user?.emailVerified === false || verificationRequired;
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  function addTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const clean = tagInput.trim().replace(/^#/, "").replace(/\s+/g, "");
      if (clean && !tags.includes(clean)) setTags(t => [...t, clean]);
      setTagInput("");
    }
  }

  const createPost = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not logged in");
      const res = await apiRequest("POST", "/api/feed", {
        userId: user.id,
        caption,
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaUrl ? mediaType : undefined,
        tags: JSON.stringify(tags),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      toast({ title: "Post published!" });
      setCaption(""); setMediaUrl(""); setMediaType("image"); setTags([]); setTagInput("");
      onPublished?.();
      onClose();
    },
    onError: (error: Error) => {
      let description = "Your draft is still here. Please try again shortly.";
      let title = "Could not publish post";
      const match = error.message.match(/^(\d+):\s*([\s\S]*)$/);
      if (match) {
        const status = Number(match[1]);
        try {
          const details = JSON.parse(match[2]);
          if (details.code === "EMAIL_VERIFICATION_REQUIRED") {
            updateUser({ emailVerified: false });
            setVerificationRequired(true);
            title = "Confirm your email to publish";
            description = "Enter your verification code here, then publish your post. Your draft has been kept.";
          } else if ([401, 403, 413, 422, 429].includes(status) && typeof details.error === "string") {
            description = details.error;
          }
        } catch {
          if (status === 429) description = "You have posted too quickly. Wait a moment and try again.";
        }
        if (status === 401) description = "Your session has expired. Please sign in again before posting.";
      }
      toast({ title, description, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && !createPost.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus size={18} className="text-primary" />
            {projectTitle ? "Share completed work" : "Share your work"}
          </DialogTitle>
        </DialogHeader>

        {!user ? (
          <p className="text-sm text-muted-foreground">Sign in to share your work with the community.</p>
        ) : (
          <div className="space-y-4 pt-1">
            {/* User row */}
            <div className="flex items-center gap-3">
              <Avatar className="w-9 h-9">
                <AvatarImage src={user.avatar || undefined} />
                <AvatarFallback className="bg-primary text-white text-xs">
                  {user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-sm">{user.name}</p>
                <p className="text-xs text-muted-foreground">{displayRole(user.role)}</p>
              </div>
            </div>

            {projectTitle && <p className="text-sm text-muted-foreground">Create a public post about {projectTitle}. Only the text and media you choose here will be published.</p>}
            {needsVerification && (
              <div className="space-y-2">
                <EmailVerificationPanel onVerified={() => setVerificationRequired(false)} />
                <p className="text-xs text-muted-foreground">Your post draft stays here while you verify.</p>
              </div>
            )}

            {/* Caption */}
            <Textarea
              aria-label="Post caption"
              placeholder="What have you been working on? Share a project, a win, a process shot..."
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={3}
              className="resize-none"
            />

            {/* Media — Vimeo/YouTube or image URL */}
            {!mediaUrl ? (
              <MediaInput onMedia={(url, type) => { setMediaUrl(url); setMediaType(type); }} />
            ) : (
              <div className="relative">
                {parseVideoUrl(mediaUrl) ? (
                  <VideoEmbed url={mediaUrl} />
                ) : (
                  <div className="rounded-xl overflow-hidden aspect-video bg-muted">
                    <img src={mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
                <button
                  aria-label="Remove post media"
                  onClick={() => { setMediaUrl(""); setMediaType("image"); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-background/80 flex items-center justify-center text-muted-foreground hover:text-foreground z-10"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Tags */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block flex items-center gap-1">
                <Hash size={11} /> Tags (press Enter to add)
              </label>
              <Input
                placeholder="e.g. Wedding, London, BrandFilm"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={addTag}
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tags.map(t => (
                    <span
                      key={t}
                      className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2.5 py-0.5 font-medium cursor-pointer hover:bg-primary/20"
                      onClick={() => setTags(ts => ts.filter(x => x !== t))}
                    >
                      #{t} <X size={10} />
                    </span>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={() => createPost.mutate()}
              disabled={(!caption.trim() && !mediaUrl) || createPost.isPending || needsVerification}
              className="w-full bg-primary hover:bg-primary/90 text-white"
            >
              {createPost.isPending ? "Publishing..." : "Publish post"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

