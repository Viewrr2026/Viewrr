import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  X, Search, CheckCircle2, Send, User, FileText,
  Tag, Clock, DollarSign, Loader2, ChevronRight, Plus,
  Circle, AlertCircle, RefreshCw, Zap, Calendar,
} from "lucide-react";

// ── Category presets ──────────────────────────────────────────────────────────
const CATEGORY_PRESETS = [
  "Video Production", "Photography", "Motion Graphics", "Editing",
  "Animation", "Social Media", "Brand Identity", "Podcast",
  "Music / Audio", "Drone", "Event Coverage", "Documentary",
];

// ── Project stages ─────────────────────────────────────────────────────────────
const STAGES = [
  { index: 0, label: "Brief & Kick-off",  desc: "Scope agreed, brief shared" },
  { index: 1, label: "Pre-production",    desc: "Planning & schedule" },
  { index: 2, label: "Production",        desc: "Work in progress" },
  { index: 3, label: "First Delivery",    desc: "Initial draft for review" },
  { index: 4, label: "Revisions",         desc: "Feedback & refinements" },
  { index: 5, label: "Final Delivery",    desc: "Finals handed over" },
];

// ── Timeline options (one-off only) ──────────────────────────────────────────
const TIMELINES = [
  "Less than 1 week", "1–2 weeks", "2–4 weeks",
  "1–2 months", "2–3 months", "3+ months",
];

// ── Billing cycle options ─────────────────────────────────────────────────────
type BillingCycle = "weekly" | "fortnightly" | "monthly" | "per_deliverable";
const BILLING_OPTIONS: { value: BillingCycle; label: string; desc: string }[] = [
  { value: "weekly",          label: "Weekly",          desc: "Billed every week" },
  { value: "fortnightly",     label: "Fortnightly",     desc: "Billed every 2 weeks" },
  { value: "monthly",         label: "Monthly",         desc: "Billed once a month" },
  { value: "per_deliverable", label: "Per Deliverable", desc: "Billed on each completed item" },
];

interface Recipient {
  id: number;
  name: string;
  avatar?: string | null;
  role?: string;
  headline?: string | null;
}

interface Props {
  senderId: number;
  onClose: () => void;
  onSent?: () => void;
}

export default function CreateProjectModal({ senderId, onClose, onSent }: Props) {
  // ── Step: 0 = type selection, 1 = details, 2 = recipient, 3 = sent ──
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Form state ──
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories]   = useState<string[]>([]);
  const [customCatInput, setCustomCatInput] = useState("");
  const [budget, setBudget]           = useState("");
  const [timeline, setTimeline]       = useState("");
  const [startStage, setStartStage]   = useState(0);

  // ── Retainer state ──
  const [isRetainer, setIsRetainer]                   = useState(false);
  const [billingCycle, setBillingCycle]               = useState<BillingCycle>("monthly");
  const [deliverablesPerCycle, setDeliverablesPerCycle] = useState("");
  const [totalCycles, setTotalCycles]                 = useState("");
  const [retainerDueDate, setRetainerDueDate]         = useState("");
  const [showDatePicker, setShowDatePicker]           = useState(false);
  const datePickerRef                                 = useRef<HTMLDivElement>(null);

  // ── Recipient search ──
  const [searchQ, setSearchQ]         = useState("");
  const [recipient, setRecipient]     = useState<Recipient | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleCategory(cat: string) {
    setCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  }

  function addCustomCategory() {
    const val = customCatInput.trim();
    if (!val || categories.includes(val)) { setCustomCatInput(""); return; }
    setCategories(prev => [...prev, val]);
    setCustomCatInput("");
  }

  const { data: searchResults = [], isFetching: searching } = useQuery<Recipient[]>({
    queryKey: ["/api/users/search", searchQ, senderId],
    queryFn: async () => {
      if (searchQ.trim().length < 2) return [];
      const params = new URLSearchParams({ q: searchQ, excludeId: String(senderId) });
      try {
        const res = await apiRequest("GET", `/api/users/search?${params}`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: searchQ.trim().length >= 2,
    staleTime: 10000,
  });

  const sendMutation = useMutation({
    mutationFn: () => {
      setSendError(null);
      const payload: Record<string, unknown> = {
        senderId,
        recipientId: recipient!.id,
        title: title.trim(),
        startStage: isRetainer ? 0 : startStage,
        isRetainer: isRetainer ? 1 : 0,
      };
      // Only include optional fields when they have a value (never send null — use undefined/omit)
      if (description.trim()) payload.description = description.trim();
      if (categories.length > 0) payload.category = categories.join(", ");
      if (budget.trim()) payload.budget = budget.trim();
      if (isRetainer) {
        if (retainerDueDate) payload.timeline = retainerDueDate;
        payload.billingCycle = billingCycle;
        if (deliverablesPerCycle.trim()) payload.deliverablesPerCycle = deliverablesPerCycle.trim();
        if (totalCycles.trim()) payload.totalCycles = parseInt(totalCycles.trim(), 10);
      } else {
        if (timeline) payload.timeline = timeline;
      }
      return apiRequest("POST", "/api/invitations", payload).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      setStep(3);
      onSent?.();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to send invitation. Please try again.";
      setSendError(msg);
    },
  });

  const canGoToStep2 = title.trim().length >= 3;
  const canSend = canGoToStep2 && !!recipient;

  // ── Format date for display ──
  function formatDate(d: string) {
    if (!d) return "";
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  // ── Today string for min date ──
  const todayStr = new Date().toISOString().split("T")[0];

  // ── Step labels (steps 1 and 2 only shown in progress bar) ──
  const STEP_LABELS = ["Project Details", "Choose Recipient"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="create-project-modal"
    >
      <div className="relative bg-background border border-border rounded-3xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-bold text-lg leading-tight">Create Private Project</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step === 0
                ? "Choose your project type to get started"
                : "Send a private brief directly to a specific person"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
            data-testid="btn-close-create-project"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Step progress (steps 1 & 2 only) */}
        {step >= 1 && step < 3 && (
          <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              return (
                <div key={n} className="flex items-center gap-2 flex-1">
                  <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 transition-all ${
                    step === n
                      ? "bg-primary text-white"
                      : step > n
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {step > n ? <CheckCircle2 size={14} /> : n}
                  </div>
                  <span className={`text-xs font-medium ${step === n ? "text-foreground" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                  {i < STEP_LABELS.length - 1 && (
                    <ChevronRight size={12} className="text-muted-foreground flex-shrink-0 ml-auto mr-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 max-h-[calc(90vh-200px)]">

          {/* ── Step 0: Project Type Selection ── */}
          {step === 0 && (
            <div className="py-2 space-y-4">
              <p className="text-sm font-semibold text-foreground text-center">What type of project is this?</p>
              <div className="grid grid-cols-1 gap-3">
                {/* One-off */}
                <button
                  onClick={() => { setIsRetainer(false); setStep(1); }}
                  data-testid="btn-type-oneoff"
                  className="group flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-border bg-card hover:border-primary/40 hover:bg-primary/3 text-left transition-all"
                >
                  <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                    <Zap size={20} className="text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">One-off Project</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Fixed scope with a defined start and end. Best for single campaigns, shoots, or productions.</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                </button>

                {/* Retainer */}
                <button
                  onClick={() => { setIsRetainer(true); setStep(1); }}
                  data-testid="btn-type-retainer"
                  className="group flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-border bg-card hover:border-primary/40 hover:bg-primary/3 text-left transition-all relative overflow-hidden"
                >
                  {/* Orange accent line */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ background: "linear-gradient(180deg,#FF5A1F,#FF8C42)" }} />
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors" style={{ background: "#FF5A1F15" }}>
                    <RefreshCw size={20} style={{ color: "#FF5A1F" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">Retainer</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "#FF5A1F20", color: "#FF5A1F" }}>New</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Recurring cycles of work with flexible billing. Ideal for ongoing content, editing, or creative partnerships.</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 1: Project Details ── */}
          {step === 1 && (
            <>
              {/* Type reminder badge */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-secondary/30">
                {isRetainer
                  ? <><RefreshCw size={12} style={{ color: "#FF5A1F" }} /><span className="text-xs font-semibold" style={{ color: "#FF5A1F" }}>Retainer</span></>
                  : <><Zap size={12} className="text-muted-foreground" /><span className="text-xs font-semibold text-foreground">One-off Project</span></>
                }
                <button
                  onClick={() => setStep(0)}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Change
                </button>
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileText size={12} className="text-primary" />
                  Project Title <span className="text-primary">*</span>
                </label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Brand video for product launch"
                  className="rounded-xl text-sm"
                  data-testid="input-project-title"
                  maxLength={120}
                />
                <p className="text-[11px] text-muted-foreground text-right">{title.length}/120</p>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FileText size={12} className="text-primary" />
                  Description
                </label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe the project, goals, deliverables, and any requirements..."
                  className="rounded-xl text-sm resize-none min-h-[100px]"
                  data-testid="input-project-description"
                  maxLength={1000}
                />
                <p className="text-[11px] text-muted-foreground text-right">{description.length}/1000</p>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Tag size={12} className="text-primary" />
                  Category
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">(select all that apply)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_PRESETS.map(cat => (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      data-testid={`btn-category-${cat.replace(/\s+/g, "-").toLowerCase()}`}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        categories.includes(cat)
                          ? "bg-primary text-white border-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {categories.includes(cat) && <span className="mr-1">✓</span>}{cat}
                    </button>
                  ))}
                  {categories.filter(c => !CATEGORY_PRESETS.includes(c)).map(cat => (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border bg-primary text-white border-primary flex items-center gap-1"
                    >
                      ✓ {cat}<X size={10} className="ml-0.5 opacity-70" />
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={customCatInput}
                    onChange={e => setCustomCatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomCategory(); } }}
                    placeholder="Add your own category…"
                    className="rounded-xl text-xs h-8 flex-1"
                    maxLength={40}
                    data-testid="input-custom-category"
                  />
                  <button
                    onClick={addCustomCategory}
                    disabled={!customCatInput.trim()}
                    className="h-8 px-3 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-40 flex items-center gap-1"
                    data-testid="btn-add-custom-category"
                  >
                    <Plus size={11} /> Add
                  </button>
                </div>
              </div>

              {/* Budget + Timeline row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <DollarSign size={12} className="text-primary" />
                    Budget
                  </label>
                  <Input
                    value={budget}
                    onChange={e => setBudget(e.target.value)}
                    placeholder="e.g. £1,500"
                    className="rounded-xl text-sm"
                    data-testid="input-project-budget"
                  />
                </div>

                {/* Timeline — date picker for retainer, select for one-off */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Clock size={12} className="text-primary" />
                    {isRetainer ? "Due Date" : "Timeline"}
                  </label>
                  {isRetainer ? (
                    <div ref={datePickerRef} className="relative">
                      <button
                        onClick={() => setShowDatePicker(v => !v)}
                        data-testid="btn-retainer-due-date"
                        className={`w-full h-9 rounded-xl border text-sm text-left px-3 flex items-center gap-2 transition-colors ${
                          retainerDueDate
                            ? "border-primary/40 bg-primary/5 text-foreground"
                            : "border-input bg-background text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        <Calendar size={13} className={retainerDueDate ? "text-primary" : "text-muted-foreground"} />
                        {retainerDueDate ? formatDate(retainerDueDate) : "Pick a date…"}
                      </button>
                      {showDatePicker && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-xl shadow-lg z-20 p-3">
                          <input
                            type="date"
                            min={todayStr}
                            value={retainerDueDate}
                            onChange={e => { setRetainerDueDate(e.target.value); setShowDatePicker(false); }}
                            className="w-full text-sm text-foreground bg-transparent outline-none cursor-pointer"
                            data-testid="input-retainer-due-date"
                          />
                          {retainerDueDate && (
                            <button
                              onClick={() => { setRetainerDueDate(""); setShowDatePicker(false); }}
                              className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Clear date
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <select
                      value={timeline}
                      onChange={e => setTimeline(e.target.value)}
                      data-testid="select-project-timeline"
                      className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                    >
                      <option value="">Select...</option>
                      {TIMELINES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* ── Retainer-specific fields ── */}
              {isRetainer && (
                <>
                  {/* Billing cycle — 2×2 grid to fit 4 options */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <RefreshCw size={12} className="text-primary" />
                      Billing Cycle <span className="text-primary">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {BILLING_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setBillingCycle(opt.value)}
                          data-testid={`btn-billing-${opt.value}`}
                          className={`flex flex-col items-start px-3 py-2.5 rounded-xl border text-left transition-all ${
                            billingCycle === opt.value
                              ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                              : "border-border hover:border-primary/20 hover:bg-secondary/40"
                          }`}
                        >
                          <span className={`text-xs font-bold ${billingCycle === opt.value ? "text-primary" : "text-foreground"}`}>
                            {opt.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground leading-snug mt-0.5">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Deliverables per cycle */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <FileText size={12} className="text-primary" />
                      Deliverables per Cycle
                    </label>
                    <textarea
                      value={deliverablesPerCycle}
                      onChange={e => setDeliverablesPerCycle(e.target.value)}
                      placeholder="e.g. 4 edited reels, 2 long-form videos, social assets…"
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground resize-none min-h-[72px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors placeholder:text-muted-foreground"
                      data-testid="input-deliverables-per-cycle"
                      maxLength={400}
                    />
                    <p className="text-[11px] text-muted-foreground text-right">{deliverablesPerCycle.length}/400</p>
                  </div>

                  {/* Total cycles (optional) */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Circle size={12} className="text-primary" />
                      Total Cycles
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">(leave blank for open-ended)</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={totalCycles}
                      onChange={e => setTotalCycles(e.target.value)}
                      placeholder="e.g. 12"
                      className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors placeholder:text-muted-foreground"
                      data-testid="input-total-cycles"
                    />
                  </div>
                </>
              )}

              {/* ── Starting Stage picker — one-off only ── */}
              {!isRetainer && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Circle size={12} className="text-primary" />
                    Starting Stage
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">(where does this project begin?)</span>
                  </label>
                  <div className="space-y-1.5">
                    {STAGES.map(stage => (
                      <button
                        key={stage.index}
                        onClick={() => setStartStage(stage.index)}
                        data-testid={`btn-stage-${stage.index}`}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all ${
                          startStage === stage.index
                            ? "border-primary/50 bg-primary/5"
                            : "border-border hover:border-primary/20 hover:bg-secondary/40"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                          startStage === stage.index
                            ? "bg-primary text-white"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {startStage === stage.index ? <CheckCircle2 size={12} /> : stage.index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold ${startStage === stage.index ? "text-primary" : "text-foreground"}`}>
                            {stage.label}
                            {stage.index === 0 && (
                              <span className="ml-2 text-[10px] font-normal text-muted-foreground">(default)</span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{stage.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Step 2: Choose Recipient ── */}
          {step === 2 && (
            <>
              {recipient ? (
                <div className="flex items-center gap-3 p-4 rounded-2xl border-2 border-primary/40 bg-primary/5">
                  <Avatar className="w-10 h-10 flex-shrink-0">
                    <AvatarImage src={recipient.avatar || undefined} />
                    <AvatarFallback className="bg-primary text-white text-sm">
                      {recipient.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{recipient.name}</p>
                    {recipient.headline && (
                      <p className="text-xs text-muted-foreground truncate">{recipient.headline}</p>
                    )}
                    {recipient.role && (
                      <p className="text-xs text-primary capitalize">{recipient.role}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setRecipient(null)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Remove recipient"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <User size={12} className="text-primary" />
                    Search your connections <span className="text-primary">*</span>
                  </label>

                  <div ref={searchRef} className="relative">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchQ}
                        onChange={e => { setSearchQ(e.target.value); setShowDropdown(true); }}
                        onFocus={() => setShowDropdown(true)}
                        placeholder="Search by name or email…"
                        className="rounded-xl text-sm pl-9"
                        data-testid="input-recipient-search"
                      />
                      {searching && (
                        <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                      )}
                    </div>

                    {showDropdown && searchQ.trim().length >= 2 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-xl shadow-lg z-10 overflow-hidden">
                        {searchResults.length === 0 && !searching ? (
                          <div className="px-4 py-3 text-sm text-muted-foreground">
                            No connections found matching "{searchQ}"
                          </div>
                        ) : (
                          searchResults.map(u => (
                            <button
                              key={u.id}
                              onClick={() => { setRecipient(u); setSearchQ(""); setShowDropdown(false); }}
                              data-testid={`btn-recipient-${u.id}`}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/60 transition-colors text-left border-b border-border last:border-b-0"
                            >
                              <Avatar className="w-8 h-8 flex-shrink-0">
                                <AvatarImage src={u.avatar || undefined} />
                                <AvatarFallback className="bg-primary text-white text-xs">
                                  {u.name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{u.name}</p>
                                {u.headline && <p className="text-xs text-muted-foreground truncate">{u.headline}</p>}
                                {u.role && <p className="text-xs text-primary capitalize">{u.role}</p>}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Only your connections will appear. They'll receive a notification to accept or decline.
                  </p>
                </div>
              )}

              {/* Project summary recap */}
              <div className="rounded-2xl bg-secondary/40 border border-border p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Project Summary
                </p>
                <SummaryRow icon={<FileText size={12} />} label="Title" value={title} />
                {description && (
                  <SummaryRow icon={<FileText size={12} />} label="Brief" value={description.length > 80 ? description.slice(0, 80) + "…" : description} />
                )}
                {categories.length > 0 && (
                  <SummaryRow icon={<Tag size={12} />} label="Category" value={categories.join(", ")} />
                )}
                {budget && <SummaryRow icon={<DollarSign size={12} />} label="Budget" value={budget} />}
                {isRetainer ? (
                  <>
                    <SummaryRow icon={<RefreshCw size={12} />} label="Type" value="Retainer" />
                    <SummaryRow
                      icon={<RefreshCw size={12} />}
                      label="Billing"
                      value={BILLING_OPTIONS.find(o => o.value === billingCycle)?.label ?? billingCycle}
                    />
                    {retainerDueDate && (
                      <SummaryRow icon={<Calendar size={12} />} label="Due date" value={formatDate(retainerDueDate)} />
                    )}
                    {deliverablesPerCycle && (
                      <SummaryRow icon={<FileText size={12} />} label="Deliverables" value={deliverablesPerCycle.length > 60 ? deliverablesPerCycle.slice(0, 60) + "…" : deliverablesPerCycle} />
                    )}
                    <SummaryRow icon={<Circle size={12} />} label="Cycles" value={totalCycles.trim() ? `${totalCycles} cycles` : "Open-ended"} />
                  </>
                ) : (
                  <>
                    {timeline && <SummaryRow icon={<Clock size={12} />} label="Timeline" value={timeline} />}
                    <SummaryRow icon={<Circle size={12} />} label="Starts at" value={STAGES[startStage].label} />
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Step 3: Sent ── */}
          {step === 3 && (
            <div className="py-8 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: "linear-gradient(135deg, #FF5A1F22, #FFA50022)" }}
              >
                <Send size={28} style={{ color: "#FF5A1F" }} />
              </div>
              <h3 className="font-bold text-lg mb-2">Invitation Sent!</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
                <span className="font-semibold text-foreground">{recipient?.name}</span> has been notified
                and can accept or decline your project invitation.
              </p>
              <p className="text-xs text-muted-foreground mt-3">
                You'll be notified when they respond. Check your pending invitations in Your Work.
              </p>
              <Button
                onClick={onClose}
                className="mt-6 bg-primary hover:bg-primary/90 text-white rounded-full px-8"
                data-testid="btn-done"
              >
                Done
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {step >= 1 && step < 3 && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border flex-shrink-0">
            <button
              onClick={() => setStep(step === 1 ? 0 : 1)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              ← Back
            </button>

            {step === 1 && (
              <Button
                onClick={() => setStep(2)}
                disabled={!canGoToStep2}
                className="bg-primary hover:bg-primary/90 text-white rounded-full px-6 text-sm"
                data-testid="btn-next-step"
              >
                Next: Choose Recipient <ChevronRight size={14} className="ml-1" />
              </Button>
            )}

            {step === 2 && (
              <div className="flex flex-col items-end gap-2">
                {sendError && (
                  <p className="text-xs text-destructive text-right max-w-xs">
                    <AlertCircle size={11} className="inline mr-1" />
                    {sendError}
                  </p>
                )}
                <Button
                  onClick={() => sendMutation.mutate()}
                  disabled={!canSend || sendMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-white rounded-full px-6 text-sm"
                  data-testid="btn-send-invitation"
                >
                  {sendMutation.isPending ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" /> Sending…</>
                  ) : (
                    <><Send size={14} className="mr-2" /> Send Invitation</>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Summary row helper ────────────────────────────────────────────────────────
function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-primary mt-0.5 flex-shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground w-16 flex-shrink-0">{label}</span>
      <span className="text-xs text-foreground font-medium leading-snug">{value}</span>
    </div>
  );
}
