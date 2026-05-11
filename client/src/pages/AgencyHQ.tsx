import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Building2, Users, Briefcase, PoundSterling, Clock, Copy,
  ExternalLink, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  LayoutGrid, UserPlus, Star, Timer, GitBranch, Plane, Database,
  ArrowLeft, CalendarClock, User, BarChart2, TrendingUp, Info,
  Pencil, Check, X, Plus, Trash2, Image, MessageSquare, Settings,
  FileText, TrendingDown, AlertCircle, Send, Inbox, Trophy,
  Activity, ChevronRight, DollarSign, Calendar, Tag,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={11}
          className={i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}
        />
      ))}
    </div>
  );
}

type HqTab = "overview" | "team" | "jobs" | "invite" | "reports" | "profile" | "pipeline" | "activity";
type PipelineStage = "all" | "incoming" | "viewed" | "proposal_sent" | "won" | "lost" | "declined";

export default function AgencyHQ() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<HqTab>("overview");
  const [expandedMember, setExpandedMember] = useState<number | null>(null);
  // Rate card editing state: memberId -> { role, dayRate, hourlyRate }
  const [editingRateId, setEditingRateId] = useState<number | null>(null);
  const [rateForm, setRateForm] = useState<{ role: string; dayRate: string; hourlyRate: string }>({ role: "", dayRate: "", hourlyRate: "" });
  // Pipeline state
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("all");
  const [selectedBrief, setSelectedBrief] = useState<any | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);

  const isAgencyOwner = user?.role === "freelancer" && (user as any)?.accountSubtype === "agency_owner";

  const { data: agencyData } = useQuery<any>({
    queryKey: ["/api/agencies/mine", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/agencies/mine/${user!.id}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!user && isAgencyOwner,
  });

  const { data: dash } = useQuery<any>({
    queryKey: ["/api/agencies/dashboard", agencyData?.id],
    queryFn: async () => {
      const res = await fetch(`/api/agencies/${agencyData!.id}/dashboard`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!agencyData?.id,
    refetchInterval: 30000,
  });

  // Not logged in or not an agency owner
  if (!user || !isAgencyOwner) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center px-6">
        <Building2 size={36} className="text-muted-foreground/40 mb-4" />
        <h2 className="text-xl font-bold mb-2">Agency owners only</h2>
        <p className="text-muted-foreground mb-6 max-w-sm">This page is only accessible to Creative Agency accounts.</p>
        <Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>
      </div>
    );
  }

  const activeMembers = (dash?.members ?? []).filter((m: any) => m.member.status === "active");
  const pendingMembers = (dash?.members ?? []).filter((m: any) => m.member.status === "pending");

  const copyInviteLink = () => {
    if (!agencyData) return;
    const link = `${window.location.origin}/#/join/${agencyData.inviteCode}`;
    navigator.clipboard?.writeText(link).then(() =>
      toast({ title: "Invite link copied!", description: "Share it with freelancers you want to invite." })
    );
  };

  // Rate card mutation
  const rateMutation = useMutation({
    mutationFn: async ({ memberId, data }: { memberId: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/agencies/${agencyData!.id}/members/${memberId}/rate`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agencies/dashboard", agencyData?.id] });
      setEditingRateId(null);
      toast({ title: "Rate card saved" });
    },
    onError: () => toast({ title: "Couldn't save rate card", variant: "destructive" }),
  });

  // Pipeline query
  const { data: pipelineBriefs = [], refetch: refetchPipeline } = useQuery<any[]>({
    queryKey: ["/api/agencies/briefs", agencyData?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agencies/${agencyData!.id}/briefs`);
      return res.json();
    },
    enabled: !!agencyData?.id && tab === "pipeline",
    refetchInterval: 30000,
  });

  // Activity query
  const { data: activityFeed = [], refetch: refetchActivity } = useQuery<any[]>({
    queryKey: ["/api/agencies/activity", agencyData?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agencies/${agencyData!.id}/activity`);
      return res.json();
    },
    enabled: !!agencyData?.id && tab === "activity",
    refetchInterval: 30000,
  });

  const incomingCount = pipelineBriefs.filter((b: any) => b.status === "incoming").length;

  const tabs: { id: HqTab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "pipeline", label: "Pipeline", icon: Inbox },
    { id: "team", label: "Team", icon: Users },
    { id: "jobs", label: "Jobs", icon: Briefcase },
    { id: "reports", label: "Reports", icon: BarChart2 },
    { id: "invite", label: "Invite & Manage", icon: UserPlus },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "profile", label: "Edit Profile", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Back link */}
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Building2 size={26} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight">{agencyData?.name ?? "My Agency"}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Agency HQ</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyInviteLink} className="gap-2">
              <Copy size={13} /> Copy invite link
            </Button>
            {agencyData?.slug && (
              <Button variant="outline" size="sm" asChild className="gap-2">
                <a href={`/#/agency/${agencyData.slug}`} target="_blank">
                  <ExternalLink size={13} /> Public page
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {[
            { label: "Total earned", value: `£${((dash?.totalEarnedPence ?? 0) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, icon: PoundSterling, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
            { label: "Total invoiced", value: `£${((dash?.totalInvoicedPence ?? 0) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, icon: FileText, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20" },
            { label: "Outstanding", value: `£${((dash?.totalOutstandingPence ?? 0) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" },
            { label: "Active jobs", value: String(dash?.activeProjectCount ?? 0), icon: Briefcase, color: "text-primary", bg: "bg-primary/5" },
            { label: "Team members", value: String(activeMembers.length), icon: Users, color: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-900/20" },
            { label: "Pending", value: String(pendingMembers.length), icon: Clock, color: "text-rose-500", bg: "bg-rose-50 dark:bg-rose-900/20" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">{label}</p>
                <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon size={15} className={color} />
                </div>
              </div>
              <p className="text-3xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-border mb-6">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 border-b-2 transition-colors ${
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={13} />{label}
              {id === "invite" && pendingMembers.length > 0 && (
                <span className="ml-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingMembers.length}
                </span>
              )}
              {id === "pipeline" && incomingCount > 0 && (
                <span className="ml-1 bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {incomingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Recent jobs */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Recent jobs</h3>
              {(dash?.recentProjects ?? []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  <Briefcase size={24} className="mx-auto mb-2 opacity-30" />
                  Jobs will appear here once team members start working.
                </div>
              ) : (
                <div className="space-y-2">
                  {(dash.recentProjects ?? []).slice(0, 6).map((pd: any) => (
                    <div key={pd.project.id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-3.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Briefcase size={13} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{pd.project.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{pd.freelancer?.name ?? "—"} · {pd.client?.name ?? "—"}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          pd.project.status === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                          pd.project.status === "completed" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                          "bg-muted text-muted-foreground"
                        }`}>{pd.project.status}</span>
                        {pd.project.agreedAmountPence && (
                          <span className="text-xs font-bold">£{(pd.project.agreedAmountPence / 100).toFixed(0)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Team snapshot */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Team</h3>
              {(dash?.members ?? []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  <Users size={24} className="mx-auto mb-2 opacity-30" />
                  No team members yet. Use the Invite tab to add your first creative.
                </div>
              ) : (
                <div className="space-y-2">
                  {(dash.members ?? []).slice(0, 6).map((mwu: any) => {
                    const { member, user: mUser, profile } = mwu;
                    const specialisms: string[] = JSON.parse(profile?.specialisms ?? "[]");
                    const isOwnerMember = mUser.id === agencyData?.ownerUserId;
                    return (
                      <div key={member.id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-3.5">
                        <Avatar className="w-9 h-9 flex-shrink-0">
                          <AvatarImage src={mUser.avatar} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{mUser.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{specialisms.slice(0, 2).join(", ") || "—"}</p>
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

              {/* Coming soon */}
              <h3 className="text-sm font-semibold mt-6 mb-3">Coming soon</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Timer, label: "Time Tracking", desc: "Log hours per project" },
                  { icon: GitBranch, label: "Project Management", desc: "Gantt charts & tasks" },
                  { icon: Plane, label: "Time Off", desc: "Holiday & leave" },
                  { icon: Database, label: "Sales CRM", desc: "Leads & pipeline" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="rounded-xl border border-dashed border-border p-4 opacity-60">
                    <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center mb-2">
                      <Icon size={13} className="text-muted-foreground" />
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

        {/* ── TEAM ── */}
        {tab === "team" && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">{(dash?.members ?? []).length} member{(dash?.members ?? []).length !== 1 ? "s" : ""} total</p>
            {(dash?.members ?? []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
                <Users size={32} className="mx-auto mb-3 opacity-30" />
                <p className="font-semibold text-foreground mb-1">No team members yet</p>
                <p className="text-sm">Copy your invite link and share it with freelancers to get started.</p>
                <Button className="mt-4 bg-primary hover:bg-primary/90 text-white" onClick={copyInviteLink}>
                  <Copy size={13} className="mr-2" /> Copy invite link
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {(dash.members ?? []).map((mwu: any) => {
                  const { member, user: mUser, profile } = mwu;
                  const specialisms: string[] = JSON.parse(profile?.specialisms ?? "[]");
                  const isOwnerMember = mUser.id === agencyData?.ownerUserId;
                  const isPending = member.status === "pending";
                  const isExpanded = expandedMember === member.id;
                  const memberRevenue = (dash?.memberRevenue ?? {})[mUser.id] ?? 0;
                  const memberProjects = (dash?.recentProjects ?? []).filter((pd: any) => pd.freelancer?.id === mUser.id);

                  return (
                    <div key={member.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                      <div
                        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedMember(isExpanded ? null : member.id)}
                      >
                        <Avatar className="w-11 h-11 flex-shrink-0">
                          <AvatarImage src={mUser.avatar} />
                          <AvatarFallback className="bg-primary/10 text-primary font-bold">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold">{mUser.name}</p>
                            {isOwnerMember && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Owner</span>}
                            {profile?.isPro === 1 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">PRO</span>}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {specialisms.slice(0, 3).map((s: string) => (
                              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/5 text-primary/80 font-medium">{s}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-xs text-muted-foreground">Earned</p>
                            <p className="font-bold">£{(memberRevenue / 100).toFixed(0)}</p>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isPending ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          }`}>{isPending ? "Pending" : "Active"}</span>
                          {isExpanded ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-border bg-muted/20 p-5">
                          <div className="grid grid-cols-3 gap-4 mb-4">
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

                          {/* ── Rate card ── */}
                          <div className="mb-4 rounded-xl border border-border bg-background p-4">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Agency rate card</p>
                              {editingRateId !== member.id ? (
                                <button
                                  className="text-xs text-primary hover:underline flex items-center gap-1"
                                  onClick={() => {
                                    setEditingRateId(member.id);
                                    setRateForm({
                                      role: member.role || "",
                                      dayRate: member.dayRatePence ? String(member.dayRatePence / 100) : "",
                                      hourlyRate: member.hourlyRatePence ? String(member.hourlyRatePence / 100) : "",
                                    });
                                  }}
                                >
                                  <Pencil size={11} /> Edit
                                </button>
                              ) : (
                                <div className="flex gap-2">
                                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditingRateId(null)}><X size={13} /></button>
                                  <button
                                    className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline"
                                    onClick={() => rateMutation.mutate({
                                      memberId: member.id,
                                      data: {
                                        role: rateForm.role || null,
                                        dayRatePence: rateForm.dayRate ? Math.round(Number(rateForm.dayRate) * 100) : null,
                                        hourlyRatePence: rateForm.hourlyRate ? Math.round(Number(rateForm.hourlyRate) * 100) : null,
                                      },
                                    })}
                                  >
                                    <Check size={12} /> Save
                                  </button>
                                </div>
                              )}
                            </div>
                            {editingRateId === member.id ? (
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-1">Role title</p>
                                  <Input value={rateForm.role} onChange={e => setRateForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Lead Editor" className="h-8 text-sm" />
                                </div>
                                <div className="relative">
                                  <p className="text-[10px] text-muted-foreground mb-1">Day rate (£)</p>
                                  <Input type="number" value={rateForm.dayRate} onChange={e => setRateForm(f => ({ ...f, dayRate: e.target.value }))} placeholder="0" className="h-8 text-sm" />
                                </div>
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-1">Hourly rate (£)</p>
                                  <Input type="number" value={rateForm.hourlyRate} onChange={e => setRateForm(f => ({ ...f, hourlyRate: e.target.value }))} placeholder="0" className="h-8 text-sm" />
                                </div>
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 gap-4">
                                <div>
                                  <p className="text-[10px] text-muted-foreground">Role</p>
                                  <p className="text-sm font-semibold mt-0.5">{member.role || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-muted-foreground">Day rate</p>
                                  <p className="text-sm font-semibold mt-0.5">{member.dayRatePence ? `£${(member.dayRatePence / 100).toFixed(0)}/day` : "—"}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-muted-foreground">Hourly rate</p>
                                  <p className="text-sm font-semibold mt-0.5">{member.hourlyRatePence ? `£${(member.hourlyRatePence / 100).toFixed(0)}/hr` : "—"}</p>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mb-4">
                            <Stars rating={profile?.rating ?? 0} />
                            <span className="text-xs text-muted-foreground">({profile?.reviewCount ?? 0} reviews)</span>
                          </div>
                          {memberProjects.length > 0 && (
                            <div className="mb-4 space-y-1.5">
                              <p className="text-xs text-muted-foreground mb-1">Their recent projects</p>
                              {memberProjects.slice(0, 3).map((pd: any) => (
                                <div key={pd.project.id} className="flex items-center justify-between text-xs rounded-lg bg-background border border-border px-3 py-2">
                                  <span className="font-medium truncate">{pd.project.title}</span>
                                  <span className={`ml-2 shrink-0 font-semibold px-1.5 py-0.5 rounded ${
                                    pd.project.status === "active" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                                  }`}>{pd.project.status}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            {isPending && (
                              <Button size="sm" className="rounded-full text-xs h-7 px-3 bg-primary hover:bg-primary/90 text-white"
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
                              <Button size="sm" variant="outline"
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

        {/* ── JOBS ── */}
        {tab === "jobs" && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">{(dash?.recentProjects ?? []).length} job{(dash?.recentProjects ?? []).length !== 1 ? "s" : ""} across the agency</p>
            {(dash?.recentProjects ?? []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
                <Briefcase size={32} className="mx-auto mb-3 opacity-30" />
                <p className="font-semibold text-foreground mb-1">No jobs yet</p>
                <p className="text-sm">Jobs assigned to your team members will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(dash.recentProjects ?? []).map((pd: any) => (
                  <div key={pd.project.id} className="bg-card border border-border rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold">{pd.project.title}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <User size={11} /> {pd.freelancer?.name ?? "—"}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Briefcase size={11} /> {pd.client?.name ?? "—"}
                          </span>
                          {pd.project.createdAt && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <CalendarClock size={11} /> {new Date(pd.project.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
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
                        {pd.project.agreedAmountPence
                          ? <span className="text-base font-bold">£{(pd.project.agreedAmountPence / 100).toFixed(0)}</span>
                          : <span className="text-xs text-muted-foreground">TBC</span>
                        }
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── INVITE & MANAGE ── */}
        {tab === "invite" && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Invite link box */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Your invite link</h3>
              <div className="bg-card border border-border rounded-2xl p-5">
                <p className="text-sm text-muted-foreground mb-4">Share this with freelancers you want to join your agency. Once they accept, you'll see a pending request below to approve.</p>
                {agencyData && (
                  <div className="bg-muted/50 border border-border rounded-xl px-3 py-2.5 flex items-center gap-2 mb-4">
                    <p className="text-xs font-mono text-muted-foreground flex-1 truncate">
                      {window.location.origin}/#/join/{agencyData.inviteCode}
                    </p>
                    <button className="shrink-0 text-primary hover:text-primary/80 transition-colors" onClick={copyInviteLink}>
                      <Copy size={14} />
                    </button>
                  </div>
                )}
                <Button className="w-full bg-primary hover:bg-primary/90 text-white" onClick={copyInviteLink}>
                  <Copy size={14} className="mr-2" /> Copy invite link
                </Button>
              </div>

              {/* Pending approvals */}
              {pendingMembers.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold mb-3">Pending approvals <span className="ml-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingMembers.length}</span></h3>
                  <div className="space-y-2">
                    {pendingMembers.map((mwu: any) => {
                      const { member, user: mUser, profile } = mwu;
                      const specialisms: string[] = JSON.parse(profile?.specialisms ?? "[]");
                      return (
                        <div key={member.id} className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40 rounded-xl p-3.5">
                          <Avatar className="w-9 h-9 flex-shrink-0">
                            <AvatarImage src={mUser.avatar} />
                            <AvatarFallback className="bg-amber-100 text-amber-700 text-xs font-bold">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm">{mUser.name}</p>
                            <p className="text-xs text-muted-foreground">{specialisms.slice(0, 2).join(", ") || "—"}</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" className="rounded-full text-xs h-7 px-3 bg-primary hover:bg-primary/90 text-white"
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
                            <button className="text-muted-foreground hover:text-destructive transition-colors"
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
                </div>
              )}
            </div>

            {/* Active members */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Active members ({activeMembers.length})</h3>
              {activeMembers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No active members yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeMembers.map((mwu: any) => {
                    const { member, user: mUser } = mwu;
                    const isOwnerMember = mUser.id === agencyData?.ownerUserId;
                    return (
                      <div key={member.id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-3.5">
                        <Avatar className="w-9 h-9 flex-shrink-0">
                          <AvatarImage src={mUser.avatar} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">{(mUser.name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{mUser.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{mUser.email}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isOwnerMember && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Owner</span>}
                          {!isOwnerMember && (
                            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
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

        {/* ── REPORTS ── */}
        {tab === "reports" && agencyData?.id && (
          <div className="space-y-8">
            {/* ── Invoicing & Payments ── */}
            <div>
              <h3 className="text-base font-semibold mb-1">Invoicing &amp; Payments</h3>
              <p className="text-sm text-muted-foreground mb-5">Live breakdown of all project financials across the agency.</p>

              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                {[
                  { label: "Total invoiced", value: `£${((dash?.totalInvoicedPence ?? 0) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, sub: "All projects with agreed price", color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
                  { label: "Paid", value: `£${((dash?.totalEarnedPence ?? 0) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, sub: "Cleared to team members", color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
                  { label: "Outstanding", value: `£${((dash?.totalOutstandingPence ?? 0) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, sub: "Awaiting payment", color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20" },
                ].map(({ label, value, sub, color, bg }) => (
                  <div key={label} className={`rounded-2xl border border-border p-5 ${bg}`}>
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Per-project table */}
              {(dash?.financials ?? []).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
                  <FileText size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No project financials yet.</p>
                  <p className="text-xs mt-1">Financials appear once projects have an agreed price set.</p>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                          <th className="text-left px-5 py-3 font-medium">Project</th>
                          <th className="text-left px-4 py-3 font-medium">Freelancer</th>
                          <th className="text-left px-4 py-3 font-medium">Client</th>
                          <th className="text-right px-4 py-3 font-medium">Amount</th>
                          <th className="text-right px-4 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dash.financials as any[]).map((f: any) => (
                          <tr key={f.projectId} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="px-5 py-3 font-medium max-w-[200px] truncate">{f.title}</td>
                            <td className="px-4 py-3 text-muted-foreground">{f.freelancerName}</td>
                            <td className="px-4 py-3 text-muted-foreground">{f.clientName}</td>
                            <td className="px-4 py-3 text-right font-semibold">
                              {f.agreedAmountPence ? `£${(f.agreedAmountPence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : <span className="text-muted-foreground text-xs">TBC</span>}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                                f.paymentStatus === "paid"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              }`}>
                                {f.paymentStatus === "paid" ? <Check size={10} /> : <Clock size={10} />}
                                {f.paymentStatus === "paid" ? "Paid" : "Outstanding"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {(dash.financials as any[]).length > 0 && (
                        <tfoot>
                          <tr className="border-t-2 border-border bg-muted/20">
                            <td className="px-5 py-3 font-bold text-sm" colSpan={3}>Total</td>
                            <td className="px-4 py-3 text-right font-bold">
                              £{((dash.financials as any[]).reduce((s: number, f: any) => s + (f.agreedAmountPence ?? 0), 0) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-xs text-muted-foreground">
                                {(dash.financials as any[]).filter((f: any) => f.paymentStatus === "paid").length} paid / {(dash.financials as any[]).length} total
                              </span>
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-border pt-2">
              <h3 className="text-base font-semibold mb-1">Time &amp; Utilization Reports</h3>
              <p className="text-sm text-muted-foreground mb-5">Logged hours and team utilization from time tracking.</p>
            </div>

            <AgencyReports
              members={dash?.members ?? []}
              projects={dash?.recentProjects ?? []}
              agencyId={agencyData.id}
            />
          </div>
        )}

        {/* ── PIPELINE ── */}
        {tab === "pipeline" && (
          <BriefPipelinePanel
            agencyData={agencyData}
            briefs={pipelineBriefs}
            stage={pipelineStage}
            setStage={setPipelineStage}
            selectedBrief={selectedBrief}
            setSelectedBrief={setSelectedBrief}
            proposalOpen={proposalOpen}
            setProposalOpen={setProposalOpen}
            members={(dash?.members ?? []).filter((m: any) => m.member?.status === "active")}
            onRefresh={refetchPipeline}
            toast={toast}
          />
        )}

        {/* ── ACTIVITY FEED ── */}
        {tab === "activity" && (
          <ActivityFeedPanel feed={activityFeed} onRefresh={refetchActivity} />
        )}

        {/* ── EDIT PROFILE ── */}
        {tab === "profile" && agencyData && (
          <AgencyProfileEditor
            agency={agencyData}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/agencies/mine", user?.id] });
              toast({ title: "Agency profile updated" });
            }}
          />
        )}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Reports Component
// ─────────────────────────────────────────────────────────────

const ORANGE = "#FF5A1F";
const MONTHS = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];

function SampleBanner() {
  return (
    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 mb-6 text-sm text-amber-800 dark:text-amber-300">
      <Info size={14} className="shrink-0" />
      <span>These reports are based on illustrative data. They'll populate automatically once time tracking and project budgets are connected.</span>
    </div>
  );
}

function ReportCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="mb-5">
        <h3 className="font-semibold text-base">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function AgencyReports({ members, projects, agencyId }: { members: any[]; projects: any[]; agencyId: number }) {
  const [utilView, setUtilView] = useState<"month" | "person">("month");

  // ── Real time entry data ───────────────────────────────────────────────────
  const { data: rawEntries = [], isLoading: entriesLoading } = useQuery<any[]>({
    queryKey: ["/api/agencies", agencyId, "time-entries"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agencies/${agencyId}/time-entries`);
      return res.json();
    },
    enabled: !!agencyId,
  });

  // ── Compute real stats from entries ───────────────────────────────────────

  // Total minutes per user
  const userMinutes: Record<number, { billable: number; total: number }> = {};
  rawEntries.forEach((e: any) => {
    if (!userMinutes[e.userId]) userMinutes[e.userId] = { billable: 0, total: 0 };
    userMinutes[e.userId].total += e.minutes;
    if (e.billable) userMinutes[e.userId].billable += e.minutes;
  });

  // Active members for display
  const activeMembers = members.filter((m: any) => m.member?.status === "active");

  // Build per-member time rows
  const memberTimeRows = activeMembers.map((m: any) => {
    const uid = m.user?.id;
    const stats = userMinutes[uid] ?? { billable: 0, total: 0 };
    const workedH = Math.round(stats.total / 60 * 10) / 10;
    const billableH = Math.round(stats.billable / 60 * 10) / 10;
    const pct = workedH > 0 ? Math.round((billableH / workedH) * 100) : 0;
    return {
      name: m.user?.name ?? "Member",
      workedH,
      billableH,
      pct,
    };
  });

  // Totals
  const totalWorkedH = Math.round(memberTimeRows.reduce((a, r) => a + r.workedH, 0) * 10) / 10;
  const totalBillableH = Math.round(memberTimeRows.reduce((a, r) => a + r.billableH, 0) * 10) / 10;
  const overallPct = totalWorkedH > 0 ? Math.round((totalBillableH / totalWorkedH) * 100) : 0;

  // ── Utilization by month (real) ────────────────────────────────────────────
  const monthMap: Record<string, { billable: number; total: number }> = {};
  rawEntries.forEach((e: any) => {
    const month = e.loggedAt ? e.loggedAt.slice(0, 7) : null; // "YYYY-MM"
    if (!month) return;
    if (!monthMap[month]) monthMap[month] = { billable: 0, total: 0 };
    monthMap[month].total += e.minutes;
    if (e.billable) monthMap[month].billable += e.minutes;
  });

  const utilByMonth = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([ym, stats]) => {
      const [, m] = ym.split("-");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const pct = stats.total > 0 ? Math.round((stats.billable / stats.total) * 100) : 0;
      return {
        month: monthNames[parseInt(m, 10) - 1],
        billable: pct,
        nonBillable: 100 - pct,
      };
    });

  // Fallback: use member utilization by-person
  const utilByPerson = memberTimeRows.map(r => ({
    name: r.name.split(" ")[0],
    billable: r.pct,
    nonBillable: 100 - r.pct,
  }));

  const hasRealData = rawEntries.length > 0;

  // ── Illustrative data for sections that need project financial data ─────────
  // These are labelled as "Estimates" since we don't yet have project budget hookup
  const MONTHS_SAMPLE = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];

  const forecastRevenue = MONTHS_SAMPLE.map((m, i) => ({
    month: m,
    actual: i < 5 ? [12400, 15200, 11800, 17600, 14900][i] : null,
    forecast: i >= 4 ? [14900, 16800, 19200][i - 4] : null,
  }));

  const forecastUtil = MONTHS_SAMPLE.map((m, i) => ({
    month: m,
    utilization: [68, 74, 63, 79, 72, 81, 77][i],
    profitability: [34, 38, 29, 42, 37, 44, 41][i],
    type: i < 5 ? "actual" : "forecast",
  }));

  return (
    <div className="space-y-6">

      {/* Banner: live if real data, illustrative if not */}
      {hasRealData ? (
        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          <Timer size={14} className="shrink-0" />
          <span>Time tracking is live — reports below reflect real logged hours from your team.</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <Info size={14} className="shrink-0" />
          <span>No time entries logged yet. Time Tracking &amp; Utilization reports will populate once your team starts logging time on projects.</span>
        </div>
      )}

      {/* 1 — Billable Utilization */}
      <ReportCard
        title="Billable Utilization"
        description={hasRealData ? "Billable vs non-billable hours — real logged data." : "Billable vs non-billable hours by month or team member."}
      >
        {hasRealData && (utilByMonth.length > 0 || utilByPerson.length > 0) ? (
          <>
            <div className="flex gap-2 mb-4">
              {(["month", "person"] as const).map(v => (
                <button key={v}
                  onClick={() => setUtilView(v)}
                  className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                    utilView === v ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "month" ? "By month" : "By person"}
                </button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={utilView === "month" ? utilByMonth : utilByPerson}
                margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey={utilView === "month" ? "month" : "name"} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="billable" name="Billable" fill={ORANGE} radius={[4, 4, 0, 0]} />
                <Bar dataKey="nonBillable" name="Non-billable" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Timer size={28} className="opacity-30" />
            <p className="text-sm">No time data yet.</p>
            <p className="text-xs">Log time on a project to populate this chart.</p>
          </div>
        )}
      </ReportCard>

      {/* 2 — Time Entries (real data) */}
      <ReportCard
        title="Time Entries"
        description={hasRealData ? "Worked vs billable hours per team member, from logged time entries." : "Worked hours vs billable hours compared per team member."}
      >
        {entriesLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-10 bg-muted/50 rounded-lg animate-pulse" />)}
          </div>
        ) : hasRealData && memberTimeRows.some(r => r.workedH > 0) ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left pb-3 font-medium">Team member</th>
                  <th className="text-right pb-3 font-medium">Worked (h)</th>
                  <th className="text-right pb-3 font-medium">Billable (h)</th>
                  <th className="text-right pb-3 font-medium">Util %</th>
                </tr>
              </thead>
              <tbody>
                {memberTimeRows.map((row) => (
                  <tr key={row.name} className="border-b border-border/50 last:border-0">
                    <td className="py-3 font-medium">{row.name}</td>
                    <td className="py-3 text-right">{row.workedH}h</td>
                    <td className="py-3 text-right">{row.billableH}h</td>
                    <td className="py-3 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                        row.pct >= 75 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                        row.pct >= 55 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                        "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      }`}>{row.pct}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {memberTimeRows.length > 1 && (
                <tfoot>
                  <tr className="border-t border-border">
                    <td className="pt-3 font-bold text-xs">Total</td>
                    <td className="pt-3 text-right font-bold">{totalWorkedH}h</td>
                    <td className="pt-3 text-right font-bold">{totalBillableH}h</td>
                    <td className="pt-3 text-right font-bold">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                        overallPct >= 75 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                        overallPct >= 55 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                        "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      }`}>{overallPct}%</span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Clock size={28} className="opacity-30" />
            <p className="text-sm">No time entries yet.</p>
            <p className="text-xs">Entries will appear here as your team logs time.</p>
          </div>
        )}
      </ReportCard>

      {/* 3 — Profitability by Client (illustrative until invoicing is connected) */}
      <ReportCard
        title="Profitability by Client"
        description="Revenue, cost, and profit margin per client. Requires project budget data to go live."
      >
        <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
          <Info size={12} />
          <span>Illustrative — will use real project financials once budgets are connected.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm opacity-60">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left pb-3 font-medium">Client</th>
                <th className="text-right pb-3 font-medium">Revenue</th>
                <th className="text-right pb-3 font-medium">Cost</th>
                <th className="text-right pb-3 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {[
                { client: "Apex Films", revenue: 8400, cost: 5100, margin: 39 },
                { client: "Bloom Agency", revenue: 6200, cost: 4300, margin: 31 },
                { client: "Cedar & Co", revenue: 11500, cost: 6800, margin: 41 },
              ].map((row) => (
                <tr key={row.client} className="border-b border-border/50 last:border-0">
                  <td className="py-3 font-medium">{row.client}</td>
                  <td className="py-3 text-right">£{row.revenue.toLocaleString()}</td>
                  <td className="py-3 text-right text-muted-foreground">£{row.cost.toLocaleString()}</td>
                  <td className="py-3 text-right">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{row.margin}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportCard>

      {/* 4 — Budget Usage (illustrative) */}
      <ReportCard
        title="Budget Usage"
        description="Real-time spend vs budget per active project. Requires agreed project budgets."
      >
        <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
          <Info size={12} />
          <span>Illustrative — will use real project budget data once connected.</span>
        </div>
        <div className="space-y-4 opacity-60">
          {[
            { project: "Brand film — Apex", budget: 8000, spent: 6200, pct: 78 },
            { project: "Social campaign — Bloom", budget: 4500, spent: 4100, pct: 91 },
            { project: "Product shoot — Cedar", budget: 6000, spent: 2800, pct: 47 },
          ].map((b) => (
            <div key={b.project}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium">{b.project}</p>
                <p className="text-xs text-muted-foreground">
                  £{b.spent.toLocaleString()} <span className="text-muted-foreground/60">/ £{b.budget.toLocaleString()}</span>
                </p>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    b.pct >= 90 ? "bg-red-500" : b.pct >= 70 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(b.pct, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </ReportCard>

      {/* 5+6 — Forecasted Revenue + Utilization side by side (illustrative) */}
      <div className="grid md:grid-cols-2 gap-6">
        <ReportCard
          title="Forecasted Revenue"
          description="Projected sales revenue by month. Illustrative until invoicing is live."
        >
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            <Info size={12} />
            <span>Illustrative estimate.</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={forecastRevenue} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => `£${Number(v).toLocaleString()}`} />
              <Line type="monotone" dataKey="actual" name="Actual" stroke={ORANGE} strokeWidth={2} dot={{ r: 3, fill: ORANGE }} connectNulls={false} />
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke={ORANGE} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: ORANGE }} connectNulls={false} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </LineChart>
          </ResponsiveContainer>
        </ReportCard>

        <ReportCard
          title="Forecasted Utilization"
          description="Projected utilization and profitability by month."
        >
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            <Info size={12} />
            <span>Illustrative estimate.</span>
          </div>
          <div className="space-y-2">
            {forecastUtil.map((row) => (
              <div key={row.month} className="flex items-center gap-3">
                <span className={`text-xs w-8 shrink-0 ${
                  row.type === "forecast" ? "text-muted-foreground/60 italic" : "text-muted-foreground"
                }`}>{row.month}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-1 mb-1">
                    <div className="h-1.5 rounded-full bg-primary/20 flex-1">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${row.utilization}%` }} />
                    </div>
                    <span className="text-xs w-8 text-right font-medium">{row.utilization}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex-1">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${row.profitability}%` }} />
                    </div>
                    <span className="text-xs w-8 text-right text-muted-foreground">{row.profitability}%</span>
                  </div>
                </div>
                {row.type === "forecast" && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground/50 shrink-0">Est.</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-primary inline-block"></span> Utilization</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-emerald-500 inline-block"></span> Profitability</span>
          </div>
        </ReportCard>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AgencyProfileEditor Component
// ─────────────────────────────────────────────────────────────

interface FeaturedWorkItem {
  url: string;
  label: string;
  type: "image" | "video";
}

interface TestimonialItem {
  name: string;
  role: string;
  company: string;
  quote: string;
  avatar?: string;
}

function AgencyProfileEditor({ agency, onSaved }: { agency: any; onSaved: () => void }) {
  const { toast } = useToast();

  // Parse JSON fields safely
  const parseFW = (v: any): FeaturedWorkItem[] => {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v || "[]"); } catch { return []; }
  };
  const parseT = (v: any): TestimonialItem[] => {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v || "[]"); } catch { return []; }
  };

  // Core fields
  const [bio, setBio] = useState<string>(agency.bio || "");
  const [location, setLocation] = useState<string>(agency.location || "");
  const [website, setWebsite] = useState<string>(agency.website || "");
  const [specialisms, setSpecialisms] = useState<string>(
    (() => { try { const p = JSON.parse(agency.specialisms || "[]"); return Array.isArray(p) ? p.join(", ") : agency.specialisms || ""; } catch { return agency.specialisms || ""; } })()
  );
  const [reelUrl, setReelUrl] = useState<string>(agency.reelUrl || "");
  const [logo, setLogo] = useState<string>(agency.logo || "");
  const [banner, setBanner] = useState<string>(agency.banner || "");

  // Featured work
  const [featuredWork, setFeaturedWork] = useState<FeaturedWorkItem[]>(parseFW(agency.featuredWork));
  const [newFWUrl, setNewFWUrl] = useState("");
  const [newFWLabel, setNewFWLabel] = useState("");
  const [newFWType, setNewFWType] = useState<"image" | "video">("image");

  // Testimonials
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>(parseT(agency.testimonials));
  const [newT, setNewT] = useState<TestimonialItem>({ name: "", role: "", company: "", quote: "", avatar: "" });

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("PATCH", `/api/agencies/${agency.id}`, payload);
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => onSaved(),
    onError: () => toast({ title: "Save failed", description: "Please try again.", variant: "destructive" }),
  });

  const handleSaveCore = () => {
    const specArray = specialisms.split(",").map((s) => s.trim()).filter(Boolean);
    saveMutation.mutate({
      bio,
      location: location || null,
      website: website || null,
      specialisms: JSON.stringify(specArray),
      reelUrl: reelUrl || null,
      logo: logo || null,
      banner: banner || null,
    });
  };

  const handleSaveFeaturedWork = () => {
    saveMutation.mutate({ featuredWork: JSON.stringify(featuredWork) });
  };

  const handleSaveTestimonials = () => {
    saveMutation.mutate({ testimonials: JSON.stringify(testimonials) });
  };

  const addFeaturedWork = () => {
    if (!newFWUrl.trim()) return;
    setFeaturedWork((prev) => [...prev, { url: newFWUrl.trim(), label: newFWLabel.trim() || "Work sample", type: newFWType }]);
    setNewFWUrl("");
    setNewFWLabel("");
    setNewFWType("image");
  };

  const removeFeaturedWork = (idx: number) => {
    setFeaturedWork((prev) => prev.filter((_, i) => i !== idx));
  };

  const addTestimonial = () => {
    if (!newT.name.trim() || !newT.quote.trim()) return;
    setTestimonials((prev) => [...prev, { ...newT }]);
    setNewT({ name: "", role: "", company: "", quote: "", avatar: "" });
  };

  const removeTestimonial = (idx: number) => {
    setTestimonials((prev) => prev.filter((_, i) => i !== idx));
  };

  const SectionHeader = ({ icon: Icon, title }: { icon: any; title: string }) => (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={15} className="text-primary" />
      <h3 className="font-semibold text-sm">{title}</h3>
    </div>
  );

  const SaveBtn = ({ onClick, label = "Save changes" }: { onClick: () => void; label?: string }) => (
    <Button
      size="sm"
      onClick={onClick}
      disabled={saveMutation.isPending}
      className="bg-primary hover:bg-primary/90 text-white text-xs h-8"
    >
      {saveMutation.isPending ? <span className="animate-pulse">Saving…</span> : <><Check size={12} className="mr-1" />{label}</>}
    </Button>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="font-bold text-base">Edit Agency Profile</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Changes appear on your public agency page immediately after saving.</p>
      </div>

      {/* ── Core Details ── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <SectionHeader icon={Building2} title="Agency Details" />
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Tell clients what makes your agency special…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Location</label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="London, UK" className="h-9 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Website</label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://youragency.com" className="h-9 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Specialisms <span className="text-muted-foreground/60">(comma-separated)</span></label>
            <Input value={specialisms} onChange={(e) => setSpecialisms(e.target.value)} placeholder="Brand Film, Motion Graphics, Photography" className="h-9 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Showreel URL <span className="text-muted-foreground/60">(YouTube or Vimeo)</span></label>
            <Input value={reelUrl} onChange={(e) => setReelUrl(e.target.value)} placeholder="https://vimeo.com/123456789" className="h-9 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Logo URL</label>
              <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" className="h-9 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Banner URL</label>
              <Input value={banner} onChange={(e) => setBanner(e.target.value)} placeholder="https://…/banner.jpg" className="h-9 text-sm" />
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <SaveBtn onClick={handleSaveCore} />
        </div>
      </div>

      {/* ── Featured Work ── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <SectionHeader icon={Image} title="Featured Work" />
        <p className="text-xs text-muted-foreground mb-4">Showcase your best projects on your public profile. Add images or videos by URL.</p>

        {/* Existing items */}
        {featuredWork.length > 0 && (
          <div className="space-y-2 mb-4">
            {featuredWork.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3 py-2">
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                  item.type === "video"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                }`}>{item.type}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{item.url}</p>
                </div>
                <button
                  onClick={() => removeFeaturedWork(idx)}
                  className="text-muted-foreground/50 hover:text-destructive transition-colors p-1"
                  aria-label="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {featuredWork.length === 0 && (
          <div className="flex flex-col items-center py-6 text-center text-muted-foreground mb-4">
            <Image size={28} className="mb-2 text-muted-foreground/30" />
            <p className="text-xs">No featured work yet. Add your first piece below.</p>
          </div>
        )}

        {/* Add new item */}
        <div className="rounded-xl border border-dashed border-border p-3 space-y-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Add item</p>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">URL</label>
              <Input value={newFWUrl} onChange={(e) => setNewFWUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Label</label>
              <Input value={newFWLabel} onChange={(e) => setNewFWLabel(e.target.value)} placeholder="e.g. Brand Film 2025" className="h-8 text-xs" />
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setNewFWType("image")}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors ${
                  newFWType === "image" ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >Img</button>
              <button
                onClick={() => setNewFWType("video")}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors ${
                  newFWType === "video" ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >Vid</button>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={addFeaturedWork} disabled={!newFWUrl.trim()} className="h-8 text-xs">
            <Plus size={12} className="mr-1" /> Add to gallery
          </Button>
        </div>

        <div className="mt-4 flex justify-end">
          <SaveBtn onClick={handleSaveFeaturedWork} label="Save gallery" />
        </div>
      </div>

      {/* ── Client Testimonials ── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <SectionHeader icon={MessageSquare} title="Client Testimonials" />
        <p className="text-xs text-muted-foreground mb-4">Add quotes from happy clients to build trust on your public page.</p>

        {/* Existing testimonials */}
        {testimonials.length > 0 && (
          <div className="space-y-3 mb-4">
            {testimonials.map((t, idx) => (
              <div key={idx} className="relative rounded-xl border border-border bg-background/50 px-4 py-3">
                <button
                  onClick={() => removeTestimonial(idx)}
                  className="absolute top-2.5 right-2.5 text-muted-foreground/40 hover:text-destructive transition-colors p-0.5"
                  aria-label="Remove testimonial"
                >
                  <Trash2 size={12} />
                </button>
                <p className="text-sm italic text-foreground/80 mb-2 pr-5">"{t.quote}"</p>
                <div className="flex items-center gap-2">
                  {t.avatar && <img src={t.avatar} alt={t.name} className="w-6 h-6 rounded-full object-cover" />}
                  <div>
                    <p className="text-xs font-semibold">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground">{t.role}{t.company ? ` · ${t.company}` : ""}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {testimonials.length === 0 && (
          <div className="flex flex-col items-center py-6 text-center text-muted-foreground mb-4">
            <MessageSquare size={28} className="mb-2 text-muted-foreground/30" />
            <p className="text-xs">No testimonials yet. Add your first client quote below.</p>
          </div>
        )}

        {/* Add new testimonial */}
        <div className="rounded-xl border border-dashed border-border p-3 space-y-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Add testimonial</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Client name *</label>
              <Input value={newT.name} onChange={(e) => setNewT((p) => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" className="h-8 text-xs" />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Role</label>
              <Input value={newT.role} onChange={(e) => setNewT((p) => ({ ...p, role: e.target.value }))} placeholder="Marketing Director" className="h-8 text-xs" />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Company</label>
              <Input value={newT.company} onChange={(e) => setNewT((p) => ({ ...p, company: e.target.value }))} placeholder="Acme Corp" className="h-8 text-xs" />
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Avatar URL <span className="text-muted-foreground/50">(optional)</span></label>
              <Input value={newT.avatar || ""} onChange={(e) => setNewT((p) => ({ ...p, avatar: e.target.value }))} placeholder="https://…/photo.jpg" className="h-8 text-xs" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Quote *</label>
            <textarea
              value={newT.quote}
              onChange={(e) => setNewT((p) => ({ ...p, quote: e.target.value }))}
              rows={3}
              placeholder="What did this client say about working with you?"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={addTestimonial}
            disabled={!newT.name.trim() || !newT.quote.trim()}
            className="h-8 text-xs"
          >
            <Plus size={12} className="mr-1" /> Add testimonial
          </Button>
        </div>

        <div className="mt-4 flex justify-end">
          <SaveBtn onClick={handleSaveTestimonials} label="Save testimonials" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Brief Pipeline Panel
// ─────────────────────────────────────────────────────────────

const STAGE_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  incoming:      { label: "Incoming",      color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-900/20",    dot: "bg-blue-500" },
  viewed:        { label: "Viewed",        color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20", dot: "bg-violet-500" },
  proposal_sent: { label: "Proposal Sent", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20",  dot: "bg-amber-500" },
  won:           { label: "Won",           color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20", dot: "bg-emerald-500" },
  lost:          { label: "Lost",          color: "text-rose-600 dark:text-rose-400",   bg: "bg-rose-50 dark:bg-rose-900/20",    dot: "bg-rose-500" },
  declined:      { label: "Declined",      color: "text-muted-foreground",              bg: "bg-muted/50",                       dot: "bg-muted-foreground" },
};

function BriefStageBadge({ status }: { status: string }) {
  const m = STAGE_META[status] ?? STAGE_META["incoming"];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${m.color} ${m.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} shrink-0`} />
      {m.label}
    </span>
  );
}

function ProposalComposer({
  brief,
  members,
  onClose,
  onSent,
  toast,
}: {
  brief: any;
  members: any[];
  onClose: () => void;
  onSent: () => void;
  toast: any;
}) {
  const [quotedAmount, setQuotedAmount] = useState("");
  const [timeline, setTimeline] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [breakdown, setBreakdown] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/agencies/briefs/${brief.id}/proposal`, {
        quotedAmountPence: Math.round(parseFloat(quotedAmount) * 100),
        timeline,
        coverNote,
        breakdown,
        teamMemberIds: selectedMemberIds,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send proposal");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Proposal sent!" });
      onSent();
      onClose();
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const toggleMember = (userId: number) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Auto-suggest total from rate cards if members are selected
  const suggestedTotal = selectedMemberIds.reduce((sum, uid) => {
    const m = members.find((m: any) => m.user?.id === uid);
    return sum + ((m?.member?.dayRatePence ?? 0) / 100);
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="font-bold text-base">Send Proposal</h3>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{brief.title}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Quoted amount */}
          <div>
            <label className="block text-xs font-semibold mb-1.5">Quoted Amount (£) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
              <Input
                type="number"
                value={quotedAmount}
                onChange={(e) => setQuotedAmount(e.target.value)}
                placeholder="0.00"
                className="pl-7 h-10 text-sm"
              />
            </div>
            {suggestedTotal > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Rate card suggests: <button className="text-primary underline underline-offset-2" onClick={() => setQuotedAmount(String(suggestedTotal))}>£{suggestedTotal.toLocaleString()}/day</button> for selected team
              </p>
            )}
          </div>

          {/* Timeline */}
          <div>
            <label className="block text-xs font-semibold mb-1.5">Timeline</label>
            <Input
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              placeholder="e.g. 4–6 weeks"
              className="h-10 text-sm"
            />
          </div>

          {/* Team selection */}
          {members.length > 0 && (
            <div>
              <label className="block text-xs font-semibold mb-2">Proposed Team</label>
              <div className="space-y-2">
                {members.map((m: any) => {
                  const selected = selectedMemberIds.includes(m.user?.id);
                  return (
                    <button
                      key={m.user?.id}
                      onClick={() => toggleMember(m.user?.id)}
                      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                        selected ? "bg-primary border-primary" : "border-muted-foreground/40"
                      }`}>
                        {selected && <Check size={10} className="text-white" />}
                      </div>
                      {m.user?.avatar
                        ? <img src={m.user.avatar} alt={m.user.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                        : <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">{m.user?.name?.[0]}</div>
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{m.user?.name}</p>
                        <p className="text-[10px] text-muted-foreground">{m.member?.role || "Member"}{m.member?.dayRatePence ? ` · £${(m.member.dayRatePence / 100).toLocaleString()}/day` : ""}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cover note */}
          <div>
            <label className="block text-xs font-semibold mb-1.5">Cover Note</label>
            <textarea
              value={coverNote}
              onChange={(e) => setCoverNote(e.target.value)}
              rows={3}
              placeholder="Why is your agency the right fit for this project?"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Breakdown */}
          <div>
            <label className="block text-xs font-semibold mb-1.5">Cost Breakdown <span className="text-muted-foreground/60 font-normal">(optional)</span></label>
            <textarea
              value={breakdown}
              onChange={(e) => setBreakdown(e.target.value)}
              rows={2}
              placeholder="e.g. Pre-production £2,000 · Shoot days £5,000 · Post £3,000"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} className="flex-1 h-10">Cancel</Button>
            <Button
              size="sm"
              onClick={() => sendMutation.mutate()}
              disabled={!quotedAmount || parseFloat(quotedAmount) <= 0 || sendMutation.isPending}
              className="flex-1 h-10 bg-primary hover:bg-primary/90 text-white gap-2"
            >
              {sendMutation.isPending ? <span className="animate-pulse">Sending…</span> : <><Send size={13} /> Send Proposal</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BriefPipelinePanel({
  agencyData,
  briefs,
  stage,
  setStage,
  selectedBrief,
  setSelectedBrief,
  proposalOpen,
  setProposalOpen,
  members,
  onRefresh,
  toast,
}: any) {
  const filteredBriefs = stage === "all" ? briefs : briefs.filter((b: any) => b.status === stage);

  const stageCounts = Object.keys(STAGE_META).reduce((acc, s) => {
    acc[s] = briefs.filter((b: any) => b.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  const markViewed = async (briefId: number) => {
    await apiRequest("PATCH", `/api/agencies/briefs/${briefId}/status`, { status: "viewed" });
    onRefresh();
  };

  const markDeclined = async (briefId: number) => {
    await apiRequest("PATCH", `/api/agencies/briefs/${briefId}/status`, { status: "declined" });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-base">Brief Pipeline</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Briefs sent directly to {agencyData?.name} from clients</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} className="gap-1.5 h-8 text-xs">
          <Activity size={12} /> Refresh
        </Button>
      </div>

      {/* Stage filter bar */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStage("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            stage === "all" ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40"
          }`}
        >
          All ({briefs.length})
        </button>
        {Object.entries(STAGE_META).map(([s, meta]) => (
          <button
            key={s}
            onClick={() => setStage(s as PipelineStage)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              stage === s ? `${meta.bg} ${meta.color} border-transparent` : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            {meta.label} {stageCounts[s] > 0 ? `(${stageCounts[s]})` : ""}
          </button>
        ))}
      </div>

      {/* Brief list */}
      {filteredBriefs.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Inbox size={36} className="text-muted-foreground/20 mb-3" />
          <p className="font-semibold text-sm mb-1">{stage === "all" ? "No briefs yet" : `No ${STAGE_META[stage]?.label.toLowerCase()} briefs`}</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            {stage === "all"
              ? "When clients send briefs directly to your agency, they'll appear here."
              : "Nothing in this stage right now."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBriefs.map((brief: any) => (
            <div key={brief.id} className="bg-card border border-border rounded-2xl p-5">
              {/* Brief header */}
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <BriefStageBadge status={brief.status} />
                    {brief.category && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{brief.category}</span>
                    )}
                  </div>
                  <h3 className="font-semibold text-sm">{brief.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    From {brief.clientName} · {new Date(brief.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                {(brief.budgetMin || brief.budgetMax) && (
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Budget</p>
                    <p className="text-sm font-semibold text-primary">
                      {brief.budgetMin && brief.budgetMax
                        ? `£${(brief.budgetMin / 100).toLocaleString()} – £${(brief.budgetMax / 100).toLocaleString()}`
                        : brief.budgetMin
                        ? `from £${(brief.budgetMin / 100).toLocaleString()}`
                        : `up to £${(brief.budgetMax / 100).toLocaleString()}`}
                    </p>
                  </div>
                )}
              </div>

              {/* Description */}
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-4">{brief.description}</p>

              {/* Meta row */}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-4">
                {brief.startDate && (
                  <span className="flex items-center gap-1"><Calendar size={11} /> Start: {brief.startDate}</span>
                )}
                {brief.duration && (
                  <span className="flex items-center gap-1"><Clock size={11} /> Duration: {brief.duration}</span>
                )}
                {brief.requirements && (
                  <span className="flex items-center gap-1"><Tag size={11} /> Requirements: {brief.requirements}</span>
                )}
              </div>

              {/* Proposal summary if exists */}
              {brief.proposal && (
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 px-4 py-3 mb-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      Proposal sent · £{(brief.proposal.quotedAmountPence / 100).toLocaleString()}
                    </p>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                      brief.proposal.status === "accepted"
                        ? "bg-emerald-200 text-emerald-800"
                        : brief.proposal.status === "declined"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {brief.proposal.status}
                    </span>
                  </div>
                  {brief.proposal.timeline && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">Timeline: {brief.proposal.timeline}</p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                {brief.status === "incoming" && (
                  <Button size="sm" variant="outline" onClick={() => markViewed(brief.id)} className="h-8 text-xs gap-1.5">
                    <CheckCircle2 size={12} /> Mark viewed
                  </Button>
                )}
                {!brief.proposal && (brief.status === "incoming" || brief.status === "viewed") && (
                  <Button
                    size="sm"
                    onClick={() => { setSelectedBrief(brief); setProposalOpen(true); }}
                    className="h-8 text-xs bg-primary hover:bg-primary/90 text-white gap-1.5"
                  >
                    <Send size={12} /> Send Proposal
                  </Button>
                )}
                {(brief.status === "incoming" || brief.status === "viewed") && !brief.proposal && (
                  <Button size="sm" variant="outline" onClick={() => markDeclined(brief.id)} className="h-8 text-xs text-muted-foreground gap-1.5">
                    <XCircle size={12} /> Decline
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Proposal composer modal */}
      {proposalOpen && selectedBrief && (
        <ProposalComposer
          brief={selectedBrief}
          members={members}
          onClose={() => { setProposalOpen(false); setSelectedBrief(null); }}
          onSent={() => { onRefresh(); setProposalOpen(false); setSelectedBrief(null); }}
          toast={toast}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Activity Feed Panel
// ─────────────────────────────────────────────────────────────

const ACTIVITY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  brief_received:      { icon: Inbox,         color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20" },
  brief_viewed:        { icon: CheckCircle2,  color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20" },
  proposal_sent:       { icon: Send,          color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20" },
  proposal_accepted:   { icon: Trophy,        color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  proposal_declined:   { icon: XCircle,       color: "text-rose-600 dark:text-rose-400",   bg: "bg-rose-50 dark:bg-rose-900/20" },
  member_joined:       { icon: UserPlus,      color: "text-primary",                        bg: "bg-primary/5" },
  member_left:         { icon: XCircle,       color: "text-muted-foreground",              bg: "bg-muted/50" },
  rate_updated:        { icon: PoundSterling, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  profile_updated:     { icon: Settings,      color: "text-primary",                       bg: "bg-primary/5" },
  time_logged:         { icon: Clock,         color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20" },
};

function ActivityFeedPanel({ feed, onRefresh }: { feed: any[]; onRefresh: () => void }) {
  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (days > 0) return `${days}d ago`;
    if (hrs > 0) return `${hrs}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return "Just now";
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-base">Activity Feed</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Everything happening across your agency in one place</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} className="gap-1.5 h-8 text-xs">
          <Activity size={12} /> Refresh
        </Button>
      </div>

      {feed.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Activity size={36} className="text-muted-foreground/20 mb-3" />
          <p className="font-semibold text-sm mb-1">No activity yet</p>
          <p className="text-xs text-muted-foreground max-w-xs">As your agency receives briefs, sends proposals, and logs time, events will appear here.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-1">
            {feed.map((event: any, idx: number) => {
              const meta = ACTIVITY_ICONS[event.type] ?? { icon: Activity, color: "text-muted-foreground", bg: "bg-muted/50" };
              const Icon = meta.icon;
              return (
                <div key={event.id} className="flex gap-4 pl-2 py-3">
                  {/* Icon node */}
                  <div className={`relative z-10 w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${meta.bg} mt-0.5`}>
                    <Icon size={12} className={meta.color} />
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-2 border-b border-border/50 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug">{event.title}</p>
                      <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(event.createdAt)}</span>
                    </div>
                    {event.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{event.body}</p>
                    )}
                    {event.actorName && (
                      <p className="text-[10px] text-muted-foreground/60 mt-1">by {event.actorName}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
