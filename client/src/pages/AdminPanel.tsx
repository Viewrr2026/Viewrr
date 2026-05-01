import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, User, Trash2, ImageIcon, Video, Clock } from "lucide-react";

interface DeletedPost {
  id: number;
  postId: number;
  ownerId: number;
  ownerName: string;
  ownerEmail: string;
  caption: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  tags: string | null;
  deletedBy: number;
  deletedAt: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminPanel() {
  const { user } = useAuth();

  const { data: log = [], isLoading } = useQuery<DeletedPost[]>({
    queryKey: ["/api/admin/deleted-posts", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const res = await fetch(`/api/admin/deleted-posts?userId=${user.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!(user as any)?.isAdmin,
    refetchInterval: 30000,
  });

  // Block non-admins
  if (!user || !(user as any).isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <ShieldAlert className="mx-auto mb-4 text-destructive" size={48} />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="text-destructive" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Content Moderation</h1>
            <p className="text-sm text-muted-foreground">
              Full history of removed posts. Use the feed page to remove posts directly.
            </p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="bg-card border border-border rounded-xl px-5 py-3 mb-6 flex items-center gap-6 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{log.length}</span> post{log.length !== 1 ? "s" : ""} removed total
          </span>
          {log.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Clock size={13} /> Last removed {timeAgo(log[0].deletedAt)}
            </span>
          )}
        </div>

        {/* Log */}
        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">Loading…</div>
        ) : log.length === 0 ? (
          <div className="text-center py-20">
            <Trash2 className="mx-auto mb-3 text-muted-foreground" size={36} />
            <p className="text-muted-foreground">No posts have been removed yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Go to the Feed page and use the ⋯ menu on any post to remove it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {log.map((entry) => (
              <div
                key={entry.id}
                className="bg-card border border-border rounded-xl p-4 flex gap-4 items-start"
              >
                {/* Icon */}
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <User size={16} className="text-destructive" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-sm">{entry.ownerName}</span>
                    <span className="text-xs text-muted-foreground">{entry.ownerEmail}</span>
                    <Badge variant="outline" className="text-xs text-destructive border-destructive/30">
                      Removed
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                      <Clock size={11} /> {timeAgo(entry.deletedAt)}
                      <span className="hidden sm:inline ml-1">
                        · {new Date(entry.deletedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </span>
                  </div>

                  {entry.caption && (
                    <p className="text-sm text-foreground mb-2 line-clamp-3 italic">"{entry.caption}"</p>
                  )}

                  {/* Media type indicator */}
                  {entry.mediaUrl && (
                    <div className="mb-2">
                      {entry.mediaType === "image" ? (
                        <img
                          src={entry.mediaUrl}
                          alt="Removed media"
                          className="rounded-lg max-h-32 object-cover border border-border opacity-60"
                        />
                      ) : entry.mediaType === "video" ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-lg px-3 py-2 w-fit">
                          <Video size={13} /> Video post
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-lg px-3 py-2 w-fit">
                          <ImageIcon size={13} /> Media attached
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Post #{entry.postId} · User notified of removal
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
