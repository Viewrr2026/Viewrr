/**
 * ProfilePreviewModal
 * Shows a freelancer a read-only preview of exactly how others see them —
 * both the browse-talent card and the full public profile page.
 * Uses data already in memory; no extra API calls.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl } from "@/lib/videoEmbed";
import {
  Star, MapPin, Briefcase, Clock, Bookmark, UserPlus,
  Video, Camera, Scissors, Megaphone, Crown,
  Eye,
} from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────
const SPECIALISM_ICONS: Record<string, typeof Video> = {
  Videographer: Video,
  "Video Editor": Scissors,
  Photographer: Camera,
  Marketer: Megaphone,
};

const AVAIL_LABEL: Record<string, string> = {
  available: "Available",
  limited: "Limited",
  busy: "Busy",
  open_to_offers: "Open to offers",
  unavailable: "Not available",
};
const AVAIL_CLASS: Record<string, string> = {
  available: "badge-available",
  limited: "badge-busy",
  busy: "badge-busy",
  open_to_offers: "badge-available",
  unavailable: "badge-unavail",
};

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={13}
          className={i <= Math.round(rating) ? "star-filled fill-current" : "star-empty"}
        />
      ))}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface PreviewProps {
  open: boolean;
  onClose: () => void;
  user: {
    name: string;
    avatar?: string | null;
    banner?: string | null;
    headline?: string | null;
    bio?: string | null;
    location?: string | null;
  };
  profile: {
    availability: string;
    specialisms?: string;
    skills?: string;
    badges?: string;
    portfolioItems?: string;
    reelUrl?: string | null;
    cardThumbnail?: string | null;
    yearsExperience?: number | null;
    hourlyRate?: number | null;
    dayRate?: number | null;
    rating?: number | null;
    reviewCount?: number | null;
    projectCount?: number | null;
    isPro?: number | null;
  };
}

// ── Card preview — exactly mirrors FreelancerCard visuals ─────────────────────
function CardPreview({ user, profile }: Omit<PreviewProps, "open" | "onClose">) {
  const specialisms: string[] = (() => { try { return JSON.parse(profile.specialisms || "[]"); } catch { return []; } })();
  const skills: string[] = (() => { try { return JSON.parse(profile.skills || "[]"); } catch { return []; } })();
  const badges: string[] = (() => { try { return JSON.parse(profile.badges || "[]"); } catch { return []; } })();
  const portfolioItems: any[] = (() => { try { return JSON.parse(profile.portfolioItems || "[]"); } catch { return []; } })();

  const specialism = specialisms[0] || "Creative";
  const Icon = SPECIALISM_ICONS[specialism] || Video;

  return (
    <div className="flex justify-center py-4">
      <div className="w-72 bg-card border border-border rounded-2xl overflow-hidden shadow-lg">
        {/* Portfolio thumbnail strip */}
        <div className="relative h-44 overflow-hidden bg-muted">
          {(() => {
            const thumb = profile.cardThumbnail || portfolioItems[0]?.thumbnail || null;
            return thumb ? (
              <img
                src={thumb}
                alt={portfolioItems[0]?.title || "Portfolio"}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                <Icon size={36} className="text-muted-foreground/40" />
              </div>
            );
          })()}

          {/* Specialism pill */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-full px-2.5 py-1 text-xs font-semibold">
            <Icon size={11} className="text-primary" />
            {specialism}
          </div>

          {/* Pro badge */}
          {profile.isPro === 1 && (
            <div
              className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: "linear-gradient(135deg, #FF5A1F, #FFA500)", color: "#fff", boxShadow: "0 2px 8px #FF5A1F55" }}
            >
              <Crown size={10} /> Pro
            </div>
          )}

          {/* Bookmark (non-functional — visual only) */}
          <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-background/90 backdrop-blur-sm flex items-center justify-center text-muted-foreground">
            <Bookmark size={14} />
          </div>
        </div>

        {/* Card body */}
        <div className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="relative flex-shrink-0">
              <Avatar className="w-10 h-10 ring-2 ring-background">
                <AvatarImage src={user.avatar || undefined} />
                <AvatarFallback className="bg-primary text-white text-xs">
                  {user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {profile.isPro === 1 && (
                <div
                  className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #FF5A1F, #FFA500)", boxShadow: "0 1px 6px #FF5A1F66" }}
                >
                  <Crown size={10} color="#fff" strokeWidth={2.5} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm truncate">{user.name}</h3>
              {user.location && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <MapPin size={10} /> {user.location}
                </p>
              )}
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${AVAIL_CLASS[profile.availability] || "badge-available"}`}>
              {AVAIL_LABEL[profile.availability] || "Available"}
            </span>
          </div>

          {/* Rating */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              <Star size={13} className="star-filled fill-current" />
              <span className="text-sm font-semibold">{(profile.rating || 0).toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({profile.reviewCount || 0})</span>
            </div>
            <span className="text-xs text-muted-foreground">{profile.projectCount || 0} projects</span>
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {skills.slice(0, 3).map(s => (
                <Badge key={s} variant="secondary" className="text-xs rounded-full px-2 py-0.5">{s}</Badge>
              ))}
            </div>
          )}

          {/* Badges */}
          {badges.length > 0 && (
            <div className="flex gap-1.5 mb-3">
              {badges.map(b => (
                <span key={b} className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">{b}</span>
              ))}
            </div>
          )}

          {/* Rate + CTA */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <div>
              {profile.dayRate ? (
                <span className="font-bold text-sm">
                  £{profile.dayRate}<span className="text-xs font-normal text-muted-foreground">/day</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Rate not set</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-primary font-semibold">View profile →</span>
              <div className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border border-border text-muted-foreground">
                <UserPlus size={11} /> Connect
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Full profile preview — mirrors ProfilePage layout inline ──────────────────
function FullProfilePreview({ user, profile }: Omit<PreviewProps, "open" | "onClose">) {
  const specialisms: string[] = (() => { try { return JSON.parse(profile.specialisms || "[]"); } catch { return []; } })();
  const skills: string[] = (() => { try { return JSON.parse(profile.skills || "[]"); } catch { return []; } })();
  const badges: string[] = (() => { try { return JSON.parse(profile.badges || "[]"); } catch { return []; } })();

  type VideoItem = { url: string; title: string };
  const videoItems: VideoItem[] = (() => {
    try { return JSON.parse(profile.portfolioItems || "[]"); } catch { return []; }
  })();
  const validVideos = videoItems.filter(v => v.url && parseVideoUrl(v.url));
  if (validVideos.length === 0 && profile.reelUrl && parseVideoUrl(profile.reelUrl)) {
    validVideos.push({ url: profile.reelUrl, title: "" });
  }

  return (
    <div className="space-y-5 pb-2">
      {/* Profile header card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Banner */}
        {user.banner ? (
          <div className="h-28 w-full bg-cover bg-center" style={{ backgroundImage: `url(${user.banner})` }} />
        ) : (
          <div className="h-20 w-full bg-gradient-to-r from-primary/20 via-primary/10 to-background" />
        )}

        <div className="p-5 pt-4">
          {/* Avatar + availability */}
          <div className="flex items-end gap-4 -mt-12 mb-4">
            <Avatar className="w-16 h-16 flex-shrink-0 ring-4 ring-card shadow-lg">
              <AvatarImage src={user.avatar || undefined} />
              <AvatarFallback className="bg-primary text-white text-xl">
                {user.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="ml-auto pb-1">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${AVAIL_CLASS[profile.availability] || "badge-available"}`}>
                {AVAIL_LABEL[profile.availability] || "Available"}
              </span>
            </div>
          </div>

          {/* Name / headline / location */}
          <h1 className="text-xl font-bold leading-tight">{user.name}</h1>
          {user.headline && (
            <p className="text-sm text-foreground/80 font-normal mt-0.5">{user.headline}</p>
          )}
          {user.location && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <MapPin size={11} /> {user.location}
            </p>
          )}

          {/* Specialisms */}
          {specialisms.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {specialisms.map(s => (
                <span key={s} className="text-xs bg-primary/10 text-primary font-semibold px-2.5 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="flex flex-wrap gap-4 mt-4">
            <div className="flex items-center gap-1.5">
              <Stars rating={profile.rating || 0} />
              <span className="font-bold text-sm">{(profile.rating || 0).toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({profile.reviewCount || 0} reviews)</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Briefcase size={12} /> {profile.projectCount || 0} projects
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock size={12} /> {profile.yearsExperience ?? 0} yrs experience
            </div>
          </div>

          {/* Badges */}
          {badges.length > 0 && (
            <div className="flex gap-2 mt-3">
              {badges.map(b => (
                <span key={b} className="text-xs bg-primary/10 text-primary rounded-full px-2.5 py-0.5 font-medium">{b}</span>
              ))}
            </div>
          )}

          {/* Bio */}
          {user.bio && (
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{user.bio}</p>
          )}
        </div>
      </div>

      {/* Pricing sidebar card (collapsed into a row here) */}
      <div className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          {profile.dayRate ? (
            <span className="text-xl font-bold">£{profile.dayRate}<span className="text-xs font-normal text-muted-foreground ml-1">/day</span></span>
          ) : (
            <span className="text-sm text-muted-foreground">Rate not set</span>
          )}
          {profile.hourlyRate && (
            <span className="text-xs text-muted-foreground">£{profile.hourlyRate}/hr</span>
          )}
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold opacity-60 cursor-default select-none">
            Message
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-muted-foreground cursor-default select-none">
            <UserPlus size={11} /> Connect
          </div>
        </div>
      </div>

      {/* Portfolio */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1">Portfolio</p>
        {validVideos.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <Video size={28} className="opacity-30" />
            <p className="text-sm">No portfolio videos yet</p>
            <p className="text-xs opacity-60">Add Vimeo or YouTube links from the Portfolio section</p>
          </div>
        ) : (
          <div className="space-y-4">
            {validVideos.map((v, i) => (
              <div key={i} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                  {v.title || (i === 0 ? "Featured" : `Video ${i + 1}`)}
                  {i === 0 && v.title ? " · Featured" : ""}
                </p>
                <VideoEmbed url={v.url} className="rounded-2xl" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Skills &amp; equipment</p>
          <div className="flex flex-wrap gap-2">
            {skills.map(s => (
              <Badge key={s} variant="secondary" className="rounded-full px-3 py-1 text-xs">{s}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function ProfilePreviewModal({ open, onClose, user, profile }: PreviewProps) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 flex-shrink-0 border-b border-border">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-primary" />
            <DialogTitle className="text-base font-bold">Profile preview</DialogTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            This is exactly how other users see you on Viewrr.
          </p>
        </DialogHeader>

        <Tabs defaultValue="card" className="flex flex-col flex-1 min-h-0">
          <TabsList className="mx-5 mt-4 mb-0 flex-shrink-0">
            <TabsTrigger value="card" className="flex-1">Browse card</TabsTrigger>
            <TabsTrigger value="profile" className="flex-1">Full profile</TabsTrigger>
          </TabsList>

          <TabsContent value="card" className="flex-1 overflow-y-auto mt-0 px-5 pb-5 pt-2">
            <p className="text-xs text-muted-foreground text-center mb-4 mt-2">
              Shown on Browse Talent and in connection request previews
            </p>
            <CardPreview user={user} profile={profile} />
          </TabsContent>

          <TabsContent value="profile" className="flex-1 overflow-y-auto mt-0 px-5 pb-5 pt-4">
            <FullProfilePreview user={user} profile={profile} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
