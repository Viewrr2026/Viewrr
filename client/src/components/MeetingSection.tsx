import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Video, Calendar, ExternalLink, X, Plus, Clock, Zap } from "lucide-react";

interface MeetingSectionProps {
  projectId: number;
  userId: number;
  otherName: string;
}

export default function MeetingSection({ projectId, userId, otherName }: MeetingSectionProps) {
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedTitle, setSchedTitle] = useState("");
  const [schedDateTime, setSchedDateTime] = useState("");

  // Fetch meetings for this project
  const { data: meetings = [] } = useQuery<any[]>({
    queryKey: ["/api/projects/meetings", projectId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/meetings`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    refetchInterval: 30000,
  });

  // Create meeting mutation
  const createMutation = useMutation({
    mutationFn: async (payload: {
      title?: string;
      scheduledAt?: string;
      isInstant: boolean;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, createdBy: userId }),
      });
      if (!res.ok) throw new Error("Failed to create meeting");
      return res.json();
    },
    onSuccess: (meeting) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/meetings", projectId] });
      setShowScheduleForm(false);
      setSchedTitle("");
      setSchedDateTime("");
      // Open the link immediately for instant calls
      if (meeting.isInstant) {
        window.open(meeting.meetLink, "_blank", "noopener,noreferrer");
      }
    },
  });

  // Cancel meeting mutation
  const cancelMutation = useMutation({
    mutationFn: async (meetingId: number) => {
      const res = await fetch(`/api/meetings/${meetingId}/cancel`, { method: "PATCH" });
      if (!res.ok) throw new Error("Failed to cancel");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/meetings", projectId] });
    },
  });

  const handleInstantCall = () => {
    createMutation.mutate({ isInstant: true, title: "Instant call" });
  };

  const handleSchedule = () => {
    if (!schedDateTime) return;
    createMutation.mutate({
      isInstant: false,
      title: schedTitle.trim() || `Call with ${otherName}`,
      scheduledAt: new Date(schedDateTime).toISOString(),
    });
  };

  // Active (non-cancelled) meetings
  const activeMeetings = meetings.filter((m: any) => m.status !== "cancelled");
  const upcoming = activeMeetings.filter(
    (m: any) => !m.isInstant && m.scheduledAt && new Date(m.scheduledAt) > new Date()
  );
  const past = activeMeetings.filter(
    (m: any) => m.isInstant || !m.scheduledAt || new Date(m.scheduledAt) <= new Date()
  );

  // Minimal datetime for scheduling (now + 5 min)
  const minDateTime = new Date(Date.now() + 5 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Video size={11} />
          Meetings
        </div>
        <div className="flex items-center gap-1.5">
          {/* Instant call */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 px-2.5"
            onClick={handleInstantCall}
            disabled={createMutation.isPending}
          >
            <Zap size={11} className="text-primary" />
            Start call now
          </Button>
          {/* Schedule */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 px-2.5"
            onClick={() => setShowScheduleForm((v) => !v)}
          >
            <Calendar size={11} />
            Schedule
          </Button>
        </div>
      </div>

      {/* Schedule form */}
      {showScheduleForm && (
        <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-xs font-medium">Schedule a meeting</p>
          <Input
            placeholder="Meeting title (optional)"
            value={schedTitle}
            onChange={(e) => setSchedTitle(e.target.value)}
            className="h-8 text-xs"
          />
          <Input
            type="datetime-local"
            min={minDateTime}
            value={schedDateTime}
            onChange={(e) => setSchedDateTime(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs bg-primary hover:bg-primary/90 text-white"
              onClick={handleSchedule}
              disabled={!schedDateTime || createMutation.isPending}
            >
              <Plus size={11} className="mr-1" />
              Create meeting
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowScheduleForm(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Upcoming meetings */}
      {upcoming.length > 0 && (
        <div className="space-y-2 mb-2">
          {upcoming.map((m: any) => {
            const dt = new Date(m.scheduledAt);
            const dateStr = dt.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            const timeStr = dt.toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar size={12} className="text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {dateStr} · {timeStr}
                    </p>
                  </div>
                  <Badge className="shrink-0 text-[10px] bg-primary/10 text-primary" variant="secondary">
                    Upcoming
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={m.meetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Join <ExternalLink size={10} />
                  </a>
                  <button
                    onClick={() => cancelMutation.mutate(m.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="Cancel meeting"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Past / instant meetings */}
      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
            {past.length === 1 ? "1 past call" : `${past.length} past calls`}
          </p>
          {past.slice(-3).map((m: any) => {
            const dt = m.scheduledAt ? new Date(m.scheduledAt) : new Date(m.createdAt);
            const dateStr = dt.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            });
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 bg-muted/50 border border-border"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {m.isInstant ? (
                    <Zap size={11} className="text-muted-foreground shrink-0" />
                  ) : (
                    <Clock size={11} className="text-muted-foreground shrink-0" />
                  )}
                  <p className="text-xs text-muted-foreground truncate">{m.title}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">{dateStr}</span>
                </div>
                <a
                  href={m.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-primary hover:underline shrink-0 flex items-center gap-0.5"
                >
                  Rejoin <ExternalLink size={9} />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {activeMeetings.length === 0 && !showScheduleForm && (
        <p className="text-xs text-muted-foreground">
          No meetings yet. Start an instant call or schedule one above.
        </p>
      )}
    </div>
  );
}
