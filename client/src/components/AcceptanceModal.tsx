// AcceptanceModal — shown when a client accepts a freelancer's interest.
// Client can send a welcome message and optionally propose a meeting time
// before the acceptance is confirmed and the project goes live.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  CheckCircle2, Calendar, MessageSquare, ArrowRight,
  Zap, X, FolderOpen, Video,
} from "lucide-react";

interface AcceptanceModalProps {
  interest: any;           // the BriefInterest being accepted
  clientName: string;
  clientAvatar?: string;
  clientId: number;
  onClose: () => void;
  onAccepted: () => void;  // called after everything is confirmed
}

export default function AcceptanceModal({
  interest,
  clientName,
  clientAvatar,
  clientId,
  onClose,
  onAccepted,
}: AcceptanceModalProps) {
  const [welcomeMessage, setWelcomeMessage] = useState(
    `Hi ${interest.freelancerName?.split(" ")[0] ?? "there"}, excited to work together on "${interest.briefTitle}"! Looking forward to getting started.`
  );
  const [meetingOption, setMeetingOption] = useState<"none" | "instant" | "scheduled">("none");
  const [meetTitle, setMeetTitle] = useState("");
  const [meetDateTime, setMeetDateTime] = useState("");
  const [step, setStep] = useState<"compose" | "done">("compose");
  const [, navigate] = useLocation();

  // Min datetime: now + 15 min
  const minDateTime = new Date(Date.now() + 15 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  // 1) Accept the interest + create project (server-side)
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/interests/${interest.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "accepted",
          clientName,
          clientAvatar,
        }),
      });
      if (!res.ok) throw new Error("Accept failed");
      return res.json();
    },
  });

  // 2) Send welcome message into the interest thread
  const messageMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/interest-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interestId: interest.id,
          senderId: clientId,
          text,
        }),
      });
      if (!res.ok) throw new Error("Message failed");
      return res.json();
    },
  });

  // 3) Create the meeting card (after project exists)
  const meetingMutation = useMutation({
    mutationFn: async ({ projectId, isInstant, scheduledAt, title }: {
      projectId: number;
      isInstant: boolean;
      scheduledAt?: string;
      title?: string;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createdBy: clientId,
          isInstant,
          scheduledAt,
          title: title || (isInstant ? "Intro call" : "Kick-off meeting"),
        }),
      });
      if (!res.ok) throw new Error("Meeting creation failed");
      return res.json();
    },
  });

  const isPending = acceptMutation.isPending || messageMutation.isPending || meetingMutation.isPending;

  async function handleConfirm() {
    try {
      // Step 1: Accept + create project
      await acceptMutation.mutateAsync();

      // Step 2: Send welcome message
      if (welcomeMessage.trim()) {
        await messageMutation.mutateAsync(welcomeMessage.trim());
      }

      // Step 3: Fetch the newly created project to get its ID for meeting
      if (meetingOption !== "none") {
        let projectId: number | null = null;
        try {
          const res = await fetch(`/api/projects?userId=${clientId}`);
          if (res.ok) {
            const projects: any[] = await res.json();
            // Find the project matching this interest
            const found = projects.find(
              (pw: any) => (pw.project ?? pw).interestId === interest.id
            );
            projectId = found ? (found.project ?? found).id : null;
          }
        } catch {}

        if (projectId) {
          if (meetingOption === "instant") {
            const meeting = await meetingMutation.mutateAsync({
              projectId,
              isInstant: true,
              title: "Intro call",
            });
            // Open the meet link immediately for the client
            window.open(meeting.meetLink, "_blank", "noopener,noreferrer");
          } else if (meetingOption === "scheduled" && meetDateTime) {
            await meetingMutation.mutateAsync({
              projectId,
              isInstant: false,
              scheduledAt: new Date(meetDateTime).toISOString(),
              title: meetTitle.trim() || "Kick-off meeting",
            });
          }
        }
      }

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ["/api/projects", clientId] });
      queryClient.invalidateQueries({ queryKey: ["/api/briefs"] });

      setStep("done");
    } catch (e) {
      console.error("Acceptance flow error:", e);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-background border border-border rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10"
        >
          <X size={14} />
        </button>

        {step === "done" ? (
          /* ── Success screen ── */
          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={28} className="text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-lg font-bold mb-1">Project is live!</h2>
            <p className="text-sm text-muted-foreground mb-1">
              <span className="font-medium text-foreground">{interest.freelancerName}</span> has been notified and your message is on its way.
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              You can track everything under <span className="font-medium text-primary">Your Work</span>.
            </p>
            <div className="flex gap-3 justify-center">
              <Button
                className="bg-primary hover:bg-primary/90 text-white rounded-full px-5 gap-2"
                onClick={() => { onAccepted(); onClose(); navigate("/your-work"); }}
              >
                <FolderOpen size={14} /> Go to Your Work
              </Button>
              <Button variant="outline" className="rounded-full px-5" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          /* ── Compose screen ── */
          <>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 size={18} className="text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-base leading-tight">Accept &amp; kick off project</h2>
                  <p className="text-xs text-muted-foreground">{interest.briefTitle}</p>
                </div>
              </div>

              {/* Freelancer pill */}
              <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2.5">
                <Avatar className="w-7 h-7">
                  <AvatarImage src={interest.freelancerAvatar || undefined} />
                  <AvatarFallback className="bg-primary text-white text-[10px]">
                    {interest.freelancerName?.slice(0, 2).toUpperCase() ?? "??"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-xs font-semibold">{interest.freelancerName}</p>
                  <p className="text-[10px] text-muted-foreground">Freelancer</p>
                </div>
                <ArrowRight size={12} className="text-muted-foreground mx-1" />
                <div className="text-[10px] text-muted-foreground">
                  Project goes live · Brief removed from board
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">

              {/* Welcome message */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2 uppercase tracking-wide">
                  <MessageSquare size={11} /> Welcome message
                </label>
                <Textarea
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Say something to kick things off…"
                  className="resize-none text-sm min-h-[80px]"
                  maxLength={500}
                />
                <p className="text-[10px] text-muted-foreground mt-1 text-right">
                  {welcomeMessage.length}/500
                </p>
              </div>

              {/* Meeting proposal */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-3 uppercase tracking-wide">
                  <Video size={11} /> Propose a meeting <span className="font-normal normal-case">(optional)</span>
                </label>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {/* No meeting */}
                  <button
                    onClick={() => setMeetingOption("none")}
                    className={`rounded-xl border p-3 text-xs text-center transition-all ${
                      meetingOption === "none"
                        ? "border-primary/60 bg-primary/5 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    <MessageSquare size={14} className="mx-auto mb-1.5" />
                    Messages only
                  </button>
                  {/* Instant call */}
                  <button
                    onClick={() => setMeetingOption("instant")}
                    className={`rounded-xl border p-3 text-xs text-center transition-all ${
                      meetingOption === "instant"
                        ? "border-primary/60 bg-primary/5 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    <Zap size={14} className="mx-auto mb-1.5" />
                    Start call now
                  </button>
                  {/* Scheduled */}
                  <button
                    onClick={() => setMeetingOption("scheduled")}
                    className={`rounded-xl border p-3 text-xs text-center transition-all ${
                      meetingOption === "scheduled"
                        ? "border-primary/60 bg-primary/5 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    <Calendar size={14} className="mx-auto mb-1.5" />
                    Schedule one
                  </button>
                </div>

                {/* Scheduled form */}
                {meetingOption === "scheduled" && (
                  <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                    <Input
                      placeholder="Meeting title (optional)"
                      value={meetTitle}
                      onChange={(e) => setMeetTitle(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="datetime-local"
                      min={minDateTime}
                      value={meetDateTime}
                      onChange={(e) => setMeetDateTime(e.target.value)}
                      className="h-8 text-xs"
                    />
                    {meetDateTime && (
                      <p className="text-[10px] text-muted-foreground">
                        A Google Meet link will be created and sent to {interest.freelancerName?.split(" ")[0]}.
                      </p>
                    )}
                  </div>
                )}

                {meetingOption === "instant" && (
                  <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-xl border border-border px-3 py-2">
                    A Google Meet room will open immediately when you confirm. {interest.freelancerName?.split(" ")[0]} will find the link in the project.
                  </p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 pt-2 border-t border-border flex gap-3">
              <Button
                className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-full gap-2"
                onClick={handleConfirm}
                disabled={
                  isPending ||
                  (meetingOption === "scheduled" && !meetDateTime)
                }
              >
                {isPending ? (
                  "Confirming…"
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Confirm &amp; go live
                  </>
                )}
              </Button>
              <Button variant="outline" className="rounded-full px-5" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
