import { Link } from "wouter";
import { Star, MapPin, Bookmark, BookmarkCheck, Video, Camera, Megaphone, Scissors, Crown, Clock, PoundSterling, ExternalLink, UserPlus, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { ProfileWithUser } from "../../server/storage";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "./AuthProvider";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { isConnected, toggleConnection, connectionCount } from "@/lib/storage";

const SPECIALISM_ICONS: Record<string, typeof Video> = {
  "Videographer": Video,
  "Video Editor": Scissors,
  "Photographer": Camera,
  "Marketer": Megaphone,
};

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  busy: "Busy",
  unavailable: "Unavailable",
};

const AVAILABILITY_CLASSES: Record<string, string> = {
  available: "badge-available",
  busy: "badge-busy",
  unavailable: "badge-unavail",
};

function StarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      <Star size={13} className="star-filled fill-current" />
      <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
      <span className="text-xs text-muted-foreground">({count})</span>
    </div>
  );
}

export default function FreelancerCard({ pw, savedInit = false }: { pw: ProfileWithUser; savedInit?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSaved, setIsSaved] = useState(savedInit);
  const [connected, setConnected] = useState(() => isConnected(pw.profile.id));
  const [connCount, setConnCount] = useState(() => connectionCount(pw.profile.id));

  function handleConnect(e: React.MouseEvent) {
    e.preventDefault();
    if (!user) { toast({ title: "Sign in to connect with creatives" }); return; }
    const now = toggleConnection(pw.profile.id);
    setConnected(now);
    setConnCount(connectionCount(pw.profile.id));
    toast({ title: now ? `Connected with ${pw.user.name}` : `Disconnected from ${pw.user.name}` });
  }

  const specialisms: string[] = JSON.parse(pw.profile.specialisms || "[]");
  const skills: string[] = JSON.parse(pw.profile.skills || "[]");
  const badges: string[] = JSON.parse(pw.profile.badges || "[]");
  const portfolioItems: any[] = JSON.parse(pw.profile.portfolioItems || "[]");
  const specialism = specialisms[0] || "Creative";
  const Icon = SPECIALISM_ICONS[specialism] || Video;

  async function toggleSave(e: React.MouseEvent) {
    e.preventDefault();
    if (!user) { toast({ title: "Sign in to save creatives" }); return; }
    try {
      const res = await apiRequest("POST", "/api/saved/toggle", { clientId: user.id, profileId: pw.profile.id });
      const data = await res.json();
      setIsSaved(data.saved);
      toast({ title: data.saved ? "Saved to your list" : "Removed from saved" });
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    }
  }

  return (
    <div
      className="relative"

    >
      <Link href={`/profile/${pw.profile.id}`} data-testid={`card-freelancer-${pw.profile.id}`}>
        <div className="group bg-card border border-border rounded-2xl overflow-hidden card-lift cursor-pointer">
          {/* Portfolio preview strip */}
          <div className="relative h-44 overflow-hidden bg-muted">
            {portfolioItems.length > 0 ? (
              <img
                src={portfolioItems[0].thumbnail}
                alt={portfolioItems[0].title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-muted">
                <Icon size={32} className="text-muted-foreground" />
              </div>
            )}

            {/* Specialism pill */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-full px-2.5 py-1 text-xs font-semibold">
              <Icon size={11} className="text-primary" />
              {specialism}
            </div>

            {/* Pro Viewrr badge */}
            {pw.profile.isPro === 1 && (
              <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #FF5A1F, #FFA500)", color: "#fff", boxShadow: "0 2px 8px #FF5A1F55" }}
                data-testid={`badge-pro-${pw.profile.id}`}>
                <Crown size={10} />
                Pro
              </div>
            )}

            {/* Save button */}
            <button
              onClick={toggleSave}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-background/90 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
              data-testid={`btn-save-${pw.profile.id}`}
              aria-label={isSaved ? "Unsave" : "Save"}
            >
              {isSaved ? <BookmarkCheck size={14} className="text-primary" /> : <Bookmark size={14} />}
            </button>
          </div>

          {/* Content */}
          <div className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="relative flex-shrink-0">
                <Avatar className="w-10 h-10 ring-2 ring-background">
                  <AvatarImage src={pw.user.avatar || undefined} />
                  <AvatarFallback className="bg-primary text-white text-xs">
                    {pw.user.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {pw.profile.isPro === 1 && (
                  <div
                    className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, #FF5A1F, #FFA500)", boxShadow: "0 1px 6px #FF5A1F66" }}
                    data-testid={`crown-avatar-${pw.profile.id}`}
                  >
                    <Crown size={10} color="#fff" strokeWidth={2.5} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-sm truncate">{pw.user.name}</h3>
                {pw.user.location && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <MapPin size={10} /> {pw.user.location}
                  </p>
                )}
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${AVAILABILITY_CLASSES[pw.profile.availability]}`}>
                {AVAILABILITY_LABELS[pw.profile.availability]}
              </span>
            </div>

            {/* Rating + badges */}
            <div className="flex items-center justify-between mb-3">
              <StarRating rating={pw.profile.rating || 0} count={pw.profile.reviewCount || 0} />
              <span className="text-xs text-muted-foreground">{pw.profile.projectCount} projects</span>
            </div>

            {/* Skills */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {skills.slice(0, 3).map(s => (
                <Badge key={s} variant="secondary" className="text-xs rounded-full px-2 py-0.5">{s}</Badge>
              ))}
            </div>

            {/* Badges */}
            {badges.length > 0 && (
              <div className="flex gap-1.5 mb-3">
                {badges.map(b => (
                  <span key={b} className="text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">
                    {b}
                  </span>
                ))}
              </div>
            )}

            {/* Rate */}
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <div>
                {pw.profile.dayRate && (
                  <span className="font-bold text-sm">£{pw.profile.dayRate}<span className="text-xs font-normal text-muted-foreground">/day</span></span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-primary font-semibold group-hover:underline">View profile →</span>
                <button
                  onClick={handleConnect}
                  className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-all ${
                    connected
                      ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                  }`}
                >
                  {connected ? <UserCheck size={11} /> : <UserPlus size={11} />}
                  {connected ? "Connected" : "Connect"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Link>


    </div>
  );
}
