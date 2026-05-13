import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bookmark, MessageSquare, User, Send, Settings, LogOut, Star, TrendingUp, Briefcase, FileText, CheckCircle2, Clock, XCircle, ChevronRight, MapPin, Users, Film, CheckCircle, AlertCircle, LayoutGrid, Plus, Trash2, GripVertical, FolderOpen, ShieldAlert, Eye, Building2, Copy, Link as LinkIcon, PoundSterling, UserPlus, BarChart2, CalendarClock, GitBranch, Timer, Plane, Database, ExternalLink, ChevronDown, ChevronUp, Mail } from "lucide-react";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl, isValidVideoUrl } from "@/lib/videoEmbed";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import FreelancerCard from "@/components/FreelancerCard";
import InterestsPanel from "@/components/InterestsPanel";
import EditProfileModal from "@/components/EditProfileModal";
import ProfilePreviewModal from "@/components/ProfilePreviewModal";
import MeetingSection from "@/components/MeetingSection";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { connectionCount } from "@/lib/storage";

type ProfileWithUser = { profile: any; user: any };

// ── Stars rating component ────────────────────────────────────────────────────
function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={12}
          className={i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}
        />
      ))}
    </div>
  );
}

function NotLoggedIn() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-col items-center justify-center py-28 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
          <User size={28} className="text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Sign in to access your dashboard</h2>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Save creatives, manage messages, and track your projects all in one place.
        </p>
        <Button asChild className="bg-primary hover:bg-primary/90 text-white">
          <Link href="/">Go to home</Link>
        </Button>
      </div>
    </div>
  );
}

function MessageThread({ userId, otherId, otherName, otherAvatar }: { userId: number; otherId: number; otherName: string; otherAvatar?: string }) {
  const [text, setText] = useState("");
  
  const { data: messages = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/messages", userId, otherId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/messages/${otherId}/${userId}`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/messages", { fromId: userId, toId: otherId, content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", userId, otherId] });
      setText("");
    },
  });

  return (
    <div className="flex flex-col h-[480px]">
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Avatar className="w-8 h-8">
          <AvatarImage src={otherAvatar} />
          <AvatarFallback className="bg-primary text-white text-xs">{otherName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="font-semibold text-sm">{otherName}</span>
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="text-center text-muted-foreground text-sm py-4">Loading...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8">No messages yet. Say hello!</div>
        ) : (
          <div className="space-y-3">
            {messages.map((m: any) => (
              <div key={m.id} className={`flex flex-col ${m.fromId === userId ? "items-end" : "items-start"}`}>
                <div className={`max-w-xs px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                  ${m.fromId === userId
                    ? "bg-primary text-white rounded-tr-sm"
                    : "bg-secondary text-foreground rounded-tl-sm"
                  }`}>
                  {m.content}
                </div>
                {m.createdAt && (
                  <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                    {formatUK(m.createdAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <form
        onSubmit={e => { e.preventDefault(); if (text.trim()) sendMutation.mutate(text); }}
        className="flex gap-2 p-4 border-t border-border"
      >
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-full"
          data-testid="input-chat-message"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || sendMutation.isPending}
          className="rounded-full bg-primary hover:bg-primary/90 text-white flex-shrink-0"
          data-testid="btn-send-chat"
        >
          <Send size={15} />
        </Button>
      </form>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ukDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const ukTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatUK(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  // Within the last minute
  if (diffMins < 1) return "Just now";
  // Today — show time only
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (d >= todayStart) return `Today at ${ukTime.format(d)}`;
  // Yesterday
  const yStart = new Date(todayStart);
  yStart.setDate(yStart.getDate() - 1);
  if (d >= yStart) return `Yesterday at ${ukTime.format(d)}`;
  // Older — full date + time
  return ukDate.format(d);
}

function InterestStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    pending:  { label: "Pending",  icon: <Clock size={11} />,      cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    viewed:   { label: "Viewed",   icon: <CheckCircle2 size={11} />, cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
    accepted: { label: "Accepted", icon: <CheckCircle2 size={11} />, cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    declined: { label: "Declined", icon: <XCircle size={11} />,    cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${s.cls}`}>
      {s.icon}{s.label}
    </span>
  );
}

function ClientInterestCard({ interest, onStatusChange }: {
  interest: any;
  onStatusChange: (id: number, status: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-start gap-4">
        <Avatar className="w-11 h-11 shrink-0">
          <AvatarImage src={interest.freelancerAvatar} />
          <AvatarFallback className="bg-primary text-white text-sm">
            {(interest.freelancerName || "?").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{interest.freelancerName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Interested in: <span className="font-medium text-foreground">{interest.briefTitle}</span></p>
            </div>
            <InterestStatusBadge status={interest.status} />
          </div>

          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline font-medium"
          >
            <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
            {expanded ? "Hide cover note" : "Read cover note"}
          </button>

          {expanded && (
            <div className="mt-3 bg-muted/50 rounded-xl p-3">
              <p className="text-sm leading-relaxed">{interest.coverNote}</p>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2">
                {interest.rate && <span>Rate: <span className="font-medium text-foreground">{interest.rate}</span></span>}
                {interest.availability && <span>Available from: <span className="font-medium text-foreground">{interest.availability}</span></span>}
              </div>
            </div>
          )}

          {/* Client actions */}
          {interest.status !== "accepted" && interest.status !== "declined" && (
            <div className="flex gap-2 mt-3">
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-white rounded-full text-xs px-4"
                onClick={() => onStatusChange(interest.id, "accepted")}
              >
                <CheckCircle2 size={12} className="mr-1" /> Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full text-xs px-4 text-muted-foreground hover:text-destructive hover:border-destructive"
                onClick={() => onStatusChange(interest.id, "declined")}
              >
                <XCircle size={12} className="mr-1" /> Decline
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-0.5 mt-2">
            <p className="text-xs text-muted-foreground">Expressed interest: {formatUK(interest.createdAt)}</p>
            {interest.respondedAt && (
              <p className="text-xs text-muted-foreground">
                {interest.status === "accepted" ? "Accepted" : "Declined"}: {formatUK(interest.respondedAt)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PortfolioEditor ────────────────────────────────────────────────────────
type PortfolioItem = { url: string; title: string };

function PortfolioEditor({ profileId, currentItems, currentReelUrl }: {
  profileId?: number;
  currentItems: PortfolioItem[];
  currentReelUrl: string;
}) {
  const { toast } = useToast();

  // Seed from existing data — merge reelUrl as first item if not already in items
  function seedItems(): PortfolioItem[] {
    const base: PortfolioItem[] = currentItems.length > 0
      ? currentItems
      : (currentReelUrl ? [{ url: currentReelUrl, title: "" }] : []);
    return base.length > 0 ? base : [{ url: "", title: "" }];
  }

  const [items, setItems] = useState<PortfolioItem[]>(seedItems);
  const [saved, setSaved] = useState(false);

  function setItem(index: number, field: keyof PortfolioItem, value: string) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it));
    setSaved(false);
  }

  function addItem() {
    setItems(prev => [...prev, { url: "", title: "" }]);
    setSaved(false);
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
    setSaved(false);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error("No profile found");
      // Only save items that have a URL
      const valid = items.filter(it => it.url.trim());
      const primaryReel = valid[0]?.url ?? "";
      const res = await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reelUrl: primaryReel,
          portfolioItems: JSON.stringify(valid),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles/own"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({ title: "Portfolio saved!" });
    },
    onError: () => toast({ title: "Failed to save portfolio", variant: "destructive" }),
  });

  const hasAnyValid = items.some(it => it.url.trim() && isValidVideoUrl(it.url.trim()));

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-primary" />
          <h3 className="font-semibold">Portfolio</h3>
        </div>
        <span className="text-xs text-muted-foreground">{items.filter(i => i.url.trim()).length} video{items.filter(i => i.url.trim()).length !== 1 ? "s" : ""}</span>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Add as many Vimeo or YouTube links as you like — they display on your public profile, hosted by Vimeo/YouTube, no upload needed.
      </p>

      <div className="space-y-4">
        {items.map((item, index) => {
          const valid = item.url.trim() ? isValidVideoUrl(item.url.trim()) : null;
          const parsed = item.url.trim() ? parseVideoUrl(item.url.trim()) : null;
          return (
            <div key={index} className="border border-border rounded-xl p-4 space-y-3 bg-background">
              <div className="flex items-center gap-2">
                <GripVertical size={14} className="text-muted-foreground/40 flex-shrink-0" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Video {index + 1}{index === 0 ? " · Featured" : ""}</span>
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(index)}
                    className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <Input
                placeholder="Title (optional) — e.g. Wedding Showreel 2024"
                value={item.title}
                onChange={e => setItem(index, "title", e.target.value)}
                className="text-sm"
              />

              <div className="relative">
                <Input
                  placeholder="https://vimeo.com/123456789  or  https://youtu.be/..."
                  value={item.url}
                  onChange={e => setItem(index, "url", e.target.value)}
                  className={`text-sm pr-24 ${
                    item.url.trim() && valid === false ? "border-destructive focus-visible:ring-destructive" : ""
                  }`}
                />
                {item.url.trim() && (
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide ${
                    valid ? "text-green-600 dark:text-green-400" : "text-destructive"
                  }`}>
                    {valid
                      ? (parsed?.provider === "vimeo" ? "Vimeo ✓" : "YouTube ✓")
                      : "Invalid"}
                  </span>
                )}
              </div>

              {/* Inline preview */}
              {valid && item.url.trim() && (
                <VideoEmbed url={item.url.trim()} className="rounded-lg" />
              )}
            </div>
          );
        })}
      </div>

      {/* Add another + Save row */}
      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={addItem}
          className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
        >
          <Plus size={15} /> Add another video
        </button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="ml-auto bg-primary hover:bg-primary/90 text-white px-5 rounded-xl"
        >
          {saveMutation.isPending ? "Saving..." : "Save portfolio"}
        </Button>
      </div>

      {saved && (
        <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-3">
          <CheckCircle size={12} /> Portfolio saved — visible on your public profile
        </p>
      )}

      {!hasAnyValid && items.every(it => !it.url.trim()) && (
        <div className="mt-5 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl py-8 gap-2 text-muted-foreground">
          <Film size={28} className="opacity-30" />
          <p className="text-sm">No videos added yet</p>
          <p className="text-xs opacity-60">Paste Vimeo or YouTube links above</p>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [activeConv, setActiveConv] = useState<{ id: number; name: string; avatar?: string } | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [invoiceTemplateOpen, setInvoiceTemplateOpen] = useState(false);
  // Open a specific tab if URL has ?tab=xyz (e.g. from "My Agency" nav link)
  const [activeTab, setActiveTab] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("tab");
    } catch { return null; }
  });

  // Must be defined before any query that references it
  const isFreelancer = user?.role === "freelancer";

  // Invoice template query (freelancers only)
  const { data: invoiceTemplate } = useQuery<any>({
    queryKey: ['/api/invoice-template'],
    queryFn: () => apiRequest('GET', '/api/invoice-template').then(r => r.json()),
    enabled: !!user && isFreelancer,
  });

  // Fetch the user's own profile (for freelancers — to display stats in the header)
  const { data: ownProfileData } = useQuery<any>({
    queryKey: ["/api/profiles/own", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/profiles/${user!.id}`);
        if (!res.ok) return null;
        return res.json();
      } catch { return null; }
    },
    enabled: !!user && isFreelancer,
  });

  const ownProfile = ownProfileData?.profile ?? null;
  const ownSpecialisms: string[] = ownProfile ? JSON.parse(ownProfile.specialisms || "[]") : [];
  const ownBadges: string[] = ownProfile ? JSON.parse(ownProfile.badges || "[]") : [];
  // Server-side connections
  const { data: connections = [], refetch: refetchConnections } = useQuery<any[]>({
    queryKey: ["/api/connections", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/connections?userId=${user!.id}`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user,
  });

  const { data: pendingRequests = [], refetch: refetchPending } = useQuery<any[]>({
    queryKey: ["/api/connections/pending", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/connections/pending?userId=${user!.id}`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user,
  });

  const ownConnCount = connections.length;

  // Fetch own reviews (lazy — only when modal opens)
  const { data: ownReviews = [] } = useQuery<any[]>({
    queryKey: ["/api/reviews/own", ownProfile?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/profiles/${ownProfile!.id}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.reviews ?? [];
      } catch { return []; }
    },
    enabled: !!ownProfile && reviewsOpen,
  });

  const availClass: Record<string, string> = {
    available:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    unavailable: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    busy:        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };
  const availLabel: Record<string, string> = {
    available:   "Available for work",
    unavailable: "Not available",
    busy:        "Busy",
  };

  const { data: savedProfiles = [] } = useQuery<ProfileWithUser[]>({
    queryKey: ["/api/saved", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/saved/${user!.id}`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!user,
  });

  const { data: conversations = [] } = useQuery<any[]>({
    queryKey: ["/api/messages/conversations", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/messages/${user!.id}/conversations`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!user,
    refetchInterval: 8000,
  });

  // Profile views — only relevant for freelancers
  const { data: viewCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/profile-views/count", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/profile-views/${user!.id}/count`);
        if (!res.ok) return { count: 0 };
        return res.json();
      } catch { return { count: 0 }; }
    },
    enabled: !!user && isFreelancer,
    refetchInterval: 30000,
  });

  const { data: viewHistory = [] } = useQuery<{ date: string; count: number }[]>({
    queryKey: ["/api/profile-views/history", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/profile-views/${user!.id}/history?days=30`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user && isFreelancer,
    refetchInterval: 30000,
  });

  const profileViewCount = viewCountData?.count ?? 0;

  // Interests: freelancers see their own applications, clients see inbound interest on their briefs
  const interestsEndpoint = user?.role === "freelancer"
    ? `/api/interests/freelancer/${user?.id}`
    : `/api/interests/client/${user?.id}`;

  const { data: interests = [], refetch: refetchInterests } = useQuery<any[]>({
    queryKey: ["/api/interests", user?.id, user?.role],
    queryFn: async () => {
      try {
        const res = await fetch(interestsEndpoint);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!user,
    refetchInterval: 15000,
  });

  // Client briefs count (for "Projects posted" stat)
  const { data: clientBriefs = [] } = useQuery<any[]>({
    queryKey: ["/api/briefs/mine", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/briefs?clientId=${user!.id}`);
        if (!res.ok) return [];
        const all = await res.json();
        return Array.isArray(all) ? all.filter((b: any) => b.clientId === user!.id) : [];
      } catch { return []; }
    },
    enabled: !!user && !isFreelancer,
    refetchInterval: 20000,
  });

  // Projects — live active projects for this user (both client + freelancer)
  const { data: projects = [], refetch: refetchProjects } = useQuery<any[]>({
    queryKey: ["/api/projects", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/projects?userId=${user!.id}`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: !!user,
    refetchInterval: 20000,
  });

  // Agency data — for agency_owner freelancers
  const isAgencyOwner = isFreelancer && (user as any)?.accountSubtype === "agency_owner";
  const { data: agencyData, refetch: refetchAgency } = useQuery<any>({
    queryKey: ["/api/agencies/mine", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/agencies/mine/${user!.id}`);
        if (!res.ok) return null;
        return res.json();
      } catch { return null; }
    },
    enabled: !!user && isAgencyOwner,
  });

  const { data: agencyDashData } = useQuery<any>({
    queryKey: ["/api/agencies/dashboard", agencyData?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/agencies/${agencyData!.id}/dashboard`);
        if (!res.ok) return null;
        return res.json();
      } catch { return null; }
    },
    enabled: !!agencyData?.id,
    refetchInterval: 30000,
  });

  // Agency proposals (for clients)
  const { data: agencyProposals = [], isLoading: proposalsLoading } = useQuery<any[]>({
    queryKey: ['/api/agencies/my-proposals'],
    queryFn: () => apiRequest('GET', '/api/agencies/my-proposals').then(r => r.json()),
    enabled: !!user && !isFreelancer,
  });

  const respondToProposalMutation = useMutation({
    mutationFn: ({ proposalId, status }: { proposalId: number; status: string }) =>
      apiRequest('PATCH', `/api/agencies/proposals/${proposalId}/status`, { status }).then(r => r.json()),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/agencies/my-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', user?.id] });
      toast({ title: vars.status === 'accepted' ? 'Proposal accepted — project created!' : 'Proposal declined' });
    },
  });

  // Agency HQ sub-tab
  const [agencyHqTab, setAgencyHqTab] = useState<"overview" | "team" | "jobs" | "invite">("overview");
  const [expandedMember, setExpandedMember] = useState<number | null>(null);

  if (!user) return <NotLoggedIn />;

  return (
    <div className="min-h-screen bg-background">

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Profile header — mirrors the public profile page */}
        <div className="bg-card border border-border rounded-2xl p-6 md:p-8 mb-6">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <Avatar className="w-20 h-20 flex-shrink-0 ring-4 ring-background shadow-lg">
              <AvatarImage src={user.avatar || undefined} />
              <AvatarFallback className="bg-primary text-white text-2xl">
                {(user.name || '?').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl font-bold leading-tight">{user.name}</h1>
                  {/* Headline — LinkedIn-style, normal weight */}
                  {(user as any).headline && (
                    <p className="text-base text-foreground/80 font-normal mt-0.5 leading-snug">
                      {(user as any).headline}
                    </p>
                  )}
                  {/* Location */}
                  {(user as any).location && (
                    <p className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                      <MapPin size={12} /> {(user as any).location}
                    </p>
                  )}
                  {/* Specialisms */}
                  {isFreelancer && ownSpecialisms.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {ownSpecialisms.map(s => (
                        <span key={s} className="text-xs bg-primary/10 text-primary font-semibold px-2.5 py-0.5 rounded-full">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Availability badge (freelancers only) */}
                  {isFreelancer && ownProfile && (
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${availClass[ownProfile.availability] ?? availClass.available}`}>
                      {availLabel[ownProfile.availability] ?? "Available for work"}
                    </span>
                  )}
                  {isAgencyOwner && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate("/agency-hq")}
                      className="gap-2 text-primary border-primary/30 hover:bg-primary/5"
                    >
                      <Building2 size={14} /> My Agency
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={logout} className="gap-2 text-muted-foreground">
                    <LogOut size={14} /> Sign out
                  </Button>
                </div>
              </div>

              {/* Stats row — same layout as public profile */}
              <div className="flex flex-wrap gap-4 mt-4">
                {isFreelancer && ownProfile ? (
                  <>
                    <button
                      onClick={() => (ownProfile.reviewCount ?? 0) > 0 && setReviewsOpen(true)}
                      className={`flex items-center gap-1.5 ${(ownProfile.reviewCount ?? 0) > 0 ? 'cursor-pointer hover:opacity-75 transition-opacity' : 'cursor-default'}`}
                    >
                      <Stars rating={ownProfile.rating || 0} />
                      <span className="font-bold text-sm">{(ownProfile.rating || 0).toFixed(1)}</span>
                      <span className="text-sm text-muted-foreground underline-offset-2 hover:underline">({ownProfile.reviewCount ?? 0} reviews)</span>
                    </button>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Briefcase size={13} /> {ownProfile.projectCount ?? 0} projects
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock size={13} /> {ownProfile.yearsExperience ?? 0} yrs experience
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users size={13} /> {ownConnCount} connections
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users size={13} /> {ownConnCount} connections
                  </div>
                )}
              </div>

              {/* Badges */}
              {isFreelancer && ownBadges.length > 0 && (
                <div className="flex gap-2 mt-3">
                  {ownBadges.map(b => (
                    <span key={b} className="text-xs bg-primary/10 text-primary rounded-full px-2.5 py-0.5 font-medium">{b}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats strip — each card is clickable and opens the relevant tab */}
        <div className={`grid gap-4 mb-8 ${isFreelancer ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'}`}>
          {(isFreelancer ? [
            { label: "Profile views",  value: String(profileViewCount),      icon: TrendingUp,   tab: "profile-views" },
            { label: "Messages",       value: String(conversations.length),   icon: MessageSquare, tab: "messages" },
            { label: "Interests sent", value: String(interests.length),       icon: FileText,     tab: "interests" },
            { label: "Projects",       value: String(projects.length),        icon: Briefcase,    tab: "projects" },
            { label: "Connections",    value: String(ownConnCount) + (pendingRequests.length > 0 ? ` (+${pendingRequests.length})` : ""), icon: Users, tab: "connections" },

          ] : [
            { label: "Saved creatives",    value: String(savedProfiles.length), icon: Bookmark,      tab: "saved" },
            { label: "Messages",           value: String(conversations.length), icon: MessageSquare, tab: "messages" },
            { label: "Interests received", value: String(interests.length),     icon: FileText,      tab: "interests" },
            { label: "Briefs posted",      value: String(clientBriefs.length),  icon: Briefcase,     tab: "projects" },
            { label: "Connections",        value: String(ownConnCount) + (pendingRequests.length > 0 ? ` (+${pendingRequests.length})` : ""), icon: Users, tab: "connections" },
            { label: "Agency Proposals",   value: String(agencyProposals.length) + (agencyProposals.filter((p: any) => p.proposal?.status === 'sent').length > 0 ? ` (${agencyProposals.filter((p: any) => p.proposal?.status === 'sent').length} new)` : ""), icon: Building2, tab: "agency-proposals" },
          ]).map(({ label, value, icon: Icon, tab }) => (
            <button
              key={label}
              onClick={() => tab && setActiveTab(prev => prev === tab ? null : tab)}
              className={`bg-card border rounded-xl p-4 text-left transition-all ${
                tab ? 'cursor-pointer hover:border-primary/50 hover:shadow-sm' : 'cursor-default'
              } ${
                activeTab === tab && tab ? 'border-primary ring-1 ring-primary/30' : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon size={16} className={activeTab === tab && tab ? 'text-primary' : 'text-primary'} />
              </div>
              <p className="text-2xl font-bold">{value}</p>
              {tab && (
                <p className="text-xs text-muted-foreground mt-1">
                  {activeTab === tab ? 'Click to close ↑' : 'Click to view →'}
                </p>
              )}
            </button>
          ))}
        </div>

        {/* ── Panel area: shown below the stat cards when one is active ─── */}
        {activeTab && (
          <div className="bg-card border border-border rounded-2xl mt-2 mb-6 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">

            {/* Profile views sparkline */}
            {activeTab === "profile-views" && isFreelancer && (
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-sm">Profile views</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Last 30 days</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">{profileViewCount}</p>
                    <p className="text-xs text-muted-foreground">total views</p>
                  </div>
                </div>
                {viewHistory.length > 0 ? (
                  <>
                    <div className="flex items-end gap-0.5 h-16">
                      {viewHistory.map((d: any, i: number) => {
                        const max = Math.max(...viewHistory.map((x: any) => x.count), 1);
                        const pct = (d.count / max) * 100;
                        return (
                          <div
                            key={i}
                            title={`${d.date}: ${d.count} view${d.count !== 1 ? 's' : ''}`}
                            className="flex-1 rounded-sm transition-all cursor-help"
                            style={{
                              height: `${Math.max(pct, d.count > 0 ? 8 : 2)}%`,
                              backgroundColor: d.count > 0 ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                              opacity: d.count > 0 ? 0.7 + (pct / 100) * 0.3 : 1,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>{viewHistory[0]?.date.slice(5)}</span>
                      <span>Today</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Views will appear here once someone visits your profile
                  </p>
                )}
              </div>
            )}

            {/* Saved creatives */}
            {activeTab === "saved" && !isFreelancer && (
              <div className="p-5">
                <h3 className="font-semibold mb-4">Saved creatives</h3>
                {savedProfiles.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Bookmark size={28} className="mx-auto mb-3 opacity-40" />
                    <p className="font-semibold text-foreground mb-1">No saved creatives yet</p>
                    <p className="text-sm mb-4">Browse talent and save the ones you love.</p>
                    <Button asChild className="bg-primary hover:bg-primary/90 text-white">
                      <Link href="/marketplace">Browse marketplace</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {savedProfiles.map((pw: any) => (
                      <FreelancerCard key={pw.profile.id} pw={pw} savedInit={true} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            {activeTab === "messages" && (
              <div className="p-5">
                <h3 className="font-semibold mb-4">Messages</h3>
                {conversations.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <MessageSquare size={28} className="mx-auto mb-3 opacity-40" />
                    <p className="font-semibold text-foreground mb-1">No conversations yet</p>
                    <p className="text-sm">Find a creative and start a conversation.</p>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-[260px,1fr] gap-4">
                    <div className="bg-background border border-border rounded-xl overflow-hidden">
                      {conversations.map((c: any) => (
                        <button
                          key={c.otherId}
                          onClick={() => setActiveConv({ id: c.otherId, name: c.otherName, avatar: c.otherAvatar })}
                          className={`w-full flex items-center gap-3 p-4 border-b border-border last:border-b-0 text-left transition-colors
                            ${activeConv?.id === c.otherId ? "bg-primary/10" : "hover:bg-secondary/50"}`}
                        >
                          <Avatar className="w-9 h-9 flex-shrink-0">
                            <AvatarImage src={c.otherAvatar} />
                            <AvatarFallback className="bg-primary text-white text-xs">{c.otherName.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">{c.otherName}</span>
                              {c.unread > 0 && <Badge className="bg-primary text-white text-xs">{c.unread}</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{c.lastMessage}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="bg-background border border-border rounded-xl overflow-hidden">
                      {activeConv ? (
                        <MessageThread userId={user.id} otherId={activeConv.id} otherName={activeConv.name} otherAvatar={activeConv.avatar} />
                      ) : (
                        <div className="flex items-center justify-center h-full py-16 text-muted-foreground text-sm">
                          Select a conversation
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Interests */}
            {activeTab === "interests" && (
              <InterestsPanel
                interests={interests}
                isFreelancer={isFreelancer}
                userId={user.id}
                userName={user.name}
                userAvatar={user.avatar}
                onStatusChange={(id, status) => {
                  fetch(`/api/interests/${id}/status`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status, clientName: user?.name, clientAvatar: user?.avatar }),
                  }).then(() => { refetchInterests(); refetchProjects(); });
                }}
              />
            )}

            {/* Active Projects */}
            {activeTab === "projects" && (
              <div className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="font-semibold">Active projects</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isFreelancer
                        ? "Live projects you\'re working on"
                        : "Projects you\'ve kicked off with creatives"}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs">{projects.length} live</Badge>
                </div>

                {projects.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FolderOpen size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="font-semibold text-foreground mb-1">No active projects yet</p>
                    <p className="text-sm">
                      {isFreelancer
                        ? "When a client accepts your interest, the project will appear here."
                        : "Accept a freelancer\'s interest to kick off a live project."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {projects.map((pw: any) => {
                      const p = pw.project ?? pw;
                      const isClient = user.id === p.clientId;
                      const otherName = isClient ? p.freelancerName : p.clientName;
                      const stageLabels = ["Brief shared", "Pre-production", "In production", "Review", "Delivery", "Complete"];
                      const stageLabel = stageLabels[Math.min(p.currentStage ?? 0, stageLabels.length - 1)];
                      const pct = Math.round(((p.currentStage ?? 0) / (stageLabels.length - 1)) * 100);
                      const createdDate = p.createdAt
                        ? new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "";

                      return (
                        <div
                          key={p.id}
                          className="bg-background border border-border rounded-xl p-4 hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <p className="font-semibold text-sm truncate">{p.title}</p>
                                {p.briefCategory && (
                                  <Badge variant="secondary" className="text-xs shrink-0">{p.briefCategory}</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {isClient ? "With" : "For"}&nbsp;
                                <span className="font-medium text-foreground">{otherName ?? "Unknown"}</span>
                                {createdDate && <span> &middot; Started {createdDate}</span>}
                              </p>
                            </div>
                            <Badge
                              className={`shrink-0 text-xs ${
                                p.status === "completed"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-primary/10 text-primary"
                              }`}
                              variant="secondary"
                            >
                              {p.status === "completed" ? "Complete" : "Active"}
                            </Badge>
                          </div>

                          {/* Progress bar */}
                          <div className="mb-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">Stage: {stageLabel}</span>
                              <span className="text-xs text-muted-foreground">{pct}%</span>
                            </div>
                            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>

                          {/* Updates / activity summary */}
                          {pw.updates && pw.updates.length > 0 && (
                            <div className="mt-3 border-t border-border pt-3">
                              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Latest update</p>
                              <div className="flex items-start gap-2">
                                <CheckCircle2 size={12} className="text-primary mt-0.5 shrink-0" />
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  {pw.updates[pw.updates.length - 1]?.update?.note ?? pw.updates[pw.updates.length - 1]?.note ?? "—"}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Go to messages CTA */}
                          <div className="mt-3">
                            <button
                              onClick={() => {
                                setActiveConv({ id: isClient ? p.freelancerId : p.clientId, name: otherName ?? "Unknown" });
                                setActiveTab("messages");
                              }}
                              className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                            >
                              <MessageSquare size={11} /> Open messages
                            </button>
                          </div>

                          {/* Meeting section */}
                          <MeetingSection
                            projectId={p.id}
                            userId={user.id}
                            otherName={otherName ?? "Unknown"}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Connections */}
            {activeTab === "connections" && (
              <div className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="font-semibold">Connections</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{ownConnCount} connection{ownConnCount !== 1 ? 's' : ''}</p>
                  </div>
                  {pendingRequests.length > 0 && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                      {pendingRequests.length} pending request{pendingRequests.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Pending requests */}
                {pendingRequests.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pending requests</h4>
                    <div className="space-y-3">
                      {pendingRequests.map((req: any) => (
                        <div key={req.id} className="flex items-center gap-3 bg-muted/40 rounded-xl p-3">
                          <Avatar className="w-10 h-10 flex-shrink-0">
                            <AvatarImage src={req.senderAvatar} />
                            <AvatarFallback className="bg-primary text-white text-xs">{(req.senderName || 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{req.senderName}</p>
                            <p className="text-xs text-muted-foreground truncate">{req.senderHeadline || req.senderRole}</p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="bg-primary hover:bg-primary/90 text-white rounded-full text-xs px-3 h-8"
                              onClick={async () => {
                                try {
                                  await apiRequest("POST", "/api/connections/respond", {
                                    requestId: req.id,
                                    responderId: user!.id,
                                    senderId: req.senderId,
                                    status: 'accepted',
                                  });
                                  refetchPending();
                                  refetchConnections();
                                  queryClient.invalidateQueries({ queryKey: ["/api/connections", user?.id] });
                                  toast({ title: `Connected with ${req.senderName}` });
                                } catch { toast({ title: "Something went wrong", variant: "destructive" }); }
                              }}
                            >
                              <CheckCircle2 size={12} className="mr-1" /> Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full text-xs px-3 h-8 text-muted-foreground hover:text-destructive hover:border-destructive"
                              onClick={async () => {
                                try {
                                  await apiRequest("POST", "/api/connections/respond", {
                                    requestId: req.id,
                                    responderId: user!.id,
                                    senderId: req.senderId,
                                    status: 'declined',
                                  });
                                  refetchPending();
                                  toast({ title: "Request declined" });
                                } catch { toast({ title: "Something went wrong", variant: "destructive" }); }
                              }}
                            >
                              <XCircle size={12} className="mr-1" /> Decline
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Accepted connections */}
                {connections.length === 0 && pendingRequests.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Users size={28} className="mx-auto mb-3 opacity-40" />
                    <p className="font-semibold text-foreground mb-1">No connections yet</p>
                    <p className="text-sm mb-4">Connect with creatives and clients to grow your network.</p>
                    <Button asChild className="bg-primary hover:bg-primary/90 text-white">
                      <Link href="/marketplace">Browse marketplace</Link>
                    </Button>
                  </div>
                ) : connections.length > 0 ? (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your connections</h4>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {connections.map((conn: any) => (
                        <Link key={conn.id} href={conn.role === 'freelancer' ? `/profile/${conn.id}` : `/profile/${conn.id}`}>
                          <div className="flex items-center gap-3 bg-muted/30 hover:bg-muted/60 rounded-xl p-3 transition-colors cursor-pointer border border-border hover:border-primary/30">
                            <Avatar className="w-10 h-10 flex-shrink-0">
                              <AvatarImage src={conn.avatar} />
                              <AvatarFallback className="bg-primary text-white text-xs">{(conn.name || 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{conn.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{conn.headline || conn.role}</p>
                              {conn.location && <p className="text-xs text-muted-foreground truncate flex items-center gap-1"><MapPin size={9} /> {conn.location}</p>}
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              conn.role === 'client'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'bg-primary/10 text-primary'
                            }`}>{conn.role === 'client' ? 'Client' : 'Creative'}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* ── Agency HQ tab ── */}
            {/* Agency Proposals inbox — for clients */}
            {activeTab === "agency-proposals" && !isFreelancer && (
              <div className="p-5">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 size={16} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base">Agency Proposals</h3>
                    <p className="text-xs text-muted-foreground">Proposals sent to you by agencies</p>
                  </div>
                  {agencyProposals.filter((p: any) => p.proposal?.status === 'sent').length > 0 && (
                    <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-primary text-white">
                      {agencyProposals.filter((p: any) => p.proposal?.status === 'sent').length} pending
                    </span>
                  )}
                </div>
                {proposalsLoading ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">Loading proposals...</div>
                ) : agencyProposals.length === 0 ? (
                  <div className="text-center py-10">
                    <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                      <Building2 size={22} className="text-muted-foreground/50" />
                    </div>
                    <p className="font-semibold text-foreground mb-1">No agency proposals yet</p>
                    <p className="text-sm text-muted-foreground">When an agency sends you a proposal, it will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {agencyProposals.map((item: any) => {
                      const proposal = item.proposal;
                      const agency = item.agency;
                      const isPending = proposal?.status === 'sent';
                      const isAccepted = proposal?.status === 'accepted';
                      const isDeclined = proposal?.status === 'declined';
                      return (
                        <div key={item.id} className={`rounded-2xl border p-5 transition-all ${
                          isPending ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'
                        }`}>
                          <div className="flex items-start gap-4">
                            <Avatar className="w-11 h-11 flex-shrink-0">
                              <AvatarImage src={agency?.logoUrl || undefined} />
                              <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                                {(agency?.name || 'AG').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <div>
                                  <p className="font-bold text-sm">{agency?.name || 'Agency'}</p>
                                  <p className="text-xs text-muted-foreground truncate max-w-xs">{item.title}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {isPending && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Pending</span>
                                  )}
                                  {isAccepted && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Accepted</span>
                                  )}
                                  {isDeclined && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Declined</span>
                                  )}
                                </div>
                              </div>
                              {proposal && (
                                <div className="mt-3 space-y-2">
                                  <div className="flex flex-wrap gap-4">
                                    {proposal.quotedAmountPence && (
                                      <div className="flex items-center gap-1.5 text-sm">
                                        <PoundSterling size={13} className="text-emerald-500" />
                                        <span className="font-semibold">£{(proposal.quotedAmountPence / 100).toFixed(0)}</span>
                                        <span className="text-muted-foreground text-xs">quoted</span>
                                      </div>
                                    )}
                                    {proposal.timeline && (
                                      <div className="flex items-center gap-1.5 text-sm">
                                        <CalendarClock size={13} className="text-blue-500" />
                                        <span className="text-muted-foreground text-xs">{proposal.timeline}</span>
                                      </div>
                                    )}
                                  </div>
                                  {proposal.coverNote && (
                                    <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">{proposal.coverNote}</p>
                                  )}
                                </div>
                              )}
                              {isPending && proposal && (
                                <div className="flex gap-2 mt-4">
                                  <Button
                                    size="sm"
                                    className="bg-primary hover:bg-primary/90 text-white text-xs h-8 px-4 rounded-xl"
                                    disabled={respondToProposalMutation.isPending}
                                    onClick={() => respondToProposalMutation.mutate({ proposalId: proposal.id, status: 'accepted' })}
                                  >
                                    <CheckCircle2 size={12} className="mr-1.5" /> Accept
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-8 px-4 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/5"
                                    disabled={respondToProposalMutation.isPending}
                                    onClick={() => respondToProposalMutation.mutate({ proposalId: proposal.id, status: 'declined' })}
                                  >
                                    <XCircle size={12} className="mr-1.5" /> Decline
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "agency" && isAgencyOwner && (
              <div>
                {/* ── Agency HQ Header ── */}
                <div className="px-6 pt-6 pb-0">
                  <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Building2 size={20} className="text-primary" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg leading-tight">{agencyData?.name ?? "Agency HQ"}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Agency dashboard</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {agencyData && (
                        <button
                          className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
                          onClick={() => {
                            const link = `${window.location.origin}/#/join/${agencyData.inviteCode}`;
                            navigator.clipboard?.writeText(link).then(() => toast({ title: "Invite link copied!", description: "Share it with freelancers you want to invite." }));
                          }}
                        >
                          <Copy size={12} /> Copy invite link
                        </button>
                      )}
                      {agencyData?.slug && (
                        <a
                          href={`/#/agency/${agencyData.slug}`}
                          target="_blank"
                          className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
                        >
                          <ExternalLink size={12} /> View public page
                        </a>
                      )}
                    </div>
                  </div>

                  {/* KPI strip */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    {[
                      { label: "Total earned", value: `£${((agencyDashData?.totalEarnedPence ?? 0) / 100).toFixed(0)}`, icon: PoundSterling, color: "text-emerald-600" },
                      { label: "Active jobs", value: String(agencyDashData?.activeProjectCount ?? 0), icon: Briefcase, color: "text-blue-500" },
                      { label: "Team members", value: String((agencyDashData?.members ?? []).filter((m: any) => m.member.status === "active").length), icon: Users, color: "text-primary" },
                      { label: "Pending approvals", value: String((agencyDashData?.members ?? []).filter((m: any) => m.member.status === "pending").length), icon: Clock, color: "text-amber-500" },
                    ].map(({ label, value, icon: Icon, color }) => (
                      <div key={label} className="bg-muted/40 border border-border/60 rounded-xl p-3.5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <Icon size={14} className={color} />
                        </div>
                        <p className="text-xl font-bold">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Sub-nav tabs */}
                  <div className="flex gap-1 border-b border-border -mx-6 px-6">
                    {([
                      { id: "overview", label: "Overview", icon: LayoutGrid },
                      { id: "team", label: "Team", icon: Users },
                      { id: "jobs", label: "Active Jobs", icon: Briefcase },
                      { id: "invite", label: "Invite & Manage", icon: UserPlus },
                    ] as { id: "overview" | "team" | "jobs" | "invite"; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        onClick={() => setAgencyHqTab(id)}
                        className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2.5 border-b-2 transition-colors ${
                          agencyHqTab === id
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon size={13} />{label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── OVERVIEW tab ── */}
                {agencyHqTab === "overview" && (
                  <div className="p-6">
                    <div className="grid md:grid-cols-2 gap-5">

                      {/* Recent jobs */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent jobs</h4>
                        {(agencyDashData?.recentProjects ?? []).length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                            No jobs yet — they'll appear here once team members start working.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(agencyDashData.recentProjects ?? []).slice(0, 5).map((pd: any) => (
                              <div key={pd.project.id} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <Briefcase size={13} className="text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate text-sm">{pd.project.title}</p>
                                  <p className="text-xs text-muted-foreground truncate">{pd.freelancer?.name ?? "—"} · {pd.client?.name ?? "—"}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    pd.project.status === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                    pd.project.status === "completed" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                                    "bg-muted text-muted-foreground"
                                  }`}>{pd.project.status}</span>
                                  {pd.project.agreedAmountPence && (
                                    <span className="text-xs font-bold text-foreground">£{(pd.project.agreedAmountPence / 100).toFixed(0)}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Team snapshot */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Team snapshot</h4>
                        {(agencyDashData?.members ?? []).length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                            No team members yet. Use the Invite tab to add your first creative.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(agencyDashData.members ?? []).slice(0, 5).map((mwu: any) => {
                              const { member, user: mUser, profile } = mwu;
                              const specialisms: string[] = JSON.parse(profile?.specialisms ?? "[]");
                              const isOwnerMember = mUser.id === agencyData?.ownerUserId;
                              return (
                                <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                                  <Avatar className="w-8 h-8 flex-shrink-0">
                                    <AvatarImage src={mUser.avatar} />
                                    <AvatarFallback className="bg-primary/10 text-primary text-xs">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">{mUser.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{specialisms.slice(0, 2).join(", ") || "No specialisms"}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {isOwnerMember && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Owner</span>}
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                      member.status === "active"
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                    }`}>{member.status === "active" ? "Active" : "Pending"}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Roadmap coming-soon cards */}
                    <div className="mt-6">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Coming soon</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { icon: Timer, label: "Time Tracking", desc: "Log hours per project" },
                          { icon: GitBranch, label: "Project Management", desc: "Gantt charts & tasks" },
                          { icon: Plane, label: "Time Off", desc: "Holiday & leave requests" },
                          { icon: Database, label: "Sales CRM", desc: "Leads & client pipeline" },
                        ].map(({ icon: Icon, label, desc }) => (
                          <div key={label} className="rounded-xl border border-dashed border-border p-4 opacity-60">
                            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center mb-2">
                              <Icon size={15} className="text-muted-foreground" />
                            </div>
                            <p className="text-sm font-semibold">{label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                            <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">Roadmap</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TEAM tab ── */}
                {agencyHqTab === "team" && (
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">All team members ({(agencyDashData?.members ?? []).length})</h4>
                    </div>
                    {(agencyDashData?.members ?? []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                        <Users size={28} className="mx-auto mb-3 opacity-30" />
                        <p className="font-semibold text-foreground mb-1">No team members yet</p>
                        <p>Copy your invite link and share it with freelancers to get started.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(agencyDashData.members ?? []).map((mwu: any) => {
                          const { member, user: mUser, profile } = mwu;
                          const specialisms: string[] = JSON.parse(profile?.specialisms ?? "[]");
                          const isOwnerMember = mUser.id === agencyData?.ownerUserId;
                          const isPending = member.status === "pending";
                          const isExpanded = expandedMember === member.id;
                          // Revenue for this member from agencyDashData
                          const memberRevenue = (agencyDashData?.memberRevenue ?? {})[mUser.id] ?? 0;
                          const memberProjects = (agencyDashData?.recentProjects ?? []).filter((pd: any) => pd.freelancer?.id === mUser.id);
                          return (
                            <div key={member.id} className="rounded-xl border border-border overflow-hidden">
                              {/* Row */}
                              <div
                                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => setExpandedMember(isExpanded ? null : member.id)}
                              >
                                <Avatar className="w-10 h-10 flex-shrink-0">
                                  <AvatarImage src={mUser.avatar} />
                                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-semibold text-sm">{mUser.name}</p>
                                    {isOwnerMember && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Owner</span>}
                                    {profile?.isPro === 1 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">PRO</span>}
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {specialisms.slice(0, 3).map((s: string) => (
                                      <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/5 text-primary/80 font-medium">{s}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="text-right hidden sm:block">
                                    <p className="text-xs text-muted-foreground">Earned</p>
                                    <p className="text-sm font-bold">£{(memberRevenue / 100).toFixed(0)}</p>
                                  </div>
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    isPending ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  }`}>{isPending ? "Pending" : "Active"}</span>
                                  {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                                </div>
                              </div>

                              {/* Expanded detail */}
                              {isExpanded && (
                                <div className="border-t border-border bg-muted/20 p-4">
                                  <div className="grid grid-cols-3 gap-3 mb-4">
                                    <div>
                                      <p className="text-xs text-muted-foreground">Location</p>
                                      <p className="text-sm font-medium mt-0.5">{mUser.location || "—"}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Day rate</p>
                                      <p className="text-sm font-medium mt-0.5">{profile?.dayRate ? `£${profile.dayRate}` : "—"}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-muted-foreground">Projects</p>
                                      <p className="text-sm font-medium mt-0.5">{profile?.projectCount ?? 0}</p>
                                    </div>
                                  </div>
                                  <div className="mb-4">
                                    <p className="text-xs text-muted-foreground mb-1">Rating</p>
                                    <div className="flex items-center gap-1.5">
                                      <Stars rating={profile?.rating ?? 0} />
                                      <span className="text-xs text-muted-foreground">({profile?.reviewCount ?? 0} reviews)</span>
                                    </div>
                                  </div>
                                  {memberProjects.length > 0 && (
                                    <div className="mb-4">
                                      <p className="text-xs text-muted-foreground mb-2">Their recent projects</p>
                                      <div className="space-y-1.5">
                                        {memberProjects.slice(0, 3).map((pd: any) => (
                                          <div key={pd.project.id} className="flex items-center justify-between text-xs rounded-lg bg-background border border-border px-3 py-2">
                                            <span className="font-medium truncate">{pd.project.title}</span>
                                            <span className={`ml-2 shrink-0 font-semibold px-1.5 py-0.5 rounded ${
                                              pd.project.status === "active" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                                            }`}>{pd.project.status}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2">
                                    {isPending && (
                                      <Button
                                        size="sm"
                                        className="rounded-full text-xs h-7 px-3 bg-primary hover:bg-primary/90 text-white"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          try {
                                            await apiRequest("POST", `/api/agencies/members/${member.id}/approve`, { userId: mUser.id });
                                            queryClient.invalidateQueries({ queryKey: ["/api/agencies/dashboard", agencyData.id] });
                                            toast({ title: `${mUser.name} approved!` });
                                          } catch { toast({ title: "Something went wrong", variant: "destructive" }); }
                                        }}
                                      >
                                        <CheckCircle2 size={11} className="mr-1" /> Approve
                                      </Button>
                                    )}
                                    {!isOwnerMember && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-full text-xs h-7 px-3 text-destructive border-destructive/30 hover:bg-destructive/5"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          if (!confirm(`Remove ${mUser.name} from your agency?`)) return;
                                          try {
                                            await apiRequest("DELETE", `/api/agencies/${agencyData.id}/members/${mUser.id}`);
                                            queryClient.invalidateQueries({ queryKey: ["/api/agencies/dashboard", agencyData.id] });
                                            toast({ title: `${mUser.name} removed` });
                                            setExpandedMember(null);
                                          } catch { toast({ title: "Something went wrong", variant: "destructive" }); }
                                        }}
                                      >
                                        <XCircle size={11} className="mr-1" /> Remove
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── ACTIVE JOBS tab ── */}
                {agencyHqTab === "jobs" && (
                  <div className="p-6">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">All agency jobs ({(agencyDashData?.recentProjects ?? []).length})</h4>
                    {(agencyDashData?.recentProjects ?? []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                        <Briefcase size={28} className="mx-auto mb-3 opacity-30" />
                        <p className="font-semibold text-foreground mb-1">No jobs yet</p>
                        <p>Jobs assigned to your team members will appear here.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(agencyDashData.recentProjects ?? []).map((pd: any) => (
                          <div key={pd.project.id} className="rounded-xl border border-border p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm">{pd.project.title}</p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <User size={11} /> {pd.freelancer?.name ?? "—"}
                                  </span>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Briefcase size={11} /> {pd.client?.name ?? "—"}
                                  </span>
                                  {pd.project.createdAt && (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <CalendarClock size={11} /> {new Date(pd.project.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1.5 shrink-0">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  pd.project.status === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                  pd.project.status === "completed" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                                  pd.project.status === "pending" ? "bg-amber-100 text-amber-700" :
                                  "bg-muted text-muted-foreground"
                                }`}>{pd.project.status}</span>
                                {pd.project.agreedAmountPence ? (
                                  <span className="text-sm font-bold text-foreground">£{(pd.project.agreedAmountPence / 100).toFixed(0)}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">TBC</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── INVITE & MANAGE tab ── */}
                {agencyHqTab === "invite" && (
                  <div className="p-6">
                    <div className="grid md:grid-cols-2 gap-6">

                      {/* Invite link */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your invite link</h4>
                        <div className="rounded-xl border border-border bg-muted/30 p-4">
                          <p className="text-sm text-muted-foreground mb-3">Share this link with freelancers you want to join your agency. Once they accept, you'll see a pending request here to approve.</p>
                          {agencyData && (
                            <div className="bg-background border border-border rounded-lg px-3 py-2 flex items-center gap-2 mb-3">
                              <p className="text-xs font-mono text-muted-foreground flex-1 truncate">
                                {window.location.origin}/#/join/{agencyData.inviteCode}
                              </p>
                              <button
                                className="shrink-0 text-primary hover:text-primary/80 transition-colors"
                                onClick={() => {
                                  const link = `${window.location.origin}/#/join/${agencyData.inviteCode}`;
                                  navigator.clipboard?.writeText(link).then(() => toast({ title: "Invite link copied!" }));
                                }}
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                          )}
                          <Button
                            className="w-full bg-primary hover:bg-primary/90 text-white text-sm"
                            onClick={() => {
                              if (!agencyData) return;
                              const link = `${window.location.origin}/#/join/${agencyData.inviteCode}`;
                              navigator.clipboard?.writeText(link).then(() => toast({ title: "Invite link copied!", description: "Share it with freelancers you want to invite." }));
                            }}
                          >
                            <Copy size={14} className="mr-2" /> Copy invite link
                          </Button>
                        </div>
                      </div>

                      {/* Pending approvals */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pending approvals</h4>
                        {(agencyDashData?.members ?? []).filter((m: any) => m.member.status === "pending").length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                            No pending requests right now.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(agencyDashData.members ?? []).filter((m: any) => m.member.status === "pending").map((mwu: any) => {
                              const { member, user: mUser, profile } = mwu;
                              const specialisms: string[] = JSON.parse(profile?.specialisms ?? "[]");
                              return (
                                <div key={member.id} className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 p-3">
                                  <Avatar className="w-9 h-9 flex-shrink-0">
                                    <AvatarImage src={mUser.avatar} />
                                    <AvatarFallback className="bg-amber-100 text-amber-700 text-xs font-bold">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-sm">{mUser.name}</p>
                                    <p className="text-xs text-muted-foreground">{specialisms.slice(0, 2).join(", ") || "—"}</p>
                                  </div>
                                  <div className="flex gap-2 shrink-0">
                                    <Button
                                      size="sm"
                                      className="rounded-full text-xs h-7 px-3 bg-primary hover:bg-primary/90 text-white"
                                      onClick={async () => {
                                        try {
                                          await apiRequest("POST", `/api/agencies/members/${member.id}/approve`, { userId: mUser.id });
                                          queryClient.invalidateQueries({ queryKey: ["/api/agencies/dashboard", agencyData.id] });
                                          toast({ title: `${mUser.name} approved!` });
                                        } catch { toast({ title: "Something went wrong", variant: "destructive" }); }
                                      }}
                                    >
                                      <CheckCircle2 size={11} className="mr-1" /> Approve
                                    </Button>
                                    <button
                                      className="text-muted-foreground hover:text-destructive transition-colors"
                                      title="Decline"
                                      onClick={async () => {
                                        if (!confirm(`Decline ${mUser.name}'s request?`)) return;
                                        try {
                                          await apiRequest("DELETE", `/api/agencies/${agencyData.id}/members/${mUser.id}`);
                                          queryClient.invalidateQueries({ queryKey: ["/api/agencies/dashboard", agencyData.id] });
                                          toast({ title: `${mUser.name}'s request declined` });
                                        } catch { toast({ title: "Something went wrong", variant: "destructive" }); }
                                      }}
                                    >
                                      <XCircle size={16} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Active members — remove control */}
                    <div className="mt-6">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Active members</h4>
                      {(agencyDashData?.members ?? []).filter((m: any) => m.member.status === "active").length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                          No active members yet.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(agencyDashData.members ?? []).filter((m: any) => m.member.status === "active").map((mwu: any) => {
                            const { member, user: mUser } = mwu;
                            const isOwnerMember = mUser.id === agencyData?.ownerUserId;
                            return (
                              <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                                <Avatar className="w-8 h-8 flex-shrink-0">
                                  <AvatarImage src={mUser.avatar} />
                                  <AvatarFallback className="bg-primary/10 text-primary text-xs">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">{mUser.name}</p>
                                  <p className="text-xs text-muted-foreground">{mUser.email}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {isOwnerMember && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Owner</span>}
                                  {!isOwnerMember && (
                                    <button
                                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                                      onClick={async () => {
                                        if (!confirm(`Remove ${mUser.name} from your agency?`)) return;
                                        try {
                                          await apiRequest("DELETE", `/api/agencies/${agencyData.id}/members/${mUser.id}`);
                                          queryClient.invalidateQueries({ queryKey: ["/api/agencies/dashboard", agencyData.id] });
                                          toast({ title: `${mUser.name} removed` });
                                        } catch { toast({ title: "Something went wrong", variant: "destructive" }); }
                                      }}
                                    >
                                      <XCircle size={13} /> Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* Admin panel shortcut — only visible to admins */}
        {(user as any)?.isAdmin && (
          <Link href="/admin">
            <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-5 mb-4 flex items-center justify-between cursor-pointer hover:border-destructive/50 hover:shadow-sm transition-all group">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert size={18} className="text-destructive" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-destructive">Content Moderation</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Remove posts that violate guidelines</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-muted-foreground group-hover:text-destructive transition-colors" />
            </div>
          </Link>
        )}

        {/* Workspace shortcut */}
        <Link href="/workspace">
          <div className="bg-card border border-border rounded-2xl p-5 mb-6 flex items-center justify-between cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <LayoutGrid size={18} className="text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">My Workspace</p>
                <p className="text-xs text-muted-foreground mt-0.5">Tasks, calendar &amp; personal notes</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </Link>

        {/* Profile section — portfolio left, account details right */}
        <div className={isFreelancer && ownProfile ? "grid lg:grid-cols-[1fr,340px] gap-6 items-start" : "max-w-lg"}>
          {/* Portfolio — freelancers only */}
          {isFreelancer && ownProfile && (
            <PortfolioEditor
              profileId={ownProfile?.id}
              currentItems={(() => {
                try { return JSON.parse(ownProfile?.portfolioItems || "[]"); }
                catch { return []; }
              })()}
              currentReelUrl={ownProfile?.reelUrl ?? ""}
            />
          )}

          {/* Account details */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-semibold mb-5">Account details</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Name</label>
                <p className="font-medium mt-0.5">{user.name}</p>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Email</label>
                <p className="font-medium mt-0.5">{user.email}</p>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Role</label>
                <p className="font-medium capitalize mt-0.5">{user.role}</p>
              </div>
              {user.bio && (
                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Bio</label>
                  <p className="text-sm text-muted-foreground mt-0.5">{user.bio}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-6 flex-wrap">
              <Button variant="outline" className="gap-2" onClick={() => setEditProfileOpen(true)}>
                <Settings size={14} /> Edit profile
              </Button>
              {isFreelancer && ownProfile && (
                <Button variant="outline" className="gap-2" onClick={() => setPreviewOpen(true)}>
                  <Eye size={14} /> Preview
                </Button>
              )}
              {isFreelancer && (
                <Button variant="outline" className="gap-2" onClick={() => setInvoiceTemplateOpen(true)}>
                  <FileText size={14} /> Invoice settings
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reviews modal */}
      <Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stars rating={ownProfile?.rating || 0} />
              <span>{(ownProfile?.rating || 0).toFixed(1)}</span>
              <span className="text-muted-foreground font-normal text-sm">· {ownReviews.length} reviews</span>
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 space-y-4 pr-1 mt-2">
            {ownReviews.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No reviews yet</p>
            ) : ownReviews.map((r: any) => (
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

      {/* Edit Profile modal */}
      {previewOpen && user && ownProfile && (
        <ProfilePreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          user={{
            name:     user.name,
            avatar:   user.avatar ?? null,
            banner:   (user as any).banner ?? null,
            headline: (user as any).headline ?? null,
            bio:      user.bio ?? null,
            location: (user as any).location ?? null,
          }}
          profile={{
            availability:    ownProfile.availability,
            specialisms:     ownProfile.specialisms,
            skills:          ownProfile.skills,
            badges:          ownProfile.badges,
            portfolioItems:  ownProfile.portfolioItems,
            reelUrl:         ownProfile.reelUrl ?? null,
            yearsExperience: ownProfile.yearsExperience ?? null,
            hourlyRate:      ownProfile.hourlyRate ?? null,
            dayRate:         ownProfile.dayRate ?? null,
            rating:          ownProfile.rating ?? null,
            reviewCount:     ownProfile.reviewCount ?? null,
            projectCount:    ownProfile.projectCount ?? null,
            isPro:           ownProfile.isPro ?? null,
            cardThumbnail:   ownProfile.cardThumbnail ?? null,
          }}
        />
      )}

      {editProfileOpen && user && (
        <EditProfileModal
          open={editProfileOpen}
          onClose={() => setEditProfileOpen(false)}
          user={{
            id: user.id,
            name: user.name,
            email: user.email,
            bio: user.bio ?? "",
            headline: (user as any).headline ?? "",
            avatar: user.avatar ?? "",
            banner: (user as any).banner ?? "",
            location: (user as any).location ?? "",
            role: user.role,
          }}
          profile={ownProfile ? {
            id:              ownProfile.id,
            availability:    ownProfile.availability,
            specialisms:     ownProfile.specialisms,
            skills:          ownProfile.skills,
            yearsExperience: ownProfile.yearsExperience ?? null,
            hourlyRate:      ownProfile.hourlyRate ?? null,
            dayRate:         ownProfile.dayRate ?? null,
            cardThumbnail:   ownProfile.cardThumbnail ?? null,
          } : undefined}
        />
      )}

      {/* Invoice Template Editor */}
      {isFreelancer && (
        <InvoiceTemplateEditor
          open={invoiceTemplateOpen}
          onClose={() => setInvoiceTemplateOpen(false)}
          existing={invoiceTemplate}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['/api/invoice-template'] })}
        />
      )}
    </div>
  );
}

// ── Invoice Template Editor ───────────────────────────────────────────────────────────────────────────────
function InvoiceTemplateEditor({ open, onClose, existing, onSaved }: {
  open: boolean;
  onClose: () => void;
  existing: any;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    businessName: '',
    businessAddress: '',
    businessEmail: '',
    businessPhone: '',
    logoUrl: '',
    vatNumber: '',
    paymentTerms: 'Payment processed securely through Viewrr',
    footerNote: '',
    accentColor: '#FF5A1F',
  });

  // Sync existing data into form when dialog opens
  useEffect(() => {
    if (existing) {
      setForm({
        businessName: existing.businessName || '',
        businessAddress: existing.businessAddress || '',
        businessEmail: existing.businessEmail || '',
        businessPhone: existing.businessPhone || '',
        logoUrl: existing.logoUrl || '',
        vatNumber: existing.vatNumber || '',
        paymentTerms: existing.paymentTerms || 'Payment processed securely through Viewrr',
        footerNote: existing.footerNote || '',
        accentColor: existing.accentColor || '#FF5A1F',
      });
    }
  }, [existing, open]);

  async function handleSave() {
    setSaving(true);
    try {
      await apiRequest('POST', '/api/invoice-template', form);
      onSaved();
      toast({ title: 'Invoice settings saved' });
      onClose();
    } catch (e) {
      toast({ title: 'Failed to save', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, key: keyof typeof form, placeholder = '', type: 'input' | 'textarea' | 'color' = 'input') {
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</label>
        {type === 'textarea' ? (
          <Textarea
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            className="text-sm resize-none"
            rows={3}
          />
        ) : type === 'color' ? (
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5 bg-transparent"
            />
            <Input
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              placeholder="#FF5A1F"
              className="text-sm font-mono w-32"
            />
            <p className="text-xs text-muted-foreground">Used as accent on your invoice</p>
          </div>
        ) : (
          <Input
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            className="text-sm"
          />
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0" style={{ borderRadius: 20 }}>
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">Invoice Settings</h2>
            <p className="text-xs text-muted-foreground mt-0.5">This branding appears on all invoices you send to clients</p>
          </div>
          {/* Viewrr stamp notice */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(255,90,31,0.08)', color: '#FF5A1F', border: '1px solid rgba(255,90,31,0.2)' }}>
            <svg width="10" height="10" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="#FF5A1F"/><path d="M9 11l7 10 7-10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Viewrr stamp always included
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {field('Business / Trading Name', 'businessName', 'Your Name or Studio Name')}
          {field('Business Address', 'businessAddress', '123 High Street\nLondon, EC1A 1BB', 'textarea')}
          {field('Business Email', 'businessEmail', 'hello@yourstudio.com')}
          {field('Business Phone', 'businessPhone', '+44 7700 900000')}
          {field('Logo URL', 'logoUrl', 'https://… (optional, shown top-left)')}
          {field('VAT Number', 'vatNumber', 'GB123456789 (leave blank if not registered)')}
          {field('Payment Terms', 'paymentTerms', 'e.g. Payment due on receipt', 'textarea')}
          {field('Footer Note', 'footerNote', 'e.g. Thank you for your business!')}
          {field('Accent Colour', 'accentColor', '#FF5A1F', 'color')}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 text-white font-semibold"
            style={{ background: 'linear-gradient(135deg,#FF5A1F,#FF8C42)' }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Invoice Settings'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
