import { api } from "@/api/client";
import type { Brief, BriefInterest, PublicUser } from "@/api/types";

/**
 * Work's data layer — projects, dynamic stages, activity, deliverables, briefs.
 *
 * Every shape and path here is the frozen PRD 1 contract (CONTRACT.md § D), not
 * an inference from today's server. Where the contract and the shipped server
 * differ, the contract wins and the difference is noted in a comment so the
 * behaviour is auditable rather than accidental.
 *
 * Boundaries this module holds:
 *   • `api/types.ts` and `api/client.ts` are read-only for every agent, so all
 *     new Work types are declared and exported HERE.
 *   • No URL is written by hand. `api/client.ts` joins everything onto
 *     `config/env.ts`'s absolute base.
 *   • `GET /api/projects` no longer takes `?userId=` — the party is derived
 *     from the session server-side (contract § D). Sending an id would be both
 *     redundant and a way to ask for someone else's work.
 *   • Payment mutation endpoints (`POST /api/projects/:id/confirm-payment`,
 *     `PATCH /api/invoices/:id/paid`) are DELIBERATELY ABSENT. Payment state is
 *     read-only on mobile; the real money path is web Stripe. There is no
 *     function here that a screen could call to fake a payment.
 */

/* ── Project shapes ───────────────────────────────────────────────────────── */

/**
 * `projects` row as it arrives inside a ProjectWithDetails. Only the columns
 * mobile renders are declared; the server sends the whole row.
 *
 * `planningStatus` is the PRD-014 discriminator:
 *   "legacy"            — historical six-stage model, READ-ONLY on mobile
 *                         (Decision 11)
 *   "planning_required" | "plan_draft" | "awaiting_client" | "client_changes"
 *                       — the plan itself is still being agreed (web-only flow)
 *   "confirmed"         — dynamic `project_stages` are live
 */
export type WorkProject = {
  id: number;
  clientId: number;
  freelancerId: number;
  title: string;
  description: string;
  /** "active" | "completed" | "cancelled" | "paused" */
  status: string;
  /** Legacy 0–5 stage index. Meaningless when planningStatus !== "legacy". */
  currentStage: number;
  freelancerName: string | null;
  clientName: string | null;
  briefCategory: string | null;
  /** "unpaid" | "paid" — nullable in the database. */
  paymentStatus: string | null;
  /** 0 | 1 — retainers are out of mobile V1 (Decision 12). */
  isRetainer: number | null;
  billingCycle?: string | null;
  deliverablesPerCycle?: string | null;
  totalCycles?: number | null;
  currentCycleNumber?: number | null;
  agreedAmountPence: number | null;
  briefId?: number | null;
  interestId?: number | null;
  planningStatus: string;
  planConfirmedAt?: string | null;
  planSentToClientAt?: string | null;
  createdAt: string;
  completedAt: string | null;
  deletedAt?: string | null;
};

/** GET /api/projects and GET /api/projects/:id — storage.ProjectWithDetails. */
export type WorkProjectDetail = {
  project: WorkProject;
  client: PublicUser;
  freelancer: PublicUser;
  /** `{ update, author }[]`; mobile reads activity from /activity instead. */
  updates: unknown[];
};

/** One `project_stages` row (PRD-014). Booleans arrive as 0 | 1. */
export type ProjectStage = {
  id: number;
  projectId: number;
  position: number;
  title: string;
  description: string | null;
  expectedDeliverable: string | null;
  targetDate: string | null;
  /** 0 | 1 — the client must approve before this stage can complete. */
  approvalRequired: number;
  /** Free text, default "none". Never validated server-side. */
  revisionAllowance: string;
  /** upcoming | in_progress | awaiting_client | changes_requested | approved | completed */
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  createdBy: number;
  updatedAt: string | null;
  notes: string | null;
  clientChangeRequest: string | null;
};

/** GET /api/projects/:id/plan-summary. `progress` is 0–100, computed server-side. */
export type PlanSummary = {
  planningStatus: string;
  planConfirmedAt: string | null;
  planSentToClientAt: string | null;
  stages: ProjectStage[];
  activeStage: ProjectStage | null;
  progress: number;
  stageCount: number;
};

/**
 * GET /api/projects/:id/updates — `{ update, author }[]`.
 *
 * `update.stage` is the LEGACY 0–5 index and cannot be correlated with a
 * dynamic `project_stages.id`. It is never used to place an update against a
 * stage; see the activity feed.
 */
export type ProjectUpdateEntry = {
  update: {
    id: number;
    projectId: number;
    authorId: number;
    stage: number;
    note: string;
    createdAt: string;
  };
  author: PublicUser;
};

/** The Stage 1 public allow-list author (contract § D). */
export type PublicAuthor = {
  id: number;
  name: string;
  avatar: string | null;
  headline: string | null;
  location: string | null;
  role: string;
};

/**
 * GET /api/projects/:id/activity — merged stage events + project updates,
 * newest first, server-ordered.
 *
 * `stageLabel` is present only when the server could name the stage. Mobile
 * never derives it from `project_updates.stage`.
 */
export type ActivityEntry = {
  id: string;
  kind: "stage_event" | "update";
  at: string;
  actor: PublicAuthor | null;
  title: string;
  body: string;
  stageLabel?: string;
};

/**
 * GET /api/projects/:id/deliverables — GATED (Decision 10).
 *
 * When `locked` is true the server OMITS `url` and `embedUrl` entirely. There
 * is nothing to reconstruct client-side and no attempt is made to: the lock is
 * a real server-side projection gate, not the web CSS watermark.
 */
export type Deliverable = {
  id: number;
  label: string;
  platform: string;
  locked: boolean;
  url?: string;
  embedUrl?: string;
  lockReason?: "awaiting_payment";
};

/* ── Brief shapes ─────────────────────────────────────────────────────────── */

export type { Brief, BriefInterest };

/** One message on an interest thread (Decision 17 — Brief/Work context only). */
export type InterestMessage = {
  id: number;
  fromId: number;
  toId: number;
  content: string;
  read: number | null;
  interestId: number | null;
  createdAt: string;
};

/* ── Reads: projects ──────────────────────────────────────────────────────── */

/**
 * Every project the signed-in user is a party to.
 *
 * No `userId` query parameter (contract § D): the server derives the party from
 * the session. Passing an id here would be a way to request another user's
 * workspace, which is exactly the hole the contract closes.
 */
export function loadProjects(signal?: AbortSignal): Promise<WorkProjectDetail[]> {
  return api.get<WorkProjectDetail[]>("/api/projects", { signal });
}

export function loadProject(
  projectId: number,
  signal?: AbortSignal,
): Promise<WorkProjectDetail> {
  return api.get<WorkProjectDetail>(`/api/projects/${projectId}`, { signal });
}

export function loadStages(
  projectId: number,
  signal?: AbortSignal,
): Promise<ProjectStage[]> {
  return api.get<ProjectStage[]>(`/api/projects/${projectId}/stages`, { signal });
}

export function loadPlanSummary(
  projectId: number,
  signal?: AbortSignal,
): Promise<PlanSummary> {
  return api.get<PlanSummary>(`/api/projects/${projectId}/plan-summary`, { signal });
}

export function loadUpdates(
  projectId: number,
  signal?: AbortSignal,
): Promise<ProjectUpdateEntry[]> {
  return api.get<ProjectUpdateEntry[]>(`/api/projects/${projectId}/updates`, { signal });
}

export function loadActivity(
  projectId: number,
  signal?: AbortSignal,
): Promise<ActivityEntry[]> {
  return api.get<ActivityEntry[]>(`/api/projects/${projectId}/activity`, { signal });
}

export function loadDeliverables(
  projectId: number,
  signal?: AbortSignal,
): Promise<Deliverable[]> {
  return api.get<Deliverable[]>(`/api/projects/${projectId}/deliverables`, { signal });
}

/* ── Reads: briefs and interests ──────────────────────────────────────────── */

/** Briefs are paginated server-side: limit default 50, hard max 200. */
export const BRIEF_PAGE_SIZE = 50;

export function loadBriefs(
  options: { clientId?: number; category?: string; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<Brief[]> {
  const { clientId, category, limit = BRIEF_PAGE_SIZE, offset = 0 } = options;
  return api.get<Brief[]>("/api/briefs", {
    query: {
      clientId,
      category: category && category !== "All" ? category : undefined,
      limit,
      offset,
    },
    signal,
  });
}

export function loadBrief(briefId: number, signal?: AbortSignal): Promise<Brief> {
  return api.get<Brief>(`/api/briefs/${briefId}`, { signal });
}

/**
 * Interests a creative has submitted.
 *
 * There is no `GET /api/briefs/:id/interests` endpoint, so per-brief applicants
 * are obtained by filtering the party-scoped list. Mobile only ever asks for
 * the signed-in user's own id.
 */
export function loadInterestsForFreelancer(
  freelancerId: number,
  signal?: AbortSignal,
): Promise<BriefInterest[]> {
  return api.get<BriefInterest[]>(`/api/interests/freelancer/${freelancerId}`, { signal });
}

/** Interests received by a client across all of their briefs. */
export function loadInterestsForClient(
  clientId: number,
  signal?: AbortSignal,
): Promise<BriefInterest[]> {
  return api.get<BriefInterest[]>(`/api/interests/client/${clientId}`, { signal });
}

/**
 * One interest / negotiation thread.
 *
 * Contract § D replaces the unauthenticated `GET /api/interest-messages/:id`
 * with this brief-scoped, participant-checked route. Interest threads live in
 * Brief/Work context and are excluded from the DM inbox (Decision 17).
 */
export function loadInterestMessages(
  briefId: number,
  interestId: number,
  signal?: AbortSignal,
): Promise<InterestMessage[]> {
  return api.get<InterestMessage[]>(
    `/api/briefs/${briefId}/interest-messages/${interestId}`,
    { signal },
  );
}

/* ── Mutations: stage transitions ─────────────────────────────────────────── */

/**
 * The three project-scoped stage transitions (contract § D).
 *
 * The server does NOT validate transition legality and does NOT enforce
 * `approvalRequired` or `revisionAllowance` — it checks only that the caller is
 * the right party. Legality is therefore gated in the client before any of
 * these is offered; see `components/work/gating.ts`, which is the single place
 * that decides what a given role may do to a given stage.
 *
 * None of these may be called for a project whose `planningStatus` is
 * "legacy" (Decision 11). The gating module refuses that case.
 */
export function approveStage(
  projectId: number,
  stageId: number,
  signal?: AbortSignal,
): Promise<ProjectStage> {
  return api.post<ProjectStage>(
    `/api/projects/${projectId}/stages/${stageId}/approve`,
    undefined,
    { signal },
  );
}

export function completeStage(
  projectId: number,
  stageId: number,
  signal?: AbortSignal,
): Promise<ProjectStage> {
  return api.post<ProjectStage>(
    `/api/projects/${projectId}/stages/${stageId}/complete`,
    undefined,
    { signal },
  );
}

export function requestStageChanges(
  projectId: number,
  stageId: number,
  message: string,
  signal?: AbortSignal,
): Promise<ProjectStage> {
  return api.post<ProjectStage>(
    `/api/projects/${projectId}/stages/${stageId}/request-changes`,
    { message },
    { signal },
  );
}

/**
 * Legacy six-stage advance (contract § D).
 *
 * Declared for contract completeness and NOT surfaced by any mobile screen:
 * `POST /api/projects/:id/advance` mutates the historical `currentStage`
 * counter, and Decision 11 makes legacy timelines read-only on mobile. Any
 * future caller must first establish that a legacy mutation is wanted.
 */
export function advanceProject(
  projectId: number,
  note?: string,
  signal?: AbortSignal,
): Promise<WorkProjectDetail> {
  return api.post<WorkProjectDetail>(
    `/api/projects/${projectId}/advance`,
    { note: note ?? "" },
    { signal },
  );
}

/* ── Composite loaders ───────────────────────────────────────────────────── */

/**
 * A read that may fail without failing the screen.
 *
 * Project detail aggregates four independent resources. A 500 on deliverables
 * should hide the deliverables card, not blank the project — but the project
 * read itself stays hard, because without it nothing on screen is true.
 */
async function optional<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export type ProjectDetailSnapshot = {
  detail: WorkProjectDetail;
  /** Null when the plan summary could not be read. */
  plan: PlanSummary | null;
  deliverables: Deliverable[];
  /** Null when deliverables could not be read — distinct from "none exist". */
  deliverablesFailed: boolean;
};

export async function loadProjectDetail(
  projectId: number,
  signal?: AbortSignal,
): Promise<ProjectDetailSnapshot> {
  const detail = await loadProject(projectId, signal);

  const [plan, deliverables] = await Promise.all([
    optional(loadPlanSummary(projectId, signal), null as PlanSummary | null),
    optional(loadDeliverables(projectId, signal), null as Deliverable[] | null),
  ]);

  return {
    detail,
    plan,
    deliverables: deliverables ?? [],
    deliverablesFailed: deliverables === null,
  };
}

export type StagesSnapshot = {
  detail: WorkProjectDetail;
  stages: ProjectStage[];
  /** Server-computed progress when the plan summary was readable. */
  progress: number | null;
};

/**
 * Stages screen snapshot.
 *
 * `plan-summary` already returns the stage list plus server-computed progress,
 * so it is the primary read; `/stages` is the fallback when the summary fails,
 * and then progress is reported as null rather than recomputed and presented as
 * if it came from the server.
 */
export async function loadStagesSnapshot(
  projectId: number,
  signal?: AbortSignal,
): Promise<StagesSnapshot> {
  const [detail, plan] = await Promise.all([
    loadProject(projectId, signal),
    optional(loadPlanSummary(projectId, signal), null as PlanSummary | null),
  ]);

  if (plan) {
    return { detail, stages: plan.stages, progress: plan.progress };
  }

  const stages = await optional(loadStages(projectId, signal), [] as ProjectStage[]);
  return { detail, stages, progress: null };
}

export type BriefDetailSnapshot = {
  brief: Brief;
  /**
   * Interests visible to the viewer: every applicant for the brief's owner, the
   * viewer's own interest for a creative. Empty for anyone else — there is no
   * endpoint that would expose more, and none is improvised.
   */
  interests: BriefInterest[];
  /** True when the interest read failed, so "none" is not claimed falsely. */
  interestsFailed: boolean;
};

export async function loadBriefDetail(
  briefId: number,
  viewer: { id: number; role: "client" | "freelancer" | "admin" },
  signal?: AbortSignal,
): Promise<BriefDetailSnapshot> {
  const brief = await loadBrief(briefId, signal);

  const owner = brief.clientId === viewer.id;
  const source = owner
    ? loadInterestsForClient(viewer.id, signal)
    : viewer.role === "freelancer"
      ? loadInterestsForFreelancer(viewer.id, signal)
      : null;

  if (!source) {
    return { brief, interests: [], interestsFailed: false };
  }

  const rows = await optional(source, null as BriefInterest[] | null);

  return {
    brief,
    interests: (rows ?? []).filter((row) => row.briefId === briefId),
    interestsFailed: rows === null,
  };
}
