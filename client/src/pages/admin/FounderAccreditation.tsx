/**
 * FounderAccreditation — Founder-only accreditation management panel
 *
 * Allows the Founder to:
 * - See all freelancers by accreditation tier
 * - Approve, reject, promote, demote, remove accreditation
 * - Leave internal notes (never visible to freelancers)
 * - View the full audit history per freelancer
 *
 * Trust is earned, never purchased.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AccreditationBadge, {
  ACCREDITATION_CONFIG,
  LEVEL_ORDER,
  type AccreditationLevel,
} from "@/components/accreditation/AccreditationBadge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Search,
  History,
  Pencil,
  ChevronDown,
  ChevronUp,
  ShieldOff,
  BadgePlus,
  ArrowUpCircle,
  ArrowDownCircle,
  FileX,
  AlertCircle,
  Users,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FreelancerProfile {
  id: number;
  userId: number;
  userName: string;
  userEmail: string;
  userAvatar: string | null;
  accreditationLevel: string | null;
  accreditationApprovedBy: number | null;
  accreditationApprovedByName: string | null;
  accreditationApprovedDate: string | null;
  accreditationNotes: string | null;
  accreditationLastReviewed: string | null;
  reviewAverage: number;
  verifiedReviewCount: number;
  completedProjectCount: number;
  specialisms: string;
  rating: number;
  reviewCount: number;
  projectCount: number;
}

interface HistoryEntry {
  id: number;
  freelancerUserId: number;
  actionDate: string;
  founderUserId: number;
  founderName: string;
  previousLevel: string | null;
  newLevel: string | null;
  action: string;
  reason: string;
  internalNotes: string;
}

type ActionType =
  | "granted"
  | "promoted"
  | "demoted"
  | "removed"
  | "rejected"
  | "changes_requested";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    granted: "Accreditation Granted",
    promoted: "Promoted",
    demoted: "Demoted",
    removed: "Accreditation Removed",
    rejected: "Application Rejected",
    changes_requested: "Changes Requested",
  };
  return map[action] ?? action;
}

function actionColor(action: string) {
  if (["granted", "promoted"].includes(action))
    return "text-green-600 dark:text-green-400";
  if (["demoted", "removed", "rejected"].includes(action))
    return "text-red-500 dark:text-red-400";
  return "text-amber-500 dark:text-amber-400";
}

// ─── Tier Stat Card ───────────────────────────────────────────────────────────

function TierCard({
  level,
  count,
  active,
  onClick,
}: {
  level: AccreditationLevel | null;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const config = level ? ACCREDITATION_CONFIG[level] : null;
  const Icon = config?.icon ?? Users;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4 text-left transition-all hover:shadow-md",
        active
          ? "border-[#FF5A1F] bg-orange-50 dark:bg-orange-950/30 shadow-sm"
          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {level ? ACCREDITATION_CONFIG[level].label : "No Accreditation"}
        </span>
        <Icon
          size={16}
          className={config?.iconClass ?? "text-zinc-400"}
        />
      </div>
      <span className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
        {count}
      </span>
    </button>
  );
}

// ─── History Dialog ───────────────────────────────────────────────────────────

function HistoryDialog({
  freelancer,
  userId,
  open,
  onClose,
}: {
  freelancer: FreelancerProfile;
  userId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { data: history = [], isLoading } = useQuery<HistoryEntry[]>({
    queryKey: ["accreditation-history", freelancer.userId],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/accreditation/history/${freelancer.userId}?userId=${userId}`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Accreditation History — {freelancer.userName}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-zinc-400" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-8 italic">
            No accreditation history yet.
          </p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {history.map((h) => (
              <div
                key={h.id}
                className="rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={cn("text-sm font-semibold", actionColor(h.action))}>
                      {actionLabel(h.action)}
                    </span>
                    {h.previousLevel && (
                      <span className="text-xs text-zinc-400 ml-2">
                        {h.previousLevel} → {h.newLevel ?? "none"}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 flex-shrink-0">
                    {formatDate(h.actionDate)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  By {h.founderName}
                </p>
                {h.reason && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1.5 italic">
                    "{h.reason}"
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Action Dialog ────────────────────────────────────────────────────────────

type ActionDialogMode =
  | { type: "grant"; profile: FreelancerProfile }
  | { type: "change"; profile: FreelancerProfile }
  | { type: "remove"; profile: FreelancerProfile }
  | { type: "notes"; profile: FreelancerProfile };

function ActionDialog({
  mode,
  userId,
  founderName,
  onClose,
}: {
  mode: ActionDialogMode;
  userId: number;
  founderName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const profile = mode.profile;

  const currentLevel = profile.accreditationLevel as AccreditationLevel;

  const [newLevel, setNewLevel] = useState<AccreditationLevel>(
    mode.type === "grant"
      ? "verified"
      : mode.type === "change"
      ? currentLevel
      : currentLevel,
  );
  const [action, setAction] = useState<ActionType>(
    mode.type === "grant"
      ? "granted"
      : mode.type === "remove"
      ? "removed"
      : "promoted",
  );
  const [reason, setReason] = useState("");
  const [internalNotes, setInternalNotes] = useState(
    profile.accreditationNotes ?? "",
  );

  const isNotesOnly = mode.type === "notes";

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (isNotesOnly) {
        const res = await fetch("/api/admin/accreditation/notes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, profileId: profile.id, internalNotes }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
      }

      const payload = {
        userId,
        freelancerUserId: profile.userId,
        profileId: profile.id,
        newLevel: mode.type === "remove" ? null : newLevel,
        action: mode.type === "remove" ? "removed" : action,
        reason,
        internalNotes,
      };

      const res = await fetch("/api/admin/accreditation/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["founder-accreditation"] });
      toast({
        title: isNotesOnly ? "Notes saved" : "Accreditation updated",
        description: isNotesOnly
          ? "Internal notes updated."
          : `${profile.userName}'s accreditation has been updated.`,
      });
      onClose();
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const title =
    mode.type === "notes"
      ? `Internal Notes — ${profile.userName}`
      : mode.type === "grant"
      ? `Grant Accreditation — ${profile.userName}`
      : mode.type === "remove"
      ? `Remove Accreditation — ${profile.userName}`
      : `Update Accreditation — ${profile.userName}`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {!isNotesOnly && mode.type !== "remove" && (
            <>
              <div>
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5 block">
                  Accreditation Level
                </label>
                <Select
                  value={newLevel ?? ""}
                  onValueChange={(v) => {
                    setNewLevel(v as AccreditationLevel);
                    // Auto-determine action
                    if (!currentLevel) {
                      setAction("granted");
                    } else if (
                      LEVEL_ORDER.indexOf(v as AccreditationLevel) >
                      LEVEL_ORDER.indexOf(currentLevel as AccreditationLevel)
                    ) {
                      setAction("promoted");
                    } else {
                      setAction("demoted");
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVEL_ORDER.map((l) => (
                      <SelectItem key={l} value={l}>
                        {ACCREDITATION_CONFIG[l].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5 block">
                  Action
                </label>
                <Select
                  value={action}
                  onValueChange={(v) => setAction(v as ActionType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="granted">Granted</SelectItem>
                    <SelectItem value="promoted">Promoted</SelectItem>
                    <SelectItem value="demoted">Demoted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="changes_requested">Changes Requested</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {mode.type === "remove" && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 flex items-start gap-2">
              <AlertCircle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-400">
                This will remove {profile.userName}'s{" "}
                <strong>{profile.accreditationLevel}</strong> accreditation. The
                freelancer will not be notified of the removal reason.
              </p>
            </div>
          )}

          {!isNotesOnly && (
            <div>
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5 block">
                Reason (shown in audit log)
              </label>
              <Textarea
                placeholder="e.g. Excellent commercial portfolio. Consistent quality. Professional presentation."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="text-sm resize-none"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5 block">
              Internal Notes{" "}
              <span className="font-normal text-zinc-400">(never visible to freelancer)</span>
            </label>
            <Textarea
              placeholder="e.g. Strong commercial work. Improve portfolio organisation."
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={3}
              className="text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className={
              mode.type === "remove"
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-[#FF5A1F] hover:bg-orange-600 text-white"
            }
          >
            {updateMutation.isPending ? (
              <Loader2 size={14} className="animate-spin mr-2" />
            ) : null}
            {isNotesOnly ? "Save Notes" : mode.type === "remove" ? "Remove Accreditation" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Freelancer Row ───────────────────────────────────────────────────────────

function FreelancerRow({
  profile,
  userId,
  founderName,
}: {
  profile: FreelancerProfile;
  userId: number;
  founderName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionMode, setActionMode] = useState<ActionDialogMode | null>(null);

  const level = profile.accreditationLevel as AccreditationLevel;

  let specialisms: string[] = [];
  try {
    specialisms = JSON.parse(profile.specialisms || "[]");
  } catch {}

  return (
    <>
      <div className="border-b border-zinc-100 dark:border-zinc-800/70 last:border-0">
        {/* Main row */}
        <div className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
          <Avatar className="w-9 h-9 flex-shrink-0">
            <AvatarImage src={profile.userAvatar || undefined} />
            <AvatarFallback className="bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm font-semibold">
              {(profile.userName || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                {profile.userName}
              </span>
              <AccreditationBadge level={level} variant="inline" />
            </div>
            <p className="text-xs text-zinc-400 truncate">{profile.userEmail}</p>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-5 text-xs text-zinc-500 dark:text-zinc-400">
            <span title="Projects">{profile.completedProjectCount ?? profile.projectCount ?? 0} proj</span>
            <span title="Reviews">{profile.verifiedReviewCount ?? profile.reviewCount ?? 0} reviews</span>
            {(profile.reviewAverage ?? profile.rating ?? 0) > 0 && (
              <span title="Avg rating">★ {((profile.reviewAverage ?? profile.rating) || 0).toFixed(1)}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Grant / Change */}
            {!level && (
              <Button
                size="sm"
                className="h-7 text-xs px-2.5 bg-[#FF5A1F] hover:bg-orange-600 text-white"
                onClick={() => setActionMode({ type: "grant", profile })}
              >
                <BadgePlus size={13} className="mr-1" /> Grant
              </Button>
            )}
            {level && level !== "elite" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2.5 border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                onClick={() => setActionMode({ type: "change", profile })}
              >
                <ArrowUpCircle size={13} className="mr-1" /> Promote
              </Button>
            )}
            {level && level !== "verified" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2.5 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                onClick={() => {
                  setActionMode({ type: "change", profile });
                }}
              >
                <ArrowDownCircle size={13} className="mr-1" /> Demote
              </Button>
            )}
            {level && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2.5 border-red-200 text-red-600 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                onClick={() => setActionMode({ type: "remove", profile })}
              >
                <ShieldOff size={13} className="mr-1" /> Remove
              </Button>
            )}

            {/* Notes button */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-600"
              title="Internal notes"
              onClick={() => setActionMode({ type: "notes", profile })}
            >
              <Pencil size={13} />
            </Button>

            {/* History */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-600"
              title="View history"
              onClick={() => setHistoryOpen(true)}
            >
              <History size={13} />
            </Button>

            {/* Expand */}
            <button
              className="h-7 w-7 p-0 flex items-center justify-center text-zinc-400 hover:text-zinc-600"
              onClick={() => setExpanded(!expanded)}
              title="Details"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="px-14 pb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <p className="font-semibold text-zinc-400 mb-0.5">Approved by</p>
              <p className="text-zinc-700 dark:text-zinc-300">
                {profile.accreditationApprovedByName ?? "—"}
              </p>
            </div>
            <div>
              <p className="font-semibold text-zinc-400 mb-0.5">Approved date</p>
              <p className="text-zinc-700 dark:text-zinc-300">
                {formatDate(profile.accreditationApprovedDate)}
              </p>
            </div>
            <div>
              <p className="font-semibold text-zinc-400 mb-0.5">Last reviewed</p>
              <p className="text-zinc-700 dark:text-zinc-300">
                {formatDate(profile.accreditationLastReviewed)}
              </p>
            </div>
            {specialisms.length > 0 && (
              <div className="col-span-full md:col-span-1">
                <p className="font-semibold text-zinc-400 mb-0.5">Specialisms</p>
                <p className="text-zinc-700 dark:text-zinc-300">{specialisms.join(", ")}</p>
              </div>
            )}
            {profile.accreditationNotes && (
              <div className="col-span-full">
                <p className="font-semibold text-zinc-400 mb-0.5">
                  Internal notes{" "}
                  <span className="font-normal italic">(founder only)</span>
                </p>
                <p className="text-zinc-700 dark:text-zinc-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2 leading-relaxed">
                  {profile.accreditationNotes}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {historyOpen && (
        <HistoryDialog
          freelancer={profile}
          userId={userId}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {actionMode && (
        <ActionDialog
          mode={actionMode}
          userId={userId}
          founderName={founderName}
          onClose={() => setActionMode(null)}
        />
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FounderAccreditation() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState<AccreditationLevel | "all">(
    "all",
  );
  const [isFetching, setIsFetching] = useState(false);

  const {
    data: profiles = [],
    isLoading,
    refetch,
  } = useQuery<FreelancerProfile[]>({
    queryKey: ["founder-accreditation", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/accreditation?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed to load profiles");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  // Tier counts
  const tierCounts = useMemo(() => {
    const counts = {
      all: profiles.length,
      none: 0,
      verified: 0,
      approved: 0,
      elite: 0,
    };
    profiles.forEach((p) => {
      const l = p.accreditationLevel as AccreditationLevel;
      if (!l) counts.none++;
      else counts[l] = (counts[l] || 0) + 1;
    });
    return counts;
  }, [profiles]);

  // Filtered list
  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      const matchSearch =
        search.trim() === "" ||
        p.userName.toLowerCase().includes(search.toLowerCase()) ||
        p.userEmail.toLowerCase().includes(search.toLowerCase());

      const matchLevel =
        filterLevel === "all" ||
        (filterLevel === null && !p.accreditationLevel) ||
        p.accreditationLevel === filterLevel;

      return matchSearch && matchLevel;
    });
  }, [profiles, search, filterLevel]);

  return (
    <AdminLayout>
      <DashboardHeader
        title="Accreditation"
        description="Manage trust and quality standards across the Viewrr marketplace."
      />

      {/* Tier summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <TierCard
          level={null}
          count={tierCounts.none}
          active={filterLevel === null}
          onClick={() => setFilterLevel(filterLevel === null ? "all" : null)}
        />
        {LEVEL_ORDER.map((l) => (
          <TierCard
            key={l}
            level={l}
            count={tierCounts[l] ?? 0}
            active={filterLevel === l}
            onClick={() =>
              setFilterLevel(filterLevel === l ? "all" : l)
            }
          />
        ))}
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-8 text-sm h-9"
          />
        </div>
        <Select
          value={filterLevel === null ? "none" : filterLevel}
          onValueChange={(v) =>
            setFilterLevel(v === "none" ? null : v === "all" ? "all" : (v as AccreditationLevel))
          }
        >
          <SelectTrigger className="h-9 text-sm w-44">
            <SelectValue placeholder="Filter by level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="none">No accreditation</SelectItem>
            {LEVEL_ORDER.map((l) => (
              <SelectItem key={l} value={l}>
                {ACCREDITATION_CONFIG[l].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={async () => {
            setIsFetching(true);
            await refetch();
            setIsFetching(false);
          }}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          disabled={isFetching}
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Freelancer list */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {/* Column headers */}
        <div className="flex items-center gap-4 px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
          <div className="w-9 flex-shrink-0" />
          <span className="flex-1 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Creative
          </span>
          <span className="hidden md:block text-xs font-semibold text-zinc-400 uppercase tracking-wider w-40">
            Stats
          </span>
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Actions
          </span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-zinc-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <FileX size={32} className="text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-400 italic">
              {profiles.length === 0
                ? "No freelancers on the platform yet."
                : "No results match your filters."}
            </p>
          </div>
        ) : (
          filtered.map((p) => (
            <FreelancerRow
              key={p.id}
              profile={p}
              userId={user?.id ?? 0}
              founderName={user?.name ?? "Founder"}
            />
          ))
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-zinc-400 mt-3 text-right">
          Showing {filtered.length} of {profiles.length} creatives
        </p>
      )}
    </AdminLayout>
  );
}
