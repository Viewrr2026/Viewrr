import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Building2, MapPin, Globe, ExternalLink, Users, Star, Quote, Play, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface AgencyMemberWithUser {
  member: { id: number; agencyId: number; userId: number; status: string; joinedAt: string | null };
  user: { id: number; name: string; avatar: string | null; location: string | null; headline: string | null; role: string };
  profile: {
    id: number;
    userId: number;
    specialisms: string;
    rating: number | null;
    reviewCount: number | null;
    projectCount: number | null;
    isPro: number | null;
    reelUrl: string | null;
    availability: string;
  } | null;
}

interface Agency {
  id: number;
  name: string;
  slug: string;
  bio: string;
  logo: string | null;
  banner: string | null;
  location: string | null;
  website: string | null;
  specialisms: string;
  reelUrl: string | null;
  ownerUserId: number;
  inviteCode: string;
  createdAt: string;
  featuredWork?: string; // JSON array of {url, label, type}
  testimonials?: string; // JSON array of {name, role, company, quote, avatar?}
}

export default function AgencyProfile() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [briefModalOpen, setBriefModalOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<{ agency: Agency; members: AgencyMemberWithUser[] }>({
    queryKey: ["/api/agencies/slug", slug],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agencies/slug/${slug}`);
      if (!res.ok) throw new Error("Agency not found");
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading agency…</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Building2 size={28} className="text-muted-foreground" />
          </div>
          <h2 className="font-bold text-lg">Agency not found</h2>
          <p className="text-sm text-muted-foreground">This agency page doesn't exist or has been removed.</p>
          <Button variant="outline" onClick={() => navigate("/marketplace")} className="rounded-full">Browse freelancers</Button>
        </div>
      </div>
    );
  }

  const { agency, members } = data;
  const specialisms: string[] = (() => { try { return JSON.parse(agency.specialisms || "[]"); } catch { return []; } })();
  const activeMembers = members.filter(m => m.member.status === "active");
  const reelParsed = agency.reelUrl ? parseVideoUrl(agency.reelUrl) : null;
  const featuredWork: Array<{ url: string; label: string; type: "image" | "video" }> = (() => {
    try { const p = JSON.parse(agency.featuredWork || "[]"); return Array.isArray(p) ? p : []; } catch { return []; }
  })();
  const testimonials: Array<{ name: string; role: string; company: string; quote: string; avatar?: string }> = (() => {
    try { const p = JSON.parse(agency.testimonials || "[]"); return Array.isArray(p) ? p : []; } catch { return []; }
  })();

  return (
    <div className="min-h-screen bg-background">

      {/* Banner / Hero */}
      <div className="relative h-48 md:h-64 bg-gradient-to-br from-neutral-900 to-neutral-800 overflow-hidden">
        {agency.banner
          ? <img src={agency.banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
          : <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "repeating-linear-gradient(45deg,#FF5A1F 0,#FF5A1F 1px,transparent 0,transparent 50%)", backgroundSize: "12px 12px" }} />
        }
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 -mt-12 relative">

        {/* Agency header card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-end gap-5">
            {/* Logo */}
            <div className="w-20 h-20 rounded-2xl border-4 border-background bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden shadow-sm -mt-10">
              {agency.logo
                ? <img src={agency.logo} alt={agency.name} className="w-full h-full object-cover" />
                : <Building2 size={32} className="text-primary" />
              }
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-xl text-foreground truncate">{agency.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                {agency.location && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin size={11} /> {agency.location}
                  </span>
                )}
                {agency.website && (
                  <a
                    href={agency.website.startsWith("http") ? agency.website : `https://${agency.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Globe size={11} /> {agency.website.replace(/^https?:\/\//, "")}
                    <ExternalLink size={9} />
                  </a>
                )}
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users size={11} /> {activeMembers.length} member{activeMembers.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>

          {agency.bio && (
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{agency.bio}</p>
          )}

          {specialisms.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {specialisms.map((s: string) => (
                <span key={s} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Showreel */}
        {reelParsed && (
          <div className="mt-6">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Showreel</h2>
            <div className="rounded-xl overflow-hidden border border-border">
              <VideoEmbed embedUrl={reelParsed.embedUrl} platform={reelParsed.platform} />
            </div>
          </div>
        )}

        {/* Featured Work Gallery */}
        {featuredWork.length > 0 && (
          <div className="mt-8">
            <h2 className="font-semibold text-base mb-4">Featured Work</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {featuredWork.map((item, idx) => (
                <a
                  key={idx}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`card-featured-work-${idx}`}
                  className="group relative rounded-2xl overflow-hidden bg-card border border-border hover:border-primary/40 hover:shadow-md transition-all aspect-video block"
                >
                  {item.type === "image" ? (
                    <img
                      src={item.url}
                      alt={item.label}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        const t = e.currentTarget;
                        t.style.display = "none";
                        const fb = t.nextElementSibling as HTMLElement | null;
                        if (fb) fb.style.display = "flex";
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-neutral-900 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-primary/80 transition-colors">
                        <Play size={18} className="text-white ml-0.5" />
                      </div>
                    </div>
                  )}
                  {/* Image fallback */}
                  <div
                    style={{ display: "none" }}
                    className="absolute inset-0 bg-muted items-center justify-center"
                    role="img"
                    aria-label={item.label}
                  >
                    <Building2 size={24} className="text-muted-foreground/40" />
                  </div>
                  {/* Label overlay */}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                    <p className="text-white text-xs font-medium truncate">{item.label}</p>
                  </div>
                  {item.type === "video" && (
                    <span className="absolute top-2 right-2 bg-black/60 text-white text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded">Video</span>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Client Testimonials */}
        {testimonials.length > 0 && (
          <div className="mt-10">
            <h2 className="font-semibold text-base mb-4">What clients say</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {testimonials.map((t, idx) => (
                <div
                  key={idx}
                  data-testid={`card-testimonial-${idx}`}
                  className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3"
                >
                  <Quote size={16} className="text-primary/40 shrink-0" />
                  <p className="text-sm text-foreground/80 italic leading-relaxed flex-1">"{t.quote}"</p>
                  <div className="flex items-center gap-3 pt-3 border-t border-border">
                    {t.avatar
                      ? <img src={t.avatar} alt={t.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                      : <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">{t.name[0]}</div>
                    }
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {t.role}{t.company ? ` · ${t.company}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact CTA */}
        <div className="mt-8 flex items-center gap-3 p-5 bg-primary/5 border border-primary/20 rounded-2xl">
          <div className="flex-1">
            <p className="font-semibold text-sm">Work with {agency.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Send a brief directly and receive a custom proposal.</p>
          </div>
          <Button
            onClick={() => {
              if (!user) { navigate("/login"); return; }
              setBriefModalOpen(true);
            }}
            className="bg-primary hover:bg-primary/90 text-white gap-2 shrink-0"
            size="sm"
          >
            <Send size={13} /> Send Brief
          </Button>
        </div>

        {/* Team grid */}
        <div className="mt-8 mb-16">
          <h2 className="font-semibold text-base mb-4">
            Meet the team
            <span className="ml-2 text-sm font-normal text-muted-foreground">({activeMembers.length})</span>
          </h2>

          {activeMembers.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No team members yet. The agency owner will invite freelancers to join.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {activeMembers.map(({ member, user, profile }) => {
                const specs: string[] = (() => { try { return JSON.parse(profile?.specialisms || "[]"); } catch { return []; } })();
                const isOwner = user.id === agency.ownerUserId;
                return (
                  <button
                    key={member.id}
                    data-testid={`card-agency-member-${member.id}`}
                    onClick={() => navigate(`/profile/${user.id}`)}
                    className="group text-left rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-md transition-all p-4 flex flex-col gap-3"
                  >
                    {/* Avatar row */}
                    <div className="flex items-center gap-3">
                      {user.avatar
                        ? <img src={user.avatar} alt={user.name} className="w-12 h-12 rounded-full object-cover" />
                        : <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">{user.name[0]}</div>
                      }
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-sm truncate">{user.name}</p>
                          {isOwner && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">Owner</span>
                          )}
                          {profile?.isPro === 1 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">PRO</span>
                          )}
                        </div>
                        {user.headline && <p className="text-xs text-muted-foreground truncate">{user.headline}</p>}
                        {user.location && !user.headline && <p className="text-xs text-muted-foreground">{user.location}</p>}
                      </div>
                    </div>

                    {/* Specialisms */}
                    {specs.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {specs.slice(0, 2).map((s: string) => (
                          <span key={s} className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px]">{s}</span>
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    {profile && (
                      <div className="flex items-center gap-3 mt-auto pt-2 border-t border-border text-xs text-muted-foreground">
                        {(profile.rating ?? 0) > 0 && (
                          <span className="flex items-center gap-1">
                            <Star size={10} className="fill-amber-400 text-amber-400" />
                            {(profile.rating ?? 0).toFixed(1)}
                          </span>
                        )}
                        {(profile.projectCount ?? 0) > 0 && (
                          <span>{profile.projectCount} project{(profile.projectCount ?? 0) !== 1 ? "s" : ""}</span>
                        )}
                        <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          profile.availability === "available"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : profile.availability === "busy"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {profile.availability}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* Brief submission modal */}
      {briefModalOpen && (
        <AgencyBriefModal
          agency={agency}
          user={user}
          onClose={() => setBriefModalOpen(false)}
          toast={toast}
        />
      )}
    </div>
  );
}

function AgencyBriefModal({ agency, user, onClose, toast }: { agency: any; user: any; onClose: () => void; toast: any }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [startDate, setStartDate] = useState("");
  const [duration, setDuration] = useState("");
  const [requirements, setRequirements] = useState("");

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/agencies/${agency.id}/briefs`, {
        clientId: user.id,
        clientName: user.name,
        clientAvatar: user.avatar || null,
        title,
        description,
        category,
        budgetMin: budgetMin ? Math.round(parseFloat(budgetMin) * 100) : null,
        budgetMax: budgetMax ? Math.round(parseFloat(budgetMax) * 100) : null,
        startDate: startDate || null,
        duration: duration || null,
        requirements,
      });
      if (!res.ok) throw new Error("Failed to send brief");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Brief sent!", description: `${agency.name} will review your brief and respond with a proposal.` });
      onClose();
    },
    onError: () => toast({ title: "Couldn't send brief", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="font-bold text-base">Send a Brief</h3>
            <p className="text-xs text-muted-foreground mt-0.5">to {agency.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5">Project title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Brand film for product launch" className="h-10 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe what you're looking for, the goals, and any key details…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5">Category</label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Film & Video" className="h-9 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5">Duration</label>
              <Input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 4 weeks" className="h-9 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5">Budget min (£)</label>
              <Input type="number" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="0" className="h-9 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5">Budget max (£)</label>
              <Input type="number" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="0" className="h-9 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Ideal start date</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Requirements <span className="font-normal text-muted-foreground/70">(optional)</span></label>
            <Input value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="Any specific skills, equipment, or deliverables…" className="h-9 text-sm" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} className="flex-1 h-10">Cancel</Button>
            <Button
              size="sm"
              onClick={() => sendMutation.mutate()}
              disabled={!title.trim() || !description.trim() || sendMutation.isPending}
              className="flex-1 h-10 bg-primary hover:bg-primary/90 text-white gap-2"
            >
              {sendMutation.isPending ? <span className="animate-pulse">Sending…</span> : <><Send size={13} /> Send Brief</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
