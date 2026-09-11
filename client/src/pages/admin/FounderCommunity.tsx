import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Flag,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserRound,
} from "lucide-react";

import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ModerationReport = {
  id: number;
  reporter_user_id: number;
  subject_type: string;
  subject_id: number;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
  resolution_note: string | null;
  moderator_action: string | null;

  reporter_name: string | null;
  reporter_email: string | null;

  subject_label: string | null;
  subject_user_id: number | null;
  subject_body: string | null;
  subject_account_status: string | null;
  prior_reports_against_subject: number | string | null;
};

type ReportsResponse = {
  reports: ModerationReport[];
  total: number;
  limit: number;
  offset: number;
};

type SuspendedUser = {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  account_status: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  suspended_by: number | null;
};

type SuspendedUsersResponse = {
  users: SuspendedUser[];
  total: number;
};

type ModeratorAction =
  | "dismissed"
  | "no_action"
  | "warned"
  | "suspended";

const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment or abuse",
  fake: "Fake or impersonation",
  inappropriate: "Inappropriate content",
  other: "Other",
};

function reasonLabel(reason: string) {
  return REASON_LABELS[reason] ?? reason;
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function priorCount(report: ModerationReport) {
  const value = Number(report.prior_reports_against_subject ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * V1 triage only.
 *
 * This NEVER performs an automated enforcement action. It merely makes
 * harassment/inappropriate reports and repeated-report subjects harder for a
 * founder to overlook. Every decision remains manual.
 */
function isPriority(report: ModerationReport) {
  return (
    report.reason === "harassment" ||
    report.reason === "inappropriate" ||
    priorCount(report) >= 2
  );
}

function actionTitle(action: ModeratorAction) {
  switch (action) {
    case "dismissed":
      return "Dismiss report";
    case "no_action":
      return "Resolve with no action";
    case "warned":
      return "Record warning";
    case "suspended":
      return "Suspend account";
  }
}

function actionDescription(action: ModeratorAction) {
  switch (action) {
    case "dismissed":
      return "Use this when the report is unfounded or does not breach Viewrr rules.";
    case "no_action":
      return "Acknowledge the report and close it without account enforcement.";
    case "warned":
      return "Record a warning decision in Viewrr's moderation history.";
    case "suspended":
      return "Suspend the reported account server-side and close this report.";
  }
}

export default function FounderCommunity() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<{
    report: ModerationReport;
    action: ModeratorAction;
  } | null>(null);
  const [note, setNote] = useState("");
  const [unsuspendTarget, setUnsuspendTarget] = useState<SuspendedUser | null>(null);
  const [unsuspendNote, setUnsuspendNote] = useState("");

  const reportsQuery = useQuery<ReportsResponse>({
    queryKey: ["founder-open-reports"],
    queryFn: async () => {
      const res = await fetch("/api/admin/reports?status=open&limit=100");

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not load moderation reports.");
      }

      return res.json();
    },
    refetchInterval: 15_000,
  });

  const suspendedUsersQuery = useQuery<SuspendedUsersResponse>({
    queryKey: ["founder-suspended-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/suspended-users");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not load suspended accounts.");
      }
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({
      report,
      action,
      note,
    }: {
      report: ModerationReport;
      action: ModeratorAction;
      note: string;
    }) => {
      const cleanNote = note.trim();

      if (action === "suspended") {
        if (!report.subject_user_id) {
          throw new Error("This report is not linked to an account that can be suspended.");
        }

        const suspend = await fetch(
          `/api/admin/users/${report.subject_user_id}/suspend`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reason:
                cleanNote ||
                `Moderation report #${report.id}: ${reasonLabel(report.reason)}`,
            }),
          },
        );

        if (!suspend.ok) {
          const body = await suspend.json().catch(() => null);
          throw new Error(body?.error ?? "Could not suspend this account.");
        }
      }

      const resolve = await fetch(
        `/api/admin/reports/${report.id}/resolve`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resolution: action,
            note: cleanNote || undefined,
          }),
        },
      );

      if (!resolve.ok) {
        const body = await resolve.json().catch(() => null);
        throw new Error(body?.error ?? "Could not resolve this report.");
      }

      return { action };
    },

    onSuccess: ({ action }) => {
      const title =
        action === "suspended"
          ? "Account suspended"
          : action === "warned"
            ? "Warning recorded"
            : action === "dismissed"
              ? "Report dismissed"
              : "Report resolved";

      toast({
        title,
        description: "The moderation queue has been updated.",
      });

      setSelected(null);
      setNote("");

      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["founder-open-reports"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["founder-open-reports-summary"],
        }),
      ]);
    },

    onError: (error: Error) => {
      toast({
        title: "Moderation action failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const unsuspendMutation = useMutation({
    mutationFn: async ({
      userId,
      note,
    }: {
      userId: number;
      note: string;
    }) => {
      const cleanNote = note.trim();

      if (!cleanNote) {
        throw new Error("A moderator note is required to unsuspend an account.");
      }

      const res = await fetch(`/api/admin/users/${userId}/unsuspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: cleanNote }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not unsuspend this account.");
      }

      return { userId };
    },

    onSuccess: () => {
      toast({
        title: "Account unsuspended",
        description:
          "The account is active again. Previously revoked sessions remain revoked, so the user must sign in again.",
      });

      setUnsuspendTarget(null);
      setUnsuspendNote("");

      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["founder-suspended-users"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["founder-open-reports"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["founder-open-reports-summary"],
        }),
      ]);
    },

    onError: (error: Error) => {
      toast({
        title: "Could not unsuspend account",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reports = reportsQuery.data?.reports ?? [];
  const total = reportsQuery.data?.total ?? 0;
  const suspendedUsers = suspendedUsersQuery.data?.users ?? [];
  const suspendedTotal = suspendedUsersQuery.data?.total ?? 0;

  return (
    <AdminLayout>
      <DashboardHeader
        title="Community"
        description="User reports, trust & safety, and community moderation."
      />

      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Open reports
              </span>
              <Flag size={16} className="text-[#FF5A1F]" />
            </div>
            <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
              {total}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Priority review
              </span>
              <ShieldAlert size={16} className="text-red-500" />
            </div>
            <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
              {reports.filter(isPriority).length}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Queue status
              </span>
              <Clock3 size={16} className="text-zinc-400" />
            </div>
            <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Refreshes every 15 seconds
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Founder decisions remain manual.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Suspended accounts
              </span>
              <Ban size={16} className="text-red-500" />
            </div>
            <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
              {suspendedTotal}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-3 border-b border-zinc-200 p-5 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Suspended accounts
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Account enforcement is managed independently from individual reports.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void suspendedUsersQuery.refetch()}
              disabled={suspendedUsersQuery.isFetching}
            >
              <RefreshCw
                size={14}
                className={cn(
                  "mr-2",
                  suspendedUsersQuery.isFetching && "animate-spin",
                )}
              />
              Refresh
            </Button>
          </div>

          {suspendedUsersQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={22} className="animate-spin text-zinc-400" />
            </div>
          ) : suspendedUsersQuery.isError ? (
            <div className="p-5">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
                <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                  Could not load suspended accounts
                </p>
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {suspendedUsersQuery.error instanceof Error
                    ? suspendedUsersQuery.error.message
                    : "Try refreshing the page."}
                </p>
              </div>
            </div>
          ) : suspendedUsers.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <ShieldCheck size={24} className="mx-auto text-green-500" />
              <p className="mt-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                No suspended accounts
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Suspended users will remain visible here until they are reinstated.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {suspendedUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {user.name}
                      </p>
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-400">
                        Suspended
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-zinc-500">
                      User #{user.id}
                      {user.email ? ` · ${user.email}` : ""}
                      {user.role ? ` · ${user.role}` : ""}
                    </p>

                    <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                      {user.suspended_reason ?? "No suspension reason recorded."}
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      Suspended {formatDate(user.suspended_at)}
                      {user.suspended_by
                        ? ` · by admin #${user.suspended_by}`
                        : ""}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setUnsuspendNote("");
                      setUnsuspendTarget(user);
                    }}
                  >
                    <UserCheck size={14} className="mr-2" />
                    Unsuspend account
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Moderation queue
            </h2>
            <p className="text-xs text-zinc-500">
              Newest open reports appear first.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void reportsQuery.refetch()}
            disabled={reportsQuery.isFetching}
          >
            <RefreshCw
              size={14}
              className={cn(
                "mr-2",
                reportsQuery.isFetching && "animate-spin",
              )}
            />
            Refresh
          </Button>
        </div>

        {reportsQuery.isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-zinc-400" />
          </div>
        ) : reportsQuery.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900/60 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={18}
                className="mt-0.5 flex-shrink-0 text-red-500"
              />
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                  Could not load moderation reports
                </p>
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {reportsQuery.error instanceof Error
                    ? reportsQuery.error.message
                    : "Try refreshing the page."}
                </p>
              </div>
            </div>
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <ShieldCheck
              size={30}
              className="mx-auto text-green-500"
            />
            <p className="mt-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              No open reports
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              New user reports will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => {
              const priority = isPriority(report);
              const previous = priorCount(report);

              return (
                <article
                  key={report.id}
                  className={cn(
                    "rounded-xl border bg-white p-5 dark:bg-zinc-900",
                    priority
                      ? "border-red-200 dark:border-red-900/60"
                      : "border-zinc-200 dark:border-zinc-800",
                  )}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#FF5A1F]">
                          Report #{report.id}
                        </span>

                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {reasonLabel(report.reason)}
                        </span>

                        {priority && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-400">
                            Priority review
                          </span>
                        )}

                        {previous > 0 && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                            {previous} prior {previous === 1 ? "report" : "reports"}
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex items-start gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                          <UserRound size={17} className="text-zinc-500" />
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {report.subject_label ??
                              `${report.subject_type} #${report.subject_id}`}
                          </p>

                          <p className="mt-0.5 text-xs text-zinc-500">
                            Reported {report.subject_type} · ID {report.subject_id}
                            {report.subject_account_status
                              ? ` · Account ${report.subject_account_status}`
                              : ""}
                          </p>
                        </div>
                      </div>

                      {report.subject_body && (
                        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                            Reported content
                          </p>
                          {report.subject_body}
                        </div>
                      )}

                      {report.description && (
                        <div className="mt-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                            Reporter description
                          </p>
                          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                            {report.description}
                          </p>
                        </div>
                      )}

                      <div className="mt-4 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                        <div>
                          <span className="font-semibold text-zinc-600 dark:text-zinc-400">
                            Reported by:
                          </span>{" "}
                          {report.reporter_name ?? `User #${report.reporter_user_id}`}
                          {report.reporter_email
                            ? ` · ${report.reporter_email}`
                            : ""}
                        </div>

                        <div className="sm:text-right">
                          <span className="font-semibold text-zinc-600 dark:text-zinc-400">
                            Received:
                          </span>{" "}
                          {formatDate(report.created_at)}
                        </div>
                      </div>
                    </div>

                    <div className="flex w-full flex-wrap gap-2 xl:w-[280px] xl:flex-col">
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => {
                          setNote("");
                          setSelected({
                            report,
                            action: "dismissed",
                          });
                        }}
                      >
                        <CheckCircle2 size={14} className="mr-2" />
                        Dismiss
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => {
                          setNote("");
                          setSelected({
                            report,
                            action: "no_action",
                          });
                        }}
                      >
                        <ShieldCheck size={14} className="mr-2" />
                        No action
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => {
                          setNote("");
                          setSelected({
                            report,
                            action: "warned",
                          });
                        }}
                      >
                        <AlertTriangle size={14} className="mr-2" />
                        Record warning
                      </Button>

                      {report.subject_user_id ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="justify-start"
                          disabled={
                            report.subject_account_status === "suspended"
                          }
                          onClick={() => {
                            setNote("");
                            setSelected({
                              report,
                              action: "suspended",
                            });
                          }}
                        >
                          <Ban size={14} className="mr-2" />
                          {report.subject_account_status === "suspended"
                            ? "Already suspended"
                            : "Suspend account"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={unsuspendTarget !== null}
        onOpenChange={(open) => {
          if (!open && !unsuspendMutation.isPending) {
            setUnsuspendTarget(null);
            setUnsuspendNote("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Unsuspend account</DialogTitle>
          </DialogHeader>

          {unsuspendTarget && (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm font-semibold">
                  {unsuspendTarget.name}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  User #{unsuspendTarget.id}
                  {unsuspendTarget.email
                    ? ` · ${unsuspendTarget.email}`
                    : ""}
                </p>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Restore this account to active status. Existing revoked sessions
                will stay revoked, so the user must sign in again.
              </p>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Moderator note
                </label>
                <Textarea
                  rows={4}
                  value={unsuspendNote}
                  onChange={(event) => setUnsuspendNote(event.target.value)}
                  placeholder="Why is this account being reinstated?"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUnsuspendTarget(null);
                setUnsuspendNote("");
              }}
              disabled={unsuspendMutation.isPending}
            >
              Cancel
            </Button>

            <Button
              disabled={
                !unsuspendTarget ||
                !unsuspendNote.trim() ||
                unsuspendMutation.isPending
              }
              onClick={() => {
                if (!unsuspendTarget) return;

                unsuspendMutation.mutate({
                  userId: unsuspendTarget.id,
                  note: unsuspendNote,
                });
              }}
            >
              {unsuspendMutation.isPending && (
                <Loader2 size={14} className="mr-2 animate-spin" />
              )}
              Unsuspend account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !actionMutation.isPending) {
            setSelected(null);
            setNote("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selected ? actionTitle(selected.action) : "Moderation action"}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm font-semibold">
                  {selected.report.subject_label ??
                    `${selected.report.subject_type} #${selected.report.subject_id}`}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {reasonLabel(selected.report.reason)} · Report #{selected.report.id}
                </p>
              </div>

              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {actionDescription(selected.action)}
              </p>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Moderator note
                </label>
                <Textarea
                  rows={4}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={
                    selected.action === "suspended"
                      ? "Reason for suspension..."
                      : "Why are you taking this action?"
                  }
                />
              </div>

              {selected.action === "warned" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This records the warning decision in moderation history. It
                  does not yet send a separate warning message to the user.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelected(null);
                setNote("");
              }}
              disabled={actionMutation.isPending}
            >
              Cancel
            </Button>

            <Button
              variant={
                selected?.action === "suspended"
                  ? "destructive"
                  : "default"
              }
              disabled={
                !selected ||
                actionMutation.isPending ||
                (selected.action === "suspended" && !note.trim())
              }
              onClick={() => {
                if (!selected) return;

                actionMutation.mutate({
                  report: selected.report,
                  action: selected.action,
                  note,
                });
              }}
            >
              {actionMutation.isPending && (
                <Loader2 size={14} className="mr-2 animate-spin" />
              )}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
