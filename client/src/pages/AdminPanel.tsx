import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ShieldAlert, User, ImageIcon, Video } from "lucide-react";
import { useState } from "react";

interface PostWithUser {
  post: {
    id: number;
    userId: number;
    caption: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    tags: string;
    likesCount: number;
    createdAt: string;
  };
  user: {
    id: number;
    name: string;
    email: string;
    avatar: string | null;
    role: string;
  };
  liked: boolean;
}

export default function AdminPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const { data: posts = [], isLoading } = useQuery<PostWithUser[]>({
    queryKey: ["/api/admin/feed", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const res = await fetch(`/api/admin/feed?userId=${user.id}&limit=100`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!(user as any)?.isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: async (postId: number) => {
      const res = await fetch(`/api/admin/feed/${postId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user!.id }),
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      toast({ title: "Post removed", description: "The user has been notified." });
      setConfirmId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Could not remove post.", variant: "destructive" });
    },
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
            <h1 className="text-2xl font-bold">Admin — Content Moderation</h1>
            <p className="text-sm text-muted-foreground">Remove posts that violate community guidelines. The user will be notified.</p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="bg-card border border-border rounded-xl px-5 py-3 mb-6 flex items-center gap-4 text-sm text-muted-foreground">
          <span><span className="font-semibold text-foreground">{posts.length}</span> posts visible</span>
        </div>

        {/* Post list */}
        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">Loading posts…</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">No posts found.</div>
        ) : (
          <div className="space-y-3">
            {posts.map(({ post, user: author }) => (
              <div
                key={post.id}
                className="bg-card border border-border rounded-xl p-4 flex gap-4 items-start"
              >
                {/* Author avatar */}
                <div className="flex-shrink-0">
                  {author.avatar ? (
                    <img src={author.avatar} alt={author.name} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                      <User size={18} className="text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-sm">{author.name}</span>
                    <span className="text-xs text-muted-foreground">{author.email}</span>
                    <Badge variant="outline" className="text-xs capitalize">{author.role}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(post.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>

                  {post.caption && (
                    <p className="text-sm text-foreground mb-2 line-clamp-3">{post.caption}</p>
                  )}

                  {/* Media preview */}
                  {post.mediaUrl && (
                    <div className="mb-2">
                      {post.mediaType === "image" ? (
                        <img
                          src={post.mediaUrl}
                          alt="Post media"
                          className="rounded-lg max-h-40 object-cover border border-border"
                        />
                      ) : post.mediaType === "video" ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-lg px-3 py-2 w-fit">
                          <Video size={14} /> Video post
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary rounded-lg px-3 py-2 w-fit">
                          <ImageIcon size={14} /> Media attached
                        </div>
                      )}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    {post.likesCount} {post.likesCount === 1 ? "like" : "likes"}
                  </div>
                </div>

                {/* Delete button / confirm */}
                <div className="flex-shrink-0">
                  {confirmId === post.id ? (
                    <div className="flex flex-col gap-2 items-end">
                      <span className="text-xs text-destructive font-medium">Remove this post?</span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="text-xs h-7"
                          onClick={() => deleteMutation.mutate(post.id)}
                          disabled={deleteMutation.isPending}
                        >
                          {deleteMutation.isPending ? "Removing…" : "Remove"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 w-8 p-0"
                      onClick={() => setConfirmId(post.id)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
