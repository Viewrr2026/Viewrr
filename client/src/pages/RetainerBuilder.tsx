import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/components/AuthProvider";
import { apiRequest } from "@/lib/queryClient";
import { safeGet, safeSet } from "@/lib/storage";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  FileText, Camera, Video, Palette, Globe, Megaphone, Sparkles, Layers,
  CalendarDays, Plus, Trash2, ChevronLeft, ChevronRight, Check,
  ArrowLeftRight, Coins, Boxes, Shuffle, Wand2, GripVertical,
  Rocket, Send, MessageSquarePlus, CalendarClock, Eye, PartyPopper, Search, UserCircle2,
  Loader2, Clock, Info,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type TemplateId =
  | "monthly_content" | "social_media" | "video_production"
  | "photography" | "design_support" | "website_support"
  | "marketing_support" | "custom";

type CommercialModel = "fixed" | "reserved_capacity" | "credits" | "hybrid" | "bespoke";

type Frequency = "per_week" | "per_month" | "per_quarter" | "per_cycle";
type LineItemType = "included" | "optional" | "out_of_scope";
type RolloverRule = "none" | "limited" | "full";

interface Deliverable {
  id: string;
  name: string;
  quantity: number;
  frequency: Frequency;
  turnaroundDays: number;
  type: LineItemType;
  rollover: RolloverRule;
}

interface WorkflowStage {
  id: string;
  name: string;
}

type BillingFrequency = "weekly" | "monthly" | "quarterly" | "custom";
type RenewalMode = "rolling" | "fixed" | "trial";

interface DraftState {
  step: number;
  templateIds: TemplateId[];  // multi-select — merge deliverables from all
  commercialModel: CommercialModel | null;
  goal: string;
  successMeasures: string;
  keyChannels: string[];
  priorityOutcomes: string[];
  deliverables: Deliverable[];
  reservedHours: number;
  reservedCredits: number;
  workflowStages: WorkflowStage[];
  startDate: string;
  billingFrequency: BillingFrequency;
  amountPerCyclePence: number;
  minimumTermCycles: number;
  renewalMode: RenewalMode;
  noticePeriodCycles: number;
  introPrice: number | null;
  introCycles: number | null;
  setupFeePence: number;
  maxRevisions: number;
  responseTimeHours: number;
  clientInputDeadlineDays: number;
  excludedWork: string;
  outOfScopeProcess: string;
  clientName: string;
  recipientUserId: number | null;
}

const DRAFT_KEY = "retainer_draft";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const TEMPLATES: { id: TemplateId; label: string; description: string; icon: any }[] = [
  { id: "monthly_content", label: "Monthly Content", description: "Ongoing content production delivered on a monthly cadence.", icon: FileText },
  { id: "social_media", label: "Social Media", description: "Recurring posts, stories and community management.", icon: Megaphone },
  { id: "video_production", label: "Video Production", description: "Regular video edits, shoots and cutdowns.", icon: Video },
  { id: "photography", label: "Photography", description: "Scheduled photo shoots and image delivery.", icon: Camera },
  { id: "design_support", label: "Design Support", description: "On-demand design tasks and brand assets.", icon: Palette },
  { id: "website_support", label: "Website Support", description: "Ongoing site updates, fixes and improvements.", icon: Globe },
  { id: "marketing_support", label: "Marketing Support", description: "Broader marketing execution across channels.", icon: Sparkles },
  { id: "custom", label: "Custom", description: "Start from scratch and define your own structure.", icon: Layers },
];

const COMMERCIAL_MODELS: { id: CommercialModel; label: string; description: string; icon: any }[] = [
  { id: "fixed", label: "Fixed Deliverables", description: "A set list of deliverables is produced each cycle for a fixed price.", icon: Boxes },
  { id: "reserved_capacity", label: "Reserved Capacity / Hours", description: "The client reserves a block of your hours each cycle to use as needed.", icon: Clock },
  { id: "credits", label: "Credits", description: "The client buys a pool of credits redeemable against any deliverable type.", icon: Coins },
  { id: "hybrid", label: "Hybrid", description: "A mix of fixed deliverables plus reserved capacity for extra requests.", icon: Shuffle },
  { id: "bespoke", label: "Bespoke", description: "A fully custom structure agreed directly between you and the client.", icon: Wand2 },
];

const TEMPLATE_DELIVERABLES: Record<TemplateId, Omit<Deliverable, "id">[]> = {
  monthly_content: [
    { name: "Blog articles", quantity: 4, frequency: "per_month", turnaroundDays: 5, type: "included", rollover: "limited" },
    { name: "Newsletter", quantity: 1, frequency: "per_month", turnaroundDays: 3, type: "included", rollover: "none" },
  ],
  social_media: [
    { name: "Social posts", quantity: 12, frequency: "per_month", turnaroundDays: 2, type: "included", rollover: "limited" },
    { name: "Stories", quantity: 8, frequency: "per_month", turnaroundDays: 1, type: "optional", rollover: "none" },
  ],
  video_production: [
    { name: "Short-form edits", quantity: 4, frequency: "per_month", turnaroundDays: 4, type: "included", rollover: "limited" },
    { name: "Long-form video", quantity: 1, frequency: "per_month", turnaroundDays: 7, type: "optional", rollover: "none" },
  ],
  photography: [
    { name: "Photo shoot", quantity: 1, frequency: "per_month", turnaroundDays: 3, type: "included", rollover: "none" },
    { name: "Edited images", quantity: 20, frequency: "per_month", turnaroundDays: 5, type: "included", rollover: "limited" },
  ],
  design_support: [
    { name: "Design requests", quantity: 6, frequency: "per_month", turnaroundDays: 3, type: "included", rollover: "limited" },
  ],
  website_support: [
    { name: "Site update tickets", quantity: 5, frequency: "per_month", turnaroundDays: 2, type: "included", rollover: "limited" },
    { name: "Hours for fixes", quantity: 4, frequency: "per_month", turnaroundDays: 1, type: "optional", rollover: "none" },
  ],
  marketing_support: [
    { name: "Campaign assets", quantity: 3, frequency: "per_month", turnaroundDays: 5, type: "included", rollover: "limited" },
    { name: "Reporting", quantity: 1, frequency: "per_month", turnaroundDays: 3, type: "included", rollover: "none" },
  ],
  custom: [],
};

const TEMPLATE_WORKFLOW: string[] = [
  "Brief / Requests", "Production", "Client Review", "Revisions", "Approved", "Cycle Complete",
];

const CHANNELS = ["Instagram", "TikTok", "YouTube", "Website", "Email", "Other"];

const STEP_TITLES = [
  "Retainer Type",
  "Outcomes & Scope",
  "Capacity & Deliverables",
  "Schedule & Workflow",
  "Pricing & Commitment",
  "Boundaries & Changes",
  "Review Agreement",
  "Launch & Onboard",
];

const STEP_TIMES = ["~1 min", "~2 min", "~3 min", "~2 min", "~2 min", "~2 min", "~1 min", "~1 min"];

function defaultDraft(): DraftState {
  return {
    step: 1,
    templateIds: [],  // multi-select
    commercialModel: null,
    goal: "",
    successMeasures: "",
    keyChannels: [],
    priorityOutcomes: ["", "", ""],
    deliverables: [],
    reservedHours: 10,
    reservedCredits: 20,
    workflowStages: TEMPLATE_WORKFLOW.map(name => ({ id: uid(), name })),
    startDate: new Date().toISOString().slice(0, 10),
    billingFrequency: "monthly",
    amountPerCyclePence: 150000,
    minimumTermCycles: 3,
    renewalMode: "rolling",
    noticePeriodCycles: 1,
    introPrice: null,
    introCycles: null,
    setupFeePence: 0,
    maxRevisions: 2,
    responseTimeHours: 48,
    clientInputDeadlineDays: 3,
    excludedWork: "",
    outOfScopeProcess: "Requests outside this scope will be quoted separately before work begins.",
    clientName: "",
    recipientUserId: null,
  };
}

function fmtGBP(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

function cycleLengthDays(freq: BillingFrequency) {
  if (freq === "weekly") return 7;
  if (freq === "monthly") return 30;
  if (freq === "quarterly") return 90;
  return 30;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Small building blocks ──────────────────────────────────────────────────

function StepHeader({ step, title, time }: { step: number; title: string; time: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div
        className="flex items-center justify-center w-10 h-10 rounded-full text-white font-bold shrink-0 font-[Clash_Display,sans-serif]"
        style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
      >
        {step}
      </div>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-[Clash_Display,sans-serif]">{title}</h1>
        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          <Clock size={11} /> {time}
        </p>
      </div>
    </div>
  );
}

function ProgressBar({ current, onJump, maxReached }: { current: number; onJump: (n: number) => void; maxReached: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center">
        {STEP_TITLES.map((title, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          const clickable = n <= maxReached;
          return (
            <div key={n} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onJump(n)}
                title={title}
                className={`flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold shrink-0 transition-colors ${
                  done ? "bg-[#FF5A1F] text-white" :
                  active ? "bg-[#FF5A1F] text-white ring-4 ring-[#FF5A1F]/20" :
                  "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground"
                } ${clickable ? "cursor-pointer" : "cursor-not-allowed"}`}
              >
                {done ? <Check size={13} /> : n}
              </button>
              {n !== STEP_TITLES.length && (
                <div className={`h-1 flex-1 mx-1 rounded-full ${n < current ? "bg-[#FF5A1F]" : "bg-zinc-100 dark:bg-zinc-800"}`} />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center sm:text-left">
        Step {current} of {STEP_TITLES.length} — {STEP_TITLES[current - 1]}
      </p>
    </div>
  );
}

function NavButtons({
  onBack, onNext, backLabel = "Back", nextLabel = "Continue", nextDisabled, loading,
}: { onBack?: () => void; onNext: () => void; backLabel?: string; nextLabel?: string; nextDisabled?: boolean; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between mt-10 pt-6 border-t border-border">
      <button
        type="button"
        onClick={onBack}
        disabled={!onBack}
        className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-0 transition-colors"
      >
        <ChevronLeft size={16} /> {backLabel}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || loading}
        className="flex items-center gap-1.5 px-6 py-2.5 rounded-full text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : null}
        {nextLabel} {!loading && <ChevronRight size={16} />}
      </button>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function RetainerBuilder() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<DraftState>(defaultDraft);
  const [maxReached, setMaxReached] = useState(1);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientSearch, setShowClientSearch] = useState(false);

  // Load existing connections — maps storage shape { id, name, role, headline } → { userId, name, email }
  const { data: connections } = useQuery<Array<{ userId: number; name: string; email: string; avatar?: string }>>({
    queryKey: ["/api/connections", user?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/connections?userId=${user?.id}`);
      if (!res.ok) return [];
      const raw: Array<{ id: number; name: string; headline?: string | null; role?: string }> = await res.json();
      return raw.map(c => ({ userId: c.id, name: c.name ?? "Unknown", email: c.headline ?? c.role ?? "", avatar: undefined }));
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const filteredConnections = (connections ?? []).filter(c =>
    !clientSearch ||
    c.name?.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.email?.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Load draft on mount
  useEffect(() => {
    const raw = safeGet(DRAFT_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DraftState;
        setDraft({ ...defaultDraft(), ...parsed });
        setMaxReached(Math.max(1, parsed.step ?? 1));
      } catch {
        /* ignore corrupted draft */
      }
    }
  }, []);

  // Autosave on every change
  useEffect(() => {
    safeSet(DRAFT_KEY, JSON.stringify(draft));
    setLastSaved(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  }, [draft]);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  function goTo(step: number) {
    setDraft(d => ({ ...d, step }));
    setMaxReached(m => Math.max(m, step));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    const n = Math.min(8, draft.step + 1);
    goTo(n);
  }
  function back() {
    goTo(Math.max(1, draft.step - 1));
  }

  function selectTemplate(id: TemplateId) {
    setDraft(d => ({
      ...d,
      templateId: id,
      deliverables: d.deliverables.length ? d.deliverables : TEMPLATE_DELIVERABLES[id].map(x => ({ ...x, id: uid() })),
    }));
  }

  function addDeliverable() {
    setDraft(d => ({
      ...d,
      deliverables: [
        ...d.deliverables,
        { id: uid(), name: "", quantity: 1, frequency: "per_month", turnaroundDays: 3, type: "included", rollover: "none" },
      ],
    }));
  }
  function removeDeliverable(id: string) {
    setDraft(d => ({ ...d, deliverables: d.deliverables.filter(x => x.id !== id) }));
  }
  function updateDeliverable(id: string, patch: Partial<Deliverable>) {
    setDraft(d => ({ ...d, deliverables: d.deliverables.map(x => x.id === id ? { ...x, ...patch } : x) }));
  }

  function addStage() {
    setDraft(d => ({ ...d, workflowStages: [...d.workflowStages, { id: uid(), name: "New stage" }] }));
  }
  function removeStage(id: string) {
    setDraft(d => ({ ...d, workflowStages: d.workflowStages.filter(s => s.id !== id) }));
  }
  function renameStage(id: string, name: string) {
    setDraft(d => ({ ...d, workflowStages: d.workflowStages.map(s => s.id === id ? { ...s, name } : s) }));
  }
  function moveStage(id: string, dir: -1 | 1) {
    setDraft(d => {
      const idx = d.workflowStages.findIndex(s => s.id === id);
      const newIdx = idx + dir;
      if (idx < 0 || newIdx < 0 || newIdx >= d.workflowStages.length) return d;
      const stages = [...d.workflowStages];
      [stages[idx], stages[newIdx]] = [stages[newIdx], stages[idx]];
      return { ...d, workflowStages: stages };
    });
  }

  const estimatedFirstCycleEnd = useMemo(
    () => fmtDate(addDays(draft.startDate, cycleLengthDays(draft.billingFrequency))),
    [draft.startDate, draft.billingFrequency]
  );

  const nextInvoiceDate = useMemo(
    () => fmtDate(addDays(draft.startDate, cycleLengthDays(draft.billingFrequency))),
    [draft.startDate, draft.billingFrequency]
  );

  const viewrrFeePence = Math.round(draft.amountPerCyclePence * 0.11);
  const netToYouPence = draft.amountPerCyclePence - viewrrFeePence;

  async function handleSendToClient() {
    if (!user?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiRequest("POST", "/api/retainer-builder/create", {
        userId: user.id,
        templateIds: draft.templateIds,
        commercialModel: draft.commercialModel,
        goal: draft.goal,
        successMeasures: draft.successMeasures,
        keyChannels: draft.keyChannels,
        priorityOutcomes: draft.priorityOutcomes.filter(Boolean),
        deliverables: draft.deliverables,
        workflowStages: draft.workflowStages.map(s => s.name),
        startDate: draft.startDate,
        billingFrequency: draft.billingFrequency,
        amountPerCyclePence: draft.amountPerCyclePence,
        minimumTermCycles: draft.minimumTermCycles,
        renewalMode: draft.renewalMode,
        noticePeriodCycles: draft.noticePeriodCycles,
        introPrice: draft.introPrice,
        introCycles: draft.introCycles,
        setupFeePence: draft.setupFeePence,
        maxRevisions: draft.maxRevisions,
        responseTimeHours: draft.responseTimeHours,
        clientInputDeadlineDays: draft.clientInputDeadlineDays,
        excludedWork: draft.excludedWork,
        recipientUserId: draft.recipientUserId,
      });
      setLaunched(true);
    } catch (e: any) {
      setSubmitError(e?.message ?? "Something went wrong sending the proposal.");
    } finally {
      setSubmitting(false);
    }
  }

  // For display: primary template is first selected, or first matching
  const template = TEMPLATES.find(t => draft.templateIds.includes(t.id)) ?? null;
  const model = COMMERCIAL_MODELS.find(m => m.id === draft.commercialModel);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-24">
      <ProgressBar current={draft.step} onJump={goTo} maxReached={maxReached} />

      {/* ── Step 1: Retainer Type ── */}
      {draft.step === 1 && (
        <div>
          <StepHeader step={1} title="Retainer Type" time={STEP_TIMES[0]} />
          <p className="text-sm text-muted-foreground mb-4">Choose a starting template. You can customise everything later.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {TEMPLATES.map(t => {
              const Icon = t.icon;
              const active = draft.templateIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTemplate(t.id)}
                  className={`text-left p-4 rounded-2xl border-2 transition-all hover:shadow-md ${
                    active ? "border-[#FF5A1F] bg-[#FF5A1F]/5" : "border-border bg-card"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${active ? "bg-[#FF5A1F] text-white" : "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground"}`}>
                    <Icon size={17} />
                  </div>
                  <p className="text-sm font-semibold font-[Clash_Display,sans-serif]">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                </button>
              );
            })}
          </div>

          <p className="text-sm font-semibold mb-1">Commercial model</p>
          <p className="text-xs text-muted-foreground mb-4">How will this retainer be structured commercially?</p>
          <div className="space-y-2">
            {COMMERCIAL_MODELS.map(m => {
              const Icon = m.icon;
              const active = draft.commercialModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => update("commercialModel", m.id)}
                  className={`w-full flex items-start gap-3 text-left p-3.5 rounded-xl border-2 transition-all hover:shadow-sm ${
                    active ? "border-[#FF5A1F] bg-[#FF5A1F]/5" : "border-border bg-card"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-[#FF5A1F] text-white" : "bg-zinc-100 dark:bg-zinc-800 text-muted-foreground"}`}>
                    <Icon size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <NavButtons onNext={next} nextDisabled={draft.templateIds.length === 0 || !draft.commercialModel} />
        </div>
      )}

      {/* ── Step 2: Outcomes & Scope ── */}
      {draft.step === 2 && (
        <div>
          <StepHeader step={2} title="Outcomes & Scope" time={STEP_TIMES[1]} />
          <div className="space-y-6">
            <div>
              <label className="text-sm font-semibold block mb-1.5">What will this retainer help the client achieve?</label>
              <Textarea
                rows={4}
                value={draft.goal}
                onChange={e => update("goal", e.target.value)}
                placeholder="e.g. Grow our Instagram following steadily while keeping a consistent, on-brand posting rhythm every month."
                className="resize-none"
              />
            </div>

            <div>
              <label className="text-sm font-semibold block mb-1.5">Success measures</label>
              <Textarea
                rows={2}
                value={draft.successMeasures}
                onChange={e => update("successMeasures", e.target.value)}
                placeholder="e.g. 10% month-on-month follower growth, engagement rate above 4%, all posts delivered on schedule."
                className="resize-none"
              />
            </div>

            <div>
              <label className="text-sm font-semibold block mb-1.5">Key channels</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {CHANNELS.map(ch => {
                  const checked = draft.keyChannels.includes(ch);
                  return (
                    <label key={ch} className="flex items-center gap-2 text-sm p-2 rounded-lg border border-border cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => update("keyChannels", v
                          ? [...draft.keyChannels, ch]
                          : draft.keyChannels.filter(c => c !== ch))}
                      />
                      {ch}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-1.5">Priority outcomes</label>
              <div className="space-y-2">
                {draft.priorityOutcomes.map((val, i) => (
                  <input
                    key={i}
                    type="text"
                    value={val}
                    onChange={e => {
                      const arr = [...draft.priorityOutcomes];
                      arr[i] = e.target.value;
                      update("priorityOutcomes", arr);
                    }}
                    placeholder={["e.g. Ship 4 pieces of content every month", "e.g. Keep turnaround under 5 days", "e.g. Maintain consistent brand voice"][i]}
                    className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
                  />
                ))}
              </div>
            </div>
          </div>
          <NavButtons onBack={back} onNext={next} nextDisabled={!draft.goal.trim()} />
        </div>
      )}

      {/* ── Step 3: Capacity & Deliverables ── */}
      {draft.step === 3 && (
        <div>
          <StepHeader step={3} title="Capacity & Deliverables" time={STEP_TIMES[2]} />

          {draft.commercialModel === "reserved_capacity" ? (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-sm font-semibold block mb-1.5">Reserved hours per cycle</label>
                <input
                  type="number"
                  min={0}
                  value={draft.reservedHours}
                  onChange={e => update("reservedHours", Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
                />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Credits per cycle</label>
                <input
                  type="number"
                  min={0}
                  value={draft.reservedCredits}
                  onChange={e => update("reservedCredits", Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-3 mb-4">
            {draft.deliverables.map(item => (
              <div key={item.id} className="p-3.5 rounded-xl border border-border bg-card space-y-3">
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => updateDeliverable(item.id, { name: e.target.value })}
                    placeholder="Deliverable name"
                    className="flex-1 px-3 py-2 text-sm border border-input rounded-lg bg-background font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => removeDeliverable(item.id)}
                    className="p-2 rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600 shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Quantity</label>
                    <input
                      type="number" min={0}
                      value={item.quantity}
                      onChange={e => updateDeliverable(item.id, { quantity: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs border border-input rounded-lg bg-background"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Frequency</label>
                    <Select value={item.frequency} onValueChange={(v) => updateDeliverable(item.id, { frequency: v as Frequency })}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_week">per week</SelectItem>
                        <SelectItem value="per_month">per month</SelectItem>
                        <SelectItem value="per_quarter">per quarter</SelectItem>
                        <SelectItem value="per_cycle">per cycle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Turnaround (days)</label>
                    <input
                      type="number" min={0}
                      value={item.turnaroundDays}
                      onChange={e => updateDeliverable(item.id, { turnaroundDays: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 text-xs border border-input rounded-lg bg-background"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Type</label>
                    <Select value={item.type} onValueChange={(v) => updateDeliverable(item.id, { type: v as LineItemType })}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="included">Included</SelectItem>
                        <SelectItem value="optional">Optional</SelectItem>
                        <SelectItem value="out_of_scope">Out of scope</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Rollover</label>
                    <Select value={item.rollover} onValueChange={(v) => updateDeliverable(item.id, { rollover: v as RolloverRule })}>
                      <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="limited">Limited</SelectItem>
                        <SelectItem value="full">Full</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addDeliverable}
            className="flex items-center gap-1.5 text-sm font-semibold text-[#FF5A1F] hover:underline"
          >
            <Plus size={15} /> Add deliverable
          </button>

          <NavButtons onBack={back} onNext={next} />
        </div>
      )}

      {/* ── Step 4: Schedule & Workflow ── */}
      {draft.step === 4 && (
        <div>
          <StepHeader step={4} title="Schedule & Workflow" time={STEP_TIMES[3]} />
          <p className="text-sm text-muted-foreground mb-4 -mt-1">A <strong>billing period</strong> (also called a cycle) is one repeating unit of your retainer — typically one month. You and your client work through deliverables, then review at the end of each period.</p>
          <p className="text-sm font-semibold mb-2">Cycle workflow</p>
          <p className="text-xs text-muted-foreground mb-4">This is the pipeline every cycle will move through.</p>

          <div className="flex items-stretch gap-2 overflow-x-auto pb-2 mb-4">
            {draft.workflowStages.map((s, i) => (
              <div key={s.id} className="flex items-center shrink-0">
                <div className="flex flex-col gap-1.5 p-2.5 rounded-xl border border-border bg-card w-36 shrink-0">
                  <div className="flex items-center gap-1">
                    <GripVertical size={12} className="text-muted-foreground shrink-0" />
                    <input
                      value={s.name}
                      onChange={e => renameStage(s.id, e.target.value)}
                      className="flex-1 text-xs font-semibold bg-transparent border-none outline-none min-w-0"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => moveStage(s.id, -1)} disabled={i === 0} className="text-muted-foreground disabled:opacity-30">
                        <ChevronLeft size={13} />
                      </button>
                      <button type="button" onClick={() => moveStage(s.id, 1)} disabled={i === draft.workflowStages.length - 1} className="text-muted-foreground disabled:opacity-30">
                        <ChevronRight size={13} />
                      </button>
                    </div>
                    <button type="button" onClick={() => removeStage(s.id)} className="text-muted-foreground hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {i < draft.workflowStages.length - 1 && (
                  <ArrowLeftRight size={13} className="text-muted-foreground mx-1.5 shrink-0" />
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addStage} className="flex items-center gap-1.5 text-sm font-semibold text-[#FF5A1F] hover:underline mb-8">
            <Plus size={15} /> Add stage
          </button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold flex items-center gap-1.5 mb-1.5"><CalendarDays size={14} /> Start date</label>
              <input
                type="date"
                value={draft.startDate}
                onChange={e => update("startDate", e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Estimated first cycle end date</label>
              <div className="px-3.5 py-2.5 text-sm border border-input rounded-lg bg-zinc-50 dark:bg-zinc-900 text-muted-foreground">
                {estimatedFirstCycleEnd ?? (draft.startDate ? 'Select a billing frequency above' : 'Select a start date above')}
              </div>
            </div>
          </div>

          <NavButtons onBack={back} onNext={next} />
        </div>
      )}

      {/* ── Step 5: Pricing & Commitment ── */}
      {draft.step === 5 && (
        <div>
          <StepHeader step={5} title="Pricing & Billing Period" time={STEP_TIMES[4]} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Billing frequency</label>
              <p className="text-xs text-muted-foreground mb-2">Each billing period (called a <strong>cycle</strong>) is one payment + delivery unit — usually one month. Each cycle has its own deliverables, invoice, and review.</p>
              <Select value={draft.billingFrequency} onValueChange={(v) => update("billingFrequency", v as BillingFrequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Amount per cycle (£)</label>
              <input
                type="number" min={0} step="0.01"
                value={draft.amountPerCyclePence / 100}
                onChange={e => update("amountPerCyclePence", Math.round(Number(e.target.value) * 100))}
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Minimum term (cycles)</label>
              <input
                type="number" min={1}
                value={draft.minimumTermCycles}
                onChange={e => update("minimumTermCycles", Number(e.target.value))}
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Renewal mode</label>
              <Select value={draft.renewalMode} onValueChange={(v) => update("renewalMode", v as RenewalMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rolling">Rolling</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Notice period</label>
              <Select value={String(draft.noticePeriodCycles)} onValueChange={(v) => update("noticePeriodCycles", Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 month</SelectItem>
                  <SelectItem value="2">2 months</SelectItem>
                  <SelectItem value="3">3 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Setup fee (£, optional)</label>
              <input
                type="number" min={0} step="0.01"
                value={draft.setupFeePence / 100}
                onChange={e => update("setupFeePence", Math.round(Number(e.target.value) * 100))}
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Intro price (£, optional)</label>
              <input
                type="number" min={0} step="0.01"
                value={draft.introPrice != null ? draft.introPrice / 100 : ""}
                onChange={e => update("introPrice", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))}
                placeholder="e.g. 100.00"
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Intro price applies for (cycles)</label>
              <input
                type="number" min={0}
                value={draft.introCycles ?? ""}
                onChange={e => update("introCycles", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="e.g. 2"
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl border border-border bg-zinc-50 dark:bg-zinc-900">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1"><Info size={12} /> Next invoice date</p>
            <p className="text-sm font-semibold">{nextInvoiceDate}</p>
          </div>

          <div className="mt-4 p-4 rounded-xl border border-[#FF5A1F]/30 bg-[#FF5A1F]/5">
            <p className="text-xs font-semibold mb-2">Viewrr fee breakdown (11%)</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Client pays</span>
              <span className="font-semibold">{fmtGBP(draft.amountPerCyclePence)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Viewrr fee</span>
              <span className="font-semibold">-{fmtGBP(viewrrFeePence)}</span>
            </div>
            <div className="flex items-center justify-between text-sm border-t border-[#FF5A1F]/20 mt-1.5 pt-1.5">
              <span className="font-semibold">You receive</span>
              <span className="font-bold text-[#FF5A1F]">{fmtGBP(netToYouPence)}</span>
            </div>
          </div>

          <NavButtons onBack={back} onNext={next} />
        </div>
      )}

      {/* ── Step 6: Boundaries & Changes ── */}
      {draft.step === 6 && (
        <div>
          <StepHeader step={6} title="Boundaries & Changes" time={STEP_TIMES[5]} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm font-semibold block mb-1.5">Number of revisions</label>
              <input
                type="number" min={0}
                value={draft.maxRevisions}
                onChange={e => update("maxRevisions", Number(e.target.value))}
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Response time SLA</label>
              <Select value={String(draft.responseTimeHours)} onValueChange={(v) => update("responseTimeHours", Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="48">48 hours</SelectItem>
                  <SelectItem value="72">72 hours</SelectItem>
                  <SelectItem value="120">5 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1.5">Client input deadline (days before cycle end)</label>
              <input
                type="number" min={0}
                value={draft.clientInputDeadlineDays}
                onChange={e => update("clientInputDeadlineDays", Number(e.target.value))}
                className="w-full px-3.5 py-2.5 text-sm border border-input rounded-lg bg-background"
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="text-sm font-semibold block mb-1.5">Excluded work</label>
            <Textarea
              rows={3}
              value={draft.excludedWork}
              onChange={e => update("excludedWork", e.target.value)}
              placeholder="e.g. Paid ad management, third-party licensing costs, video voiceover talent."
              className="resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-semibold block mb-1.5">Out-of-scope process</label>
            <Textarea
              rows={2}
              value={draft.outOfScopeProcess}
              onChange={e => update("outOfScopeProcess", e.target.value)}
              className="resize-none"
            />
          </div>

          <NavButtons onBack={back} onNext={next} />
        </div>
      )}

      {/* ── Step 7: Review Agreement ── */}
      {draft.step === 7 && (
        <div>
          <StepHeader step={7} title="Review Agreement" time={STEP_TIMES[6]} />
          <AgreementSummary draft={draft} template={template} model={model} nextInvoiceDate={nextInvoiceDate} />

          <div className="flex flex-col sm:flex-row gap-2 mt-6">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold border border-border hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <Eye size={15} /> Preview as client
            </button>
            <button
              type="button"
              onClick={next}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
            >
              <Check size={15} /> Looks good — continue
            </button>
          </div>

          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Retainer proposal preview</DialogTitle>
              </DialogHeader>
              <AgreementSummary draft={draft} template={template} model={model} nextInvoiceDate={nextInvoiceDate} readOnly />
              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="px-4 py-2 rounded-full text-sm font-semibold text-white"
                  style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                >
                  Close preview
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <NavButtons onBack={back} onNext={next} nextLabel="Continue" />
        </div>
      )}

      {/* ── Step 8: Launch & Onboard ── */}
      {draft.step === 8 && (
        <div>
          {!launched ? (
            <>
              <StepHeader step={8} title="Launch & Onboard" time={STEP_TIMES[7]} />
              <div className="text-center py-6">
                <PartyPopper size={40} className="text-[#FF5A1F] mx-auto mb-3" />
                <h2 className="text-2xl font-bold font-[Clash_Display,sans-serif] mb-1">Your retainer proposal is ready 🎉</h2>
                <p className="text-sm text-muted-foreground">Review the summary below, then send it to your client.</p>
              </div>

              <AgreementSummary draft={draft} template={template} model={model} nextInvoiceDate={nextInvoiceDate} compact />

              {submitError && (
                <p className="text-sm text-red-600 mt-4 text-center">{submitError}</p>
              )}

              {/* Client selector */}
              <div className="mt-6 mb-4 rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold">Send to</span>
                  {draft.recipientUserId && (
                    <button type="button" onClick={() => update("recipientUserId", null)} className="text-xs text-muted-foreground hover:text-primary">Change</button>
                  )}
                </div>
                {draft.recipientUserId ? (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserCircle2 size={18} className="text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{connections?.find(c => c.userId === draft.recipientUserId)?.name ?? "Selected client"}</p>
                      <p className="text-xs text-muted-foreground">{connections?.find(c => c.userId === draft.recipientUserId)?.email ?? ""}</p>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <div className="relative mb-2">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={clientSearch}
                        onChange={e => setClientSearch(e.target.value)}
                        placeholder="Search your connections by name or email…"
                        className="w-full pl-8 pr-3 py-2 text-sm border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    {(filteredConnections.length > 0 || clientSearch) ? (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {filteredConnections.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-3 text-center">No connections found matching "{clientSearch}"</p>
                        ) : filteredConnections.map(c => (
                          <button
                            key={c.userId}
                            type="button"
                            onClick={() => { update("recipientUserId", c.userId); setClientSearch(""); }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary/50 text-left transition-colors"
                          >
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <UserCircle2 size={15} className="text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold leading-tight">{c.name}</p>
                              <p className="text-xs text-muted-foreground">{c.email}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Start typing to search your connections, or <a href="/#/your-work" className="text-primary underline">go to Your Work</a> to start a project with a new client first.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleSendToClient}
                  disabled={submitting || !draft.recipientUserId}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-full text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2 transition-opacity"
                  style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                  title={!draft.recipientUserId ? "Select a client above first" : ""}
                >
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {draft.recipientUserId ? "Send to Client" : "Select a client above to send"}
                </button>
                <button type="button" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border border-border hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <MessageSquarePlus size={15} /> Add Welcome Message
                </button>
                <button type="button" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border border-border hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <CalendarClock size={15} /> Schedule Kick-off
                </button>
                <button type="button" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border border-border hover:bg-zinc-50 dark:hover:bg-zinc-900 sm:col-span-2">
                  <Eye size={15} /> Preview Workspace
                </button>
              </div>

              <div className="mt-10">
                <p className="text-sm font-semibold mb-3">What happens next</p>
                <div className="space-y-3">
                  {[
                    "Proposal sent to client",
                    "Client reviews & accepts",
                    "First cycle begins",
                    "Automatic invoice generated",
                  ].map((label, i) => (
                    <div key={label} className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[#FF5A1F]/10 text-[#FF5A1F] text-xs font-bold shrink-0">{i + 1}</div>
                      <p className="text-sm">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <NavButtons onBack={back} onNext={() => {}} nextLabel="" nextDisabled />
            </>
          ) : (
            <div className="text-center py-16">
              <Rocket size={44} className="text-[#FF5A1F] mx-auto mb-4" />
              <h2 className="text-2xl font-bold font-[Clash_Display,sans-serif] mb-2">Sent to your client!</h2>
              <p className="text-sm text-muted-foreground mb-6">They'll be notified to review and accept the retainer proposal.</p>
              <button
                type="button"
                onClick={() => navigate("/your-work")}
                className="px-6 py-2.5 rounded-full text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
              >
                Go to Your Work
              </button>
            </div>
          )}
        </div>
      )}

      {lastSaved && (
        <div className="fixed bottom-4 right-4 text-[11px] text-muted-foreground bg-card border border-border rounded-full px-3 py-1.5 shadow-sm">
          Draft saved {lastSaved}
        </div>
      )}
    </div>
  );
}

// ─── Agreement summary (shared between review, preview, launch) ────────────

function AgreementSummary({
  draft, template, model, nextInvoiceDate, readOnly, compact,
}: {
  draft: DraftState;
  template?: { label: string };
  model?: { label: string };
  nextInvoiceDate: string;
  readOnly?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Client</p>
        <p className="text-sm font-semibold">{draft.clientName || "To be confirmed"}</p>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Retainer type & model</p>
        <p className="text-sm">{template?.label ?? "—"} · {model?.label ?? "—"}</p>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Goal</p>
        <p className="text-sm">{draft.goal || "—"}</p>
      </div>

      {!compact && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Deliverables</p>
          <div className="space-y-1">
            {draft.deliverables.length === 0 && <p className="text-sm text-muted-foreground">No deliverables added.</p>}
            {draft.deliverables.map(d => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <span>{d.name || "Untitled"}</span>
                <span className="text-muted-foreground">{d.quantity} {d.frequency.replace("per_", "/ ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Workflow</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {draft.workflowStages.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <span className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800">{s.name}</span>
              {i < draft.workflowStages.length - 1 && <ChevronRight size={11} className="text-muted-foreground" />}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Price</p>
          <p className="text-sm font-semibold">{fmtGBP(draft.amountPerCyclePence)} / {draft.billingFrequency}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Minimum term</p>
          <p className="text-sm font-semibold">{draft.minimumTermCycles} cycles</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Notice period</p>
          <p className="text-sm font-semibold">{draft.noticePeriodCycles} month{draft.noticePeriodCycles !== 1 ? "s" : ""}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Revision limit</p>
          <p className="text-sm font-semibold">{draft.maxRevisions}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Next invoice</p>
          <p className="text-sm font-semibold">{nextInvoiceDate}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5">Billing frequency</p>
          <p className="text-sm font-semibold capitalize">{draft.billingFrequency}</p>
        </div>
      </div>

      {readOnly && (
        <p className="text-[11px] text-muted-foreground italic">This is a read-only preview of what your client will see.</p>
      )}
    </div>
  );
}
