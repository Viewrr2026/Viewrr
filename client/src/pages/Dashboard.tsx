import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bookmark, MessageSquare, User, Send, Settings, LogOut, Star, TrendingUp, Briefcase, FileText, CheckCircle2, Clock, XCircle, ChevronRight, MapPin, Users, Film, CheckCircle, AlertCircle } from "lucide-react";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl, isValidVideoUrl } from "@/lib/videoEmbed";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FreelancerCard from "@/components/FreelancerCard";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
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

// ── ShowreelEditor ─────────────────────────────────────────────────────
function ShowreelEditor({ profileId, currentUrl }: { profileId?: number; currentUrl: string }) {
  const { toast } = useToast();
  const [url, setUrl] = useState(currentUrl);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const parsed = parseVideoUrl(url);
  const isValid = isValidVideoUrl(url);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error("No profile found");
      const res = await apiRequest("PATCH", `/api/profiles/${profileId}`, { reelUrl: url.trim() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles/own"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({ title: "Showreel saved!" });
    },
    onError: () => toast({ title: "Failed to save showreel", variant: "destructive" }),
  });

  function handleSave() {
    if (url.trim() && !isValid) {
      setError("Please paste a valid Vimeo or YouTube link.");
      return;
    }
    setError("");
    saveMutation.mutate();
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Film size={16} className="text-primary" />
        <h3 className="font-semibold">Showreel</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Paste your Vimeo or YouTube showreel link below. It will display directly on your public profile — hosted by Vimeo/YouTube, zero upload needed.
      </p>

      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="https://vimeo.com/123456789  or  https://youtu.be/..."
            value={url}
            onChange={e => { setUrl(e.target.value); setError(""); setSaved(false); }}
            className={`flex-1 ${error ? "border-destructive" : ""}`}
          />
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-white px-4 rounded-xl flex-shrink-0"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle size={12} /> {error}
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle size={12} /> Saved — visible on your public profile
          </p>
        )}
        {url && !error && (
          <p className="text-xs text-muted-foreground">
            {parsed
              ? `Detected: ${parsed.provider === "vimeo" ? "Vimeo" : "YouTube"} video`
              : "Not a recognised Vimeo or YouTube link yet"}
          </p>
        )}
      </div>

      {/* Live preview */}
      {isValid && url && (
        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
          <VideoEmbed url={url} className="rounded-xl" />
        </div>
      )}

      {!url && (
        <div className="mt-5 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl py-10 gap-2 text-muted-foreground">
          <Film size={28} className="opacity-30" />
          <p className="text-sm">No showreel added yet</p>
          <p className="text-xs opacity-60">Paste a Vimeo or YouTube link above</p>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [activeConv, setActiveConv] = useState<{ id: number; name: string; avatar?: string } | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null); // null = nothing selected yet

  // Must be defined before any query that references it
  const isFreelancer = user?.role === "freelancer";

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
  const ownConnCount = user ? connectionCount(user.id) : 0;

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
                <div>
                  <h1 className="text-2xl font-bold">{user.name}</h1>
                  {/* Specialisms + location row */}
                  <div className="flex flex-wrap gap-2 mt-1">
                    {isFreelancer && ownSpecialisms.length > 0
                      ? ownSpecialisms.map(s => (
                          <span key={s} className="text-sm text-primary font-semibold">{s}</span>
                        ))
                      : <span className="text-sm text-muted-foreground capitalize">{user.role}</span>
                    }
                    {user.location && (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin size={12} /> {user.location}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Availability badge (freelancers only) */}
                  {isFreelancer && ownProfile && (
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${availClass[ownProfile.availability] ?? availClass.available}`}>
                      {availLabel[ownProfile.availability] ?? "Available for work"}
                    </span>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {(isFreelancer ? [
            { label: "Profile views",  value: String(profileViewCount),      icon: TrendingUp,   tab: "profile-views" },
            { label: "Messages",       value: String(conversations.length),   icon: MessageSquare, tab: "messages" },
            { label: "Interests sent", value: String(interests.length),       icon: FileText,     tab: "interests" },
            { label: "Projects",       value: "—",                            icon: Briefcase,    tab: null },
          ] : [
            { label: "Saved creatives",    value: String(savedProfiles.length), icon: Bookmark,      tab: "saved" },
            { label: "Messages",           value: String(conversations.length), icon: MessageSquare, tab: "messages" },
            { label: "Interests received", value: String(interests.length),     icon: FileText,      tab: "interests" },
            { label: "Projects posted",    value: "—",                          icon: Briefcase,     tab: null },
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
              <div className="p-5">
                <h3 className="font-semibold mb-4">{isFreelancer ? "Interests sent" : "Interests received"}</h3>
                {interests.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <FileText size={28} className="mx-auto mb-3 opacity-40" />
                    <p className="font-semibold text-foreground mb-1">{isFreelancer ? "No interests sent yet" : "No interests received yet"}</p>
                    <p className="text-sm mb-4">
                      {isFreelancer ? "Browse the briefs board and express interest in projects that suit you." : "Once freelancers express interest in your briefs, they'll appear here."}
                    </p>
                    <Button asChild className="bg-primary hover:bg-primary/90 text-white">
                      <Link href="/briefs">{isFreelancer ? "Browse briefs" : "View briefs board"}</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {isFreelancer ? (
                      interests.map((interest: any) => (
                        <div key={interest.id} className="bg-background border border-border rounded-2xl p-5">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm leading-snug">{interest.briefTitle}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">Brief by {interest.briefClientName}</p>
                            </div>
                            <InterestStatusBadge status={interest.status} />
                          </div>
                          <div className="bg-muted/50 rounded-xl p-3 mb-3">
                            <p className="text-xs text-muted-foreground mb-1 font-semibold uppercase tracking-wide">Your cover note</p>
                            <p className="text-sm leading-relaxed">{interest.coverNote}</p>
                          </div>
                          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                            {interest.rate && <span>Rate: <span className="font-medium text-foreground">{interest.rate}</span></span>}
                            {interest.availability && <span>Available from: <span className="font-medium text-foreground">{interest.availability}</span></span>}
                          </div>
                          <div className="flex flex-col gap-0.5 mt-2 text-xs text-muted-foreground">
                            <span>Sent: {formatUK(interest.createdAt)}</span>
                            {interest.respondedAt && (
                              <span>{interest.status === "accepted" ? "Accepted" : "Declined"} by client: {formatUK(interest.respondedAt)}</span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      interests.map((interest: any) => (
                        <ClientInterestCard
                          key={interest.id}
                          interest={interest}
                          onStatusChange={(id: number, status: string) => {
                            fetch(`/api/interests/${id}/status`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status, clientName: user?.name, clientAvatar: user?.avatar }),
                            }).then(() => refetchInterests());
                          }}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* Profile section — always visible at the bottom */}
        <div className="space-y-6 max-w-lg">
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
            <Button variant="outline" className="mt-6 gap-2">
              <Settings size={14} /> Edit profile
            </Button>
          </div>
          {isFreelancer && <ShowreelEditor profileId={ownProfile?.id} currentUrl={ownProfile?.reelUrl ?? ""} />}
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
    </div>
  );
}
