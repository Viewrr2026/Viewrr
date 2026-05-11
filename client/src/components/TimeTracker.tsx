import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Clock, Play, Pause, Square, Plus, Trash2,
  ChevronDown, ChevronUp, Timer, Pencil, Check, X,
} from "lucide-react";
import type { TimeEntry } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtStopwatch(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  projectId: number;
  userId: number;
  agencyId?: number | null;
  isFreelancer: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline edit row
// ─────────────────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  userId,
  onDelete,
  onUpdated,
}: {
  entry: TimeEntry;
  userId: number;
  onDelete: (id: number) => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(entry.description);
  const [mins, setMins] = useState(String(entry.minutes));
  const [billable, setBillable] = useState(entry.billable);
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/time-entries/${entry.id}`, {
        userId,
        description: desc,
        minutes: Number(mins),
        billable,
      });
      return res.json();
    },
    onSuccess: () => {
      setEditing(false);
      onUpdated();
    },
    onError: () => toast({ title: "Couldn't save", variant: "destructive" }),
  });

  if (editing) {
    return (
      <div
        className="flex flex-col gap-2 p-3 rounded-lg bg-muted/40 border border-border"
        data-testid={`time-entry-edit-${entry.id}`}
      >
        <Input
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="What did you work on?"
          className="text-sm h-8"
          data-testid="input-edit-description"
        />
        <div className="flex items-center gap-2">
          <div className="relative flex-shrink-0">
            <Input
              type="number"
              min={1}
              value={mins}
              onChange={e => setMins(e.target.value)}
              className="text-sm h-8 w-24 pr-8"
              data-testid="input-edit-minutes"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              min
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBillable(v => !v)}
            className={`text-xs px-2 py-1 rounded-full font-medium border transition-colors ${
              billable
                ? "bg-[#FF5A1F]/10 text-[#FF5A1F] border-[#FF5A1F]/20"
                : "bg-muted text-muted-foreground border-border"
            }`}
            data-testid="toggle-edit-billable"
          >
            {billable ? "Billable" : "Non-billable"}
          </button>
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(false)}
              data-testid="button-cancel-edit"
            >
              <X size={14} />
            </Button>
            <Button
              size="sm"
              className="h-7 px-3 bg-[#FF5A1F] hover:bg-[#e04d16] text-white text-xs"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !mins || Number(mins) < 1}
              data-testid="button-save-edit"
            >
              <Check size={12} className="mr-1" />
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 py-2.5 group"
      data-testid={`time-entry-row-${entry.id}`}
    >
      {/* Date badge */}
      <div className="flex-shrink-0 w-20 pt-0.5">
        <span className="text-xs text-muted-foreground">{formatDate(entry.loggedAt)}</span>
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug truncate">
          {entry.description || <span className="text-muted-foreground italic">No description</span>}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium text-[#FF5A1F]">{fmtDuration(entry.minutes)}</span>
          {entry.billable ? (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-[#FF5A1F]/10 text-[#FF5A1F] font-medium">
              Billable
            </span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              Non-billable
            </span>
          )}
        </div>
      </div>

      {/* Actions — reveal on hover */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(true)}
          data-testid={`button-edit-entry-${entry.id}`}
        >
          <Pencil size={12} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(entry.id)}
          data-testid={`button-delete-entry-${entry.id}`}
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main TimeTracker component
// ─────────────────────────────────────────────────────────────────────────────

export default function TimeTracker({ projectId, userId, agencyId, isFreelancer }: Props) {
  const { toast } = useToast();

  // Collapsible panel state
  const [open, setOpen] = useState(false);

  // Tab: "timer" or "manual"
  const [tab, setTab] = useState<"timer" | "manual">("timer");

  // ── Stopwatch state ────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [timerDesc, setTimerDesc] = useState("");
  const [timerBillable, setTimerBillable] = useState(true);

  // ── Manual entry state ────────────────────────────────────────────────────
  const [manualHours, setManualHours] = useState("");
  const [manualMins, setManualMins] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualBillable, setManualBillable] = useState(true);
  const [manualDate, setManualDate] = useState(todayISO());

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: entries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/projects", projectId, "time-entries"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/time-entries`);
      return res.json();
    },
    enabled: open,
  });

  const logMutation = useMutation({
    mutationFn: async (payload: {
      minutes: number;
      description: string;
      billable: boolean;
      loggedAt: string;
    }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/time-entries`, {
        userId,
        agencyId: agencyId ?? null,
        ...payload,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "time-entries"] });
      // Also invalidate agency time entries so reports update
      if (agencyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/agencies", agencyId, "time-entries"] });
      }
    },
    onError: () => toast({ title: "Couldn't log time", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/time-entries/${id}`, { userId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "time-entries"] });
      if (agencyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/agencies", agencyId, "time-entries"] });
      }
    },
    onError: () => toast({ title: "Couldn't delete entry", variant: "destructive" }),
  });

  // ── Stopwatch tick ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (running) {
      startTimeRef.current = Date.now() - elapsed * 1000;
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current!) / 1000));
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const handleStart = () => setRunning(true);
  const handlePause = () => setRunning(false);

  const handleStop = useCallback(async () => {
    setRunning(false);
    const totalMinutes = Math.max(1, Math.round(elapsed / 60));
    if (totalMinutes < 1) {
      toast({ title: "Timer too short", description: "Log at least 1 minute." });
      setElapsed(0);
      return;
    }
    await logMutation.mutateAsync({
      minutes: totalMinutes,
      description: timerDesc.trim(),
      billable: timerBillable,
      loggedAt: todayISO(),
    });
    setElapsed(0);
    setTimerDesc("");
    toast({ title: `${fmtDuration(totalMinutes)} logged`, description: timerDesc || "Time entry saved." });
  }, [elapsed, timerDesc, timerBillable, logMutation]);

  const handleManualLog = useCallback(async () => {
    const h = Number(manualHours) || 0;
    const m = Number(manualMins) || 0;
    const totalMinutes = h * 60 + m;
    if (totalMinutes < 1) {
      toast({ title: "Enter a duration", description: "At least 1 minute required.", variant: "destructive" });
      return;
    }
    await logMutation.mutateAsync({
      minutes: totalMinutes,
      description: manualDesc.trim(),
      billable: manualBillable,
      loggedAt: manualDate || todayISO(),
    });
    setManualHours("");
    setManualMins("");
    setManualDesc("");
    setManualDate(todayISO());
    toast({ title: `${fmtDuration(totalMinutes)} logged`, description: manualDesc || "Time entry saved." });
  }, [manualHours, manualMins, manualDesc, manualBillable, manualDate, logMutation]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const billableMinutes = entries.filter(e => e.billable).reduce((sum, e) => sum + e.minutes, 0);
  const totalEntries = entries.length;

  // Only show for freelancers (they do the work)
  if (!isFreelancer) return null;

  return (
    <div className="border-t border-border" data-testid="time-tracker-section">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full text-left group py-4"
        data-testid="button-toggle-time-tracker"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-1.5">
            <Timer size={11} />
            Time Tracking
          </p>
          {totalMinutes > 0 && !open && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#FF5A1F]/10 text-[#FF5A1F] font-semibold">
              {fmtDuration(totalMinutes)}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp size={14} className="text-muted-foreground" />
          : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>

      {open && (
        <div className="pb-4 space-y-4" data-testid="time-tracker-panel">

          {/* Summary bar */}
          {totalEntries > 0 && (
            <div className="grid grid-cols-3 gap-3" data-testid="time-tracker-summary">
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-[#FF5A1F]">{fmtDuration(totalMinutes)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground">{fmtDuration(billableMinutes)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Billable</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-foreground">{totalEntries}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Entries</p>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-muted/50 rounded-lg" data-testid="time-tracker-tabs">
            <button
              type="button"
              onClick={() => setTab("timer")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === "timer"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-timer"
            >
              <Play size={11} />
              Stopwatch
            </button>
            <button
              type="button"
              onClick={() => setTab("manual")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === "manual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-manual"
            >
              <Plus size={11} />
              Manual
            </button>
          </div>

          {/* ── Stopwatch tab ──────────────────────────────────────────────── */}
          {tab === "timer" && (
            <div className="space-y-3" data-testid="stopwatch-panel">
              {/* Big clock */}
              <div className="flex flex-col items-center py-6 rounded-xl bg-muted/30 border border-border/60 gap-4">
                <div
                  className={`font-mono text-4xl font-bold tracking-wider tabular-nums transition-colors ${
                    running ? "text-[#FF5A1F]" : "text-foreground"
                  }`}
                  data-testid="stopwatch-display"
                >
                  {fmtStopwatch(elapsed)}
                </div>
                {/* Controls */}
                <div className="flex items-center gap-3">
                  {!running && elapsed === 0 && (
                    <Button
                      onClick={handleStart}
                      className="bg-[#FF5A1F] hover:bg-[#e04d16] text-white h-10 px-6 gap-2 rounded-full"
                      data-testid="button-start-timer"
                    >
                      <Play size={14} className="fill-white" />
                      Start
                    </Button>
                  )}
                  {running && (
                    <Button
                      onClick={handlePause}
                      variant="outline"
                      className="h-10 px-6 gap-2 rounded-full border-[#FF5A1F]/30 text-[#FF5A1F] hover:bg-[#FF5A1F]/5"
                      data-testid="button-pause-timer"
                    >
                      <Pause size={14} />
                      Pause
                    </Button>
                  )}
                  {!running && elapsed > 0 && (
                    <Button
                      onClick={handleStart}
                      variant="outline"
                      className="h-10 px-5 gap-2 rounded-full"
                      data-testid="button-resume-timer"
                    >
                      <Play size={14} />
                      Resume
                    </Button>
                  )}
                  {elapsed > 0 && (
                    <Button
                      onClick={handleStop}
                      disabled={logMutation.isPending}
                      className="h-10 px-5 gap-2 rounded-full bg-foreground text-background hover:bg-foreground/80"
                      data-testid="button-stop-log-timer"
                    >
                      <Square size={12} className="fill-background" />
                      Log {fmtDuration(Math.max(1, Math.round(elapsed / 60)))}
                    </Button>
                  )}
                  {!running && elapsed > 0 && (
                    <Button
                      variant="ghost"
                      className="h-10 w-10 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setElapsed(0)}
                      data-testid="button-reset-timer"
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Description + billable for timer */}
              {(running || elapsed > 0) && (
                <div className="flex flex-col gap-2 animate-in slide-in-from-top-2 duration-200">
                  <Input
                    value={timerDesc}
                    onChange={e => setTimerDesc(e.target.value)}
                    placeholder="What are you working on?"
                    className="text-sm"
                    data-testid="input-timer-description"
                  />
                  <button
                    type="button"
                    onClick={() => setTimerBillable(v => !v)}
                    className={`self-start text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                      timerBillable
                        ? "bg-[#FF5A1F]/10 text-[#FF5A1F] border-[#FF5A1F]/20 hover:bg-[#FF5A1F]/15"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                    }`}
                    data-testid="toggle-timer-billable"
                  >
                    {timerBillable ? "✓ Billable" : "Non-billable"}
                  </button>
                </div>
              )}

              {/* Empty hint */}
              {!running && elapsed === 0 && (
                <p className="text-xs text-muted-foreground text-center py-1">
                  Hit Start to begin tracking time on this project.
                </p>
              )}
            </div>
          )}

          {/* ── Manual entry tab ───────────────────────────────────────────── */}
          {tab === "manual" && (
            <div className="space-y-3" data-testid="manual-entry-panel">
              <Input
                value={manualDesc}
                onChange={e => setManualDesc(e.target.value)}
                placeholder="What did you work on?"
                className="text-sm"
                data-testid="input-manual-description"
              />

              {/* Duration row */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={manualHours}
                    onChange={e => setManualHours(e.target.value)}
                    className="text-sm pr-10"
                    data-testid="input-manual-hours"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                    hrs
                  </span>
                </div>
                <div className="relative flex-1">
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    placeholder="0"
                    value={manualMins}
                    onChange={e => setManualMins(e.target.value)}
                    className="text-sm pr-10"
                    data-testid="input-manual-mins"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                    min
                  </span>
                </div>
                <Input
                  type="date"
                  value={manualDate}
                  onChange={e => setManualDate(e.target.value)}
                  className="text-sm flex-1"
                  data-testid="input-manual-date"
                />
              </div>

              {/* Billable toggle + log button */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setManualBillable(v => !v)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                    manualBillable
                      ? "bg-[#FF5A1F]/10 text-[#FF5A1F] border-[#FF5A1F]/20 hover:bg-[#FF5A1F]/15"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                  }`}
                  data-testid="toggle-manual-billable"
                >
                  {manualBillable ? "✓ Billable" : "Non-billable"}
                </button>
                <Button
                  className="ml-auto bg-[#FF5A1F] hover:bg-[#e04d16] text-white h-9 px-5 text-sm gap-2"
                  onClick={handleManualLog}
                  disabled={logMutation.isPending || (Number(manualHours) + Number(manualMins) === 0)}
                  data-testid="button-log-manual"
                >
                  {logMutation.isPending ? (
                    <span className="animate-spin h-3 w-3 border-2 border-white/40 border-t-white rounded-full" />
                  ) : (
                    <Plus size={14} />
                  )}
                  Log Time
                </Button>
              </div>
            </div>
          )}

          {/* ── Entry log ──────────────────────────────────────────────────── */}
          {isLoading && (
            <div className="space-y-2 pt-2" data-testid="time-entries-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 rounded-lg bg-muted/50 animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && entries.length > 0 && (
            <div data-testid="time-entries-list">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest mb-2">
                Log
              </p>
              <div className="divide-y divide-border/50">
                {entries.map(entry => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    userId={userId}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onUpdated={() =>
                      queryClient.invalidateQueries({
                        queryKey: ["/api/projects", projectId, "time-entries"],
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {!isLoading && entries.length === 0 && (
            <div
              className="text-center py-8 text-muted-foreground"
              data-testid="time-entries-empty"
            >
              <Clock size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No time logged yet.</p>
              <p className="text-xs mt-1">Use the stopwatch or add an entry manually.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
