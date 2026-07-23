// NotificationPreferences.tsx
// PRD-006 Feature 4 — per-user notification preference settings
import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Bell, Mail, Loader2, ChevronLeft } from "lucide-react";
import { useLocation } from "wouter";

interface Prefs {
  emailProjectInvitations: boolean;
  emailNewOffers: boolean;
  emailCounterOffers: boolean;
  emailMessages: boolean;
  emailStageUpdates: boolean;
  emailPaymentUpdates: boolean;
  emailReviewRequests: boolean;
  emailProductUpdates: boolean;
}

const PREF_ROWS: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: "emailProjectInvitations", label: "Project Invitations",  desc: "When a client invites you to a project" },
  { key: "emailNewOffers",          label: "New Offers",           desc: "When a freelancer expresses interest in your brief" },
  { key: "emailCounterOffers",      label: "Counter Offers",       desc: "When someone counters a price proposal" },
  { key: "emailMessages",           label: "Messages",             desc: "When you receive a new direct message" },
  { key: "emailStageUpdates",       label: "Stage Updates",        desc: "When a project stage is submitted or approved" },
  { key: "emailPaymentUpdates",     label: "Payment Updates",      desc: "Payment requests, receipts and confirmations" },
  { key: "emailReviewRequests",     label: "Review Requests",      desc: "When you're asked to leave a review" },
  { key: "emailProductUpdates",     label: "Product Updates",      desc: "Platform news and new Viewrr features" },
];

const DEFAULT_PREFS: Prefs = {
  emailProjectInvitations: true,
  emailNewOffers: true,
  emailCounterOffers: true,
  emailMessages: true,
  emailStageUpdates: true,
  emailPaymentUpdates: true,
  emailReviewRequests: true,
  emailProductUpdates: false,
};

export default function NotificationPreferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch(`/api/notifications/preferences/${user.id}`)
      .then(r => r.json())
      .then(data => {
        setPrefs({
          emailProjectInvitations: data.emailProjectInvitations ?? true,
          emailNewOffers: data.emailNewOffers ?? true,
          emailCounterOffers: data.emailCounterOffers ?? true,
          emailMessages: data.emailMessages ?? true,
          emailStageUpdates: data.emailStageUpdates ?? true,
          emailPaymentUpdates: data.emailPaymentUpdates ?? true,
          emailReviewRequests: data.emailReviewRequests ?? true,
          emailProductUpdates: data.emailProductUpdates ?? false,
        });
      })
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false));
  }, [user?.id]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notifications/preferences/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Preferences saved", description: "Your notification settings have been updated." });
    } catch {
      toast({ title: "Could not save preferences", variant: "destructive" });
    }
    setSaving(false);
  }

  function toggle(key: keyof Prefs) {
    setPrefs(p => ({ ...p, [key]: !p[key] }));
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate("/dashboard")}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-base font-bold">Notification Preferences</h1>
          <p className="text-xs text-muted-foreground">Choose how Viewrr keeps you informed</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

        {/* In-app notifications info banner */}
        <div
          className="flex items-start gap-3 p-4 rounded-2xl border"
          style={{ background: "rgba(255,90,31,0.04)", borderColor: "rgba(255,90,31,0.2)" }}
        >
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,90,31,0.1)" }}>
            <Bell size={15} style={{ color: "#FF5A1F" }} />
          </div>
          <div>
            <p className="text-sm font-semibold">In-app notifications</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
              In-app notifications are always enabled for critical project events — new offers, stage updates, payments and messages. These cannot be turned off.
            </p>
          </div>
        </div>

        {/* Email preferences */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Mail size={15} className="text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Email Notifications</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-primary" />
            </div>
          ) : (
            <div className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {PREF_ROWS.map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0 pr-4">
                    <Label htmlFor={key} className="text-sm font-medium cursor-pointer">{label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  <Switch
                    id={key}
                    checked={prefs[key]}
                    onCheckedChange={() => toggle(key)}
                    aria-label={label}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-8 rounded-full text-white font-semibold"
            style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
          >
            {saving ? <><Loader2 size={14} className="animate-spin mr-2" />Saving…</> : "Save preferences"}
          </Button>
        </div>
      </div>
    </div>
  );
}
