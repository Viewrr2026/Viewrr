import { api } from "@/api/client";

/**
 * Trust and safety: blocking and reporting.
 *
 * Contract (PRD-1 section D):
 *   POST   /api/me/block/:userId   -> { ok }
 *   DELETE /api/me/block/:userId   -> { ok }
 *   GET    /api/me/blocks          -> BlockedUser[]   (hydrated)
 *   POST   /api/reports            -> { reportId }
 *
 * The report vocabulary is the server's own enum, transcribed rather than
 * guessed: subject types user | profile | post | message | brief | project and
 * reasons spam | harassment | fake | inappropriate | other.
 */

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "fake",
  "inappropriate",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment or abuse",
  fake: "Fake or impersonation",
  inappropriate: "Inappropriate content",
  other: "Something else",
};

export type ReportSubjectType = "user" | "profile" | "post" | "message" | "brief" | "project";

/** One row of GET /api/me/blocks after the additive hydration. */
export type BlockedUser = {
  userId: number;
  /** Null when the server could not hydrate a name. Never substituted with a guess. */
  name: string | null;
  avatar: string | null;
  headline: string | null;
  blockedAt: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asUserId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * Accepts the contract shape (an array of hydrated rows) and also the legacy
 * `{ blockedIds: number[] }` body that production still returns until the
 * backend agent lands the hydration. In the legacy case the row keeps a null
 * name — the screen then shows the account id rather than inventing a person.
 */
function normaliseBlocks(raw: unknown): BlockedUser[] {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { blockedIds?: unknown })?.blockedIds)
      ? ((raw as { blockedIds: unknown[] }).blockedIds)
      : [];

  return rows.flatMap((entry) => {
    if (typeof entry === "number") {
      return [{ userId: entry, name: null, avatar: null, headline: null, blockedAt: null }];
    }
    const row = entry as Record<string, unknown> | null;
    const userId = asUserId(row?.userId ?? row?.id);
    if (userId === null) return [];
    return [
      {
        userId,
        name: asString(row?.name),
        avatar: asString(row?.avatar),
        headline: asString(row?.headline),
        blockedAt: asString(row?.blockedAt),
      },
    ];
  });
}

export async function fetchBlockedUsers(signal?: AbortSignal): Promise<BlockedUser[]> {
  const raw = await api.get<unknown>("/api/me/blocks", { signal });
  return normaliseBlocks(raw);
}

export function blockUser(userId: number) {
  return api.post<{ ok?: boolean }>(`/api/me/block/${userId}`);
}

export function unblockUser(userId: number) {
  return api.delete<{ ok?: boolean }>(`/api/me/block/${userId}`);
}

export type SubmitReportInput = {
  subjectType: ReportSubjectType;
  subjectId: number;
  reason: ReportReason;
  /** Optional free text. Trimmed by the caller; empty strings are not sent. */
  description?: string;
};

export function submitReport(input: SubmitReportInput) {
  const body: Record<string, unknown> = {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    reason: input.reason,
  };
  const description = input.description?.trim();
  if (description) body.description = description;
  return api.post<{ ok?: boolean; reportId?: number }>("/api/reports", body);
}
