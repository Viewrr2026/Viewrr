import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Star, MapPin, Briefcase, Clock, MessageSquare, Bookmark, BookmarkCheck, Instagram, Linkedin, ChevronLeft, Video, UserPlus, UserCheck, Users, Play } from "lucide-react";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/AuthProvider";
import { displayRole, roleBadgeClass } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { connectionCount } from "@/lib/storage";
import AccreditationBadge, { type AccreditationLevel } from "@/components/accreditation/AccreditationBadge";

type ConnStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected';

interface ProfileData {
  profile: any;
  user: any;
  reviews: any[];
  isClientStub?: boolean;
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={size}
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
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState<{ url: string; title: string } | null>(null);
  const profileIdNum = Number(id);
  const [connStatus, setConnStatus] = useState<ConnStatus>('none');
  const [connRequestId, setConnRequestId] = useState<number | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  const connCount = connectionCount(profileIdNum);

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

  useEffect(() => {
    if (!user || !data?.user?.id || user.id === data.user.id) return;
    apiRequest("GET", `/api/connections/status?userA=${user.id}&userB=${data.user.id}`)
      .then(r => r.json())
      .then(res => {
        if (res.status === 'accepted') setConnStatus('connected');
        else if (res.status === 'pending') {
          setConnStatus(res.senderId === user.id ? 'pending_sent' : 'pending_received');
          setConnRequestId(res.requestId);
        } else setConnStatus('none');
      })
      .catch(() => {});
  }, [user?.id, data?.user?.id]);

  async function handleConnect() {
    if (!user) { toast({ title: "Sign in to connect" }); return; }
    if (connLoading) return;
    const targetUserId = data?.user?.id;
    if (!targetUserId) return;
    setConnLoading(true);
    try {
      if (connStatus === 'connected') {
        await apiRequest("DELETE", "/api/connections", { userA: user.id, userB: targetUserId });
        setConnStatus('none');
        setConnRequestId(null);
        toast({ title: `Disconnected from ${data?.user.name}` });
      } else if (connStatus === 'pending_sent') {
        toast({ title: "Request pending", description: `Waiting for ${data?.user.name} to accept` });
      } else if (connStatus === 'pending_received') {
        await apiRequest("POST", "/api/connections/respond", {
          requestId: connRequestId,
          responderId: user.id,
          senderId: targetUserId,
          status: 'accepted',
        });
        setConnStatus('connected');
        toast({ title: `Connected with ${data?.user.name}` });
      } else {
        const res = await apiRequest("POST", "/api/connections/request", {
          senderId: user.id,
          recipientId: targetUserId,
        });
        const d = await res.json();
        setConnStatus('pending_sent');
        setConnRequestId(d.id ?? null);
        toast({ title: `Connection request sent to ${data?.user.name}` });
      }
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setConnLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    fetch(`/api/profile-views/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerId: user?.id ?? null }),
    }).catch(() => {});
  }, [id]);

  const specialisms: string[] = data ? JSON.parse(data.profile.specialisms || "[]") : [];
  const skills: string[] = data ? JSON.parse(data.profile.skills || "[]") : [];
  const badges: string[] = data ? JSON.parse(data.profile.badges || "[]") : [];
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
    const res = await apiRequest("POST", "/api/saved/toggle", { clientId: user.id, profileId: Number(id) });
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
          <div className="grid lg:grid-cols-[260px,1fr] gap-8">
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

  const { profile, user: freelancer, reviews, isClientStub } = data;

  // ── Client stub ──────────────────────────────────────────────────────────────
  if (isClientStub) {
    const clientUser = freelancer;
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ChevronLeft size={16} /> Back
          </Link>

          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {clientUser.banner ? (
              <div className="h-28 w-full bg-cover bg-center" style={{ backgroundImage: `url(${clientUser.banner})` }} />
            ) : (
              <div className="h-20 w-full bg-gradient-to-r from-primary/20 via-primary/10 to-background" />
            )}
            <div className="px-6 pb-6 pt-4">
              <div className="flex items-end gap-4 -mt-12 mb-4">
                <Avatar className="w-20 h-20 ring-4 ring-card shadow-lg flex-shrink-0">
                  <AvatarImage src={clientUser.avatar || undefined} />
                  <AvatarFallback className="bg-primary text-white text-2xl">
                    {(clientUser.name || '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className={`mb-2 px-3 py-1 rounded-full text-xs font-semibold border ${roleBadgeClass(clientUser.role)}`}>
                  {displayRole(clientUser.role)}
                </span>
              </div>

              <h1 className="text-2xl font-bold">{clientUser.name}</h1>
              {clientUser.headline && (
                <p className="text-base text-foreground/80 mt-0.5">{clientUser.headline}</p>
              )}
              {clientUser.location && (
                <p className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                  <MapPin size={12} /> {clientUser.location}
                </p>
              )}
              {clientUser.bio && (
                <p className="mt-4 text-muted-foreground leading-relaxed">{clientUser.bio}</p>
              )}

              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-4">
                <Users size={13} /> {connCount} connections
              </div>

              <div className="flex gap-3 mt-5 flex-wrap">
                <Button
                  className="bg-primary hover:bg-primary/90 text-white gap-2"
                  onClick={() => setMsgOpen(true)}
                  data-testid="btn-message"
                >
                  <MessageSquare size={16} /> Send message
                </Button>
                <Button
                  variant="outline"
                  className={`gap-2 transition-all ${
                    connStatus === 'connected' ? "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10"
                    : connStatus === 'pending_sent' ? "border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400"
                    : connStatus === 'pending_received' ? "border-primary/50 text-primary bg-primary/5"
                    : ""
                  }`}
                  onClick={handleConnect}
                  disabled={connLoading}
                  data-testid="btn-connect"
                >
                  {connStatus === 'connected' ? <UserCheck size={16} className="text-primary" />
                   : connStatus === 'pending_sent' ? <Clock size={16} />
                   : <UserPlus size={16} />}
                  {connStatus === 'connected' ? "Connected"
                   : connStatus === 'pending_sent' ? "Pending"
                   : connStatus === 'pending_received' ? "Accept Request"
                   : "Connect"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Dialog open={msgOpen} onOpenChange={v => !v && setMsgOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Message {clientUser.name}</DialogTitle></DialogHeader>
            {!user ? (
              <p className="text-sm text-muted-foreground">Please sign in to send a message.</p>
            ) : (
              <form onSubmit={async e => {
                e.preventDefault();
                if (!msgText.trim()) return;
                try {
                  await apiRequest("POST", "/api/messages", { fromId: user.id, toId: clientUser.id, content: msgText });
                  toast({ title: "Message sent!" });
                  setMsgOpen(false); setMsgText("");
                } catch { toast({ title: "Failed to send", variant: "destructive" }); }
              }} className="space-y-4">
                <Textarea placeholder="Write a message..." value={msgText} onChange={e => setMsgText(e.target.value)} rows={4} required />
                <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-white">Send message</Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Portfolio items ──────────────────────────────────────────────────────────
  type VideoItem = { url: string; title: string; clientName?: string; thumbnail?: string };
  let videoItems: VideoItem[] = [];
  try { videoItems = JSON.parse(profile.portfolioItems || "[]"); } catch {}
  if (videoItems.length === 0 && profile.reelUrl) {
    videoItems = [{ url: profile.reelUrl, title: "Showreel" }];
  }
  const validVideos = videoItems.filter(v => v.url && parseVideoUrl(v.url));

  // ── Main freelancer profile ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-8">

        {/* Back */}
        <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ChevronLeft size={16} /> Back to marketplace
        </Link>

        {/* Main card */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="grid lg:grid-cols-[260px,1fr]">

            {/* ── Left sidebar ────────────────────────────────────────────── */}
            <div className="border-r border-border p-6 flex flex-col gap-6">

              {/* Avatar */}
              <div className="flex flex-col items-center gap-3 pt-2">
                <Avatar className="w-32 h-32 ring-4 ring-card shadow-lg">
                  <AvatarImage src={freelancer.avatar || undefined} />
                  <AvatarFallback className="bg-primary text-white text-3xl">
                    {(freelancer.name || '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {/* Accreditation badge (sidebar — visible mobile and desktop) */}
                {profile.accreditationLevel && (
                  <AccreditationBadge
                    level={(profile.accreditationLevel as AccreditationLevel)}
                    variant="badge"
                  />
                )}
                {/* Availability */}
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${availClass[profile.availability]}`}>
                  {availLabel[profile.availability]}
                </span>
              </div>

              {/* Skills & Tools */}
              {skills.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2.5 text-foreground">Skills &amp; Tools</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map(s => (
                      <span key={s} className="text-xs bg-secondary text-secondary-foreground px-2.5 py-1 rounded-full border border-border">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Badges */}
              {badges.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2.5 text-foreground">Badges</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {badges.map(b => (
                      <span key={b} className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Experience */}
              {profile.yearsExperience && (
                <div>
                  <h3 className="text-sm font-semibold mb-1.5 text-foreground">Experience</h3>
                  <p className="text-sm text-muted-foreground">{profile.yearsExperience}+ years</p>
                  {specialisms.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Specialising in {specialisms.slice(0, 2).join(' / ')}
                    </p>
                  )}
                </div>
              )}

              {/* Pricing */}
              {(profile.dayRate || profile.hourlyRate) && (
                <div>
                  <h3 className="text-sm font-semibold mb-1.5 text-foreground">Rates</h3>
                  {profile.dayRate && (
                    <p className="text-sm text-muted-foreground">
                      <span className="text-foreground font-semibold">£{profile.dayRate}</span> / day
                    </p>
                  )}
                  {profile.hourlyRate && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      <span className="text-foreground font-medium">£{profile.hourlyRate}</span> / hour
                    </p>
                  )}
                </div>
              )}

              {/* Social links */}
              {Object.keys(socialLinks).length > 0 && (
                <div className="flex gap-3">
                  {socialLinks.instagram && (
                    <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                      <Instagram size={18} />
                    </a>
                  )}
                  {socialLinks.linkedin && (
                    <a href={socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                      <Linkedin size={18} />
                    </a>
                  )}
                </div>
              )}

              {/* Recent Reviews */}
              {reviews.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-foreground">Recent Reviews</h3>
                  <div className="space-y-3">
                    {reviews.slice(0, 3).map((r: any) => (
                      <div key={r.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <img
                            src={r.clientAvatar || `https://i.pravatar.cc/32?u=${r.clientName}`}
                            alt={r.clientName}
                            className="w-6 h-6 rounded-full flex-shrink-0"
                          />
                          <span className="text-xs font-semibold truncate">{r.clientName}</span>
                          <Stars rating={r.rating} size={11} />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                          "{r.comment}"
                        </p>
                      </div>
                    ))}
                    {reviews.length > 3 && (
                      <button
                        onClick={() => setReviewsOpen(true)}
                        className="text-xs text-primary hover:underline mt-1"
                      >
                        View all {reviews.length} reviews
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right main content ────────────────────────────────────── */}
            <div className="p-6 lg:p-8 space-y-6">

              {/* Header row: name/headline/meta + CTA buttons */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold leading-tight">{freelancer.name}</h1>
                    <AccreditationBadge level={(profile.accreditationLevel as AccreditationLevel) ?? null} variant="badge" />
                  </div>
                  {(freelancer as any).headline && (
                    <p className="text-base text-foreground/70 font-normal mt-0.5 leading-snug">
                      {(freelancer as any).headline}
                    </p>
                  )}

                  {/* Specialism pills */}
                  {specialisms.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {specialisms.map(s => (
                        <span key={s} className="text-xs bg-secondary text-secondary-foreground border border-border font-medium px-2.5 py-1 rounded-full">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
                    <button
                      onClick={() => reviews.length > 0 && setReviewsOpen(true)}
                      className={`flex items-center gap-1.5 ${reviews.length > 0 ? 'cursor-pointer hover:opacity-75 transition-opacity' : 'cursor-default'}`}
                    >
                      <Stars rating={profile.rating || 0} />
                      <span className="text-sm font-bold">{(profile.rating || 0).toFixed(1)} / 5.0</span>
                      <span className="text-sm text-muted-foreground">· {profile.reviewCount} Reviews</span>
                    </button>
                    {freelancer.location && (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin size={13} /> {freelancer.location}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Users size={13} /> {connCount} connections
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <Button
                    className="bg-primary hover:bg-primary/90 text-white gap-2 px-6"
                    onClick={() => setMsgOpen(true)}
                    data-testid="btn-message"
                  >
                    <MessageSquare size={16} />
                    Message
                  </Button>
                  <Button
                    variant="outline"
                    className={`gap-2 transition-all ${
                      connStatus === 'connected' ? "border-primary/40 text-primary bg-primary/5 hover:bg-primary/10"
                      : connStatus === 'pending_sent' ? "border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400"
                      : connStatus === 'pending_received' ? "border-primary/50 text-primary bg-primary/5"
                      : ""
                    }`}
                    onClick={handleConnect}
                    disabled={connLoading}
                    data-testid="btn-connect"
                  >
                    {connStatus === 'connected' ? <UserCheck size={16} className="text-primary" />
                     : connStatus === 'pending_sent' ? <Clock size={16} />
                     : <UserPlus size={16} />}
                    {connStatus === 'connected' ? "Connected"
                     : connStatus === 'pending_sent' ? "Pending"
                     : connStatus === 'pending_received' ? "Accept Request"
                     : "Connect"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-muted-foreground hover:text-foreground"
                    onClick={toggleSave}
                    data-testid="btn-save-profile"
                  >
                    {isSaved ? <BookmarkCheck size={15} className="text-primary" /> : <Bookmark size={15} />}
                    {isSaved ? "Saved" : "Save"}
                  </Button>
                </div>
              </div>

              {/* Bio */}
              {freelancer.bio && (
                <p className="text-sm text-muted-foreground leading-relaxed">{freelancer.bio}</p>
              )}

              {/* Portfolio grid */}
              <div>
                <h2 className="text-base font-semibold mb-4">Portfolio</h2>
                {validVideos.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
                    <Video size={32} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No portfolio videos yet</p>
                    {/* Show CTA only to the profile owner */}
                    {user && user.id === freelancer.id ? (
                      <>
                        <p className="text-xs mt-1 mb-4">Add your Vimeo or YouTube links to showcase your work</p>
                        <a
                          href="/#/dashboard"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors bg-primary/10 px-4 py-2 rounded-full"
                        >
                          Add portfolio videos →
                        </a>
                      </>
                    ) : (
                      <p className="text-xs mt-1">This freelancer hasn't added their portfolio yet</p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {validVideos.map((v, i) => {
                      const parsed = parseVideoUrl(v.url);
                      // Build thumbnail: Vimeo or YouTube
                      let thumb: string | null = null;
                      // Use built-in thumbnailUrl from parseVideoUrl
                      if (parsed?.thumbnailUrl) {
                        thumb = parsed.thumbnailUrl;
                      }
                      return (
                        <button
                          key={i}
                          onClick={() => setActiveVideo(v)}
                          className="group relative rounded-xl overflow-hidden bg-secondary aspect-video text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          data-testid={`portfolio-item-${i}`}
                        >
                          {thumb ? (
                            <img src={thumb} alt={v.title || `Portfolio item ${i + 1}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-background" />
                          )}
                          {/* Play overlay */}
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                              <Play size={16} className="text-primary fill-primary ml-0.5" />
                            </div>
                          </div>
                          {/* Always-visible play icon */}
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center group-hover:opacity-0 transition-opacity">
                              <Play size={14} className="text-white fill-white ml-0.5" />
                            </div>
                          </div>
                          {/* Title overlay at bottom */}
                          {(v.title || v.clientName) && (
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
                              {v.title && <p className="text-white text-xs font-semibold truncate">{v.title}</p>}
                              {v.clientName && <p className="text-white/70 text-[10px] truncate">Client: {v.clientName}</p>}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Reviews section (inline, below portfolio) */}
              {reviews.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold">Reviews</h2>
                    {reviews.length > 2 && (
                      <button onClick={() => setReviewsOpen(true)} className="text-xs text-primary hover:underline">
                        View all {reviews.length}
                      </button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {reviews.slice(0, 4).map((r: any) => (
                      <div key={r.id} className="bg-secondary/40 border border-border rounded-xl p-4">
                        <div className="flex items-center gap-2.5 mb-2">
                          <img
                            src={r.clientAvatar || `https://i.pravatar.cc/40?u=${r.clientName}`}
                            alt={r.clientName}
                            className="w-8 h-8 rounded-full flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-xs truncate">{r.clientName}</p>
                            {r.projectType && <p className="text-xs text-muted-foreground truncate">{r.projectType}</p>}
                          </div>
                          <Stars rating={r.rating} size={12} />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">"{r.comment}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

      {/* Video lightbox */}
      <Dialog open={!!activeVideo} onOpenChange={v => !v && setActiveVideo(null)}>
        <DialogContent className="sm:max-w-3xl p-2">
          {activeVideo && (
            <div className="space-y-2">
              {activeVideo.title && (
                <p className="text-sm font-semibold px-2 pt-1">{activeVideo.title}</p>
              )}
              <div className="aspect-video rounded-lg overflow-hidden">
                <VideoEmbed url={activeVideo.url} className="rounded-lg" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reviews modal */}
      <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stars rating={profile.rating || 0} />
              <span>{(profile.rating || 0).toFixed(1)}</span>
              <span className="text-muted-foreground font-normal text-sm">· {reviews.length} reviews</span>
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 space-y-4 pr-1 mt-2">
            {reviews.map((r: any) => (
              <div key={r.id} className="bg-secondary/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <img
                      src={r.clientAvatar || `https://i.pravatar.cc/40?u=${r.clientName}`}
                      alt={r.clientName}
                      className="w-8 h-8 rounded-full"
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
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
