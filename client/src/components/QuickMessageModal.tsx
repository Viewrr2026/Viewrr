/**
 * QuickMessageModal
 * Opened by NotificationBell when a user clicks a "message" notification.
 * Shows the full conversation thread + reply box in a floating modal.
 */
import { useState, useEffect, useRef } from "react";
import { X, Send } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── UK timestamp ─────────────────────────────────────────────────────────────
function formatUK(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit",
    day: "numeric", month: "short",
    timeZone: "Europe/London",
  }).format(d);
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface QuickMessageModalProps {
  open: boolean;
  onClose: () => void;
  userId: number;       // the logged-in user
  otherId: number;      // the person they received the message from
  otherName: string;
  otherAvatar?: string | null;
}

export default function QuickMessageModal({
  open, onClose, userId, otherId, otherName, otherAvatar,
}: QuickMessageModalProps) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch the thread (poll every 5 s while open)
  const { data: messages = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/messages", userId, otherId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/messages/${otherId}/${userId}`);
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  // Auto-scroll to bottom when messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/messages", { fromId: userId, toId: otherId, content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", userId, otherId] });
      setText("");
    },
  });

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-[201] bottom-6 right-6 w-[360px] max-w-[calc(100vw-24px)] flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        style={{ maxHeight: "520px" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
          <Avatar className="w-8 h-8 flex-shrink-0">
            <AvatarImage src={otherAvatar || undefined} />
            <AvatarFallback className="bg-primary text-white text-xs">
              {otherName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{otherName}</p>
            <p className="text-[11px] text-muted-foreground">Message</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-3" style={{ minHeight: 0, maxHeight: "360px" }}>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map(i => (
                <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
                  <div className="h-8 w-40 rounded-2xl bg-secondary animate-pulse" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">No messages yet. Say hello!</p>
          ) : (
            <div className="space-y-3">
              {messages.map((m: any) => (
                <div key={m.id} className={`flex flex-col ${m.fromId === userId ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[240px] px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                    ${m.fromId === userId
                      ? "bg-primary text-white rounded-tr-sm"
                      : "bg-secondary text-foreground rounded-tl-sm"
                    }`}>
                    {m.content}
                  </div>
                  {m.createdAt && (
                    <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                      {formatUK(m.createdAt)}
                    </span>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        {/* Reply box */}
        <form
          onSubmit={e => { e.preventDefault(); if (text.trim()) sendMutation.mutate(text); }}
          className="flex gap-2 px-3 py-3 border-t border-border bg-background"
        >
          <Input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Reply..."
            className="flex-1 rounded-full text-sm h-9"
            autoFocus
            data-testid="input-quick-reply"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!text.trim() || sendMutation.isPending}
            className="rounded-full w-9 h-9 bg-primary hover:bg-primary/90 text-white flex-shrink-0"
            data-testid="btn-send-quick-reply"
          >
            <Send size={14} />
          </Button>
        </form>
      </div>
    </>
  );
}
