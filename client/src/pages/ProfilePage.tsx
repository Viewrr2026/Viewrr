import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Star, MapPin, Briefcase, Clock, ExternalLink, MessageSquare, Bookmark, BookmarkCheck, Instagram, Linkedin, ChevronLeft, Video, UserPlus, UserCheck, Users } from "lucide-react";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { apiRequest as api } from "@/lib/queryClient";
import { isConnected, toggleConnection, connectionCount } from "@/lib/storage";

interface ProfileData {
  profile: any;
  user: any;
  reviews: any[];
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={14}
          className={i <= Math.round(rating) ? "star-filled fill-current" : "star-empty"}
        />
      ))}
    </div>
  );
}

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const profileIdNum = Number(id);
  const [connected, setConnected] = useState(() => isConnected(profileIdNum));
  const [connCount, setConnCount] = useState(() => connectionCount(profileIdNum));

  function handleConnect() {
    if (!user) { toast({ title: "Sign in to connect" }); return; }
    const now = toggleConnection(profileIdNum);
    setConnected(now);
    setConnCount(connectionCount(profileIdNum));
    toast({ title: now ? `You're now connected with ${data?.user.name}` : `Disconnected from ${data?.user.name}` });
  }

  // Fire a profile view as soon as the page loads (once per mount)
  useEffect(() => {
    if (!id) return;
    fetch(`/api/profile-views/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerId: user?.id ?? null }),
    }).catch(() => {}); // silent — never block the page
  }, [id]);

  const { data, isLoading, isError } = useQuery<ProfileData>({
    queryKey: ["/api/profiles", id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/profiles/${id}`);
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
  });

  const specialisms: string[] = data ? JSON.parse(data.profile.specialisms || "[]") : [];
  const skills: string[] = data ? JSON.parse(data.profile.skills || "[]") : [];
  const badges: string[] = data ? JSON.parse(data.profile.badges || "[]") : [];
  const portfolio: any[] = data ? JSON.parse(data.profile.portfolioItems || "[]") : [];
  const socialLinks: Record<string, string> = data ? JSON.parse(data.profile.socialLinks || "{}") : {};

  const availClass: Record<string, string> = {
    available: "badge-available",
    busy: "badge-busy",
    unavailable: "badge-unavail",
  };
  const availLabel: Record<string, string> = {
    available: "Available for work",
    busy: "Currently busy",
    unavailable: "Not available",
  };

  async function toggleSave() {
    if (!user) { toast({ title: "Sign in to save creatives" }); return; }
    const res = await api("POST", "/api/saved/toggle", { clientId: user.id, profileId: Number(id) });
    const d = await res.json();
    setIsSaved(d.saved);
    toast({ title: d.saved ? "Saved to your list" : "Removed from saved" });
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !msgText.trim()) return;
    try {
      await apiRequest("POST", "/api/messages", { fromId: user.id, toId: data?.user.id, content: msgText });
      toast({ title: "Message sent!" });
      setMsgOpen(false);
      setMsgText("");
    } catch {
      toast({ title: "Failed to send message", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="h-8 w-48 skeleton rounded mb-8" />
          <div className="grid lg:grid-cols-[2fr,1fr] gap-8">
            <div className="space-y-4">
              <div className="h-64 skeleton rounded-2xl" />
              <div className="h-40 skeleton rounded-2xl" />
            </div>
            <div className="h-80 skeleton rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!data || isError) return (
    <div className="min-h-screen bg-background">
      <div className="p-20 text-center text-muted-foreground">
        <p className="text-lg font-semibold mb-2">Profile not found</p>
        <Link href="/marketplace" className="text-primary underline text-sm">Back to marketplace</Link>
      </div>
    </div>
  );

  const { profile, user: freelancer, reviews } = data;

  return (
    <div className="min-h-screen bg-background">

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Back */}
        <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ChevronLeft size={16} /> Back to marketplace
        </Link>

        <div className="grid lg:grid-cols-[1fr,320px] gap-8">
          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="space-y-6">
            {/* Profile header card */}
            <div className="bg-card border border-border rounded-2xl p-6 md:p-8">
              <div className="flex items-start gap-5">
                <Avatar className="w-20 h-20 flex-shrink-0 ring-4 ring-background shadow-lg">
                  <AvatarImage src={freelancer.avatar || undefined} />
                  <AvatarFallback className="bg-primary text-white text-2xl">
                    {(freelancer.name || '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h1 className="text-2xl font-bold">{freelancer.name}</h1>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {specialisms.map(s => (
                          <span key={s} className="text-sm text-primary font-semibold">{s}</span>
                        ))}
                        {freelancer.location && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin size={12} /> {freelancer.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${availClass[profile.availability]}`}>
                      {availLabel[profile.availability]}
                    </span>
                  </div>

                  {/* Stats row */}
                  <div className="flex flex-wrap gap-4 mt-4">
                    <div className="flex items-center gap-1.5">
                      <Stars rating={profile.rating || 0} />
                      <span className="font-bold">{(profile.rating || 0).toFixed(1)}</span>
                      <span className="text-sm text-muted-foreground">({profile.reviewCount} reviews)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Briefcase size={13} />
                      {profile.projectCount} projects
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock size={13} />
                      {profile.yearsExperience} yrs experience
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users size={13} />
                      {connCount} connections
                    </div>
                  </div>

                  {/* Badges */}
                  {badges.length > 0 && (
                    <div className="flex gap-2 mt-3">
                      {badges.map(b => (
                        <span key={b} className="text-xs bg-primary/10 text-primary rounded-full px-2.5 py-0.5 font-medium">
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Bio */}
              {freelancer.bio && (
                <p className="mt-5 text-muted-foreground leading-relaxed">{freelancer.bio}</p>
              )}

              {/* Social links */}
              {Object.keys(socialLinks).length > 0 && (
                <div className="flex gap-3 mt-4">
                  {socialLinks.instagram && (
                    <a href={socialLinks.instagram} className="text-muted-foreground hover:text-primary transition-colors">
                      <Instagram size={18} />
                    </a>
                  )}
                  {socialLinks.linkedin && (
                    <a href={socialLinks.linkedin} className="text-muted-foreground hover:text-primary transition-colors">
                      <Linkedin size={18} />
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="portfolio">
              <TabsList className="w-full">
                <TabsTrigger value="portfolio" className="flex-1">Portfolio</TabsTrigger>
                <TabsTrigger value="reviews" className="flex-1">Reviews ({reviews.length})</TabsTrigger>
                <TabsTrigger value="skills" className="flex-1">Skills</TabsTrigger>
              </TabsList>

              {/* Portfolio */}
              <TabsContent value="portfolio" className="mt-4 space-y-4">
                {profile.reelUrl && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Showreel</p>
                    {parseVideoUrl(profile.reelUrl) ? (
                      <VideoEmbed url={profile.reelUrl} className="rounded-2xl" />
                    ) : (
                      <div className="rounded-2xl overflow-hidden aspect-video bg-muted flex items-center justify-center text-muted-foreground text-sm">
                        <Video size={24} className="mr-2 opacity-40" /> Showreel unavailable
                      </div>
                    )}
                  </div>
                )}

                {portfolio.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {portfolio.map((item, i) => (
                      <div key={i} className="group relative aspect-video rounded-xl overflow-hidden bg-muted" data-testid={`portfolio-item-${i}`}>
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                        {item.type === "video" && (
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Play size={20} className="text-white" />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                          <p className="text-white text-xs font-medium">{item.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Video size={32} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No portfolio items yet</p>
                  </div>
                )}
              </TabsContent>

              {/* Reviews */}
              <TabsContent value="reviews" className="mt-4 space-y-4">
                {reviews.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">No reviews yet</div>
                ) : (
                  reviews.map((r: any) => (
                    <div key={r.id} className="bg-card border border-border rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={r.clientAvatar || `https://i.pravatar.cc/40?u=${r.clientName}`}
                            alt={r.clientName}
                            className="w-9 h-9 rounded-full"
                          />
                          <div>
                            <p className="font-semibold text-sm">{r.clientName}</p>
                            {r.projectType && <p className="text-xs text-muted-foreground">{r.projectType}</p>}
                          </div>
                        </div>
                        <Stars rating={r.rating} />
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">"{r.comment}"</p>
                    </div>
                  ))
                )}
              </TabsContent>

              {/* Skills */}
              <TabsContent value="skills" className="mt-4">
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="font-semibold mb-4">Core skills</h3>
                  <div className="flex flex-wrap gap-2">
                    {skills.map(s => (
                      <Badge key={s} variant="secondary" className="rounded-full px-3 py-1">{s}</Badge>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* ── Sidebar ──────────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Pricing card */}
            <div className="bg-card border border-border rounded-2xl p-6 sticky top-20">
              <div className="space-y-3 mb-5">
                {profile.dayRate && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">£{profile.dayRate}</span>
                    <span className="text-muted-foreground text-sm">/ day</span>
                  </div>
                )}
                {profile.hourlyRate && (
                  <p className="text-sm text-muted-foreground">£{profile.hourlyRate} per hour</p>
                )}
              </div>

              <div className="space-y-3">
                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-white gap-2"
                  onClick={() => setMsgOpen(true)}
                  data-testid="btn-message"
                >
                  <MessageSquare size={16} />
                  Send message
                </Button>
                <Button
                  variant="outline"
                  className={`w-full gap-2 transition-all ${
                    connected ? "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10" : ""
                  }`}
                  onClick={handleConnect}
                  data-testid="btn-connect"
                >
                  {connected ? <UserCheck size={16} className="text-primary" /> : <UserPlus size={16} />}
                  {connected ? "Connected" : "Connect"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={toggleSave}
                  data-testid="btn-save-profile"
                >
                  {isSaved ? <BookmarkCheck size={16} className="text-primary" /> : <Bookmark size={16} />}
                  {isSaved ? "Saved" : "Save"}
                </Button>
              </div>

              <div className="mt-5 pt-5 border-t border-border space-y-2.5 text-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Experience</span>
                  <span className="text-foreground font-medium">{profile.yearsExperience} years</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Connections</span>
                  <span className="text-foreground font-medium">{connCount}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Projects completed</span>
                  <span className="text-foreground font-medium">{profile.projectCount}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Rating</span>
                  <span className="text-foreground font-medium">{(profile.rating || 0).toFixed(1)} / 5.0</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Message dialog */}
      <Dialog open={msgOpen} onOpenChange={v => !v && setMsgOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Message {freelancer.name}</DialogTitle>
          </DialogHeader>
          {!user ? (
            <p className="text-sm text-muted-foreground">Please sign in to send a message.</p>
          ) : (
            <form onSubmit={sendMessage} className="space-y-4">
              <Textarea
                placeholder="Describe your project briefly..."
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                rows={4}
                required
                data-testid="input-message"
              />
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-white" data-testid="btn-send-message">
                Send message
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Reel dialog */}
      {profile.reelUrl && (
        <Dialog open={reelOpen} onOpenChange={v => !v && setReelOpen(false)}>
          <DialogContent className="sm:max-w-3xl p-2">
            <div className="aspect-video rounded-lg overflow-hidden">
              <iframe
                src={profile.reelUrl}
                className="w-full h-full"
                allow="autoplay; fullscreen"
                allowFullScreen
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
