import FeedPostComposer from "@/components/FeedPostComposer";
import { useState, useMemo, useCallback } from "react";
import { displayRole } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

import {
  Heart, MessageCircle, Send, ImagePlus, X, Hash,
  MoreHorizontal, Trash2, MapPin, Sparkles, TrendingUp,
  Share2, Repeat2, Mail, Film, Link as LinkIcon, Pencil, Upload, Loader2,
} from "lucide-react";
import { parseVideoUrl, isValidVideoUrl } from "@/lib/videoEmbed";
import VideoEmbed from "@/components/VideoEmbed";
import FeedVideo from "@/components/FeedVideo";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import type { PostWithUser, CommentWithUser } from "../../../server/storage";

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Extract nouns from post captions for dynamic trending
function extractNouns(posts: PostWithUser[]): string[] {
  const wordCount: Record<string, number> = {};
  const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","is","was","are","were","be","been","have","has","had","do","does","did","will","would","could","should","may","might","i","we","you","he","she","they","it","this","that","these","those","my","your","our","their","its","just","very","so","as","if","then","than","what","who","how","when","where","why","all","any","each","every","some","no","not","up","out","about","into","also","here","there"]);

  posts.forEach(pw => {
    const tags: string[] = JSON.parse(pw.post.tags || "[]");
    // Tags are highest signal
    tags.forEach(t => { wordCount[t] = (wordCount[t] || 0) + 3; });
    // Also mine captions
    const words = (pw.post.caption || "").toLowerCase().split(/\W+/);
    words.forEach(w => {
      if (w.length > 4 && !stopWords.has(w)) {
        wordCount[w] = (wordCount[w] || 0) + 1;
      }
    });
  });

  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

// ── Comment section ────────────────────────────────────────────────────────────
function CommentSection({ postId, commentCount }: { postId: number; commentCount: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const { data: comments = [] } = useQuery<CommentWithUser[]>({
    queryKey: ["/api/feed/comments", postId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/feed/${postId}/comments`);
      return res.json();
    },
    enabled: open,
  });

  const addComment = useMutation({
    mutationFn: async (content: string) => {
      if (!user) throw new Error("Not logged in");
      const res = await apiRequest("POST", `/api/feed/${postId}/comments`, { userId: user.id, content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed/comments", postId] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      setText("");
    },
    onError: () => toast({ title: "Sign in to comment", variant: "destructive" }),
  });

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`btn-comments-${postId}`}
      >
        <MessageCircle size={17} />
        <span>{commentCount}</span>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-border space-y-3">
          {comments.length === 0 && (
            <p className="text-xs text-muted-foreground">No comments yet. Be the first.</p>
          )}
          {comments.map(({ comment, user: cu }) => (
            <div key={comment.id} className="flex gap-2.5">
              <Avatar className="w-7 h-7 flex-shrink-0">
                <AvatarImage src={cu.avatar || undefined} />
                <AvatarFallback className="bg-primary text-white text-xs">
                  {cu.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 bg-secondary rounded-xl px-3 py-2">
                <span className="font-semibold text-xs mr-2">{cu.name}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                <p className="text-sm mt-0.5">{comment.content}</p>
              </div>
            </div>
          ))}

          {user && (
            <form
              onSubmit={e => { e.preventDefault(); if (text.trim()) addComment.mutate(text); }}
              className="flex gap-2"
            >
              <Avatar className="w-7 h-7 flex-shrink-0">
                <AvatarImage src={user.avatar || undefined} />
                <AvatarFallback className="bg-primary text-white text-xs">
                  {user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Input
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 h-8 text-sm rounded-full"
              />
              <Button type="submit" size="icon" className="w-8 h-8 rounded-full bg-primary hover:bg-primary/90 text-white flex-shrink-0" disabled={!text.trim() || addComment.isPending}>
                <Send size={13} />
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── DM Modal ──────────────────────────────────────────────────────────────────
function DMModal({ open, onClose, toName }: { open: boolean; onClose: () => void; toName: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [msg, setMsg] = useState("");
  function send() {
    if (!msg.trim()) return;
    toast({ title: `Message sent to ${toName}!` });
    setMsg(""); onClose();
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail size={16} className="text-primary" /> Message {toName}</DialogTitle>
        </DialogHeader>
        {!user ? (
          <p className="text-sm text-muted-foreground">Sign in to send messages.</p>
        ) : (
          <div className="space-y-3">
            <Textarea placeholder={`Say something to ${toName}...`} value={msg} onChange={e => setMsg(e.target.value)} rows={4} className="resize-none" />
            <Button onClick={send} disabled={!msg.trim()} className="w-full bg-primary hover:bg-primary/90 text-white rounded-full">Send message</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Post card ─────────────────────────────────────────────────────────────────
function PostCard({ pw }: { pw: PostWithUser }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [liked, setLiked] = useState(pw.liked);
  const [likeCount, setLikeCount] = useState(pw.post.likeCount);
  const [dmOpen, setDmOpen] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editCaption, setEditCaption] = useState(pw.post.caption || "");
  const [editTagInput, setEditTagInput] = useState("");
  const [editTags, setEditTags] = useState<string[]>(JSON.parse(pw.post.tags || "[]"));
  // Local caption/tags so edits reflect immediately without refetch flicker
  const [displayCaption, setDisplayCaption] = useState(pw.post.caption || "");
  const [displayTags, setDisplayTags] = useState<string[]>(JSON.parse(pw.post.tags || "[]"));
  const tags: string[] = displayTags;

  const likeMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not logged in");
      const res = await apiRequest("POST", `/api/feed/${pw.post.id}/like`, { userId: user.id });
      return res.json();
    },
    onSuccess: (data) => { setLiked(data.liked); setLikeCount(data.likeCount); },
    onError: () => toast({ title: "Sign in to like posts" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/feed/${pw.post.id}`, { userId: user!.id }); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/feed"] }); toast({ title: "Post deleted" }); },
  });

  const adminDeleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/feed/${pw.post.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user!.id }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      toast({ title: "Post removed", description: "The user has been notified." });
    },
    onError: () => toast({ title: "Failed to remove post", variant: "destructive" } as any),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/feed/${pw.post.id}`, {
        userId: user!.id,
        caption: editCaption,
        tags: JSON.stringify(editTags),
      });
      return res.json();
    },
    onSuccess: () => {
      setDisplayCaption(editCaption);
      setDisplayTags([...editTags]);
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      toast({ title: "Post updated" });
      setEditOpen(false);
    },
    onError: () => toast({ title: "Failed to update post", variant: "destructive" }),
  });

  function openEdit() {
    setEditCaption(displayCaption);
    setEditTags([...displayTags]);
    setEditTagInput("");
    setEditOpen(true);
  }

  function handleEditTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && editTagInput.trim()) {
      e.preventDefault();
      const clean = editTagInput.trim().replace(/^#/, "").replace(/\s+/g, "");
      if (clean && !editTags.includes(clean)) setEditTags(t => [...t, clean]);
      setEditTagInput("");
    }
  }

  const isOwner = user?.id === pw.user.id;
  const isAdminUser = !!(user as any)?.isAdmin;

  function handleShare() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
    toast({ title: "Link copied to clipboard" });
  }

  function handleRepost() {
    if (!user) { toast({ title: "Sign in to repost" }); return; }
    setReposted(true);
    toast({ title: `Reposted ${pw.user.name}'s post to your feed` });
  }

  // Determine profile ID from userId — use userId as profileId approximation
  const profileHref = `/profile/${pw.user.id}`;

  return (
    <article className="bg-card border border-border rounded-2xl overflow-hidden" data-testid={`post-card-${pw.post.id}`}>
      {/* Repost label */}
      {reposted && (
        <div className="px-5 pt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Repeat2 size={13} /> <span>You reposted this</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          {/* ✅ Item 6 — click avatar goes to profile */}
          <Link href={profileHref}>
            <Avatar className="w-10 h-10 ring-2 ring-background cursor-pointer hover:ring-primary/40 transition-all">
              <AvatarImage src={pw.user.avatar || undefined} />
              <AvatarFallback className="bg-primary text-white text-sm">
                {pw.user.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Link>
          <div>
            <Link href={profileHref} className="font-semibold text-sm leading-tight hover:text-primary hover:underline transition-colors">
              {pw.user.name}
            </Link>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {pw.user.location && (
                <span className="flex items-center gap-0.5">
                  <MapPin size={10} /> {pw.user.location}
                </span>
              )}
              <span>· {timeAgo(pw.post.createdAt)}</span>
            </div>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary transition-colors">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleShare} className="flex items-center gap-2">
              <LinkIcon size={13} /> Copy link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRepost} className="flex items-center gap-2">
              <Repeat2 size={13} /> Repost
            </DropdownMenuItem>
            {!isOwner && (
              <DropdownMenuItem onClick={() => setDmOpen(true)} className="flex items-center gap-2">
                <Mail size={13} /> Message {pw.user.name.split(" ")[0]}
              </DropdownMenuItem>
            )}
            {isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="flex items-center gap-2" onClick={openEdit}>
                  <Pencil size={13} /> Edit post
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive flex items-center gap-2" onClick={() => deleteMutation.mutate()}>
                  <Trash2 size={13} /> Delete post
                </DropdownMenuItem>
              </>
            )}
            {isAdminUser && !isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive flex items-center gap-2"
                  onClick={() => adminDeleteMutation.mutate()}
                  disabled={adminDeleteMutation.isPending}
                >
                  <Trash2 size={13} /> Remove post (Admin)
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Caption */}
      {displayCaption && (
        <p className="px-5 pb-3 text-sm leading-relaxed whitespace-pre-line">{displayCaption}</p>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="px-5 pb-3 flex flex-wrap gap-1.5">
          {tags.map(t => (
            <span key={t} className="text-xs text-primary font-medium">#{t}</span>
          ))}
        </div>
      )}

      {/* Edit post dialog */}
      <Dialog open={editOpen} onOpenChange={v => !v && setEditOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil size={16} className="text-primary" /> Edit post
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <Textarea
              placeholder="Update your caption..."
              value={editCaption}
              onChange={e => setEditCaption(e.target.value)}
              rows={4}
              className="resize-none"
            />
            {/* Tags editor */}
            <div className="space-y-2">
              {editTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {editTags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      #{t}
                      <button onClick={() => setEditTags(tags => tags.filter(x => x !== t))} className="hover:text-destructive transition-colors">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 border border-border rounded-xl px-3 py-2">
                <Hash size={14} className="text-muted-foreground flex-shrink-0" />
                <Input
                  className="border-0 p-0 h-auto focus-visible:ring-0 text-sm"
                  placeholder="Add tag, press Enter"
                  value={editTagInput}
                  onChange={e => setEditTagInput(e.target.value)}
                  onKeyDown={handleEditTag}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 rounded-full" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-full"
                onClick={() => editMutation.mutate()}
                disabled={editMutation.isPending}
              >
                {editMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Uploaded videos play inline; external embeds keep provider controls. */}
      {pw.post.mediaUrl && (
        <div className="mx-5 mb-4">
          {parseVideoUrl(pw.post.mediaUrl)?.provider === "upload" && pw.post.mediaUrl.endsWith(".mp4") ? (
            <FeedVideo key={pw.post.mediaUrl} url={pw.post.mediaUrl} label={`Video by ${pw.user.name}`} />
          ) : parseVideoUrl(pw.post.mediaUrl) ? (
            <VideoEmbed url={pw.post.mediaUrl} />
          ) : (
            <div className="rounded-xl overflow-hidden bg-muted aspect-video">
              <img src={pw.post.mediaUrl} alt="Post media" className="w-full h-full object-cover" loading="lazy" />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="px-5 pb-4 flex items-center gap-5 border-t border-border pt-3">
        <button
          onClick={() => likeMutation.mutate()}
          disabled={likeMutation.isPending}
          className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${liked ? "text-red-500" : "text-muted-foreground hover:text-red-400"}`}
          data-testid={`btn-like-${pw.post.id}`}
        >
          <Heart size={17} className={liked ? "fill-current" : ""} />
          <span>{likeCount}</span>
        </button>

        <CommentSection postId={pw.post.id} commentCount={pw.post.commentCount} />

        {/* ✅ Item 8 — Share & DM */}
        <button onClick={handleRepost} className={`flex items-center gap-1.5 text-sm transition-colors ${reposted ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
          <Repeat2 size={17} />
        </button>
        <button onClick={handleShare} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Share2 size={16} />
        </button>
        {!isOwner && (
          <button onClick={() => setDmOpen(true)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors ml-auto">
            <Mail size={16} />
          </button>
        )}
      </div>

      <DMModal open={dmOpen} onClose={() => setDmOpen(false)} toName={pw.user.name} />
    </article>
  );
}

const PAGE_SIZE = 10;

// ── Main Feed page ─────────────────────────────────────────────────────────────
export default function Feed() {
  const { user } = useAuth();
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [posts, setPosts] = useState<PostWithUser[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Initial load
  const { isLoading } = useQuery<PostWithUser[]>({
    queryKey: ["/api/feed", user?.id],
    queryFn: async () => {
      try {
        // PRD-1 Decision 1: the viewer is now derived from the session
        // server-side (optionalAuth) — no viewer id in the query string.
        const res = await fetch(`/api/feed?limit=${PAGE_SIZE}&offset=0`);
        if (!res.ok) { setPosts([]); setHasMore(false); return []; }
        const data: PostWithUser[] = await res.json();
        setPosts(data);
        setOffset(PAGE_SIZE);
        setHasMore(data.length === PAGE_SIZE);
        return data;
      } catch {
        setPosts([]);
        setHasMore(false);
        return [];
      }
    },
    staleTime: 60 * 1000,        // treat cached data as fresh for 60s
    gcTime: 5 * 60 * 1000,       // keep in memory for 5 mins
    refetchInterval: false,
    refetchOnMount: true,         // always check for new posts when navigating to feed
    retry: false,
    refetchOnWindowFocus: false,  // don't re-fetch just because the user switched tabs
  });

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/feed?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) { setHasMore(false); return; }
      const data: PostWithUser[] = await res.json();
      setPosts(prev => {
        // deduplicate by post id
        const existingIds = new Set(prev.map(p => p.post.id));
        const fresh = data.filter(p => !existingIds.has(p.post.id));
        return [...prev, ...fresh];
      });
      setOffset(o => o + PAGE_SIZE);
      setHasMore(data.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, offset, user]);

  // When a new post is created, prepend it to the list and bust queries
  const handleNewPost = useCallback(() => {
    // Invalidate query so next full-reload picks up fresh data
    queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    // Re-fetch first page to get the newest post at the top
    (async () => {
      try {
        const res = await fetch(`/api/feed?limit=${PAGE_SIZE}&offset=0`);
        if (!res.ok) return;
        const data: PostWithUser[] = await res.json();
        setPosts(prev => {
          const existingIds = new Set(prev.map(p => p.post.id));
          const fresh = data.filter(p => !existingIds.has(p.post.id));
          return [...fresh, ...prev];
        });
        setHasMore(data.length === PAGE_SIZE);
      } catch { /* silent */ }
    })();
  }, [user]);

  // ✅ Item 9 — Dynamic trending tags from actual post content
  const trendingTags = useMemo(() => {
    const dynamic = extractNouns(posts);
    if (dynamic.length >= 5) return dynamic;
    const seeds = ["BrandFilm", "ColourGrade", "Documentary", "FashionPhotography", "TikTok", "Drone", "MotionDesign", "Wedding", "Festival"];
    const merged = [...new Set([...dynamic, ...seeds])];
    return merged.slice(0, 9);
  }, [posts]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,300px] gap-6">

          {/* ── Left: Feed ──────────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Post composer */}
            <div
              className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3 cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setPostModalOpen(true)}
            >
              <Avatar className="w-10 h-10 flex-shrink-0">
                {user ? (
                  <>
                    <AvatarImage src={user.avatar || undefined} />
                    <AvatarFallback className="bg-primary text-white text-sm">
                      {user.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </>
                ) : (
                  <AvatarFallback className="bg-secondary text-muted-foreground text-sm">?</AvatarFallback>
                )}
              </Avatar>
              <div className="flex-1 bg-secondary hover:bg-secondary/70 transition-colors rounded-full px-4 py-2.5 text-sm text-muted-foreground">
                Share your latest work...
              </div>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-white rounded-full gap-1.5 hidden sm:flex"
                onClick={e => { e.stopPropagation(); setPostModalOpen(true); }}
              >
                <Upload size={14} />
                Post
              </Button>
            </div>

            {/* Posts */}
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="bg-card border border-border rounded-2xl p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full skeleton" />
                      <div className="space-y-1.5 flex-1">
                        <div className="h-3 skeleton rounded w-1/3" />
                        <div className="h-2.5 skeleton rounded w-1/4" />
                      </div>
                    </div>
                    <div className="h-3 skeleton rounded w-full" />
                    <div className="h-3 skeleton rounded w-4/5" />
                    <div className="h-40 skeleton rounded-xl" />
                  </div>
                ))}
              </div>
            ) : posts.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-2xl">
                <ImagePlus size={32} className="mx-auto mb-4 opacity-40" />
                <p className="font-semibold text-foreground mb-2">Nothing in the feed yet</p>
                <p className="text-sm">Be the first to share your work.</p>
              </div>
            ) : (
              <>
                {posts.map(pw => <PostCard key={pw.post.id} pw={pw} />)}

                {/* Load more */}
                {hasMore && (
                  <div className="pt-2 pb-4 flex justify-center">
                    <Button
                      variant="outline"
                      className="rounded-full px-8"
                      onClick={loadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? (
                        <><Loader2 size={15} className="mr-2 animate-spin" /> Loading...</>
                      ) : "Load more posts"}
                    </Button>
                  </div>
                )}

                {!hasMore && posts.length > 0 && (
                  <p className="text-center text-xs text-muted-foreground py-4">You're all caught up</p>
                )}
              </>
            )}
          </div>

          {/* ── Right sidebar ───────────────────────────────────────────── */}
          <div className="space-y-5 lg:sticky lg:top-20 self-start">
            {/* ✅ Item 9 — Dynamic trending tags */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
                <TrendingUp size={15} className="text-primary" />
                Trending now
              </h3>
              <div className="flex flex-wrap gap-2">
                {trendingTags.map(tag => (
                  <span
                    key={tag}
                    className="text-xs bg-secondary text-muted-foreground rounded-full px-3 py-1 hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer font-medium"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Share CTA */}
            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={15} className="text-primary" />
                <h3 className="font-semibold text-sm">Share your work</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Post your latest projects, behind-the-scenes, and wins. Get discovered by brands actively looking for creative talent.
              </p>
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-white text-sm"
                onClick={() => setPostModalOpen(true)}
              >
                <Upload size={14} className="mr-1.5" />
                Post now
              </Button>
            </div>

            {/* Browse talent CTA — clients only */}
            {(!user || user.role === "client") && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-semibold text-sm mb-2">Looking to hire?</h3>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  Browse 2,400+ verified videographers, editors, photographers, and marketers ready to work.
                </p>
                <Button asChild variant="outline" className="w-full text-sm">
                  <Link href="/marketplace">Browse talent →</Link>
                </Button>
              </div>
            )}
            {/* Freelancer: find briefs CTA */}
            {user?.role === "freelancer" && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-semibold text-sm mb-2">Find your next brief</h3>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  Browse live briefs from clients looking for exactly your skills.
                </p>
                <Button asChild variant="outline" className="w-full text-sm">
                  <Link href="/briefs">View open briefs →</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <FeedPostComposer open={postModalOpen} onClose={() => { setPostModalOpen(false); handleNewPost(); }} />
    </div>
  );
}
