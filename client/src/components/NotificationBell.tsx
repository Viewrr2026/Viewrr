import { useState, useRef, useEffect } from "react";
import { Bell, Heart, MessageCircle, Mail, Briefcase, CheckCircle, XCircle, Eye, UserCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import QuickMessageModal from "./QuickMessageModal";
import NotificationActionModal from "./NotificationActionModal";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Notification {
  id: number;
  recipientId: number;
  actorId: number;
  actorName: string;
  actorAvatar: string | null;
  type: string;
  message: string;
  link: string | null;
  read: number;
  createdAt: string;
}

// ─── UK timestamp helper ─────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    timeZone: "Europe/London"
  }).format(date);
}

// ─── Icon per notification type ───────────────────────────────────────────────
function NotifIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 flex-shrink-0";
  switch (type) {
    case "like": return <Heart className={cls} style={{ color: "#FF5A1F" }} />;
    case "comment": return <MessageCircle className={cls} style={{ color: "#3B82F6" }} />;
    case "message": return <Mail className={cls} style={{ color: "#8B5CF6" }} />;
    case "interest": return <Briefcase className={cls} style={{ color: "#FF5A1F" }} />;
    case "interest_accepted": return <CheckCircle className={cls} style={{ color: "#22C55E" }} />;
    case "interest_declined": return <XCircle className={cls} style={{ color: "#EF4444" }} />;
    case "profile_view": return <Eye className={cls} style={{ color: "#F59E0B" }} />;
    case "connection": return <UserCheck className={cls} style={{ color: "#06B6D4" }} />;
    default: return <Bell className={cls} style={{ color: "#6B7280" }} />;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Quick message modal state
  const [msgModal, setMsgModal] = useState<{
    open: boolean;
    otherId: number;
    otherName: string;
    otherAvatar?: string | null;
  }>({ open: false, otherId: 0, otherName: "" });

  // Action modal state (like, comment, interest, profile_view, etc.)
  const [actionModal, setActionModal] = useState<{
    open: boolean;
    notification: Notification | null;
  }>({ open: false, notification: null });

  const DEMO_IDS = new Set([1, 2, 3]);
  const isDemo = user && DEMO_IDS.has(user.id);

  const unreadCount = notifications.filter(n => n.read === 0).length;

  // Load notifications on open
  async function fetchNotifs() {
    if (!user || isDemo) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(Array.isArray(data) ? data : []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }

  // Poll unread count every 30s while user is logged in
  useEffect(() => {
    if (!user || isDemo) return;
    let mounted = true;
    async function pollCount() {
      try {
        const res = await fetch(`/api/notifications/${user!.id}/unread-count`);
        if (res.ok && mounted) {
          const { count } = await res.json();
          // Only refetch full list if count changed (avoid unnecessary re-renders)
          setNotifications(prev => {
            const prevUnread = prev.filter(n => n.read === 0).length;
            if (count !== prevUnread && count > 0) fetchNotifs();
            return prev;
          });
        }
      } catch { /* silent */ }
    }
    pollCount();
    const timer = setInterval(pollCount, 30_000);
    return () => { mounted = false; clearInterval(timer); };
  }, [user?.id]);

  // Open → fetch fresh list
  useEffect(() => {
    if (open) fetchNotifs();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function markRead(id: number) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
  }

  function handleNotifClick(n: Notification) {
    markRead(n.id);
    setOpen(false);
    if (n.type === "message") {
      // Quick reply modal
      setMsgModal({
        open: true,
        otherId: n.actorId,
        otherName: n.actorName,
        otherAvatar: n.actorAvatar,
      });
    } else {
      // Contextual action modal for all other types
      setActionModal({ open: true, notification: n });
    }
  }

  async function markAllRead() {
    if (!user) return;
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
    await fetch(`/api/notifications/user/${user.id}/read-all`, { method: "PATCH" });
  }

  // Don't render if not logged in
  if (!user) return null;

  return (
    <>
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        aria-label="Notifications"
        data-testid="notification-bell"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-white text-[10px] font-bold leading-none px-1"
            style={{ background: "#FF5A1F", fontSize: "10px" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-h-[420px] overflow-y-auto rounded-xl border border-border bg-background shadow-xl z-[100] flex flex-col"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background z-10">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Demo users */}
          {isDemo && (
            <div className="flex flex-col items-center justify-center py-10 px-4 gap-2 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Notifications are only available on real accounts.</p>
            </div>
          )}

          {/* Real users — loading */}
          {!isDemo && loading && notifications.length === 0 && (
            <div className="flex flex-col gap-2 p-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <div className="w-8 h-8 rounded-full bg-secondary animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-secondary rounded animate-pulse w-3/4" />
                    <div className="h-2.5 bg-secondary rounded animate-pulse w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Real users — empty state */}
          {!isDemo && !loading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 px-4 gap-2 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">You're all caught up.</p>
              <p className="text-xs text-muted-foreground/60">Likes, comments, messages and interest updates will appear here.</p>
            </div>
          )}

          {/* Notification list */}
          {!isDemo && notifications.length > 0 && (
            <ul className="divide-y divide-border">
              {notifications.map(n => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-secondary/60 ${n.read === 0 ? "bg-primary/5" : ""}`}
                  onClick={() => handleNotifClick(n)}
                >
                  {/* Actor avatar */}
                  <div className="relative mt-0.5">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={n.actorAvatar || undefined} />
                      <AvatarFallback className="bg-secondary text-foreground text-xs">
                        {n.actorName.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {/* Type icon badge */}
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-background flex items-center justify-center border border-border">
                      <NotifIcon type={n.type} />
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-relaxed ${n.read === 0 ? "font-semibold text-foreground" : "text-foreground/80"}`}>
                      {n.message}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
                  </div>

                  {/* Unread dot */}
                  {n.read === 0 && (
                    <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#FF5A1F" }} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>

      {/* Quick message modal */}
      <QuickMessageModal
        open={msgModal.open}
        onClose={() => setMsgModal(m => ({ ...m, open: false }))}
        userId={user.id}
        otherId={msgModal.otherId}
        otherName={msgModal.otherName}
        otherAvatar={msgModal.otherAvatar}
      />

      {/* Contextual action modal for all other notification types */}
      <NotificationActionModal
        open={actionModal.open}
        onClose={() => setActionModal(m => ({ ...m, open: false }))}
        notification={actionModal.notification}
      />
    </>
  );
}
