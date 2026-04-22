import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { Link } from "wouter";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import LoginModal from "@/components/LoginModal";
import SignupModal from "@/components/SignupModal";
import {
  CheckCircle2, Circle, Clock, Briefcase, MessageSquare,
  ArrowRight, ChevronDown, ChevronUp, X, Expand,
  Eye, EyeOff, Globe, Lock,
} from "lucide-react";
import { safeGet, safeSet } from "@/lib/storage";
import { DEMO_USER_IDS, getMockProjects } from "@/lib/mockData";
import type { ProjectWithDetails } from "../../../server/storage";

// ── 6 universal project stages ────────────────────────────────────────────────
const STAGES = [
  { label: "Brief & Kick-off",  desc: "Project scope agreed, brief shared"              },
  { label: "Pre-production",    desc: "Planning, storyboard, schedule"                  },
  { label: "Production",        desc: "Shoot day / creative work in progress"            },
  { label: "First Delivery",    desc: "Initial files or draft delivered for review"      },
  { label: "Revisions",         desc: "Feedback applied, refinements made"              },
  { label: "Final Delivery",    desc: "All finals handed over, project complete"         },
];

function stageStatus(projectStage: number, i: number): "done" | "active" | "upcoming" {
  if (i < projectStage) return "done";
  if (i === projectStage) return "active";
  return "upcoming";
}

function statusPill(status: string) {
  if (status === "completed") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (status === "paused")    return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
}

// ── Shared stage tracker ──────────────────────────────────────────────────────
function StageTracker({ currentStage, size = "sm" }: { currentStage: number; size?: "sm" | "lg" }) {
  const iconSize   = size === "lg" ? 18 : 15;
  const dotSize    = size === "lg" ? "w-9 h-9" : "w-7 h-7";
  const lineHeight = size === "lg" ? "h-9" : "h-7";
  const textSize   = size === "lg" ? "text-sm" : "text-xs";
  const descSize   = size === "lg" ? "text-xs" : "text-[11px]";
  const pb         = size === "lg" ? "pb-5" : "pb-4";

  return (
    <ol className="space-y-0">
      {STAGES.map((stage, i) => {
        const status = stageStatus(currentStage, i);
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`${dotSize} rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                status === "done"     ? "bg-primary text-white"
                : status === "active" ? "bg-primary/15 text-primary ring-2 ring-primary/40"
                : "bg-muted text-muted-foreground"
              }`}>
                {status === "done"   ? <CheckCircle2 size={iconSize} />
                : status === "active" ? <Clock size={iconSize - 2} />
                : <Circle size={iconSize - 2} />}
              </div>
              {i < STAGES.length - 1 && (
                <div className={`w-0.5 ${lineHeight} mt-0.5 rounded-full ${status === "done" ? "bg-primary/40" : "bg-border"}`} />
              )}
            </div>
            <div className={`${pb} min-w-0`}>
              <p className={`${textSize} font-medium leading-9 ${status === "upcoming" ? "text-muted-foreground" : "text-foreground"}`}>
                {stage.label}
                {status === "active" && <span className="ml-2 text-xs font-normal text-primary">← Current</span>}
              </p>
              {status !== "upcoming" && (
                <p className={`${descSize} text-muted-foreground -mt-1.5`}>{stage.desc}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Activity log entry ────────────────────────────────────────────────────────
function UpdateEntry({ update, author, size = "sm" }: { update: any; author: any; size?: "sm" | "lg" }) {
  return (
    <div className="flex gap-3">
      <Avatar className={size === "lg" ? "w-8 h-8 flex-shrink-0 mt-0.5" : "w-6 h-6 flex-shrink-0 mt-0.5"}>
        <AvatarImage src={author.avatar || undefined} />
        <AvatarFallback className="bg-primary text-white text-[10px]">
          {author.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`font-semibold ${size === "lg" ? "text-sm" : "text-xs"}`}>{author.name}</span>
          <span className="text-[10px] text-muted-foreground">
            Stage {update.stage + 1} · {STAGES[update.stage]?.label}
          </span>
        </div>
        <p className={`text-muted-foreground mt-0.5 leading-relaxed ${size === "lg" ? "text-sm" : "text-xs"}`}>
          {update.note}
        </p>
      </div>
    </div>
  );
}

// ── Visibility toggle (client only, completed projects) ──────────────────────
function VisibilityToggle({ projectId, isClient }: { projectId: number; isClient: boolean }) {
  const key = `project_visibility_${projectId}`;
  const [isPublic, setIsPublic] = useState(() => safeGet(key) !== "private");

  if (!isClient) return null;

  function toggle() {
    const next = !isPublic;
    setIsPublic(next);
    safeSet(key, next ? "public" : "private");
  }

  return (
    <div className={`rounded-2xl border-2 p-4 transition-all ${
      isPublic ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/40"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isPublic ? "bg-primary/15" : "bg-muted"
          }`}>
            {isPublic
              ? <Globe size={16} className="text-primary" />
              : <Lock size={16} className="text-muted-foreground" />}
          </div>
          <div>
            <p className={`text-sm font-semibold ${ isPublic ? "text-primary" : "text-foreground" }`}>
              {isPublic ? "Shared to Feed" : "Kept Private"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              {isPublic
                ? "This project is visible on the Viewrr feed for others to see."
                : "Only you and the freelancer can see this project."}
            </p>
          </div>
        </div>
        {/* iOS-style toggle */}
        <button
          onClick={toggle}
          className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 mt-1 ${
            isPublic ? "bg-primary" : "bg-border"
          }`}
          aria-label={isPublic ? "Make private" : "Share to feed"}
        >
          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            isPublic ? "translate-x-6" : "translate-x-0.5"
          }`} />
        </button>
      </div>
      {/* Options row */}
      <div className="flex gap-2 mt-3 pt-3 border-t border-border">
        <button
          onClick={() => { setIsPublic(true); safeSet(key, "public"); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            isPublic ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40"
          }`}
        >
          <Globe size={11} /> Share to Feed
        </button>
        <button
          onClick={() => { setIsPublic(false); safeSet(key, "private"); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            !isPublic ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/40"
          }`}
        >
          <Lock size={11} /> Keep Private
        </button>
      </div>
    </div>
  );
}

// ── Full-screen project modal ─────────────────────────────────────────────────
function ProjectModal({ pw, currentUserId, onClose }: {
  pw: ProjectWithDetails;
  currentUserId: number;
  onClose: () => void;
}) {
  const [noteText, setNoteText] = useState("");
  const isFreelancer = currentUserId === pw.freelancer.id;
  const isClient = currentUserId === pw.client.id;
  const canAdvance = isFreelancer && pw.project.currentStage < STAGES.length - 1 && pw.project.status !== "completed";
  const otherPerson = isFreelancer ? pw.client : pw.freelancer;

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const advanceMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/projects/${pw.project.id}/advance`, { note: noteText, authorId: currentUserId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
      setNoteText("");
    },
  });

  const noteMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/projects/${pw.project.id}/updates`, {
        authorId: currentUserId,
        stage: pw.project.currentStage,
        note: noteText,
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
      setNoteText("");
    },
  });

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="project-modal"
    >
      {/* Panel */}
      <div className="relative bg-background border border-border rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Modal header */}
        <div className="flex items-start justify-between gap-4 px-7 py-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar className="w-11 h-11 flex-shrink-0">
              <AvatarImage src={otherPerson.avatar || undefined} />
              <AvatarFallback className="bg-primary text-white text-sm">
                {otherPerson.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h2 className="font-bold text-lg leading-tight truncate">{pw.project.title}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isFreelancer ? "Client" : "Freelancer"}: {otherPerson.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`text-xs font-semibold px-3 py-1 rounded-full capitalize ${statusPill(pw.project.status)}`}>
              {pw.project.status}
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
              data-testid="btn-close-modal"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {pw.project.description && (
            <div className="px-7 pt-5 pb-0">
              <p className="text-sm text-muted-foreground leading-relaxed">{pw.project.description}</p>
            </div>
          )}

          {/* Two-column: timeline + activity */}
          <div className="grid md:grid-cols-[1fr,380px] divide-y md:divide-y-0 md:divide-x divide-border px-0">

            {/* ── Left: progress timeline ── */}
            <div className="px-7 py-6">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-5">Project Progress</p>

              {/* Progress bar */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">
                    Stage {pw.project.currentStage + 1} of {STAGES.length}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: "#FF5A1F" }}>
                    {Math.round((pw.project.currentStage / (STAGES.length - 1)) * 100)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.round((pw.project.currentStage / (STAGES.length - 1)) * 100)}%`,
                      background: "linear-gradient(90deg, #FF5A1F, #FFA500)",
                    }}
                  />
                </div>
              </div>

              <StageTracker currentStage={pw.project.currentStage} size="lg" />
            </div>

            {/* ── Right: activity log + controls ── */}
            <div className="px-7 py-6 flex flex-col">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-5">Activity Log</p>

              {/* Both sides */}
              <div className="mb-3">
                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border">
                  {/* Client */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Avatar className="w-7 h-7 flex-shrink-0">
                      <AvatarImage src={pw.client.avatar || undefined} />
                      <AvatarFallback className="bg-primary text-white text-[10px]">
                        {pw.client.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{pw.client.name}</p>
                      <p className="text-[10px] text-muted-foreground">Client</p>
                    </div>
                  </div>
                  <span className="text-muted-foreground text-xs">↔</span>
                  {/* Freelancer */}
                  <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                    <div className="min-w-0 text-right">
                      <p className="text-xs font-semibold truncate">{pw.freelancer.name}</p>
                      <p className="text-[10px] text-muted-foreground">Freelancer</p>
                    </div>
                    <Avatar className="w-7 h-7 flex-shrink-0">
                      <AvatarImage src={pw.freelancer.avatar || undefined} />
                      <AvatarFallback className="bg-primary text-white text-[10px]">
                        {pw.freelancer.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
              </div>

              {/* Updates scroll area */}
              <div className="flex-1 space-y-4 overflow-y-auto pr-1 mb-4 min-h-0" style={{ maxHeight: "280px" }}>
                {pw.updates.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No updates yet.</p>
                ) : (
                  pw.updates.map(({ update, author }) => (
                    <UpdateEntry key={update.id} update={update} author={author} size="lg" />
                  ))
                )}
              </div>

              {/* Visibility toggle — completed projects, client only */}
              {pw.project.status === "completed" && isClient && (
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-3">Project Visibility</p>
                  <VisibilityToggle projectId={pw.project.id} isClient={isClient} />
                </div>
              )}

              {/* Add note / advance */}
              {pw.project.status !== "completed" && (
                <div className="border-t border-border pt-4 space-y-3">
                  <Textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="Add a note or update visible to both sides…"
                    className="text-sm resize-none min-h-[72px]"
                    data-testid="input-modal-note"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-sm"
                      disabled={!noteText.trim() || noteMutation.isPending}
                      onClick={() => noteMutation.mutate()}
                      data-testid="btn-modal-add-note"
                    >
                      <MessageSquare size={13} className="mr-1.5" />
                      Add note
                    </Button>
                    {canAdvance && (
                      <Button
                        size="sm"
                        className="flex-1 text-sm text-white"
                        style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                        disabled={advanceMutation.isPending}
                        onClick={() => advanceMutation.mutate()}
                        data-testid="btn-modal-advance"
                      >
                        <ArrowRight size={13} className="mr-1.5" />
                        Next stage
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compact project card (list view) ─────────────────────────────────────────
function ProjectCard({ pw, currentUserId, onOpen }: {
  pw: ProjectWithDetails;
  currentUserId: number;
  onOpen: () => void;
}) {
  const isFreelancer = currentUserId === pw.freelancer.id;
  const isClient = currentUserId === pw.client.id;
  const otherPerson  = isFreelancer ? pw.client : pw.freelancer;
  const pct = Math.round((pw.project.currentStage / (STAGES.length - 1)) * 100);
  const isCompleted = pw.project.status === "completed";
  const visKey = `project_visibility_${pw.project.id}`;
  const [isPublic, setIsPublic] = useState(() => safeGet(visKey) !== "private");

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-card border border-border rounded-2xl p-5 hover:border-primary/40 hover:shadow-md transition-all group"
      data-testid={`card-project-${pw.project.id}`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="w-10 h-10 flex-shrink-0">
            <AvatarImage src={otherPerson.avatar || undefined} />
            <AvatarFallback className="bg-primary text-white text-xs">
              {otherPerson.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
              {pw.project.title}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isFreelancer ? "Client" : "Freelancer"}: {otherPerson.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusPill(pw.project.status)}`}>
            {pw.project.status}
          </span>
          {/* Visibility badge — client only, completed only */}
          {isCompleted && isClient && (
            <span
              onClick={e => {
                e.stopPropagation();
                const next = !isPublic;
                setIsPublic(next);
                safeSet(visKey, next ? "public" : "private");
              }}
              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full cursor-pointer transition-all ${
                isPublic
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              title={isPublic ? "Visible on Feed — click to make private" : "Private — click to share to Feed"}
            >
              {isPublic ? <Globe size={9} /> : <Lock size={9} />}
              {isPublic ? "Feed" : "Private"}
            </span>
          )}
          <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
            <Expand size={13} />
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">
            {STAGES[pw.project.currentStage]?.label}
          </span>
          <span className="text-xs font-semibold" style={{ color: "#FF5A1F" }}>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, #FF5A1F, #FFA500)",
            }}
          />
        </div>
      </div>

      {/* Stage pills */}
      <div className="flex gap-1 mt-3 flex-wrap">
        {STAGES.map((s, i) => {
          const status = stageStatus(pw.project.currentStage, i);
          return (
            <span
              key={i}
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                status === "done"     ? "bg-primary/15 text-primary"
                : status === "active" ? "text-white"
                : "bg-muted text-muted-foreground"
              }`}
              style={status === "active" ? { background: "linear-gradient(135deg,#FF5A1F,#FFA500)" } : {}}
            >
              {s.label}
            </span>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-3 text-right group-hover:text-primary transition-colors">
        Click to open full view →
      </p>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function YourWork() {
  const { user } = useAuth();
  const [openProject, setOpenProject] = useState<ProjectWithDetails | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const isDemo = !!user && DEMO_USER_IDS.has(user.id);

  const { data: projects = [], isLoading } = useQuery<ProjectWithDetails[]>({
    queryKey: ["/api/projects", user?.id],
    queryFn: () => {
      if (isDemo) return Promise.resolve(getMockProjects(user!.id) as any);
      return apiRequest("GET", `/api/projects?userId=${user!.id}`).then(r => r.json());
    },
    enabled: !!user,
    refetchInterval: isDemo ? false : 5000,
  });

  // Keep open project in sync with refetched data
  useEffect(() => {
    if (openProject) {
      const fresh = projects.find(p => p.project.id === openProject.project.id);
      if (fresh) setOpenProject(fresh);
    }
  }, [projects]);

  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  if (!user) {
    return (
      <>
        <div className="min-h-screen bg-background flex flex-col items-center justify-center py-28 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
            <Briefcase size={28} className="text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Sign in to view your work</h2>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Track project progress, share updates, and stay aligned with your clients or freelancers.
          </p>
          <div className="flex gap-3">
            <Button
              onClick={() => setLoginOpen(true)}
              className="bg-primary hover:bg-primary/90 text-white rounded-full px-6"
            >
              Sign in
            </Button>
            <Button
              onClick={() => setSignupOpen(true)}
              variant="outline"
              className="rounded-full px-6"
            >
              Sign up
            </Button>
          </div>
        </div>
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
        <SignupModal open={signupOpen} onClose={() => setSignupOpen(false)} />
      </>
    );
  }

  const active    = projects.filter(p => p.project.status !== "completed");
  const completed = projects.filter(p => p.project.status === "completed");

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">Your Work</h1>
          <p className="text-muted-foreground text-sm">
            {user.role === "freelancer"
              ? "Track your active projects and keep clients in the loop."
              : "See exactly where every project stands — from kick-off to final delivery."}
          </p>
        </div>

        {/* Stats — clickable filter tiles */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {([
            { label: "Active Projects", value: active.length,    key: "active"    as const },
            { label: "Completed",       value: completed.length, key: "completed" as const },
            { label: "Total Projects",  value: projects.length,  key: "all"       as const },
          ] as { label: string; value: number; key: "active" | "completed" | "all" }[]).map(s => {
            const isSelected = filter === s.key;
            return (
              <button
                key={s.label}
                onClick={() => setFilter(isSelected ? "all" : s.key)}
                data-testid={`stat-tile-${s.key}`}
                className={`relative bg-card border rounded-xl p-4 text-center transition-all group ${
                  isSelected
                    ? "border-primary/60 shadow-md ring-2 ring-primary/20"
                    : "border-border hover:border-primary/30 hover:shadow-sm"
                }`}
              >
                <p
                  className="text-2xl font-bold"
                  style={{ color: isSelected ? "#FF5A1F" : undefined }}
                >
                  {s.value}
                </p>
                <p className={`text-xs mt-0.5 transition-colors ${
                  isSelected ? "text-primary font-semibold" : "text-muted-foreground group-hover:text-foreground"
                }`}>
                  {s.label}
                </p>

              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map(i => <div key={i} className="h-36 rounded-2xl bg-muted animate-pulse" />)}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Briefcase size={40} className="mx-auto mb-4 opacity-30" />
            <h3 className="font-semibold text-foreground mb-2">No projects yet</h3>
            <p className="text-sm mb-6">
              {user.role === "freelancer"
                ? "Projects appear here once a client hires you through Viewrr."
                : "Find a creative on Browse Talent and start a project together."}
            </p>
            <Button asChild className="bg-primary hover:bg-primary/90 text-white">
              <Link href="/marketplace">Browse Talent</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Filter label */}
            {filter !== "all" && (
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold capitalize">
                  Showing: <span style={{ color: "#FF5A1F" }}>{filter === "active" ? "Active Projects" : "Completed"}</span>
                </p>
                <button
                  onClick={() => setFilter("all")}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <X size={11} /> Clear filter
                </button>
              </div>
            )}

            {(filter === "all" || filter === "active") && active.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-4">
                  Active ({active.length})
                </h2>
                <div className="space-y-3">
                  {active.map(pw => (
                    <ProjectCard key={pw.project.id} pw={pw} currentUserId={user.id} onOpen={() => setOpenProject(pw)} />
                  ))}
                </div>
              </section>
            )}
            {(filter === "all" || filter === "completed") && completed.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-4">
                  Completed ({completed.length})
                </h2>
                <div className="space-y-3">
                  {completed.map(pw => (
                    <ProjectCard key={pw.project.id} pw={pw} currentUserId={user.id} onOpen={() => setOpenProject(pw)} />
                  ))}
                </div>
              </section>
            )}
            {filter !== "all" &&
             ((filter === "active" && active.length === 0) ||
              (filter === "completed" && completed.length === 0)) && (
              <div className="text-center py-16 text-muted-foreground">
                <Briefcase size={36} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No {filter} projects yet.</p>
                <button
                  onClick={() => setFilter("all")}
                  className="mt-3 text-xs text-primary hover:underline"
                >
                  Show all projects
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full-screen modal */}
      {openProject && (
        <ProjectModal
          pw={openProject}
          currentUserId={user.id}
          onClose={() => setOpenProject(null)}
        />
      )}
    </div>
  );
}
