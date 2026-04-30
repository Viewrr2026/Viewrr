// InterestsPanel — full interest detail + message thread
// Imported and used directly in Dashboard.tsx

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  ArrowLeft, Send, CheckCircle2, XCircle, Clock, FileText,
  CalendarDays, Banknote, StickyNote, MessageSquare, ChevronRight,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import AcceptanceModal from "@/components/AcceptanceModal";

// ── helpers ──────────────────────────────────────────────────────────────────
const ukDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const ukTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
});
function formatUK(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMins < 1) return "Just now";
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  if (d >= todayStart) return `Today at ${ukTime.format(d)}`;
  const yStart = new Date(todayStart); yStart.setDate(yStart.getDate() - 1);
  if (d >= yStart) return `Yesterday at ${ukTime.format(d)}`;
  return ukDate.format(d);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    pending:  { label: "Pending",  icon: <Clock size={11} />,        cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    viewed:   { label: "Viewed",   icon: <CheckCircle2 size={11} />, cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
    accepted: { label: "Accepted", icon: <CheckCircle2 size={11} />, cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    declined: { label: "Declined", icon: <XCircle size={11} />,      cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${s.cls}`}>
      {s.icon}{s.label}
    </span>
  );
}

// ── MessageThread (scoped strictly to one interest) ─────────────────────────
function InterestMessageThread({
  userId, otherId, otherName, otherAvatar, interestId, briefTitle,
}: { userId: number; otherId: number; otherName: string; otherAvatar?: string; interestId: number; briefTitle: string }) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasScolledRef = useRef(false);

  const { data: messages = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/interest-messages", interestId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/interest-messages/${interestId}?userId=${userId}`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    refetchInterval: 5000,
  });

  // Scroll to bottom only on initial load — not on every poll refetch
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !hasScolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
      hasScolledRef.current = true;
    }
  }, [isLoading, messages.length]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch("/api/interest-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: userId, toId: otherId, content, interestId, briefTitle }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/interest-messages", interestId] });
      setText("");
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <Avatar className="w-7 h-7">
          <AvatarImage src={otherAvatar} />
          <AvatarFallback className="bg-primary text-white text-[10px]">
            {otherName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-semibold leading-none">{otherName}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Conversation</p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <p className="text-center text-xs text-muted-foreground py-6">Loading messages…</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare size={22} className="mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">No messages yet — say hello!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m: any, idx: number) => {
              const mine = m.fromId === userId;
              // Show date separator when day changes
              const prevDate = idx > 0 ? messages[idx - 1].createdAt?.slice(0, 10) : null;
              const thisDate = m.createdAt?.slice(0, 10);
              const showSep = thisDate && thisDate !== prevDate;
              return (
                <div key={m.id}>
                  {showSep && (
                    <div className="flex items-center gap-2 my-3">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted-foreground px-2">
                        {new Date(thisDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      mine
                        ? "bg-primary text-white rounded-tr-sm"
                        : "bg-secondary text-foreground rounded-tl-sm"
                    }`}>
                      {m.content}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                      {formatUK(m.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <form
        onSubmit={e => { e.preventDefault(); if (text.trim()) sendMutation.mutate(text); }}
        className="flex gap-2 p-3 border-t border-border"
      >
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-full text-sm"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || sendMutation.isPending}
          className="rounded-full bg-primary hover:bg-primary/90 text-white flex-shrink-0"
        >
          <Send size={14} />
        </Button>
      </form>
    </div>
  );
}

// ── InterestDetail — right panel ─────────────────────────────────────────────
function InterestDetail({
  interest,
  isFreelancer,
  userId,
  userName,
  userAvatar,
  onBack,
  onStatusChange,
}: {
  interest: any;
  isFreelancer: boolean;
  userId: number;
  userName: string;
  userAvatar?: string;
  onBack: () => void;
  onStatusChange: (id: number, status: string) => void;
}) {
  const otherId    = isFreelancer ? interest.briefClientId  : interest.freelancerId;
  const otherName  = isFreelancer ? interest.briefClientName : interest.freelancerName;
  const otherAvatar = isFreelancer ? undefined               : interest.freelancerAvatar;
  const [showAcceptModal, setShowAcceptModal] = useState(false);

  return (
    <div className="flex flex-col h-full min-h-[560px]">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-4 pt-4 pb-2 transition-colors"
      >
        <ArrowLeft size={13} /> Back to all interests
      </button>

      {/* Brief summary card */}
      <div className="mx-4 mb-4 bg-muted/40 border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{interest.briefTitle}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isFreelancer ? `Brief by ${interest.briefClientName}` : `Applied by ${interest.freelancerName}`}
            </p>
          </div>
          <StatusBadge status={interest.status} />
        </div>

        {/* Meta row */}
        <div className="grid grid-cols-2 gap-2">
          {interest.rate && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Banknote size={12} className="text-primary flex-shrink-0" />
              <span>Rate: <span className="font-medium text-foreground">{interest.rate}</span></span>
            </div>
          )}
          {interest.availability && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays size={12} className="text-primary flex-shrink-0" />
              <span>From: <span className="font-medium text-foreground">{interest.availability}</span></span>
            </div>
          )}
        </div>

        {/* Cover note */}
        <div className="bg-background rounded-lg p-3 border border-border">
          <div className="flex items-center gap-1.5 mb-1.5">
            <StickyNote size={11} className="text-muted-foreground" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isFreelancer ? "Your cover note" : "Cover note"}
            </p>
          </div>
          <p className="text-xs leading-relaxed text-foreground">{interest.coverNote}</p>
        </div>

        {/* Timestamps */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><Clock size={10} /> Sent: {formatUK(interest.createdAt)}</span>
          {interest.respondedAt && (
            <span className="flex items-center gap-1">
              <CheckCircle2 size={10} />
              {interest.status === "accepted" ? "Accepted" : "Declined"}: {formatUK(interest.respondedAt)}
            </span>
          )}
        </div>

        {/* Client action buttons */}
        {!isFreelancer && interest.status !== "accepted" && interest.status !== "declined" && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-white rounded-full text-xs px-4"
              onClick={() => setShowAcceptModal(true)}
            >
              <CheckCircle2 size={12} className="mr-1" /> Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs px-4 text-muted-foreground hover:text-destructive hover:border-destructive"
              onClick={() => onStatusChange(interest.id, "declined")}
            >
              <XCircle size={12} className="mr-1" /> Decline
            </Button>
          </div>
        )}

        {/* Acceptance modal */}
        {showAcceptModal && (
          <AcceptanceModal
            interest={interest}
            clientName={userName}
            clientAvatar={userAvatar}
            clientId={userId}
            onClose={() => setShowAcceptModal(false)}
            onAccepted={() => {
              onStatusChange(interest.id, "accepted");
              setShowAcceptModal(false);
            }}
          />
        )}
      </div>

      {/* Divider label */}
      <div className="flex items-center gap-2 px-4 mb-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Messages</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-hidden border-t border-border">
        <InterestMessageThread
          userId={userId}
          otherId={otherId}
          otherName={otherName}
          otherAvatar={otherAvatar}
          interestId={interest.id}
          briefTitle={interest.briefTitle}
        />
      </div>
    </div>
  );
}

// ── InterestsPanel — exported ─────────────────────────────────────────────────
export default function InterestsPanel({
  interests,
  isFreelancer,
  userId,
  userName,
  userAvatar,
  onStatusChange,
}: {
  interests: any[];
  isFreelancer: boolean;
  userId: number;
  userName: string;
  userAvatar?: string;
  onStatusChange: (id: number, status: string) => void;
}) {
  const [selected, setSelected] = useState<any | null>(null);

  if (interests.length === 0) {
    return (
      <div className="p-5 text-center py-10 text-muted-foreground">
        <FileText size={28} className="mx-auto mb-3 opacity-40" />
        <p className="font-semibold text-foreground mb-1">
          {isFreelancer ? "No interests sent yet" : "No interests received yet"}
        </p>
        <p className="text-sm mb-4">
          {isFreelancer
            ? "Browse the briefs board and express interest in projects that suit you."
            : "Once freelancers express interest in your briefs, they'll appear here."}
        </p>
        <Button asChild className="bg-primary hover:bg-primary/90 text-white">
          <Link href="/briefs">{isFreelancer ? "Browse briefs" : "View briefs board"}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-[280px,1fr] divide-y md:divide-y-0 md:divide-x divide-border">
      {/* LEFT — interest list */}
      <div className="overflow-y-auto max-h-[640px]">
        <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
          {isFreelancer ? "Interests sent" : "Interests received"} · {interests.length}
        </p>
        {interests.map((interest: any) => (
          <button
            key={interest.id}
            onClick={() => setSelected(interest)}
            className={`w-full text-left flex items-start gap-3 px-4 py-3.5 border-b border-border last:border-b-0 transition-colors
              ${selected?.id === interest.id
                ? "bg-primary/8 border-l-2 border-l-primary"
                : "hover:bg-secondary/50"
              }`}
          >
            <Avatar className="w-8 h-8 flex-shrink-0 mt-0.5">
              {isFreelancer ? (
                <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                  {interest.briefClientName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              ) : (
                <>
                  <AvatarImage src={interest.freelancerAvatar} />
                  <AvatarFallback className="bg-primary text-white text-xs">
                    {interest.freelancerName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </>
              )}
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <p className="font-semibold text-xs truncate leading-snug">{interest.briefTitle}</p>
                <StatusBadge status={interest.status} />
              </div>
              <p className="text-[11px] text-muted-foreground truncate">
                {isFreelancer ? interest.briefClientName : interest.freelancerName}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <Clock size={9} /> {formatUK(interest.createdAt)}
              </p>
            </div>
            <ChevronRight size={12} className={`flex-shrink-0 mt-1 transition-colors ${selected?.id === interest.id ? "text-primary" : "text-muted-foreground/40"}`} />
          </button>
        ))}
      </div>

      {/* RIGHT — detail + thread */}
      <div className="overflow-hidden">
        {selected ? (
          <InterestDetail
            interest={selected}
            isFreelancer={isFreelancer}
            userId={userId}
            userName={userName}
            userAvatar={userAvatar}
            onBack={() => setSelected(null)}
            onStatusChange={(id, status) => {
              onStatusChange(id, status);
              setSelected((prev: any) => prev ? { ...prev, status } : prev);
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-16 text-muted-foreground gap-2">
            <MessageSquare size={26} className="opacity-30" />
            <p className="text-sm">Select an interest to view details &amp; chat</p>
          </div>
        )}
      </div>
    </div>
  );
}
