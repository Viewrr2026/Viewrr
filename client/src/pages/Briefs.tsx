import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { MapPin, Clock, Briefcase, PoundSterling, Plus, Calendar, Wifi, Users, ChevronRight, X, Search, Send, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type Brief = {
  id: number;
  clientName: string;
  clientAvatar?: string;
  title: string;
  description: string;
  category: string;
  location: string;
  remote: number;
  startDate?: string;
  duration?: string;
  budgetMin?: number;
  budgetMax?: number;
  budgetType: string;
  requirements: string;
  status: string;
  applicationCount: number;
  createdAt: string;
};

const SEED_BRIEFS: Brief[] = [
  {
    id: 1,
    clientName: "SoundWave Events",
    clientAvatar: "",
    title: "Videographer for Summer Music Festival",
    description: "We're looking for an experienced videographer to cover our 3-day outdoor music festival in Manchester this August. You'll capture headline acts, crowd atmosphere, backstage moments and create a highlight reel for social media. Must be comfortable working in a busy, fast-paced environment with multiple stages running simultaneously.",
    category: "Videography",
    location: "Manchester, UK",
    remote: 0,
    startDate: "2026-08-10",
    duration: "2–3 days",
    budgetMin: 800,
    budgetMax: 1500,
    budgetType: "project",
    requirements: "Own 4K camera, drone licence preferred, event experience required, fast turnaround editing",
    status: "open",
    applicationCount: 7,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 2,
    clientName: "The Whitmore Family",
    clientAvatar: "",
    title: "Wedding Videographer — Cotswolds",
    description: "We're getting married in the Cotswolds in September and are looking for a videographer to capture our special day. We'd love a cinematic film of 5–8 minutes plus a social teaser. We have a church ceremony followed by a barn reception. Looking for someone with a warm, natural documentary style rather than overly produced.",
    category: "Videography",
    location: "Cotswolds, UK",
    remote: 0,
    startDate: "2026-09-14",
    duration: "1 day",
    budgetMin: 1200,
    budgetMax: 2000,
    budgetType: "project",
    requirements: "Wedding portfolio required, cinematic style, dual-camera setup preferred",
    status: "open",
    applicationCount: 12,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 3,
    clientName: "Bloom Botanics",
    clientAvatar: "",
    title: "Product & Lifestyle Photographer for Instagram",
    description: "We're a luxury indoor plant brand looking for a photographer to shoot a series of lifestyle images for our Instagram and website refresh. We need 30–40 edited images across two sessions — product flats, lifestyle setups in home environments, and detail shots. Must have experience with product photography and a clean, airy aesthetic.",
    category: "Photography",
    location: "London, UK",
    remote: 0,
    startDate: "2026-05-20",
    duration: "2–3 days",
    budgetMin: 600,
    budgetMax: 1000,
    budgetType: "project",
    requirements: "Product photography portfolio, own studio lighting, experience with lifestyle shoots",
    status: "open",
    applicationCount: 4,
    createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
  {
    id: 4,
    clientName: "ProSport Media",
    clientAvatar: "",
    title: "Sports Highlight Editor — YouTube Channel",
    description: "We run a growing YouTube sports analysis channel (85k subscribers) and need a skilled video editor to produce weekly highlight and analysis videos. You'll work from raw footage and talking head recordings to create punchy, well-paced 8–12 minute videos with graphics, lower thirds and music. Must be available weekly on an ongoing basis.",
    category: "Video Editing",
    location: "Remote",
    remote: 1,
    startDate: "2026-05-01",
    duration: "Ongoing",
    budgetMin: 200,
    budgetMax: 350,
    budgetType: "project",
    requirements: "Adobe Premiere Pro or DaVinci Resolve, sports content experience, fast turnaround, motion graphics a bonus",
    status: "open",
    applicationCount: 9,
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 5,
    clientName: "Maison Oré",
    clientAvatar: "",
    title: "Brand Marketing Campaign — Luxury Skincare Launch",
    description: "We are launching a new luxury skincare line in the UK and need a creative marketer to develop and execute our launch campaign across Instagram, TikTok and paid channels. This is a 3-month contract role covering strategy, content briefs, influencer outreach and performance reporting. Experience with beauty or lifestyle brands is essential.",
    category: "Marketing",
    location: "London, UK",
    remote: 1,
    startDate: "2026-06-01",
    duration: "1–3 months",
    budgetMin: 3000,
    budgetMax: 5000,
    budgetType: "project",
    requirements: "Luxury brand experience, Instagram & TikTok strategy, influencer management, analytics reporting",
    status: "open",
    applicationCount: 3,
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
];

const CATEGORIES = ["All", "Videography", "Video Editing", "Photography", "Marketing", "Other"];

const categoryColour: Record<string, string> = {
  Videography: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "Video Editing": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  Photography: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Marketing: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  Other: "bg-muted text-muted-foreground",
};

function formatBudget(brief: Brief) {
  if (!brief.budgetMin && !brief.budgetMax) return "Budget TBC";
  const suffix = brief.budgetType === "day" ? "/day" : brief.budgetType === "hour" ? "/hr" : "";
  if (brief.budgetMin && brief.budgetMax)
    return `£${brief.budgetMin.toLocaleString()} – £${brief.budgetMax.toLocaleString()}${suffix}`;
  if (brief.budgetMax) return `Up to £${brief.budgetMax.toLocaleString()}${suffix}`;
  return `From £${brief.budgetMin?.toLocaleString()}${suffix}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

function BriefRow({ brief, isActive, onClick }: { brief: Brief; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-5 py-4 border-b border-border transition-all group relative ${
        isActive
          ? "bg-primary/5 border-l-2 border-l-primary"
          : "hover:bg-muted/60 border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar className="w-10 h-10 shrink-0 mt-0.5">
          <AvatarImage src={brief.clientAvatar} />
          <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
            {brief.clientName[0]}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <h3 className={`font-semibold text-sm leading-snug ${isActive ? "text-primary" : "group-hover:text-primary transition-colors"}`}>
              {brief.title}
            </h3>
            <ChevronRight size={14} className={`shrink-0 mt-0.5 transition-colors ${isActive ? "text-primary" : "text-muted-foreground/40 group-hover:text-muted-foreground"}`} />
          </div>

          <p className="text-xs text-muted-foreground mb-1.5">{brief.clientName}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin size={11} className="text-primary/70" />
              {brief.location}{brief.remote ? " · Remote ok" : ""}
            </span>
            {brief.duration && (
              <span className="flex items-center gap-1">
                <Clock size={11} className="text-primary/70" />
                {brief.duration}
              </span>
            )}
            <span className="flex items-center gap-1 font-medium text-foreground/80">
              <PoundSterling size={11} className="text-primary/70" />
              {formatBudget(brief)}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${categoryColour[brief.category] || categoryColour.Other}`}>
              {brief.category}
            </span>
            <span className="text-xs text-muted-foreground">{timeAgo(brief.createdAt)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function BriefDetail({ brief, onClose, onApply, onCloseBrief, isOwned }: { brief: Brief; onClose: () => void; onApply: () => void; onCloseBrief?: () => void; isOwned?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={panelRef} className="flex flex-col h-full overflow-y-auto">
      {/* Detail header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start justify-between gap-3 mb-4">
          <Avatar className="w-12 h-12">
            <AvatarImage src={brief.clientAvatar} />
            <AvatarFallback className="text-base font-bold bg-primary/10 text-primary">
              {brief.clientName[0]}
            </AvatarFallback>
          </Avatar>
          {/* Mobile close */}
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${categoryColour[brief.category] || categoryColour.Other}`}>
          {brief.category}
        </span>
        <h2 className="text-xl font-bold mt-3 leading-snug">{brief.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{brief.clientName} · {timeAgo(brief.createdAt)}</p>

        <Button onClick={onApply} className="w-full mt-5 bg-primary hover:bg-primary/90 text-white rounded-full font-semibold">
          Express Interest
        </Button>
        <p className="text-xs text-center text-muted-foreground mt-2">Your profile will be shared with the client</p>
      </div>

      {/* Detail body */}
      <div className="p-6 space-y-6">
        {/* Key stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/50 rounded-xl p-3">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin size={11} /> Location</p>
            <p className="text-sm font-medium">{brief.location}</p>
            {brief.remote ? (
              <p className="text-xs text-primary mt-0.5 flex items-center gap-1"><Wifi size={10} /> Remote / hybrid ok</p>
            ) : null}
          </div>
          <div className="bg-muted/50 rounded-xl p-3">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><PoundSterling size={11} /> Budget</p>
            <p className="text-sm font-semibold text-primary">{formatBudget(brief)}</p>
          </div>
          {brief.duration && (
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock size={11} /> Duration</p>
              <p className="text-sm font-medium">{brief.duration}</p>
            </div>
          )}
          {brief.startDate && (
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar size={11} /> Start date</p>
              <p className="text-sm font-medium">
                {new Date(brief.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          )}
          <div className="bg-muted/50 rounded-xl p-3">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Users size={11} /> Applicants</p>
            <p className="text-sm font-medium">{brief.applicationCount} interested</p>
          </div>
        </div>

        {/* Description */}
        <div>
          <h3 className="font-semibold mb-2 text-sm uppercase tracking-wide text-muted-foreground">About this brief</h3>
          <p className="text-sm leading-relaxed whitespace-pre-line">{brief.description}</p>
        </div>

        {/* Requirements */}
        {brief.requirements && (
          <div>
            <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Requirements</h3>
            <ul className="space-y-2">
              {brief.requirements.split(",").map((req, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  {req.trim()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bottom CTA */}
        <Button onClick={onApply} className="w-full bg-primary hover:bg-primary/90 text-white rounded-full font-semibold">
          Express Interest
        </Button>
        {isOwned && onCloseBrief && (
          <button
            onClick={onCloseBrief}
            className="w-full mt-2 text-xs text-muted-foreground hover:text-destructive transition-colors text-center"
          >
            Close this brief (remove from board)
          </button>
        )}
      </div>
    </div>
  );
}

// ── Express Interest modal ────────────────────────────────────────────────────
function ExpressInterestModal({ brief, open, onClose }: { brief: Brief | null; open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"form" | "done">("form");
  const [coverNote, setCoverNote] = useState("");
  const [rate, setRate] = useState("");
  const [availability, setAvailability] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!coverNote.trim()) return;
    setStep("done");
  }

  function handleClose() {
    setStep("form"); setCoverNote(""); setRate(""); setAvailability("");
    onClose();
  }

  if (!brief) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        {step === "form" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Send size={16} className="text-primary" />
                Express interest
              </DialogTitle>
            </DialogHeader>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-xl mb-1">
              <Avatar className="w-9 h-9 shrink-0">
                <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">{brief.clientName[0]}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-sm leading-snug">{brief.title}</p>
                <p className="text-xs text-muted-foreground">{brief.clientName} · {formatBudget(brief)}</p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cover note <span className="text-destructive">*</span></label>
                <Textarea
                  placeholder={`Tell ${brief.clientName} why you're the right person for this project. Mention relevant experience, your approach, and why it excites you.`}
                  value={coverNote}
                  onChange={e => setCoverNote(e.target.value)}
                  rows={5}
                  className="resize-none"
                  required
                />
                <p className="text-xs text-muted-foreground">{coverNote.length}/500 — keep it focused and personal.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your rate</label>
                  <Input placeholder="e.g. £500/day" value={rate} onChange={e => setRate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available from</label>
                  <Input type="date" value={availability} onChange={e => setAvailability(e.target.value)} />
                </div>
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Your Viewrr profile</strong> will be shared with {brief.clientName} alongside this note, including your portfolio, ratings and skills.
              </div>

              <Button type="submit" disabled={!coverNote.trim()} className="w-full bg-primary hover:bg-primary/90 text-white rounded-full">
                Submit application
              </Button>
            </form>
          </>
        ) : (
          <div className="py-8 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle size={30} className="text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Application sent!</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                {brief.clientName} will be able to review your profile and cover note. You'll hear back if they're interested.
              </p>
            </div>
            <Button onClick={handleClose} variant="outline" className="rounded-full">Back to briefs</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Briefs() {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Brief | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [apiBriefs, setApiBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Load briefs from the real API on mount; fall back to seed data if unavailable
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/briefs");
        if (res.ok) {
          const data: Brief[] = await res.json();
          setApiBriefs(data.length > 0 ? data : null);
          if (data.length > 0) setSelected(data[0]);
          else setSelected(SEED_BRIEFS[0]);
        } else {
          setApiBriefs(null);
          setSelected(SEED_BRIEFS[0]);
        }
      } catch {
        setApiBriefs(null);
        setSelected(SEED_BRIEFS[0]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Use real API data when available, otherwise fall back to seeds
  const allBriefs: Brief[] = apiBriefs ?? SEED_BRIEFS;

  const briefs = allBriefs.filter(b => {
    if (category !== "All" && b.category !== category) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return b.title.toLowerCase().includes(q) ||
        b.clientName.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.location.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q);
    }
    return true;
  });

  // Reset selection when filter/search changes
  useEffect(() => {
    setSelected(briefs[0] ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, search]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-16 z-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h1 className="text-xl font-bold">Briefs Board</h1>
              <p className="text-xs text-muted-foreground mt-0.5">{briefs.length} open brief{briefs.length !== 1 ? "s" : ""}</p>
            </div>
            <Link href="/briefs/new">
              <Button className="bg-primary hover:bg-primary/90 text-white rounded-full px-4 gap-1.5 text-sm shrink-0">
                <Plus size={15} />
                Post a Brief
              </Button>
            </Link>
          </div>

          {/* ✅ Item 11 — Search bar */}
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search briefs by title, client, location..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-full border border-border bg-background text-sm focus:outline-none focus:border-primary transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Category filters */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  category === cat
                    ? "bg-primary text-white border-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Split layout */}
      <div className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6">
        {briefs.length === 0 ? (
          <div className="text-center py-24">
            <Briefcase size={40} className="mx-auto text-muted-foreground mb-4 opacity-40" />
            <p className="text-muted-foreground mb-4">No briefs in this category yet.</p>
            <Link href="/briefs/new">
              <Button className="rounded-full bg-primary text-white hover:bg-primary/90">Post the first brief</Button>
            </Link>
          </div>
        ) : (
          <div className="flex gap-4 items-start">
            {/* LEFT — scrollable list */}
            <div className="w-full md:w-[380px] lg:w-[420px] shrink-0 bg-card border border-border rounded-2xl overflow-hidden">
              {briefs.map(b => (
                <BriefRow
                  key={b.id}
                  brief={b}
                  isActive={selected?.id === b.id}
                  onClick={() => setSelected(b)}
                />
              ))}
            </div>

            {/* RIGHT — sticky detail panel */}
            {selected && (
              <div className="hidden md:block flex-1 bg-card border border-border rounded-2xl sticky top-[9rem] max-h-[calc(100vh-10rem)] overflow-y-auto">
                <BriefDetail
                  brief={selected}
                  onClose={() => setSelected(null)}
                  onApply={() => setApplyOpen(true)}
                  isOwned={false}
                />
              </div>
            )}
          </div>
        )}

        {/* Mobile full-screen detail overlay */}
        {selected && (
          <div className="md:hidden fixed inset-0 z-50 bg-background overflow-y-auto" style={{ top: "4rem" }}>
            <BriefDetail
              brief={selected}
              onClose={() => setSelected(null)}
              onApply={() => setApplyOpen(true)}
              isOwned={false}
            />
          </div>
        )}

        {/* Express Interest modal */}
        <ExpressInterestModal brief={selected} open={applyOpen} onClose={() => setApplyOpen(false)} />
      </div>
    </div>
  );
}
