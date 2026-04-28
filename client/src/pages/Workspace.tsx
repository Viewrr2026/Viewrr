import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Trash2, Check, Circle, Clock, Flag, Tag,
  ChevronLeft, ChevronRight, CalendarDays, ListTodo,
  GripVertical, Pencil, X, AlertCircle,
} from "lucide-react";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────
type Status   = "todo" | "in_progress" | "done";
type Priority = "low" | "medium" | "high";

interface Task {
  id: number;
  userId: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  tags: string; // JSON string[]
  createdAt: string;
}

interface CalendarEvent {
  id: number;
  userId: number;
  title: string;
  description: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; icon: React.ReactNode }> = {
  low:    { label: "Low",    color: "text-blue-500",  icon: <Flag size={11} /> },
  medium: { label: "Medium", color: "text-amber-500", icon: <Flag size={11} /> },
  high:   { label: "High",   color: "text-red-500",   icon: <Flag size={11} /> },
};

const STATUS_COLS: { id: Status; label: string; color: string }[] = [
  { id: "todo",        label: "To Do",       color: "bg-border/60" },
  { id: "in_progress", label: "In Progress", color: "bg-primary/20" },
  { id: "done",        label: "Done",        color: "bg-green-500/20" },
];

const EVENT_COLORS = ["#FF5A1F", "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function parseTags(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

// ── TaskCard ──────────────────────────────────────────────────────────────────
function TaskCard({ task, onEdit, onDelete, onStatusChange }: {
  task: Task;
  onEdit: (t: Task) => void;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, s: Status) => void;
}) {
  const tags = parseTags(task.tags);
  const pri  = PRIORITY_CONFIG[task.priority];
  const overdue = isOverdue(task.dueDate) && task.status !== "done";

  return (
    <div className="bg-card border border-border rounded-xl p-3.5 group hover:border-primary/30 transition-all duration-150 shadow-sm">
      <div className="flex items-start gap-2">
        {/* Status toggle circle */}
        <button
          onClick={() => {
            const next: Status = task.status === "todo" ? "in_progress" : task.status === "in_progress" ? "done" : "todo";
            onStatusChange(task.id, next);
          }}
          className="mt-0.5 flex-shrink-0"
          title="Cycle status"
        >
          {task.status === "done"
            ? <Check size={16} className="text-green-500" />
            : task.status === "in_progress"
            ? <Clock size={16} className="text-primary" />
            : <Circle size={16} className="text-muted-foreground/50" />}
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
          )}

          {/* Tags + priority + due */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className={`flex items-center gap-0.5 text-xs font-medium ${pri.color}`}>
              {pri.icon}{pri.label}
            </span>
            {task.dueDate && (
              <span className={`text-xs flex items-center gap-0.5 ${overdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                <CalendarDays size={10} />{formatDate(task.dueDate)}{overdue && " · Overdue"}
              </span>
            )}
            {tags.map(tag => (
              <span key={tag} className="text-[10px] bg-secondary px-1.5 py-0.5 rounded-full text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={() => onEdit(task)} className="p-1 hover:text-primary transition-colors">
            <Pencil size={12} />
          </button>
          <button onClick={() => onDelete(task.id)} className="p-1 hover:text-red-500 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TaskModal ─────────────────────────────────────────────────────────────────
function TaskModal({ open, task, userId, onClose }: {
  open: boolean;
  task: Task | null;
  userId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(task?.title ?? "");
  const [desc, setDesc]   = useState(task?.description ?? "");
  const [status, setStatus] = useState<Status>(task?.status ?? "todo");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [tagInput, setTagInput] = useState((task ? parseTags(task.tags) : []).join(", "));

  // Reset when task changes
  useMemo(() => {
    setTitle(task?.title ?? "");
    setDesc(task?.description ?? "");
    setStatus(task?.status ?? "todo");
    setPriority(task?.priority ?? "medium");
    setDueDate(task?.dueDate ?? "");
    setTagInput((task ? parseTags(task.tags) : []).join(", "));
  }, [task]);

  const save = async () => {
    if (!title.trim()) return;
    const tags = tagInput.split(",").map(t => t.trim()).filter(Boolean);
    const body = {
      userId,
      title: title.trim(),
      description: desc.trim(),
      status,
      priority,
      dueDate: dueDate || null,
      tags: JSON.stringify(tags),
    };
    const url  = task ? `/api/workspace/tasks/${task.id}` : "/api/workspace/tasks";
    const method = task ? "PATCH" : "POST";
    const payload = task ? { userId, ...body } : body;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { toast({ title: "Error", description: "Could not save task", variant: "destructive" }); return; }
    await queryClient.invalidateQueries({ queryKey: ["/api/workspace/tasks", userId] });
    toast({ title: task ? "Task updated" : "Task created" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <Input placeholder="Task title *" value={title} onChange={e => setTitle(e.target.value)} />
          <textarea
            placeholder="Description (optional)"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            className="w-full text-sm bg-secondary/50 border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as Status)}
                className="w-full text-sm bg-secondary/50 border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value as Priority)}
                className="w-full text-sm bg-secondary/50 border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Due date</label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tags (comma-separated)</label>
            <Input placeholder="e.g. client work, urgent" value={tagInput} onChange={e => setTagInput(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1 bg-primary hover:bg-primary/90 text-white" onClick={save}>
              {task ? "Save changes" : "Create task"}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── EventModal ────────────────────────────────────────────────────────────────
function EventModal({ open, event, userId, prefillDate, onClose }: {
  open: boolean;
  event: CalendarEvent | null;
  userId: number;
  prefillDate: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle]         = useState(event?.title ?? "");
  const [desc, setDesc]           = useState(event?.description ?? "");
  const [date, setDate]           = useState(event?.date ?? prefillDate);
  const [startTime, setStartTime] = useState(event?.startTime ?? "");
  const [endTime, setEndTime]     = useState(event?.endTime ?? "");
  const [color, setColor]         = useState(event?.color ?? "#FF5A1F");

  useMemo(() => {
    setTitle(event?.title ?? "");
    setDesc(event?.description ?? "");
    setDate(event?.date ?? prefillDate);
    setStartTime(event?.startTime ?? "");
    setEndTime(event?.endTime ?? "");
    setColor(event?.color ?? "#FF5A1F");
  }, [event, prefillDate]);

  const save = async () => {
    if (!title.trim() || !date) return;
    const body = { userId, title: title.trim(), description: desc.trim(), date, startTime: startTime || null, endTime: endTime || null, color };
    const url    = event ? `/api/workspace/events/${event.id}` : "/api/workspace/events";
    const method = event ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event ? { userId, ...body } : body),
    });
    if (!res.ok) { toast({ title: "Error saving event", variant: "destructive" }); return; }
    await queryClient.invalidateQueries({ queryKey: ["/api/workspace/events", userId] });
    toast({ title: event ? "Event updated" : "Event added" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <Input placeholder="Event title *" value={title} onChange={e => setTitle(e.target.value)} />
          <textarea
            placeholder="Description (optional)"
            value={desc} onChange={e => setDesc(e.target.value)}
            rows={2}
            className="w-full text-sm bg-secondary/50 border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Date</label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Start time</label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">End time</label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Colour</label>
            <div className="flex gap-2">
              {EVENT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? "scale-125 ring-2 ring-offset-1 ring-offset-background ring-white" : "hover:scale-110"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1 bg-primary hover:bg-primary/90 text-white" onClick={save}>
              {event ? "Save changes" : "Add event"}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function Calendar({ userId, events, onDayClick, onEventClick }: {
  userId: number;
  events: CalendarEvent[];
  onDayClick: (date: string) => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  const today = new Date().toISOString().slice(0, 10);

  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const firstDow    = new Date(cursor.year, cursor.month, 1).getDay(); // 0=Sun
  const startOffset = (firstDow + 6) % 7; // Monday-based

  const monthStr = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
  const monthLabel = new Date(cursor.year, cursor.month).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of events) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }, [events]);

  const prev = () => setCursor(c => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 });
  const next = () => setCursor(c => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 });

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="font-semibold text-base">{monthLabel}</h3>
        <div className="flex gap-1">
          <button onClick={prev} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setCursor({ year: new Date().getFullYear(), month: new Date().getMonth() })}
            className="px-2.5 py-1 text-xs rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          >
            Today
          </button>
          <button onClick={next} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {DOW.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const dateStr = day ? `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
          const dayEvents = day ? (eventsByDate[dateStr] ?? []) : [];
          const isToday = dateStr === today;

          return (
            <div
              key={i}
              onClick={() => day && onDayClick(dateStr)}
              className={`min-h-[72px] p-1.5 border-b border-r border-border/40 last:border-r-0 transition-colors
                ${day ? "cursor-pointer hover:bg-secondary/40" : "bg-secondary/10"}
                ${(i + 1) % 7 === 0 ? "border-r-0" : ""}
              `}
            >
              {day && (
                <>
                  <div className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1
                    ${isToday ? "bg-primary text-white" : "text-foreground"}`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 2).map(ev => (
                      <div
                        key={ev.id}
                        onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                        className="text-[10px] font-medium truncate px-1 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: ev.color + "33", color: ev.color, borderLeft: `2px solid ${ev.color}` }}
                      >
                        {ev.startTime && <span className="opacity-70 mr-0.5">{ev.startTime}</span>}
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-[10px] text-muted-foreground pl-1">+{dayEvents.length - 2} more</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Workspace Page ───────────────────────────────────────────────────────
export default function Workspace() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<"board" | "calendar">("board");

  // Task modal
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask]     = useState<Task | null>(null);

  // Event modal
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent]     = useState<CalendarEvent | null>(null);
  const [prefillDate, setPrefillDate]       = useState("");

  // Calendar month (for fetch)
  const [calMonth, setCalMonth] = useState(() => new Date().toISOString().slice(0, 7));

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Please sign in to use your workspace.</p>
          <Button asChild className="bg-primary text-white"><Link href="/">Go home</Link></Button>
        </div>
      </div>
    );
  }

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/workspace/tasks", user.id],
    queryFn: async () => {
      const res = await fetch(`/api/workspace/tasks/${user.id}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/workspace/events", user.id, calMonth],
    queryFn: async () => {
      const res = await fetch(`/api/workspace/events/${user.id}?month=${calMonth}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const deleteTask = async (id: number) => {
    await fetch(`/api/workspace/tasks/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/workspace/tasks", user.id] });
    toast({ title: "Task deleted" });
  };

  const moveTask = async (id: number, status: Status) => {
    await fetch(`/api/workspace/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, status }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/workspace/tasks", user.id] });
  };

  const deleteEvent = async (ev: CalendarEvent) => {
    await fetch(`/api/workspace/events/${ev.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/workspace/events", user.id] });
    toast({ title: "Event deleted" });
    setEditingEvent(null);
    setEventModalOpen(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { todo: [], in_progress: [], done: [] };
    for (const t of tasks) { if (map[t.status]) map[t.status].push(t); }
    return map;
  }, [tasks]);

  const overdueCount = tasks.filter(t => isOverdue(t.dueDate) && t.status !== "done").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Workspace</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
              {overdueCount > 0 && (
                <span className="ml-2 text-red-500 font-semibold flex-inline items-center gap-1">
                  · {overdueCount} overdue
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-secondary rounded-lg p-1 gap-0.5">
              <button
                onClick={() => setView("board")}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors
                  ${view === "board" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ListTodo size={13} /> Board
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors
                  ${view === "calendar" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <CalendarDays size={13} /> Calendar
              </button>
            </div>

            <Button
              className="bg-primary hover:bg-primary/90 text-white gap-1.5 text-sm"
              onClick={() => {
                if (view === "board") { setEditingTask(null); setTaskModalOpen(true); }
                else { setPrefillDate(new Date().toISOString().slice(0, 10)); setEditingEvent(null); setEventModalOpen(true); }
              }}
            >
              <Plus size={15} />
              {view === "board" ? "New task" : "New event"}
            </Button>
          </div>
        </div>

        {/* ── Board view ──────────────────────────────────────────────────── */}
        {view === "board" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {STATUS_COLS.map(col => {
              const colTasks = byStatus[col.id];
              return (
                <div key={col.id} className="flex flex-col gap-3">
                  {/* Column header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${col.id === "todo" ? "bg-muted-foreground" : col.id === "in_progress" ? "bg-primary" : "bg-green-500"}`} />
                      <span className="text-sm font-semibold">{col.label}</span>
                      <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
                        {colTasks.length}
                      </span>
                    </div>
                    <button
                      onClick={() => { setEditingTask(null); setTaskModalOpen(true); }}
                      className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-primary"
                      title="Add task"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {/* Cards */}
                  <div className="space-y-2 min-h-[100px]">
                    {colTasks.length === 0 && (
                      <div className="border-2 border-dashed border-border/50 rounded-xl p-4 text-center text-xs text-muted-foreground">
                        No tasks here
                      </div>
                    )}
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onEdit={t => { setEditingTask(t); setTaskModalOpen(true); }}
                        onDelete={deleteTask}
                        onStatusChange={moveTask}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Calendar view ────────────────────────────────────────────────── */}
        {view === "calendar" && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr,280px] gap-6">
            <Calendar
              userId={user.id}
              events={events}
              onDayClick={date => {
                setPrefillDate(date);
                setEditingEvent(null);
                setEventModalOpen(true);
              }}
              onEventClick={ev => {
                setEditingEvent(ev);
                setEventModalOpen(true);
              }}
            />

            {/* Upcoming events sidebar */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">This month</h3>
                <span className="text-xs text-muted-foreground">{events.length} event{events.length !== 1 ? "s" : ""}</span>
              </div>
              {events.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                  <CalendarDays size={24} className="mx-auto mb-2 opacity-40" />
                  Click any day to add an event
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map(ev => (
                    <div
                      key={ev.id}
                      onClick={() => { setEditingEvent(ev); setEventModalOpen(true); }}
                      className="bg-card border border-border rounded-xl p-3 cursor-pointer hover:border-primary/30 transition-colors group"
                      style={{ borderLeft: `3px solid ${ev.color}` }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{ev.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(ev.date)}
                            {ev.startTime && ` · ${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ""}`}
                          </p>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); deleteEvent(ev); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-500 transition-all"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <TaskModal
        open={taskModalOpen}
        task={editingTask}
        userId={user.id}
        onClose={() => { setTaskModalOpen(false); setEditingTask(null); }}
      />
      <EventModal
        open={eventModalOpen}
        event={editingEvent}
        userId={user.id}
        prefillDate={prefillDate}
        onClose={() => { setEventModalOpen(false); setEditingEvent(null); }}
      />
    </div>
  );
}
