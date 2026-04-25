/**
 * NotificationActionModal
 * Opens contextual content when a user clicks any notification.
 *
 * Type routing:
 *  message            → QuickMessageModal (already handled — not routed here)
 *  like / comment     → PostPreviewPanel  (fetches post, shows media + actions)
 *  interest           → InterestPanel     (cover note + accept/decline for clients)
 *  interest_accepted  → InterestResultPanel (congrats / sorry card for freelancer)
 *  interest_declined  → InterestResultPanel
 *  profile_view       → ProfileSnapshotPanel (actor's mini-profile)
 *  connection         → ConnectionPanel
 */
import { useState } from "react";
import { X, Heart, MessageCircle, Send, CheckCircle, XCircle, Eye, Briefcase, User, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./AuthProvider";

// ─── Types ───────────────────────────────────────────────────────────────────
export interface NotificationModalProps {
  open: boolean;
  onClose: () => void;
  notification: {
    id: number;
    type: string;
    actorId: number;
    actorName: string;
    actorAvatar: string | null;
    message: string;
    link: string | null;
  } | null;
}

// ─── UK time helper ───────────────────────────────────────────────────────────
function fmt(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(d);
}

// ─── Shell wrapper ────────────────────────────────────────────────────────────
function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed z-[201] inset-x-4 sm:inset-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[420px] top-1/2 -translate-y-1/2 flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </>
  );
}

// ─── Post preview (like / comment notifications) ─────────────────────────────
function PostPreviewPanel({
  postId, actorId, actorName, actorAvatar, type, onClose,
}: {
  postId: number; actorId: number; actorName: string; actorAvatar: string | null; type: string; onClose: () => void;
}) {
  const { user } = useAuth();
  const [commentText, setCommentText] = useState("");
  const [showComments, setShowComments] = useState(type === "comment");

  const { data: pw, isLoading } = useQuery<any>({
    queryKey: ["/api/feed/post", postId],
    queryFn: async () => {
      const res = await fetch(`/api/feed`);
      if (!res.ok) return null;
      const posts = await res.json();
      return posts.find((p: any) => p.post.id === postId) ?? null;
    },
  });

  const { data: comments = [] } = useQuery<any[]>({
    queryKey: ["/api/feed/comments", postId],
    queryFn: async () => {
      const res = await fetch(`/api/feed/${postId}/comments`);
      return res.ok ? res.json() : [];
    },
    enabled: showComments,
  });

  const addComment = useMutation({
    mutationFn: async (content: string) => {
      if (!user) return;
      const res = await apiRequest("POST", `/api/feed/${postId}/comments`, { userId: user.id, content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed/comments", postId] });
      setCommentText("");
    },
  });

  const typeLabel = type === "like" ? "liked your post" : "commented on your post";
  const typeIcon = type === "like" ? <Heart size={14} className="text-red-500" /> : <MessageCircle size={14} className="text-blue-500" />;

  return (
    <ModalShell onClose={onClose}>
      {/* Actor header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Avatar className="w-9 h-9">
          <AvatarImage src={actorAvatar || undefined} />
          <AvatarFallback className="bg-primary text-white text-xs">{actorName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{actorName}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">{typeIcon} {typeLabel}</p>
        </div>
      </div>

      {/* Post content */}
      <div className="overflow-y-auto flex-1">
        {isLoading && (
          <div className="space-y-3 p-4">
            <div className="h-4 bg-secondary rounded animate-pulse w-3/4" />
            <div className="h-40 bg-secondary rounded-xl animate-pulse" />
          </div>
        )}
        {!isLoading && !pw && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <Eye size={28} className="opacity-30" />
            <p>Post could not be loaded.</p>
          </div>
        )}
        {!isLoading && pw && (
          <div className="p-4 space-y-3">
            {/* Caption */}
            {pw.post.caption && <p className="text-sm leading-relaxed">{pw.post.caption}</p>}
            {/* Tags */}
            {pw.post.tags && JSON.parse(pw.post.tags).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {JSON.parse(pw.post.tags).map((t: string) => (
                  <span key={t} className="text-xs text-primary font-medium">#{t}</span>
                ))}
              </div>
            )}
            {/* Media */}
            {pw.post.mediaUrl && (
              <div className="rounded-xl overflow-hidden bg-muted aspect-video">
                {pw.post.mediaType === "video" ? (
                  <video src={pw.post.mediaUrl} className="w-full h-full object-cover" controls muted />
                ) : (
                  <img src={pw.post.mediaUrl} alt="Post" className="w-full h-full object-cover" />
                )}
              </div>
            )}
            {/* Stats */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
              <span className="flex items-center gap-1"><Heart size={12} /> {pw.post.likeCount}</span>
              <span className="flex items-center gap-1"><MessageCircle size={12} /> {pw.post.commentCount} comment{pw.post.commentCount !== 1 ? "s" : ""}</span>
              <span className="ml-auto">{fmt(pw.post.createdAt)}</span>
            </div>
            {/* Comments toggle */}
            <button
              className="w-full flex items-center justify-between text-xs text-primary font-medium py-1 hover:underline"
              onClick={() => setShowComments(v => !v)}
            >
              <span>{showComments ? "Hide comments" : "View comments"}</span>
              {showComments ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showComments && (
              <div className="space-y-2">
                {comments.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
                {comments.map((c: any) => (
                  <div key={c.comment.id} className="flex items-start gap-2">
                    <Avatar className="w-6 h-6 flex-shrink-0 mt-0.5">
                      <AvatarImage src={c.user.avatar || undefined} />
                      <AvatarFallback className="text-[9px] bg-secondary">{c.user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="bg-secondary rounded-xl px-3 py-1.5 flex-1 min-w-0">
                      <p className="text-xs font-semibold">{c.user.name}</p>
                      <p className="text-xs leading-relaxed">{c.comment.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reply bar */}
      {user && pw && (
        <form
          onSubmit={e => { e.preventDefault(); if (commentText.trim()) addComment.mutate(commentText); }}
          className="flex gap-2 px-3 py-3 border-t border-border"
        >
          <Input
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            className="flex-1 rounded-full text-sm h-9"
          />
          <Button type="submit" size="icon" disabled={!commentText.trim() || addComment.isPending}
            className="rounded-full w-9 h-9 bg-primary hover:bg-primary/90 text-white flex-shrink-0">
            <Send size={14} />
          </Button>
        </form>
      )}
    </ModalShell>
  );
}

// ─── Interest panel (client receives interest from freelancer) ────────────────
function InterestPanel({
  notification, onClose,
}: {
  notification: NotificationModalProps["notification"]; onClose: () => void;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);

  // Fetch all interests for this client and find the one from this actor
  const { data: interests = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/interests/client", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const res = await fetch(`/api/interests/client/${user.id}`);
      return res.ok ? res.json() : [];
    },
    enabled: !!user,
  });

  // Find the most recent interest from this actor
  const interest = interests.find((i: any) => i.freelancerId === notification?.actorId);

  async function respond(status: "accepted" | "declined") {
    if (!interest || !user) return;
    await fetch(`/api/interests/${interest.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, clientName: user.name, clientAvatar: user.avatar }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/interests/client", user.id] });
    setDone(status);
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Avatar className="w-9 h-9">
          <AvatarImage src={notification?.actorAvatar || undefined} />
          <AvatarFallback className="bg-primary text-white text-xs">{notification?.actorName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-semibold">{notification?.actorName}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase size={12} /> Expressed interest in your brief</p>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        {isLoading && <div className="h-24 bg-secondary rounded-xl animate-pulse" />}

        {!isLoading && !interest && (
          <p className="text-sm text-muted-foreground text-center py-8">Interest details not available.</p>
        )}

        {!isLoading && interest && (
          <>
            <div className="bg-muted/50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brief</p>
              <p className="font-semibold text-sm">{interest.briefTitle}</p>
            </div>

            <div>
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 text-xs text-primary font-medium hover:underline mb-2"
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? "Hide cover note" : "Read cover note"}
              </button>
              {expanded && (
                <div className="bg-secondary/60 rounded-xl p-3">
                  <p className="text-sm leading-relaxed">{interest.coverNote}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2">
                    {interest.rate && <span>Rate: <span className="font-medium text-foreground">{interest.rate}</span></span>}
                    {interest.availability && <span>Available from: <span className="font-medium text-foreground">{interest.availability}</span></span>}
                  </div>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">Sent {fmt(interest.createdAt)}</p>

            {done ? (
              <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${done === "accepted" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                {done === "accepted" ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {done === "accepted" ? "You accepted this interest" : "You declined this interest"}
              </div>
            ) : interest.status === "accepted" || interest.status === "declined" ? (
              <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${interest.status === "accepted" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                {interest.status === "accepted" ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {interest.status === "accepted" ? "Already accepted" : "Already declined"}
              </div>
            ) : (
              <div className="flex gap-2">
                <Button className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-full text-sm" onClick={() => respond("accepted")}>
                  <CheckCircle size={14} className="mr-1.5" /> Accept
                </Button>
                <Button variant="outline" className="flex-1 rounded-full text-sm text-muted-foreground hover:text-destructive hover:border-destructive" onClick={() => respond("declined")}>
                  <XCircle size={14} className="mr-1.5" /> Decline
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Interest result panel (freelancer sees accepted/declined) ────────────────
function InterestResultPanel({
  notification, onClose,
}: {
  notification: NotificationModalProps["notification"]; onClose: () => void;
}) {
  const accepted = notification?.type === "interest_accepted";
  return (
    <ModalShell onClose={onClose}>
      <div className="flex flex-col items-center text-center px-6 py-10 gap-4">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${accepted ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
          {accepted
            ? <CheckCircle size={32} className="text-green-600 dark:text-green-400" />
            : <XCircle size={32} className="text-red-600 dark:text-red-400" />}
        </div>
        <div>
          <p className="text-lg font-bold">{accepted ? "Interest Accepted!" : "Interest Declined"}</p>
          <p className="text-sm text-muted-foreground mt-1">{notification?.message}</p>
        </div>
        {accepted && (
          <p className="text-sm text-muted-foreground bg-secondary/60 rounded-xl px-4 py-3">
            Great news — you can now message the client directly from your Dashboard to discuss the project.
          </p>
        )}
        {!accepted && (
          <p className="text-sm text-muted-foreground bg-secondary/60 rounded-xl px-4 py-3">
            Don't be discouraged — keep exploring briefs and expressing interest in projects that fit your skills.
          </p>
        )}
        <Button className="bg-primary hover:bg-primary/90 text-white rounded-full w-full" onClick={onClose}>
          Got it
        </Button>
      </div>
    </ModalShell>
  );
}

// ─── Profile view panel (someone viewed your profile) ────────────────────────
function ProfileViewPanel({
  notification, onClose,
}: {
  notification: NotificationModalProps["notification"]; onClose: () => void;
}) {
  // Fetch viewer's profile
  const { data: profile, isLoading } = useQuery<any>({
    queryKey: ["/api/profiles", notification?.actorId],
    queryFn: async () => {
      const res = await fetch(`/api/profiles/${notification!.actorId}`);
      return res.ok ? res.json() : null;
    },
    enabled: !!notification?.actorId,
  });

  const user = profile?.user;
  const prof = profile?.profile;

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Eye size={18} className="text-amber-500" />
        <p className="text-sm font-semibold">Profile View</p>
      </div>
      <div className="overflow-y-auto flex-1 p-4">
        {isLoading && <div className="h-32 bg-secondary rounded-xl animate-pulse" />}
        {!isLoading && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <Avatar className="w-16 h-16">
              <AvatarImage src={notification?.actorAvatar || user?.avatar || undefined} />
              <AvatarFallback className="bg-primary text-white text-xl">{notification?.actorName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-base">{notification?.actorName}</p>
              {user?.location && <p className="text-xs text-muted-foreground">{user.location}</p>}
            </div>
            {prof && (
              <div className="flex flex-wrap gap-1.5 justify-center">
                {JSON.parse(prof.specialisms || "[]").slice(0, 3).map((s: string) => (
                  <span key={s} className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium">{s}</span>
                ))}
              </div>
            )}
            <p className="text-sm text-muted-foreground">{notification?.actorName} viewed your profile</p>
            <Button asChild className="bg-primary hover:bg-primary/90 text-white rounded-full w-full mt-2">
              <a href={`/#/profile/${notification?.actorId}`} onClick={onClose}>
                <User size={14} className="mr-1.5" /> View their profile
              </a>
            </Button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────
export default function NotificationActionModal({ open, onClose, notification }: NotificationModalProps) {
  if (!open || !notification) return null;

  const { type, actorId, actorName, actorAvatar, link } = notification;

  // Extract post ID from link if available (e.g. "/feed/42")
  const postIdFromLink = link?.match(/\/feed\/(\d+)/)?.[1];
  // We also allow link="/feed" with no post ID — in that case we show the most recent interaction
  // For like/comment we need a post ID — store it in link as /feed/ID
  const postId = postIdFromLink ? Number(postIdFromLink) : null;

  if (type === "like" || type === "comment") {
    // If no postId in link, fall back to showing a generic feed hint
    if (!postId) {
      return (
        <ModalShell onClose={onClose}>
          <div className="flex flex-col items-center justify-center py-12 gap-3 px-6 text-center">
            <Heart size={32} className="text-red-400" />
            <p className="font-semibold">{notification.message}</p>
            <p className="text-sm text-muted-foreground">View your feed to see the full post.</p>
            <Button className="bg-primary hover:bg-primary/90 text-white rounded-full" onClick={onClose}>
              <a href="/#/feed">Go to Feed</a>
            </Button>
          </div>
        </ModalShell>
      );
    }
    return (
      <PostPreviewPanel
        postId={postId}
        actorId={actorId}
        actorName={actorName}
        actorAvatar={actorAvatar}
        type={type}
        onClose={onClose}
      />
    );
  }

  if (type === "interest") {
    return <InterestPanel notification={notification} onClose={onClose} />;
  }

  if (type === "interest_accepted" || type === "interest_declined") {
    return <InterestResultPanel notification={notification} onClose={onClose} />;
  }

  if (type === "profile_view") {
    return <ProfileViewPanel notification={notification} onClose={onClose} />;
  }

  // Fallback: generic info panel
  return (
    <ModalShell onClose={onClose}>
      <div className="flex flex-col items-center justify-center py-12 gap-3 px-6 text-center">
        <p className="font-semibold text-base">{notification.message}</p>
        <Button className="bg-primary hover:bg-primary/90 text-white rounded-full" onClick={onClose}>Dismiss</Button>
      </div>
    </ModalShell>
  );
}
