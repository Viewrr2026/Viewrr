/**
 * PRD-014 — Plan Your Project
 * Dynamic stage builder for newly accepted projects.
 * Used by freelancers to define how they'll deliver a project.
 */

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, ChevronUp, ChevronDown, CheckCircle2, Circle,
  Clock, Calendar, ArrowRight, Rocket, GripVertical, Pencil, X, Check,
  ClipboardList, Layers, ChevronRight, Users,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ProjectStage {
  id: number;
  projectId: number;
  position: number;
  title: string;
  description?: string | null;
  expectedDeliverable?: string | null;
  targetDate?: string | null;
  approvalRequired: number;
  revisionAllowance: string;
  status: string;
  startedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
  clientChangeRequest?: string | null;
}

interface DraftStage {
  id: string; // local draft ID
  title: string;
  description: string;
  expectedDeliverable: string;
  targetDate: string;
  approvalRequired: boolean;
  revisionAllowance: string;
}

type BuilderView = "choose" | "templates" | "builder" | "review" | "confirm" | "done";

const TEMPLATES: Record<string, Array<{ title: string; description: string; approvalRequired: boolean }>> = {
  Videography: [
    { title: "Planning", description: "Brief confirmed, shoot dates locked, locations scouted.", approvalRequired: false },
    { title: "Filming", description: "Capture agreed footage on location.", approvalRequired: false },
    { title: "First Edit", description: "First cut uploaded for client review.", approvalRequired: true },
    { title: "Revisions", description: "Agreed amendments following client feedback.", approvalRequired: false },
    { title: "Final Delivery", description: "Final approved files supplied.", approvalRequired: true },
  ],
  Photography: [
    { title: "Planning", description: "Shot list agreed, location confirmed, schedule set.", approvalRequired: false },
    { title: "Shoot", description: "Photography session takes place.", approvalRequired: false },
    { title: "Image Selection", description: "Selects shared for client to choose favourites.", approvalRequired: true },
    { title: "Retouching", description: "Final retouching applied to approved selects.", approvalRequired: false },
    { title: "Final Delivery", description: "Full resolution finals delivered.", approvalRequired: true },
  ],
  "Graphic Design": [
    { title: "Discovery", description: "Brief deep-dive, brand review, references gathered.", approvalRequired: false },
    { title: "Concepts", description: "Initial design directions presented.", approvalRequired: true },
    { title: "Design Development", description: "Chosen concept developed in full.", approvalRequired: false },
    { title: "Revisions", description: "Amends applied following client feedback.", approvalRequired: false },
    { title: "Final Artwork", description: "Production-ready files delivered.", approvalRequired: true },
  ],
  "Social Content": [
    { title: "Content Planning", description: "Content calendar and scripts agreed.", approvalRequired: true },
    { title: "Production", description: "Filming or design work.", approvalRequired: false },
    { title: "First Drafts", description: "First versions shared for review.", approvalRequired: true },
    { title: "Approval", description: "Final amendments and sign-off.", approvalRequired: true },
    { title: "Publishing / Delivery", description: "Content published or final files delivered.", approvalRequired: false },
  ],
  "Web Design": [
    { title: "Discovery", description: "Goals, audience and technical requirements defined.", approvalRequired: false },
    { title: "Wireframes", description: "Page layouts and user flows presented.", approvalRequired: true },
    { title: "Design", description: "Full visual design applied.", approvalRequired: true },
    { title: "Build", description: "Development and testing.", approvalRequired: false },
    { title: "Review", description: "Client walkthrough and final amends.", approvalRequired: true },
    { title: "Launch", description: "Site goes live.", approvalRequired: false },
  ],
};

function makeDraft(t?: Partial<DraftStage>): DraftStage {
  return {
    id: `draft_${Math.random().toString(36).slice(2)}`,
    title: t?.title ?? "",
    description: t?.description ?? "",
    expectedDeliverable: t?.expectedDeliverable ?? "",
    targetDate: t?.targetDate ?? "",
    approvalRequired: t?.approvalRequired ?? false,
    revisionAllowance: t?.revisionAllowance ?? "none",
  };
}

// ── Stage row in builder ───────────────────────────────────────────────────────
function StageRow({
  stage, index, total,
  onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  stage: DraftStage; index: number; total: number;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}) {
  return (
    <div className="group flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:border-[#FF5A1F]/30 transition-colors">
      {/* Position number */}
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
        style={{ background: "rgba(255,90,31,0.12)", color: "#FF5A1F" }}>
        {index + 1}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm">{stage.title || <span className="text-muted-foreground italic">Untitled stage</span>}</p>
          {stage.approvalRequired && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(255,90,31,0.12)", color: "#FF5A1F" }}>
              Client approval
            </span>
          )}
        </div>
        {stage.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{stage.description}</p>
        )}
        {stage.targetDate && (
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Calendar size={9} /> {stage.targetDate}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onMoveUp(stage.id)} disabled={index === 0}
          className="p-1 rounded hover:bg-muted disabled:opacity-30">
          <ChevronUp size={14} />
        </button>
        <button onClick={() => onMoveDown(stage.id)} disabled={index === total - 1}
          className="p-1 rounded hover:bg-muted disabled:opacity-30">
          <ChevronDown size={14} />
        </button>
        <button onClick={() => onEdit(stage.id)} className="p-1 rounded hover:bg-muted">
          <Pencil size={13} />
        </button>
        <button onClick={() => onDelete(stage.id)} className="p-1 rounded hover:bg-muted hover:text-destructive">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Inline stage editor ────────────────────────────────────────────────────────
function StageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Partial<DraftStage>;
  onSave: (s: DraftStage) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DraftStage>(makeDraft(initial));
  const up = (k: keyof DraftStage, v: any) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <div className="border border-[#FF5A1F]/40 rounded-xl p-4 bg-card space-y-3">
      <div>
        <Label className="text-xs font-semibold mb-1 block">Stage name *</Label>
        <Input value={draft.title} onChange={e => up("title", e.target.value)}
          placeholder="e.g. First Edit" className="text-sm" />
      </div>
      <div>
        <Label className="text-xs font-semibold mb-1 block">Description</Label>
        <Textarea value={draft.description} onChange={e => up("description", e.target.value)}
          placeholder="What happens in this stage?" className="text-sm resize-none" rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs font-semibold mb-1 block">Expected deliverable</Label>
          <Input value={draft.expectedDeliverable} onChange={e => up("expectedDeliverable", e.target.value)}
            placeholder="e.g. 3 concept boards" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs font-semibold mb-1 block">Target date</Label>
          <Input type="date" value={draft.targetDate} onChange={e => up("targetDate", e.target.value)}
            className="text-sm" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch checked={draft.approvalRequired} onCheckedChange={v => up("approvalRequired", v)} id={`apr-${draft.id}`} />
          <Label htmlFor={`apr-${draft.id}`} className="text-xs cursor-pointer">Client approval required</Label>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { if (!draft.title.trim()) return; onSave(draft); }}
          disabled={!draft.title.trim()} className="text-white text-xs gap-1"
          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}>
          <Check size={12} /> Save stage
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-xs">Cancel</Button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ProjectPlanBuilder({
  projectId,
  freelancerId,
  clientId,
  projectTitle,
  clientName,
  freelancerName,
  planningStatus,
  onPlanConfirmed,
  onClose,
  isClient = false,
  clientChangeRequest,
}: {
  projectId: number;
  freelancerId: number;
  clientId: number;
  projectTitle: string;
  clientName: string;
  freelancerName: string;
  planningStatus: string;
  onPlanConfirmed?: () => void;
  onClose?: () => void;
  isClient?: boolean;
  clientChangeRequest?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Determine starting view
  const initialView: BuilderView =
    isClient && planningStatus === "awaiting_client" ? "review"
    : planningStatus === "confirmed" ? "done"
    : planningStatus === "client_changes" ? "builder"
    : "choose";

  const [view, setView] = useState<BuilderView>(initialView);
  const [stages, setStages] = useState<DraftStage[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [requireClientApproval, setRequireClientApproval] = useState(true);
  const [changeMessage, setChangeMessage] = useState("");

  // Fetch existing stages if plan_draft / client_changes
  const { data: existingStages = [] } = useQuery<ProjectStage[]>({
    queryKey: [`/api/projects/${projectId}/stages`],
    enabled: ["plan_draft", "client_changes", "awaiting_client", "confirmed"].includes(planningStatus),
    onSuccess: (data) => {
      if (data.length > 0 && stages.length === 0) {
        setStages(data.map(s => makeDraft({
          id: `existing_${s.id}`,
          title: s.title,
          description: s.description ?? "",
          expectedDeliverable: s.expectedDeliverable ?? "",
          targetDate: s.targetDate ?? "",
          approvalRequired: s.approvalRequired === 1,
          revisionAllowance: s.revisionAllowance,
        })));
      }
    },
  });

  // Mutations
  const bulkMutation = useMutation({
    mutationFn: async (stgs: DraftStage[]) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/stages/bulk`, {
        freelancerId,
        stages: stgs.map(s => ({
          title: s.title,
          description: s.description || undefined,
          expectedDeliverable: s.expectedDeliverable || undefined,
          targetDate: s.targetDate || undefined,
          approvalRequired: s.approvalRequired,
          revisionAllowance: s.revisionAllowance,
        })),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ requireApproval }: { requireApproval: boolean }) => {
      // First bulk-save current draft
      await bulkMutation.mutateAsync(stages);
      const res = await apiRequest("POST", `/api/projects/${projectId}/plan/confirm`, {
        freelancerId,
        requireClientApproval: requireApproval,
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/projects", freelancerId] });
      if (data.status === "awaiting_client") {
        toast({ title: "Plan sent to client", description: `${clientName} will review and approve before work begins.` });
      } else {
        toast({ title: "🚀 Project underway!", description: `Stage 1 is now active.` });
      }
      setView("done");
      onPlanConfirmed?.();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/plan/approve`, { clientId });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", clientId] });
      toast({ title: "Plan approved", description: "The project is now underway." });
      setView("done");
      onPlanConfirmed?.();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const requestChangeMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/plan/request-change`, { clientId, message });
      if (!res.ok) throw new Error((await res.json()).error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", clientId] });
      toast({ title: "Change requested", description: `${freelancerName} will update the plan.` });
      onClose?.();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Stage manipulation helpers
  const addStage = (s: DraftStage) => { setStages(prev => [...prev, s]); setShowAddForm(false); };
  const saveEdit = (updated: DraftStage) => { setStages(prev => prev.map(s => s.id === updated.id ? updated : s)); setEditingId(null); };
  const deleteStage = (id: string) => setStages(prev => prev.filter(s => s.id !== id));
  const moveUp = (id: string) => setStages(prev => {
    const i = prev.findIndex(s => s.id === id);
    if (i === 0) return prev;
    const next = [...prev];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    return next;
  });
  const moveDown = (id: string) => setStages(prev => {
    const i = prev.findIndex(s => s.id === id);
    if (i === prev.length - 1) return prev;
    const next = [...prev];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    return next;
  });
  const applyTemplate = (name: string) => {
    const tmpl = TEMPLATES[name];
    if (!tmpl) return;
    setStages(tmpl.map(t => makeDraft(t)));
    setView("builder");
  };

  // ── Views ────────────────────────────────────────────────────────────────────

  // Client review view
  if (view === "review" && isClient) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: "rgba(255,90,31,0.08)", border: "1px solid rgba(255,90,31,0.25)" }}>
          <ClipboardList size={16} style={{ color: "#FF5A1F" }} />
          <div>
            <p className="text-sm font-semibold">{freelancerName} shared the project plan</p>
            <p className="text-xs text-muted-foreground">Review the stages below and approve to get started.</p>
          </div>
        </div>

        {existingStages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading plan…</p>
        ) : (
          <div className="space-y-2">
            {existingStages.map((stage, i) => (
              <div key={stage.id} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: "rgba(255,90,31,0.12)", color: "#FF5A1F" }}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{stage.title}</p>
                    {stage.approvalRequired === 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                        style={{ background: "rgba(255,90,31,0.12)", color: "#FF5A1F" }}>
                        Your approval needed
                      </span>
                    )}
                  </div>
                  {stage.description && <p className="text-xs text-muted-foreground mt-0.5">{stage.description}</p>}
                  {stage.targetDate && (
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <Calendar size={9} /> Target: {stage.targetDate}
                    </p>
                  )}
                </div>
                {i < existingStages.length - 1 && (
                  <ChevronRight size={14} className="text-muted-foreground flex-shrink-0 mt-1" />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}
            className="w-full text-white gap-2" style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}>
            <CheckCircle2 size={15} />
            {approveMutation.isPending ? "Approving…" : "Looks Good — Start Project"}
          </Button>
          <div className="flex items-center gap-2">
            <Textarea
              placeholder="e.g. Could we add a storyboard review before filming?"
              value={changeMessage}
              onChange={e => setChangeMessage(e.target.value)}
              className="text-sm resize-none" rows={2}
            />
          </div>
          <Button variant="outline" size="sm"
            onClick={() => { if (!changeMessage.trim()) return; requestChangeMutation.mutate(changeMessage); }}
            disabled={!changeMessage.trim() || requestChangeMutation.isPending}>
            {requestChangeMutation.isPending ? "Sending…" : "Request Change"}
          </Button>
        </div>
      </div>
    );
  }

  // Done state
  if (view === "done") {
    if (isClient) {
      return (
        <div className="text-center space-y-3 py-6">
          <div className="text-3xl">✅</div>
          <p className="font-bold text-base">Plan approved</p>
          <p className="text-sm text-muted-foreground">The project is underway. You'll be notified at each stage.</p>
          {onClose && <Button variant="outline" size="sm" onClick={onClose}>Close</Button>}
        </div>
      );
    }
    return (
      <div className="text-center space-y-3 py-6">
        <div className="text-3xl">🚀</div>
        <p className="font-bold text-base">
          {requireClientApproval ? `Plan sent to ${clientName}` : "Project underway!"}
        </p>
        <p className="text-sm text-muted-foreground">
          {requireClientApproval
            ? `${clientName} will review the plan and approve before work begins.`
            : "Stage 1 is now active. Time to get to work."}
        </p>
        {onClose && <Button variant="outline" size="sm" onClick={onClose}>Close</Button>}
      </div>
    );
  }

  // Choose view (start from scratch or template)
  if (view === "choose") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-bold text-base">Plan your project</h3>
          <p className="text-sm text-muted-foreground mt-1">
            How will you deliver <span className="font-medium text-foreground">{projectTitle}</span>?
            Break the work into clear stages so {clientName} always knows what's happening.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setView("builder")}
            className="flex flex-col items-start gap-2 p-4 rounded-xl border-2 border-border hover:border-[#FF5A1F]/50 transition-colors text-left"
          >
            <Plus size={20} style={{ color: "#FF5A1F" }} />
            <p className="font-semibold text-sm">Start from scratch</p>
            <p className="text-xs text-muted-foreground">Build your own stages from the ground up.</p>
          </button>
          <button
            onClick={() => setView("templates")}
            className="flex flex-col items-start gap-2 p-4 rounded-xl border-2 border-border hover:border-[#FF5A1F]/50 transition-colors text-left"
          >
            <Layers size={20} style={{ color: "#FF5A1F" }} />
            <p className="font-semibold text-sm">Use a template</p>
            <p className="text-xs text-muted-foreground">Start with a discipline-specific workflow.</p>
          </button>
        </div>

        {clientChangeRequest && (
          <div className="p-3 rounded-xl text-sm" style={{ background: "rgba(255,90,31,0.08)", border: "1px solid rgba(255,90,31,0.25)" }}>
            <p className="font-semibold text-xs mb-1" style={{ color: "#FF5A1F" }}>
              {clientName} requested a change:
            </p>
            <p className="text-muted-foreground">{clientChangeRequest}</p>
          </div>
        )}
      </div>
    );
  }

  // Template picker
  if (view === "templates") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setView("choose")} className="text-muted-foreground hover:text-foreground">
            <ChevronUp size={16} className="rotate-[-90deg]" />
          </button>
          <h3 className="font-bold text-sm">Choose a template</h3>
        </div>
        <p className="text-xs text-muted-foreground">Templates are starting points — every stage can be renamed, reordered or deleted.</p>
        <div className="space-y-2">
          {Object.entries(TEMPLATES).map(([name, stages]) => (
            <button
              key={name}
              onClick={() => applyTemplate(name)}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-border hover:border-[#FF5A1F]/40 hover:bg-muted/30 transition-colors text-left"
            >
              <div>
                <p className="font-semibold text-sm">{name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stages.map(s => s.title).join(" → ")}
                </p>
              </div>
              <ArrowRight size={14} className="text-muted-foreground flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Main builder
  if (view === "builder") {
    return (
      <div className="space-y-4">
        {clientChangeRequest && (
          <div className="p-3 rounded-xl text-sm" style={{ background: "rgba(255,90,31,0.08)", border: "1px solid rgba(255,90,31,0.25)" }}>
            <p className="font-semibold text-xs mb-1" style={{ color: "#FF5A1F" }}>
              {clientName} requested a change:
            </p>
            <p className="text-muted-foreground text-xs">{clientChangeRequest}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm">Your delivery stages</h3>
          <span className="text-xs text-muted-foreground">{stages.length} stage{stages.length !== 1 ? "s" : ""}</span>
        </div>

        {stages.length === 0 && !showAddForm && (
          <div className="text-center py-8 border-2 border-dashed border-border rounded-xl">
            <ClipboardList size={28} className="mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No stages yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add your first stage below</p>
          </div>
        )}

        <div className="space-y-2">
          {stages.map((stage, i) => (
            editingId === stage.id ? (
              <StageEditor key={stage.id} initial={stage} onSave={saveEdit} onCancel={() => setEditingId(null)} />
            ) : (
              <StageRow
                key={stage.id} stage={stage} index={i} total={stages.length}
                onEdit={setEditingId} onDelete={deleteStage}
                onMoveUp={moveUp} onMoveDown={moveDown}
              />
            )
          ))}
        </div>

        {showAddForm && (
          <StageEditor initial={{}} onSave={addStage} onCancel={() => setShowAddForm(false)} />
        )}

        {!showAddForm && stages.length < 20 && (
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}
            className="w-full gap-2 border-dashed">
            <Plus size={14} /> Add stage
          </Button>
        )}

        {stages.length > 0 && !showAddForm && !editingId && (
          <Button
            className="w-full text-white gap-2"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
            onClick={() => setView("review")}
          >
            Review plan <ArrowRight size={14} />
          </Button>
        )}

        <button onClick={() => setView("choose")} className="text-xs text-muted-foreground hover:text-foreground w-full text-center">
          ← Back
        </button>
      </div>
    );
  }

  // Plan review / confirm
  if (view === "review") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-bold text-sm">Your delivery plan</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{stages.length} stages · {projectTitle}</p>
        </div>

        {/* Stage flow */}
        <div className="space-y-1.5">
          {stages.map((stage, i) => (
            <div key={stage.id} className="flex items-start gap-2">
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: "rgba(255,90,31,0.12)", color: "#FF5A1F" }}>
                  {i + 1}
                </div>
                {i < stages.length - 1 && <div className="w-px h-4 bg-border mt-0.5" />}
              </div>
              <div className="pb-1">
                <p className="text-sm font-semibold leading-tight">{stage.title}</p>
                {stage.description && <p className="text-xs text-muted-foreground">{stage.description}</p>}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {stage.approvalRequired && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: "rgba(255,90,31,0.12)", color: "#FF5A1F" }}>
                      Client approval
                    </span>
                  )}
                  {stage.targetDate && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Calendar size={8} /> {stage.targetDate}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Client approval toggle */}
        <div className="p-3 rounded-xl border border-border space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Confirm plan with {clientName}?</p>
              <p className="text-[10px] text-muted-foreground">Recommended — lets {clientName} approve before work starts.</p>
            </div>
            <Switch checked={requireClientApproval} onCheckedChange={setRequireClientApproval} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            className="w-full text-white gap-2"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
            onClick={() => confirmMutation.mutate({ requireApproval: requireClientApproval })}
            disabled={confirmMutation.isPending}
          >
            <Rocket size={14} />
            {confirmMutation.isPending ? "Confirming…"
              : requireClientApproval ? `Send plan to ${clientName}` : "Confirm & Start Project"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setView("builder")} className="text-xs">
            ← Keep editing
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Active stage workspace (for confirmed projects) ───────────────────────────
export function ProjectTimeline({
  projectId,
  freelancerId,
  clientId,
  isFreelancer,
  projectStatus,
}: {
  projectId: number;
  freelancerId: number;
  clientId: number;
  isFreelancer: boolean;
  projectStatus: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const userId = isFreelancer ? freelancerId : clientId;

  const { data: stages = [], isLoading } = useQuery<ProjectStage[]>({
    queryKey: [`/api/projects/${projectId}/stages`],
    refetchInterval: 15000,
  });

  const activeStage = stages.find(s =>
    s.status === "in_progress" || s.status === "awaiting_client" || s.status === "changes_requested"
  );

  const completedCount = stages.filter(s => s.status === "completed" || s.status === "approved").length;
  const progress = stages.length > 0 ? Math.round((completedCount / stages.length) * 100) : 0;

  const submitMutation = useMutation({
    mutationFn: async (stageId: number) => {
      const res = await apiRequest("POST", `/api/stages/${stageId}/submit`, { freelancerId });
      if (!res.ok) throw new Error((await res.json()).error);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] }); toast({ title: "Sent for review" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: async (stageId: number) => {
      const res = await apiRequest("POST", `/api/stages/${stageId}/complete`, { freelancerId });
      if (!res.ok) throw new Error((await res.json()).error);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] }); toast({ title: "Stage completed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async (stageId: number) => {
      const res = await apiRequest("POST", `/api/stages/${stageId}/approve`, { clientId });
      if (!res.ok) throw new Error((await res.json()).error);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] }); toast({ title: "Stage approved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [changeMessage, setChangeMessage] = useState("");
  const requestChangesMutation = useMutation({
    mutationFn: async ({ stageId, message }: { stageId: number; message: string }) => {
      const res = await apiRequest("POST", `/api/stages/${stageId}/request-changes`, { clientId, message });
      if (!res.ok) throw new Error((await res.json()).error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] });
      setChangeMessage("");
      toast({ title: "Changes requested" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-4 text-center text-sm text-muted-foreground">Loading stages…</div>;
  if (stages.length === 0) return null;

  const stageStatusIcon = (status: string) => {
    if (status === "completed" || status === "approved") return <CheckCircle2 size={16} className="text-green-500" />;
    if (status === "in_progress") return <div className="w-4 h-4 rounded-full border-2 border-[#FF5A1F] bg-[#FF5A1F]/20" />;
    if (status === "awaiting_client") return <Clock size={16} className="text-amber-500" />;
    if (status === "changes_requested") return <div className="w-4 h-4 rounded-full border-2 border-destructive" />;
    return <Circle size={16} className="text-muted-foreground" />;
  };

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-muted-foreground">{completedCount} of {stages.length} stages complete</span>
          <span className="font-semibold" style={{ color: "#FF5A1F" }}>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${progress}%`, background: "linear-gradient(90deg,#FF5A1F,#FF8C42)" }} />
        </div>
      </div>

      {/* Stage list */}
      <div className="space-y-2">
        {stages.map((stage, i) => {
          const isActive = stage.status === "in_progress" || stage.status === "awaiting_client" || stage.status === "changes_requested";
          const isDone = stage.status === "completed" || stage.status === "approved";
          return (
            <div key={stage.id}
              className={`rounded-xl border transition-all ${isActive ? "border-[#FF5A1F]/40 bg-[#FF5A1F]/5" : "border-border bg-card"} ${isDone ? "opacity-70" : ""}`}>
              <div className="flex items-start gap-3 p-3">
                <div className="flex-shrink-0 mt-0.5">{stageStatusIcon(stage.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold ${isDone ? "line-through text-muted-foreground" : ""}`}>
                      {stage.title}
                    </p>
                    {stage.status === "awaiting_client" && (
                      <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600">Awaiting your review</Badge>
                    )}
                    {stage.status === "changes_requested" && (
                      <Badge variant="outline" className="text-[10px] border-destructive text-destructive">Changes requested</Badge>
                    )}
                    {stage.status === "approved" && (
                      <Badge variant="outline" className="text-[10px] border-green-500 text-green-600">Approved</Badge>
                    )}
                  </div>
                  {stage.description && isActive && (
                    <p className="text-xs text-muted-foreground mt-0.5">{stage.description}</p>
                  )}
                  {stage.targetDate && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Calendar size={9} /> {stage.targetDate}
                    </p>
                  )}
                  {stage.clientChangeRequest && stage.status === "changes_requested" && (
                    <div className="mt-1.5 p-2 rounded-lg text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <p className="font-semibold text-destructive mb-0.5">Client feedback:</p>
                      <p className="text-muted-foreground">{stage.clientChangeRequest}</p>
                    </div>
                  )}

                  {/* Freelancer actions */}
                  {isFreelancer && isActive && stage.status === "in_progress" && projectStatus !== "completed" && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {stage.approvalRequired ? (
                        <Button size="sm" className="h-7 text-xs gap-1 text-white"
                          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                          onClick={() => submitMutation.mutate(stage.id)}
                          disabled={submitMutation.isPending}>
                          <ArrowRight size={11} />
                          {submitMutation.isPending ? "Sending…" : "Mark ready for review"}
                        </Button>
                      ) : (
                        <Button size="sm" className="h-7 text-xs gap-1 text-white"
                          style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                          onClick={() => completeMutation.mutate(stage.id)}
                          disabled={completeMutation.isPending}>
                          <CheckCircle2 size={11} />
                          {completeMutation.isPending ? "Completing…" : "Complete stage"}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Client actions */}
                  {!isFreelancer && isActive && stage.status === "awaiting_client" && (
                    <div className="mt-2 space-y-2">
                      <Button size="sm" className="h-7 text-xs gap-1 text-white w-full"
                        style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                        onClick={() => approveMutation.mutate(stage.id)}
                        disabled={approveMutation.isPending}>
                        <CheckCircle2 size={11} />
                        {approveMutation.isPending ? "Approving…" : "Approve & Continue"}
                      </Button>
                      <div className="flex gap-2">
                        <Textarea
                          placeholder="Leave feedback…"
                          value={changeMessage}
                          onChange={e => setChangeMessage(e.target.value)}
                          className="text-xs resize-none h-12" rows={2}
                        />
                        <Button size="sm" variant="outline" className="h-12 text-xs px-2"
                          onClick={() => { if (!changeMessage.trim()) return; requestChangesMutation.mutate({ stageId: stage.id, message: changeMessage }); }}
                          disabled={!changeMessage.trim() || requestChangesMutation.isPending}>
                          Request changes
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
