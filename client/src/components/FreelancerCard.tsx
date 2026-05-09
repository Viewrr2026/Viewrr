import { Link } from "wouter";
import { Star, MapPin, Bookmark, BookmarkCheck, Video, Camera, Megaphone, Scissors, Crown, UserPlus, UserCheck, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { ProfileWithUser } from "../../server/storage";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "./AuthProvider";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

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

// Connection status: 'none' | 'pending_sent' | 'pending_received' | 'connected'
type ConnStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected';

export default function FreelancerCard({ pw, savedInit = false }: { pw: ProfileWithUser; savedInit?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSaved, setIsSaved] = useState(savedInit);
  const [connStatus, setConnStatus] = useState<ConnStatus>('none');
  const [requestId, setRequestId] = useState<number | null>(null);
  const [connLoading, setConnLoading] = useState(false);

  // Load connection status from server
  useEffect(() => {
    if (!user || user.id === pw.user.id) return;
    apiRequest("GET", `/api/connections/status?userA=${user.id}&userB=${pw.user.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'accepted') {
          setConnStatus('connected');
        } else if (data.status === 'pending') {
          setConnStatus(data.senderId === user.id ? 'pending_sent' : 'pending_received');
          setRequestId(data.requestId);
        } else {
          setConnStatus('none');
        }
      })
      .catch(() => {});
  }, [user?.id, pw.user.id]);

  async function handleConnect(e: React.MouseEvent) {
    e.preventDefault();
    if (!user) { toast({ title: "Sign in to connect with creatives" }); return; }
    if (connLoading) return;
    setConnLoading(true);
    try {
      if (connStatus === 'connected') {
        // Remove connection
        await apiRequest("DELETE", "/api/connections", { userA: user.id, userB: pw.user.id });
        setConnStatus('none');
        setRequestId(null);
        toast({ title: `Disconnected from ${pw.user.name}` });
      } else if (connStatus === 'pending_sent') {
        // Can't unsend yet — just inform
        toast({ title: "Connection request pending", description: `Waiting for ${pw.user.name} to accept` });
      } else if (connStatus === 'pending_received') {
        // Accept the incoming request
        await apiRequest("POST", "/api/connections/respond", {
          requestId,
          responderId: user.id,
          senderId: pw.user.id,
          status: 'accepted',
        });
        setConnStatus('connected');
        toast({ title: `Connected with ${pw.user.name}` });
      } else {
        // Send new request
        const res = await apiRequest("POST", "/api/connections/request", {
          senderId: user.id,
          recipientId: pw.user.id,
        });
        const data = await res.json();
        setConnStatus('pending_sent');
        setRequestId(data.id ?? null);
        toast({ title: `Connection request sent to ${pw.user.name}` });
      }
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setConnLoading(false);
    }
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

  // Button appearance based on status
  function ConnectButton() {
    if (!user || user.id === pw.user.id) return null;

    const configs: Record<ConnStatus, { icon: React.ReactNode; label: string; cls: string }> = {
      none: {
        icon: <UserPlus size={11} />,
        label: "Connect",
        cls: "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
      },
      pending_sent: {
        icon: <Clock size={11} />,
        label: "Pending",
        cls: "bg-amber-50 text-amber-600 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700",
      },
      pending_received: {
        icon: <UserCheck size={11} />,
        label: "Accept",
        cls: "bg-primary/10 text-primary border-primary/50 hover:bg-primary/20",
      },
      connected: {
        icon: <UserCheck size={11} />,
        label: "Connected",
        cls: "bg-primary/10 text-primary border-primary/30 hover:bg-red-50 hover:text-red-500 hover:border-red-300",
      },
    };

    const cfg = configs[connStatus];
    return (
      <button
        onClick={handleConnect}
        disabled={connLoading}
        className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-all ${cfg.cls}`}
      >
        {cfg.icon}
        {cfg.label}
      </button>
    );
  }

  return (
    <div className="relative">
      <Link href={`/profile/${pw.profile.id}`} data-testid={`card-freelancer-${pw.profile.id}`}>
        <div className="group bg-card border border-border rounded-2xl overflow-hidden card-lift cursor-pointer">
          {/* Portfolio preview strip */}
          <div className="relative h-44 overflow-hidden bg-muted">
            {(() => {
              const thumb = (pw.profile as any).cardThumbnail || (portfolioItems[0]?.thumbnail) || null;
              return thumb ? (
                <img
                  src={thumb}
                  alt={portfolioItems[0]?.title || pw.user.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <Icon size={32} className="text-muted-foreground" />
                </div>
              );
            })()}

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
              <div className="flex items-center gap-2">
                <span className="text-xs text-primary font-semibold group-hover:underline">View profile →</span>
                <ConnectButton />
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
