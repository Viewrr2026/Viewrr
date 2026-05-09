import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthProvider";
import { Link } from "wouter";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import LoginModal from "@/components/LoginModal";
import SignupModal from "@/components/SignupModal";
import MeetingSection from "@/components/MeetingSection";
import DeliverablesSection from "@/components/DeliverablesSection";
import CreateProjectModal from "@/components/CreateProjectModal";
import {
  CheckCircle2, Circle, Clock, Briefcase, MessageSquare,
  ArrowRight, ChevronDown, ChevronUp, X, Expand, Video,
  Eye, EyeOff, Globe, Lock, AlertTriangle, RefreshCw,
  Plus, Send, Inbox, Check, XCircle, Upload, Trash2, ExternalLink, Star,
  Pause, Play, FileText, DollarSign, Banknote, BadgeCheck, Loader2 as LoaderIcon, AlertCircle,
} from "lucide-react";
import { safeGet, safeSet } from "@/lib/storage";
import { DEMO_USER_IDS, getMockProjects } from "@/lib/mockData";
import type { ProjectWithDetails } from "../../../server/storage";

// ── ReviewModal ─────────────────────────────────────────────────────────────
function ReviewModal({
  open, onClose, pw, currentUser, role,
}: {
  open: boolean;
  onClose: (submitted?: boolean) => void;
  pw: ProjectWithDetails;
  currentUser: { id: number; name: string; avatar?: string | null };
  role: "client" | "freelancer";
}) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Who is being reviewed?
  const reviewee = role === "client" ? pw.freelancer : pw.client;
  const revieweeProfile = role === "client" ? (pw as any).freelancerProfile : null;

  const handleSubmit = async () => {
    if (rating === 0) return setError("Please select a star rating.");
    if (comment.trim().length < 10) return setError("Please write at least 10 characters.");
    setSubmitting(true);
    setError("");
    try {
      // Reviews go on the REVIEWEE's profile.
      // reviewee is already set correctly: client reviews freelancer, freelancer reviews client.
      // /api/profile-by-user will auto-create a stub profile if none exists (e.g. for clients).
      const revieweeId = reviewee.id;
      const profileRes = await apiRequest("GET", `/api/profile-by-user/${revieweeId}`);
      const profile = await profileRes.json();
      if (!profile?.id) throw new Error("Could not find profile for this user");
      await apiRequest("POST", "/api/reviews", {
        profileId: profile.id,
        clientId: currentUser.id,
        clientName: currentUser.name,
        clientAvatar: currentUser.avatar || null,
        rating,
        comment: comment.trim(),
        projectType: pw.project.briefCategory || null,
        projectId: pw.project.id,
        role,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      onClose(true);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg">Leave a review</h2>
          <button onClick={() => onClose()} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        {/* Reviewee info */}
        <div className="flex items-center gap-3 mb-6 p-3 bg-muted/40 rounded-xl">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden flex-shrink-0">
            {reviewee.avatar
              ? <img src={reviewee.avatar} className="w-full h-full object-cover" />
              : <span className="text-sm font-bold text-primary">{reviewee.name.slice(0,2).toUpperCase()}</span>
            }
          </div>
          <div>
            <p className="font-semibold text-sm">{reviewee.name}</p>
            <p className="text-xs text-muted-foreground">{pw.project.title}</p>
          </div>
        </div>

        {/* Star picker */}
        <div className="mb-5">
          <p className="text-sm font-medium mb-2">Rating</p>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(n)}
                className="transition-transform hover:scale-110"
              >
                <Star
                  size={28}
                  className={n <= (hovered || rating)
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-muted-foreground"
                  }
                />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {["Poor","Fair","Good","Very good","Excellent"][rating-1]}
            </p>
          )}
        </div>

        {/* Comment */}
        <div className="mb-5">
          <p className="text-sm font-medium mb-2">Your review</p>
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={`How was working with ${reviewee.name}?`}
            className="resize-none h-28"
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground text-right mt-1">{comment.length}/500</p>
        </div>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => onClose()} disabled={submitting}>Cancel</Button>
          <Button
            className="flex-1 bg-primary hover:bg-primary/90 text-white"
            onClick={handleSubmit}
            disabled={submitting || rating === 0}
          >
            {submitting ? "Submitting..." : "Publish review"}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  if (status === "completed")         return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (status === "awaiting_payment")  return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
  if (status === "awaiting_signoff")  return "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400";
  if (status === "paused")            return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
}

function statusLabel(status: string): string {
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "awaiting_signoff") return "Awaiting sign-off";
  return status.charAt(0).toUpperCase() + status.slice(1);
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

// ── RetainerCycle type ──────────────────────────────────────────────────────
type RetainerCycle = {
  id: number;
  projectId: number;
  cycleNumber: number;
  status: "active" | "awaiting_signoff" | "awaiting_payment" | "paid" | "paused";
  startDate: string;
  endDate: string | null;
  freelancerNote: string | null;
  paymentStatus: "unpaid" | "paid";
  createdAt: string;
};

// ── Full-screen project modal ─────────────────────────────────────────────────
function ProjectModal({ pw, currentUserId, onClose }: {
  pw: ProjectWithDetails;
  currentUserId: number;
  onClose: () => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [showMeetings, setShowMeetings] = useState(false);
  const [leftTab, setLeftTab] = useState<"progress" | "description">("progress");
  const [showSendWork, setShowSendWork] = useState(false);
  const isFreelancer = currentUserId === pw.freelancer.id;
  const isClient = currentUserId === pw.client.id;
  const canAdvance = isFreelancer && pw.project.currentStage < STAGES.length - 1 && pw.project.status !== "completed" && pw.project.status !== "awaiting_payment";
  const isSendWorkStage = isFreelancer && pw.project.currentStage === STAGES.length - 2; // index 4 = Revisions
  const otherPerson = isFreelancer ? pw.client : pw.freelancer;

  // Retainer
  const isRetainerProject = (pw.project as any).isRetainer === 1;
  const [submitNote, setSubmitNote] = useState("");
  const [retainerActionError, setRetainerActionError] = useState("");

  const { data: retainerCycles = [], refetch: refetchCycles } = useQuery<RetainerCycle[]>({
    queryKey: ["/api/projects", pw.project.id, "retainer", "cycles"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${pw.project.id}/retainer/cycles`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isRetainerProject,
    staleTime: 0,
  });

  const currentCycle = retainerCycles.find(
    c => c.cycleNumber === ((pw.project as any).currentCycleNumber ?? 1)
  ) ?? retainerCycles[retainerCycles.length - 1];

  const submitCycleMutation = useMutation({
    mutationFn: ({ cycleId, note }: { cycleId: number; note: string }) =>
      apiRequest("POST", `/api/projects/${pw.project.id}/retainer/submit-cycle`, { cycleId, note }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
      refetchCycles();
      setSubmitNote("");
      setRetainerActionError("");
    },
    onError: () => setRetainerActionError("Failed to submit cycle. Please try again."),
  });

  const signoffCycleMutation = useMutation({
    mutationFn: (cycleId: number) =>
      apiRequest("POST", `/api/projects/${pw.project.id}/retainer/signoff-cycle`, { cycleId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
      refetchCycles();
      setRetainerActionError("");
    },
    onError: () => setRetainerActionError("Failed to sign off cycle."),
  });

  const payCycleMutation = useMutation({
    mutationFn: (cycleId: number) =>
      apiRequest("POST", `/api/projects/${pw.project.id}/retainer/pay-cycle`, { cycleId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
      refetchCycles();
      setRetainerActionError("");
    },
    onError: () => setRetainerActionError("Failed to record payment."),
  });

  const pauseMutation = useMutation({
    mutationFn: (cycleId: number) =>
      apiRequest("POST", `/api/projects/${pw.project.id}/retainer/pause`, { cycleId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
      refetchCycles();
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (cycleId: number) =>
      apiRequest("POST", `/api/projects/${pw.project.id}/retainer/resume`, { cycleId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
      refetchCycles();
    },
  });


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
          <div className="flex items-center gap-3 flex-shrink-0 flex-wrap justify-end">
            {(pw.project as any).isRetainer === 1 && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "#FF5A1F18", color: "#FF5A1F" }}>
                <RefreshCw size={9} /> Retainer
              </span>
            )}
            {(pw.project as any).agreedAmountPence != null && (
              <span
                className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full"
                style={{ background: "#FF5A1F18", color: "#FF5A1F" }}
                title="Agreed project price"
              >
                £{((pw.project as any).agreedAmountPence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} agreed
              </span>
            )}
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusPill(pw.project.status)}`}>
              {statusLabel(pw.project.status)}
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

          {/* Two-column: timeline + activity */}
          <div className="grid md:grid-cols-[1fr,380px] divide-y md:divide-y-0 md:divide-x divide-border px-0">

            {/* ── Left: tabbed panel ── */}
            <div className="px-7 py-6">

              {isRetainerProject ? (
                /* ────── RETAINER VIEW ────── */
                <div className="space-y-5">
                  {/* Cycle header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-base">
                        Cycle {(pw.project as any).currentCycleNumber ?? 1}
                        {(pw.project as any).totalCycles
                          ? <span className="text-muted-foreground font-normal text-sm"> of {(pw.project as any).totalCycles}</span>
                          : <span className="text-muted-foreground font-normal text-sm"> — open-ended</span>
                        }
                      </h3>
                      {(pw.project as any).billingCycle && (
                        <p className="text-xs text-muted-foreground capitalize mt-0.5">
                          {(pw.project as any).billingCycle} billing
                        </p>
                      )}
                    </div>
                    {currentCycle && pw.project.status !== "completed" && (
                      <button
                        onClick={() => {
                          if (!currentCycle) return;
                          if (currentCycle.status === "paused") {
                            resumeMutation.mutate(currentCycle.id);
                          } else {
                            pauseMutation.mutate(currentCycle.id);
                          }
                        }}
                        disabled={pauseMutation.isPending || resumeMutation.isPending}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50"
                        data-testid="btn-retainer-pause-resume"
                      >
                        {currentCycle?.status === "paused"
                          ? <><Play size={11} /> Resume</>
                          : <><Pause size={11} /> Pause</>
                        }
                      </button>
                    )}
                  </div>

                  {/* Deliverables info */}
                  {(pw.project as any).deliverablesPerCycle && (
                    <div className="rounded-xl bg-secondary/40 border border-border p-3">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                        <FileText size={10} /> Deliverables per cycle
                      </p>
                      <p className="text-sm text-foreground leading-relaxed">{(pw.project as any).deliverablesPerCycle}</p>
                    </div>
                  )}

                  {/* Current cycle status + actions */}
                  {currentCycle && (
                    <div className="rounded-2xl border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Cycle</p>
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusPill(currentCycle.status)}`}>
                          {statusLabel(currentCycle.status)}
                        </span>
                      </div>

                      {/* Freelancer: submit note + button */}
                      {isFreelancer && currentCycle.status === "active" && (
                        <div className="space-y-2">
                          <textarea
                            value={submitNote}
                            onChange={e => setSubmitNote(e.target.value)}
                            placeholder="Describe what you delivered this cycle…"
                            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none min-h-[72px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors placeholder:text-muted-foreground"
                            data-testid="input-submit-cycle-note"
                          />
                          <Button
                            size="sm"
                            className="w-full text-white"
                            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                            disabled={submitCycleMutation.isPending}
                            onClick={() => currentCycle && submitCycleMutation.mutate({ cycleId: currentCycle.id, note: submitNote })}
                            data-testid="btn-submit-cycle"
                          >
                            <Send size={12} className="mr-1.5" />
                            {submitCycleMutation.isPending ? "Submitting…" : "Submit Cycle for Sign-off"}
                          </Button>
                        </div>
                      )}

                      {/* Freelancer: note shown when awaiting sign-off */}
                      {isFreelancer && currentCycle.status === "awaiting_signoff" && (
                        <p className="text-xs text-muted-foreground">
                          Waiting for client sign-off.{currentCycle.freelancerNote ? ` Your note: "${currentCycle.freelancerNote}"` : ""}
                        </p>
                      )}

                      {/* Client: sign off */}
                      {isClient && currentCycle.status === "awaiting_signoff" && (
                        <div className="space-y-2">
                          {currentCycle.freelancerNote && (
                            <div className="rounded-xl bg-secondary/40 p-3 text-sm text-foreground leading-relaxed border border-border">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Freelancer note</p>
                              {currentCycle.freelancerNote}
                            </div>
                          )}
                          <Button
                            size="sm"
                            className="w-full text-white"
                            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                            disabled={signoffCycleMutation.isPending}
                            onClick={() => currentCycle && signoffCycleMutation.mutate(currentCycle.id)}
                            data-testid="btn-signoff-cycle"
                          >
                            <CheckCircle2 size={12} className="mr-1.5" />
                            {signoffCycleMutation.isPending ? "Signing off…" : "Sign Off This Cycle"}
                          </Button>
                        </div>
                      )}

                      {/* Client: pay */}
                      {isClient && currentCycle.status === "awaiting_payment" && (
                        <Button
                          size="sm"
                          className="w-full text-white"
                          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                          disabled={payCycleMutation.isPending}
                          onClick={() => currentCycle && payCycleMutation.mutate(currentCycle.id)}
                          data-testid="btn-pay-cycle"
                        >
                          <DollarSign size={12} className="mr-1.5" />
                          {payCycleMutation.isPending ? "Recording…" : "Confirm Payment for this Cycle"}
                        </Button>
                      )}

                      {currentCycle.status === "paid" && (
                        <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                          <CheckCircle2 size={12} /> Cycle {currentCycle.cycleNumber} complete — next cycle starting automatically.
                        </p>
                      )}

                      {retainerActionError && (
                        <p className="text-xs text-destructive">{retainerActionError}</p>
                      )}
                    </div>
                  )}

                  {/* Cycle history */}
                  {retainerCycles.length > 1 && (
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cycle History</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {[...retainerCycles].reverse().map(cycle => (
                          <div
                            key={cycle.id}
                            className="flex items-center justify-between px-3 py-2 rounded-xl bg-secondary/40 border border-border"
                          >
                            <div>
                              <p className="text-xs font-semibold">Cycle {cycle.cycleNumber}</p>
                              <p className="text-[11px] text-muted-foreground">{cycle.startDate}</p>
                            </div>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusPill(cycle.status)}`}>
                              {statusLabel(cycle.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ────── ONE-OFF VIEW (original tabs) ────── */
                <>
                  {/* Tabs */}
                  <div className="flex gap-1 mb-6 border-b border-border">
                    {(["progress", "description"] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setLeftTab(tab)}
                        className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors relative ${
                          leftTab === tab
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "progress" ? "Project Progress" : "Project Description"}
                        {leftTab === tab && (
                          <span
                            className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                            style={{ background: "#FF5A1F" }}
                          />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Progress tab */}
                  {leftTab === "progress" && (
                    <>
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
                    </>
                  )}

                  {/* Description tab */}
                  {leftTab === "description" && (
                    <div>
                      {pw.project.description ? (
                        <p className="text-sm text-foreground leading-relaxed">{pw.project.description}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No description provided for this project.</p>
                      )}
                    </div>
                  )}
                </>
              )}

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

              {/* Meetings — collapsed behind toggle */}
              <div className="border-t border-border pt-4">
                <button
                  onClick={() => setShowMeetings(v => !v)}
                  className="flex items-center justify-between w-full text-left group"
                >
                  <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-1.5">
                    <Video size={11} /> Meetings
                  </p>
                  {showMeetings
                    ? <ChevronUp size={14} className="text-muted-foreground" />
                    : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>
                {showMeetings && (
                  <div className="mt-3">
                    <MeetingSection
                      projectId={pw.project.id}
                      userId={currentUserId}
                      otherName={otherPerson.name}
                    />
                  </div>
                )}
              </div>

              {/* Work delivery — active projects */}
              {pw.project.status !== "completed" || (pw.project as any).paymentStatus === "unpaid" ? (
                <DeliverablesSection
                  projectId={pw.project.id}
                  userId={currentUserId}
                  isFreelancer={isFreelancer}
                  projectStatus={pw.project.status}
                  paymentStatus={(pw.project as any).paymentStatus ?? "unpaid"}
                  projectTitle={pw.project.title}
                  freelancerName={pw.freelancer.name}
                  clientId={pw.project.clientId}
                  agreedAmountPence={(pw.project as any).agreedAmountPence ?? (pw.project.budgetMax ? Math.round(pw.project.budgetMax * 100) : undefined)}
                  onPaymentConfirmed={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
                  }}
                />
              ) : (
                <DeliverablesSection
                  projectId={pw.project.id}
                  userId={currentUserId}
                  isFreelancer={isFreelancer}
                  projectStatus={pw.project.status}
                  paymentStatus={(pw.project as any).paymentStatus ?? "paid"}
                  projectTitle={pw.project.title}
                  freelancerName={pw.freelancer.name}
                  clientId={pw.project.clientId}
                  agreedAmountPence={(pw.project as any).agreedAmountPence ?? (pw.project.budgetMax ? Math.round(pw.project.budgetMax * 100) : undefined)}
                />
              )}

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
                      Send Message
                    </Button>
                    {canAdvance && !isSendWorkStage && (
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
                    {isSendWorkStage && pw.project.status !== "awaiting_payment" && pw.project.status !== "completed" && (
                      <Button
                        size="sm"
                        className="flex-1 text-sm text-white"
                        style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                        onClick={() => setShowSendWork(true)}
                        data-testid="btn-send-work"
                      >
                        <Upload size={13} className="mr-1.5" />
                        Send work
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Send Work Modal */}
      {showSendWork && (
        <SendWorkModal
          projectId={pw.project.id}
          currentUserId={currentUserId}
          clientName={pw.client.name}
          onClose={() => setShowSendWork(false)}
          onSent={() => {
            setShowSendWork(false);
            queryClient.invalidateQueries({ queryKey: ["/api/projects", currentUserId] });
            // Force immediate refetch of deliverables (don't rely on stale-time check)
            queryClient.refetchQueries({ queryKey: ["/api/projects", pw.project.id, "deliverables"] });
          }}
        />
      )}
    </div>
  );
}

// ── Send Work Modal ───────────────────────────────────────────────────────────
interface SendWorkLink {
  url: string;
  label: string;
}

function detectPlatformName(url: string): { logo: string; name: string; canEmbed: boolean; embedUrl: string } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    if (host.includes("youtube.com") || host === "youtu.be") {
      let id = u.searchParams.get("v");
      if (!id && host === "youtu.be") id = u.pathname.slice(1);
      if (!id) { const m = u.pathname.match(/\/embed\/([^/?]+)/); if (m) id = m[1]; }
      return { logo: "🎬", name: "YouTube", canEmbed: !!id, embedUrl: id ? `https://www.youtube.com/embed/${id}?rel=0&autoplay=0` : url };
    }
    if (host.includes("vimeo.com")) {
      const m = u.pathname.match(/\/(\d+)/);
      return { logo: "🎞️", name: "Vimeo", canEmbed: !!m?.[1], embedUrl: m?.[1] ? `https://player.vimeo.com/video/${m[1]}?title=0&byline=0` : url };
    }
    if (host.includes("drive.google.com")) {
      const m = u.pathname.match(/\/d\/([^/]+)/);
      return { logo: "📁", name: "Google Drive", canEmbed: !!m?.[1], embedUrl: m?.[1] ? `https://drive.google.com/file/d/${m[1]}/preview` : url };
    }
    if (host.includes("docs.google.com")) {
      const isSlides = u.pathname.includes("/presentation/");
      const isSheet = u.pathname.includes("/spreadsheets/");
      const m = u.pathname.match(/\/d\/([^/]+)/);
      const type = isSlides ? "presentation" : isSheet ? "spreadsheets" : "document";
      return { logo: "📄", name: isSlides ? "Google Slides" : isSheet ? "Google Sheets" : "Google Docs", canEmbed: !!m?.[1], embedUrl: m?.[1] ? `https://docs.google.com/${type}/d/${m[1]}/preview` : url };
    }
    if (host.includes("figma.com")) {
      return { logo: "🎨", name: "Figma", canEmbed: true, embedUrl: `https://www.figma.com/embed?embed_host=viewrr&url=${encodeURIComponent(url)}` };
    }
    if (host.includes("dropbox.com")) {
      return { logo: "📦", name: "Dropbox", canEmbed: true, embedUrl: url.replace("?dl=0","?raw=1").replace("dl=0","raw=1") };
    }
    if (host.includes("frame.io")) {
      return { logo: "🎥", name: "Frame.io", canEmbed: true, embedUrl: url };
    }
    return { logo: "🔗", name: host, canEmbed: false, embedUrl: url };
  } catch {
    return { logo: "🔗", name: "Link", canEmbed: false, embedUrl: url };
  }
}

const SW_LABEL_OPTIONS = ["Final cut", "Final files", "Assets", "Presentation", "Showreel", "Other"];

function SendWorkModal({
  projectId, currentUserId, clientName, onClose, onSent,
}: {
  projectId: number;
  currentUserId: number;
  clientName: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [links, setLinks] = useState<SendWorkLink[]>([{ url: "", label: SW_LABEL_OPTIONS[0] }]);
  const [customLabels, setCustomLabels] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState("");

  // Prevent backdrop scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function addLink() {
    setLinks(prev => [...prev, { url: "", label: SW_LABEL_OPTIONS[0] }]);
  }

  function removeLink(i: number) {
    setLinks(prev => prev.filter((_, idx) => idx !== i));
    setCustomLabels(prev => { const n = { ...prev }; delete n[i]; return n; });
    setErrors(prev => { const n = { ...prev }; delete n[i]; return n; });
  }

  function updateUrl(i: number, val: string) {
    setLinks(prev => prev.map((l, idx) => idx === i ? { ...l, url: val } : l));
    setErrors(prev => { const n = { ...prev }; delete n[i]; return n; });
  }

  function updateLabel(i: number, val: string) {
    setLinks(prev => prev.map((l, idx) => idx === i ? { ...l, label: val } : l));
  }

  async function handleSend() {
    setGlobalError("");
    const newErrors: Record<number, string> = {};

    // Validate all links
    for (let i = 0; i < links.length; i++) {
      const { url, label } = links[i];
      if (!url.trim()) { newErrors[i] = "Please paste a link"; continue; }
      try { new URL(url.trim()); } catch { newErrors[i] = "That doesn't look like a valid URL"; continue; }
      if (label === "Other" && !customLabels[i]?.trim()) { newErrors[i] = "Please enter a label"; }
    }

    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    if (links.length === 0) { setGlobalError("Add at least one link"); return; }

    setSubmitting(true);
    try {
      // 1. POST each deliverable
      for (let idx = 0; idx < links.length; idx++) {
        const { url, label } = links[idx];
        const info = detectPlatformName(url.trim());
        const finalLabel = label === "Other" ? (customLabels[idx]?.trim() || "Final files") : label;
        await fetch(`/api/projects/${projectId}/deliverables`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: url.trim(),
            label: finalLabel,
            platform: info.name,
            embedUrl: info.embedUrl,
            createdBy: currentUserId,
          }),
        });
      }

      // 2. Advance to Final Delivery (stage 5) + set awaiting_payment
      await apiRequest("POST", `/api/projects/${projectId}/advance`, {
        note: `Work sent to ${clientName} — awaiting payment to release files.`,
        authorId: currentUserId,
      });

      onSent();
    } catch (e) {
      setGlobalError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="send-work-modal"
    >
      <div className="bg-background border border-border rounded-3xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <h3 className="font-bold text-base">Send work to client</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Paste links to your deliverables — {clientName} will see them with a Viewrr watermark until payment is confirmed.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-4"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto" style={{ maxHeight: "60vh" }}>

          {links.map((link, i) => {
            const hasUrl = link.url.trim().length > 0;
            let platformInfo: ReturnType<typeof detectPlatformName> | null = null;
            try { new URL(link.url.trim()); platformInfo = detectPlatformName(link.url.trim()); } catch {}

            return (
              <div key={i} className="bg-secondary/30 rounded-2xl p-4 space-y-3 border border-border">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">Link {i + 1}</p>
                  {links.length > 1 && (
                    <button onClick={() => removeLink(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {/* URL input */}
                <input
                  type="url"
                  value={link.url}
                  onChange={e => updateUrl(i, e.target.value)}
                  placeholder="https://vimeo.com/… or youtube.com/…"
                  className="w-full text-sm h-9 px-3 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
                  data-testid={`input-send-work-url-${i}`}
                />

                {/* Platform detection feedback */}
                {hasUrl && platformInfo && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{platformInfo.logo}</span>
                    <span>Detected: <span className="font-semibold text-foreground">{platformInfo.name}</span></span>
                    {platformInfo.canEmbed
                      ? <span className="text-green-500">· Embeds in Viewrr ✓</span>
                      : <span className="text-amber-500">· Will open in new tab</span>}
                  </div>
                )}

                {/* Label pills */}
                <div className="flex flex-wrap gap-1.5">
                  {SW_LABEL_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => updateLabel(i, opt)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        link.label === opt
                          ? "bg-[#FF5A1F] border-[#FF5A1F] text-white"
                          : "border-border text-muted-foreground hover:border-[#FF5A1F] hover:text-foreground"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                {link.label === "Other" && (
                  <input
                    type="text"
                    value={customLabels[i] ?? ""}
                    onChange={e => setCustomLabels(prev => ({ ...prev, [i]: e.target.value }))}
                    placeholder="Custom label…"
                    className="w-full text-sm h-9 px-3 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
                  />
                )}

                {errors[i] && <p className="text-xs text-destructive">{errors[i]}</p>}
              </div>
            );
          })}

          {/* Add another link */}
          <button
            onClick={addLink}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
          >
            <Plus size={13} /> Add another link
          </button>

          {/* Info callout */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-secondary/50 border border-border">
            <Lock size={13} className="text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Files will display inside Viewrr with a watermark. Once {clientName} confirms payment, the watermark lifts and they receive full access.
            </p>
          </div>

          {globalError && <p className="text-xs text-destructive text-center">{globalError}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1 rounded-full" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-full text-white font-semibold gap-2"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
            onClick={handleSend}
            disabled={submitting}
            data-testid="btn-send-work-confirm"
          >
            {submitting ? "Sending…" : <><Send size={13} /> Send to client →</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Compact project card (list view) ─────────────────────────────────────────
function ProjectCard({ pw, currentUserId, onOpen, onReviewOpen }: {
  pw: ProjectWithDetails;
  currentUserId: number;
  onOpen: () => void;
  onReviewOpen?: () => void;
}) {
  const isFreelancer = currentUserId === pw.freelancer.id;
  const isClient = currentUserId === pw.client.id;
  const otherPerson  = isFreelancer ? pw.client : pw.freelancer;
  const pct = Math.round((pw.project.currentStage / (STAGES.length - 1)) * 100);
  const isCompleted = pw.project.status === "completed";
  const visKey = `project_visibility_${pw.project.id}`;
  const [isPublic, setIsPublic] = useState(() => safeGet(visKey) !== "private");

  // Retainer data
  const retainer = (pw.project as any);
  const isRetainerProject = retainer.isRetainer === 1;
  const cycleNum = retainer.currentCycleNumber ?? 1;
  const totalCycles = retainer.totalCycles;
  const billingCycle: string | null = retainer.billingCycle ?? null;

  // Has this user already left a review?
  const alreadyReviewed = isClient
    ? (pw.project as any).reviewGivenByClient === 1
    : (pw.project as any).reviewGivenByFreelancer === 1;

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
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {/* Retainer badge */}
          {isRetainerProject && (
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FF5A1F18", color: "#FF5A1F" }}>
              <RefreshCw size={8} />
              {billingCycle ? billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1) : "Retainer"}
            </span>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusPill(pw.project.status)}`}>
            {statusLabel(pw.project.status)}
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

      {/* Progress — retainer vs one-off */}
      {isRetainerProject ? (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">
              Cycle <span className="font-semibold text-foreground">{cycleNum}</span>
              {totalCycles ? ` of ${totalCycles}` : " — open-ended"}
            </span>
            {totalCycles && (
              <span className="text-xs font-semibold" style={{ color: "#FF5A1F" }}>
                {Math.round((cycleNum / totalCycles) * 100)}%
              </span>
            )}
          </div>
          {totalCycles && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(Math.round((cycleNum / totalCycles) * 100), 100)}%`,
                  background: "linear-gradient(90deg, #FF5A1F, #FFA500)",
                }}
              />
            </div>
          )}
          {/* Cycle status pills */}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium text-white" style={{ background: "linear-gradient(135deg,#FF5A1F,#FFA500)" }}>
              Cycle {cycleNum} active
            </span>
            {billingCycle && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground capitalize">
                {billingCycle}
              </span>
            )}
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      {/* Leave a review CTA — completed projects only, once per user */}
      {isCompleted && !alreadyReviewed && onReviewOpen && (
        <button
          onClick={e => { e.stopPropagation(); onReviewOpen(); }}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-xl border border-yellow-400/40 bg-yellow-400/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-400/20 transition-colors"
        >
          <Star size={12} className="fill-yellow-400 text-yellow-400" />
          Leave a review for {otherPerson.name}
        </button>
      )}
      {isCompleted && alreadyReviewed && (
        <p className="text-xs text-green-600 dark:text-green-400 mt-3 text-center flex items-center justify-center gap-1">
          <CheckCircle2 size={12} /> Review submitted
        </p>
      )}
      {!isCompleted && (
        <p className="text-xs text-muted-foreground mt-3 text-right group-hover:text-primary transition-colors">
          Click to open full view →
        </p>
      )}
    </button>
  );
}

// ── Invitation card ──────────────────────────────────────────────────────────
interface EnrichedInvitation {
  id: number;
  senderId: number;
  recipientId: number;
  title: string;
  description?: string | null;
  category?: string | null;
  budget?: string | null;
  timeline?: string | null;
  status: string;
  createdAt: string;
  senderName?: string;
  senderAvatar?: string | null;
  recipientName?: string;
  recipientAvatar?: string | null;
}

function InvitationCard({
  inv,
  currentUserId,
  onAccept,
  onDecline,
  accepting,
  declining,
}: {
  inv: EnrichedInvitation;
  currentUserId: number;
  onAccept: () => void;
  onDecline: () => void;
  accepting: boolean;
  declining: boolean;
}) {
  const isReceived = inv.recipientId === currentUserId;
  const otherName  = isReceived ? (inv.senderName ?? "Someone") : (inv.recipientName ?? "Someone");
  const otherAvatar = isReceived ? inv.senderAvatar : inv.recipientAvatar;

  const statusColour =
    inv.status === "accepted"  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
    : inv.status === "declined" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";

  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3">
      {/* Top row */}
      <div className="flex items-start gap-3">
        <Avatar className="w-9 h-9 flex-shrink-0">
          <AvatarImage src={otherAvatar || undefined} />
          <AvatarFallback className="bg-primary text-white text-xs">
            {otherName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{inv.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isReceived ? "From" : "Sent to"}: <span className="text-foreground font-medium">{otherName}</span>
              </p>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full flex-shrink-0 capitalize ${statusColour}`}>
              {inv.status}
            </span>
          </div>
        </div>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5">
        {inv.category && (
          <span className="px-2.5 py-1 rounded-full text-[11px] bg-secondary text-muted-foreground border border-border">
            {inv.category}
          </span>
        )}
        {inv.budget && (
          <span className="px-2.5 py-1 rounded-full text-[11px] bg-secondary text-muted-foreground border border-border">
            {inv.budget}
          </span>
        )}
        {inv.timeline && (
          <span className="px-2.5 py-1 rounded-full text-[11px] bg-secondary text-muted-foreground border border-border">
            {inv.timeline}
          </span>
        )}
      </div>

      {inv.description && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{inv.description}</p>
      )}

      {/* Actions — only for pending received invitations */}
      {isReceived && inv.status === "pending" && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={onAccept}
            disabled={accepting || declining}
            className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-full text-xs h-8"
            data-testid={`btn-accept-invitation-${inv.id}`}
          >
            {accepting ? (
              <span className="flex items-center gap-1"><Check size={12} className="animate-pulse" /> Accepting…</span>
            ) : (
              <span className="flex items-center gap-1"><Check size={12} /> Accept</span>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDecline}
            disabled={accepting || declining}
            className="flex-1 rounded-full text-xs h-8 border-border"
            data-testid={`btn-decline-invitation-${inv.id}`}
          >
            {declining ? (
              <span className="flex items-center gap-1"><XCircle size={12} className="animate-pulse" /> Declining…</span>
            ) : (
              <span className="flex items-center gap-1"><XCircle size={12} /> Decline</span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Earnings Notification Banner (freelancer only, shown when funds held) ────
function EarningsBanner({ userId, onSetupClick }: { userId: number; onSetupClick: () => void }) {
  const { data: status } = useQuery<{
    connected: boolean; onboarded: boolean; pendingPence: number;
  }>({
    queryKey: ["/api/stripe/status", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/status/${userId}`);
      if (!res.ok) return { connected: false, onboarded: false, pendingPence: 0 };
      return res.json();
    },
    staleTime: 30_000,
  });

  if (!status || status.onboarded || status.pendingPence <= 0) return null;

  const pendingGBP = (status.pendingPence / 100).toFixed(2);

  return (
    <div
      className="mb-6 rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #FF5A1F 0%, #FF8C42 60%, #FFD700 100%)",
        boxShadow: "0 4px 24px rgba(255,90,31,0.35)",
      }}
    >
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Coin pulse animation */}
          <div className="relative flex-shrink-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center bg-white/20"
              style={{ animation: "banner-pulse 2s ease-in-out infinite" }}
            >
              <Banknote size={18} className="text-white" />
            </div>
            <style>{`
              @keyframes banner-pulse {
                0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
                50% { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(255,255,255,0); }
              }
            `}</style>
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">You've been paid £{pendingGBP}</p>
            <p className="text-white/80 text-xs mt-0.5">Connect your bank account to receive it</p>
          </div>
        </div>
        <button
          onClick={onSetupClick}
          className="flex-shrink-0 px-4 py-2 rounded-full bg-white text-xs font-bold transition-all hover:scale-105 active:scale-95"
          style={{ color: "#FF5A1F" }}
        >
          Collect now →
        </button>
      </div>
    </div>
  );
}

// ── Payouts Panel (freelancer only) ───────────────────────────────────────────
function PayoutsPanel({ userId, triggerSetup = 0 }: { userId: number; triggerSetup?: number }) {
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupDone, setPopupDone] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevTrigger = useRef(0);

  const { data: status, isLoading, refetch } = useQuery<{
    connected: boolean;
    onboarded: boolean;
    chargesEnabled?: boolean;
    pendingPence: number;
    error?: string;
  }>({
    queryKey: ["/api/stripe/status", userId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stripe/status/${userId}`);
      if (!res.ok) return { connected: false, onboarded: false, pendingPence: 0 };
      return res.json();
    },
    staleTime: 30_000,
    refetchOnMount: true,
  });

  // Poll for status while popup is open, detect when it closes
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      // If popup closed by user
      if (popupRef.current?.closed) {
        clearInterval(pollRef.current!);
        setPopupOpen(false);
        await refetch();
        return;
      }
      // Poll status
      try {
        const res = await apiRequest("GET", `/api/stripe/status/${userId}`);
        if (res.ok) {
          const data = await res.json();
          queryClient.setQueryData(["/api/stripe/status", userId], data);
          if (data.onboarded) {
            clearInterval(pollRef.current!);
            popupRef.current?.close();
            setPopupOpen(false);
            setPopupDone(true);
          }
        }
      } catch {}
    }, 2500);
  }, [userId, refetch]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res1 = await apiRequest("POST", "/api/stripe/connect-account", { userId });
      if (!res1.ok) {
        const b = await res1.json().catch(() => ({}));
        throw new Error(b.error || "Could not create Stripe account");
      }
      const res2 = await apiRequest("POST", "/api/stripe/onboarding-link", { userId });
      if (!res2.ok) {
        const b = await res2.json().catch(() => ({}));
        throw new Error(b.error || "Could not generate onboarding link");
      }
      const { url } = await res2.json();
      return url as string;
    },
    onSuccess: (url) => {
      // Open centered popup instead of redirecting
      const w = 520, h = 720;
      const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
      const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
      const popup = window.open(
        url,
        "stripe_onboarding",
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
      if (popup) {
        popupRef.current = popup;
        setPopupOpen(true);
        setPopupDone(false);
        startPolling();
      } else {
        // Popup blocked — fallback to redirect
        window.location.href = url;
      }
    },
  });

  // When EarningsBanner "Collect now" is clicked, auto-fire the setup
  useEffect(() => {
    if (triggerSetup > 0 && triggerSetup !== prevTrigger.current && !popupOpen) {
      prevTrigger.current = triggerSetup;
      connectMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSetup]);

  const pendingGBP = status ? (status.pendingPence / 100).toFixed(2) : "0.00";

  return (
    <>
      {/* Popup waiting overlay */}
      {popupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
        >
          <div
            className="relative w-full max-w-sm mx-4 rounded-2xl border border-border bg-card p-8 flex flex-col items-center text-center"
            style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}
          >
            {/* Animated ring */}
            <div className="relative mb-6">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,90,31,0.12)" }}
              >
                <Banknote size={28} style={{ color: "#FF5A1F" }} />
              </div>
              {/* Spinning ring */}
              <svg className="absolute inset-0 w-16 h-16" viewBox="0 0 64 64" style={{ animation: "spin 2s linear infinite" }}>
                <circle cx="32" cy="32" r="29" fill="none" stroke="#FF5A1F" strokeWidth="2.5"
                  strokeDasharray="60 120" strokeLinecap="round" />
              </svg>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>

            <h3 className="text-base font-semibold mb-1">Verifying your identity</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
              Complete the steps in the Stripe window that just opened.<br />
              This page will update automatically when you're done.
            </p>

            {/* Pulse dots */}
            <div className="flex items-center gap-1.5 mb-6">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: "#FF5A1F",
                    animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
                    opacity: 0.3,
                  }}
                />
              ))}
              <style>{`
                @keyframes pulse-dot {
                  0%, 80%, 100% { opacity: 0.3; transform: scale(1); }
                  40% { opacity: 1; transform: scale(1.4); }
                }
              `}</style>
            </div>

            <div className="flex items-center gap-3 w-full">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 rounded-full text-xs"
                onClick={() => { popupRef.current?.focus(); }}
              >
                Bring window to front
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-xs text-muted-foreground"
                onClick={() => {
                  popupRef.current?.close();
                  if (pollRef.current) clearInterval(pollRef.current);
                  setPopupOpen(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8 rounded-2xl border border-border bg-card overflow-hidden" data-testid="panel-payouts">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Banknote size={16} className="text-primary" />
            <span className="text-sm font-semibold">Payouts</span>
          </div>
          {status?.onboarded && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>
              <BadgeCheck size={12} /> Active
            </span>
          )}
          {status?.connected && !status.onboarded && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20">
              Verification needed
            </span>
          )}
        </div>

        <div className="px-5 py-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderIcon size={14} className="animate-spin" />
              Checking payout status…
            </div>
          ) : popupDone || status?.onboarded ? (
            <div className="space-y-3">
              {popupDone && !status?.onboarded && (
                <div
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-medium"
                  style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}
                >
                  <CheckCircle2 size={14} />
                  Verification submitted — Stripe is processing your details.
                </div>
              )}
              <div className="flex items-center gap-2.5 text-sm">
                <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                <span className="text-muted-foreground">Your bank account is connected. Payments go to you automatically.</span>
              </div>
              {status && status.pendingPence > 0 && (
                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-secondary/60 border border-border">
                  <div className="flex items-center gap-2">
                    <DollarSign size={14} className="text-primary" />
                    <span className="text-xs font-semibold">Pending earnings</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: "#FF5A1F" }}>£{pendingGBP}</span>
                </div>
              )}
            </div>
          ) : status?.connected && !status.onboarded ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your Stripe account exists but needs verification to receive payments. Complete your details to unlock payouts.
                  {status.pendingPence > 0 && (
                    <span className="block mt-1 font-medium text-foreground">£{pendingGBP} is held and will be released once verified.</span>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                className="text-white rounded-full gap-2 text-xs"
                style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                data-testid="btn-complete-verification"
              >
                {connectMutation.isPending
                  ? <><LoaderIcon size={12} className="animate-spin" /> Opening…</>
                  : <>Complete verification →</>}
              </Button>
              {connectMutation.isError && (
                <p className="text-xs text-destructive">{(connectMutation.error as any)?.message}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Connect your bank account to receive payments from clients directly. It takes about 2 minutes.
              </p>
              <Button
                size="sm"
                className="text-white rounded-full gap-2 text-xs"
                style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                data-testid="btn-connect-bank"
              >
                {connectMutation.isPending
                  ? <><LoaderIcon size={12} className="animate-spin" /> Opening…</>
                  : <><Banknote size={12} /> Set up payouts</>}
              </Button>
              {connectMutation.isError && (
                <p className="text-xs text-destructive">{(connectMutation.error as any)?.message}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function YourWork() {
  const { user } = useAuth();
  const [openProject, setOpenProject] = useState<ProjectWithDetails | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [invTab, setInvTab] = useState<"received" | "sent">("received");
  const [reviewTarget, setReviewTarget] = useState<ProjectWithDetails | null>(null);
  const [invitationsOpen, setInvitationsOpen] = useState(true);
  const [payoutsTrigger, setPayoutsTrigger] = useState(0);

  const isDemo = !!user && DEMO_USER_IDS.has(user.id);

  const { data: projects = [], isLoading, isError, refetch } = useQuery<ProjectWithDetails[]>({
    queryKey: ["/api/projects", user?.id],
    queryFn: async () => {
      if (isDemo) return getMockProjects(user!.id) as any;
      try {
        const res = await fetch(`/api/projects?userId=${user!.id}`);
        if (!res.ok) return []; // server error — return empty, never throw
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch {
        return []; // network error — return empty, never throw
      }
    },
    enabled: !!user,
    staleTime: 0,          // always fetch fresh on mount — prevents stale cache showing wrong stage
    refetchOnMount: true,
    refetchInterval: false,
    retry: false,
  });

  // Keep open project in sync with refetched data
  useEffect(() => {
    if (openProject) {
      const fresh = projects.find(p => p.project.id === openProject.project.id);
      if (fresh) setOpenProject(fresh);
    }
  }, [projects]);

  // Handle Stripe return URL params
  const { toast } = useToast();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentResult = params.get("payment");
    if (paymentResult === "success") {
      toast({
        title: "Payment successful",
        description: "Your payment was processed by Stripe. The freelancer will be paid once their account is verified.",
        duration: 7000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", user?.id] });
      // Clean URL so toast doesn't re-fire on refresh
      const clean = window.location.pathname + (window.location.hash || "");
      window.history.replaceState({}, "", clean);
    } else if (paymentResult === "cancelled") {
      toast({
        title: "Payment cancelled",
        description: "You cancelled the payment — no charge was made.",
        duration: 5000,
      });
      const clean = window.location.pathname + (window.location.hash || "");
      window.history.replaceState({}, "", clean);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Invitations query
  const { data: invitations = [], refetch: refetchInvitations } = useQuery<EnrichedInvitation[]>({
    queryKey: ["/api/invitations", user?.id],
    queryFn: async () => {
      if (!user || isDemo) return [];
      try {
        const res = await fetch(`/api/invitations?userId=${user.id}`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user && !isDemo,
    refetchInterval: false,
    retry: false,
  });

  // Accept/decline mutations
  const acceptMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/invitations/${id}/accept`, { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", user?.id] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/invitations/${id}/decline`, { method: "PATCH" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations", user?.id] });
    },
  });

  const received = invitations.filter(i => i.recipientId === user?.id);
  const sent     = invitations.filter(i => i.senderId === user?.id);
  const pendingReceived = received.filter(i => i.status === "pending");

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
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1">Your Work</h1>
            <p className="text-muted-foreground text-sm">
              {user.role === "freelancer"
                ? "Track your active projects and keep clients in the loop."
                : "See exactly where every project stands — from kick-off to final delivery."}
            </p>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            className="bg-primary hover:bg-primary/90 text-white rounded-full px-5 text-sm flex items-center gap-2 flex-shrink-0"
            data-testid="btn-create-project"
          >
            <Plus size={15} /> Create Project
          </Button>
        </div>

        {/* ── Earnings banner — shown only when funds held and not verified ── */}
        {!isDemo && user.role === "freelancer" && (
          <EarningsBanner userId={user.id} onSetupClick={() => setPayoutsTrigger(t => t + 1)} />
        )}

        {/* ── Payouts panel (freelancers only) ── */}
        {!isDemo && user.role === "freelancer" && (
          <PayoutsPanel userId={user.id} triggerSetup={payoutsTrigger} />
        )}

        {/* ── Pending Invitations panel ── */}
        {!isDemo && invitations.length > 0 && (
          <div className="mb-8 rounded-2xl border border-border bg-card overflow-hidden">
            {/* Collapsible header — always visible */}
            <button
              onClick={() => setInvitationsOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary/40 transition-colors"
              aria-expanded={invitationsOpen}
            >
              <div className="flex items-center gap-2">
                <Inbox size={16} className="text-primary" />
                <span className="text-sm font-semibold">Project Invitations</span>
                {pendingReceived.length > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary text-white">
                    {pendingReceived.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!invitationsOpen && (
                  <span className="text-xs text-muted-foreground">
                    {invitations.length} invitation{invitations.length !== 1 ? "s" : ""}
                  </span>
                )}
                <ChevronDown
                  size={16}
                  className={`text-muted-foreground transition-transform duration-200 ${
                    invitationsOpen ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>

            {/* Collapsible body */}
            {invitationsOpen && (
              <>
                {/* Tabs */}
                <div className="flex items-center justify-between px-5 pb-3 border-b border-border">
                  <div className="flex gap-1 bg-secondary rounded-full p-0.5">
                    <button
                      onClick={() => setInvTab("received")}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        invTab === "received" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid="tab-inv-received"
                    >
                      Received {received.length > 0 && `(${received.length})`}
                    </button>
                    <button
                      onClick={() => setInvTab("sent")}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        invTab === "sent" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid="tab-inv-sent"
                    >
                      Sent {sent.length > 0 && `(${sent.length})`}
                    </button>
                  </div>
                </div>

                {/* Cards */}
                <div className="p-4 grid gap-3 sm:grid-cols-2">
                  {invTab === "received" && (
                    received.length === 0 ? (
                      <div className="col-span-2 text-center py-8 text-muted-foreground">
                        <Inbox size={28} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No invitations received yet</p>
                      </div>
                    ) : (
                      received.map(inv => (
                        <InvitationCard
                          key={inv.id}
                          inv={inv}
                          currentUserId={user.id}
                          onAccept={() => acceptMutation.mutate(inv.id)}
                          onDecline={() => declineMutation.mutate(inv.id)}
                          accepting={acceptMutation.isPending && acceptMutation.variables === inv.id}
                          declining={declineMutation.isPending && declineMutation.variables === inv.id}
                        />
                      ))
                    )
                  )}
                  {invTab === "sent" && (
                    sent.length === 0 ? (
                      <div className="col-span-2 text-center py-8 text-muted-foreground">
                        <Send size={28} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No invitations sent yet</p>
                        <button
                          onClick={() => setShowCreateModal(true)}
                          className="mt-2 text-xs text-primary hover:underline"
                        >
                          Create your first private project
                        </button>
                      </div>
                    ) : (
                      sent.map(inv => (
                        <InvitationCard
                          key={inv.id}
                          inv={inv}
                          currentUserId={user.id}
                          onAccept={() => acceptMutation.mutate(inv.id)}
                          onDecline={() => declineMutation.mutate(inv.id)}
                          accepting={acceptMutation.isPending && acceptMutation.variables === inv.id}
                          declining={declineMutation.isPending && declineMutation.variables === inv.id}
                        />
                      ))
                    )
                  )}
                </div>
              </>
            )}
          </div>
        )}

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
            {[1, 2, 3].map(i => (
              <div key={i} className="h-36 rounded-2xl bg-muted animate-pulse" />
            ))}
            <p className="text-xs text-muted-foreground text-center pt-2">Loading your projects...</p>
          </div>
        ) : isError ? (
          /* ── Network / server error ── */
          <div className="text-center py-20">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={26} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">Couldn't load your projects</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
              There was a problem connecting to the server. Your projects are safe — please try refreshing.
            </p>
            <Button
              onClick={() => refetch()}
              className="bg-primary hover:bg-primary/90 text-white rounded-full px-6"
            >
              <RefreshCw size={14} className="mr-2" /> Try again
            </Button>
          </div>
        ) : projects.length === 0 ? (
          /* ── Empty state — role-aware ── */
          <div className="text-center py-20 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
              <Briefcase size={28} className="text-primary" />
            </div>
            <h3 className="font-semibold text-foreground mb-2 text-lg">
              {user.role === "freelancer" ? "Your dashboard is ready" : "No projects yet"}
            </h3>
            <p className="text-sm mb-2 max-w-sm mx-auto leading-relaxed">
              {user.role === "freelancer"
                ? "Once a client starts a project with you, it will appear here. Your profile is live — make sure your portfolio looks great so clients can find you."
                : "Find a creative on Browse Talent and start a project together."}
            </p>
            {user.role === "freelancer" && (
              <p className="text-xs text-muted-foreground mb-6">
                In the meantime, post to the Feed to get noticed.
              </p>
            )}
            <div className="flex gap-3 justify-center">
              {user.role === "freelancer" ? (
                <>
                  <Button asChild className="bg-primary hover:bg-primary/90 text-white rounded-full px-6">
                    <Link href="/feed">Go to Feed</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full px-6">
                    <Link href="/marketplace">View my profile</Link>
                  </Button>
                </>
              ) : (
                <Button asChild className="bg-primary hover:bg-primary/90 text-white rounded-full px-6">
                  <Link href="/marketplace">Browse Talent</Link>
                </Button>
              )}
            </div>
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
                    <ProjectCard key={pw.project.id} pw={pw} currentUserId={user.id} onOpen={() => setOpenProject(pw)} onReviewOpen={() => setReviewTarget(pw)} />
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

      {/* Full-screen project modal */}
      {openProject && (
        <ProjectModal
          pw={openProject}
          currentUserId={user.id}
          onClose={() => setOpenProject(null)}
        />
      )}

      {/* Create Project modal */}
      {showCreateModal && (
        <CreateProjectModal
          senderId={user.id}
          onClose={() => setShowCreateModal(false)}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/invitations", user.id] });
          }}
        />
      )}

      {/* Review modal */}
      {reviewTarget && user && (
        <ReviewModal
          open={!!reviewTarget}
          onClose={(submitted) => {
            setReviewTarget(null);
            if (submitted) {
              queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
            }
          }}
          pw={reviewTarget}
          currentUser={{ id: user.id, name: user.name, avatar: user.avatar }}
          role={user.id === reviewTarget.client.id ? "client" : "freelancer"}
        />
      )}
    </div>
  );
}
