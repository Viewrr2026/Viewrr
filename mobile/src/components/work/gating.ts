import type { ProjectStage, WorkProject } from "@/api/work";

/** UI mirrors server transition checks; the server remains authoritative. */

/** Where the viewer stands in relation to this project. */
export type Party = "client" | "freelancer" | "observer";

export function partyFor(project: WorkProject, viewerId: number): Party {
  if (project.freelancerId === viewerId) return "freelancer";
  if (project.clientId === viewerId) return "client";
  // Admins and anyone else the server lets through are observers: they can see
  // the timeline and never act on it.
  return "observer";
}

/** True for the historical six-stage model (Decision 11). */
export function isLegacyProject(project: WorkProject): boolean {
  return project.planningStatus === "legacy";
}

/** True when the project is a retainer (Decision 12 — out of V1). */
export function isRetainer(project: WorkProject): boolean {
  return project.isRetainer === 1;
}

/**
 * Whether the project itself is in a state that accepts stage transitions at
 * all. A completed, cancelled or soft-deleted project is history.
 */
export function isProjectMutable(project: WorkProject): boolean {
  if (project.deletedAt) return false;
  if (isLegacyProject(project)) return false;
  return project.status === "active" && project.planningStatus === "confirmed";
}

/**
 * Revision allowance is free text with a default of "none" — `revision_allowance text NOT NULL DEFAULT 'none'`.
 * The only claim mobile is entitled to make is "the plan says revisions are
 * included" versus "the plan says none". Counting revisions consumed is not
 * possible: no endpoint reports per-stage change-request counts.
 */
export function allowsRevisions(stage: ProjectStage): boolean {
  const value = stage.revisionAllowance.trim().toLowerCase();
  if (value === "" || value === "none" || value === "0") return false;
  return true;
}

export type StageActionKind = "approve" | "request-changes" | "complete" | "start" | "submit";

export type StageAction = {
  kind: StageActionKind;
  label: string;
  /** Primary = the expected next move for this role. */
  emphasis: "primary" | "secondary";
  /** Shown under the buttons when the action carries a consequence. */
  hint?: string;
};

export type StageGating = {
  /** Actions this viewer may take on this stage right now. */
  actions: StageAction[];
  /**
   * Why there is nothing to do, when that is worth saying. Never speculative:
   * only states mobile can prove from the stage row.
   */
  note: string | null;
  /** True when the stage is the one work is currently sitting on. */
  active: boolean;
};

const ACTIVE_STATUSES = new Set(["in_progress", "awaiting_client", "changes_requested"]);

/** Role-specific actions. The screen and server also check stage order. */
export function gateStage(
  project: WorkProject,
  stage: ProjectStage,
  party: Party,
): StageGating {
  const active = ACTIVE_STATUSES.has(stage.status);
  const approvalRequired = stage.approvalRequired === 1;

  if (!isProjectMutable(project) || party === "observer" || isRetainer(project)) {
    return { actions: [], note: null, active };
  }

  if (party === "client") {
    if (stage.status !== "awaiting_client") {
      return { actions: [], note: null, active };
    }

    const actions: StageAction[] = [
      {
        kind: "approve",
        label: "Approve stage",
        emphasis: "primary",
        hint: "This tells your creative the stage is signed off.",
      },
    ];

    if (allowsRevisions(stage)) {
      actions.push({
        kind: "request-changes",
        label: "Request changes",
        emphasis: "secondary",
      });
      return {
        actions,
        note: `Revisions on this stage: ${stage.revisionAllowance}.`,
        active,
      };
    }

    return {
      actions,
      note: "The agreed plan includes no revisions on this stage. Message your creative to discuss changes.",
      active,
    };
  }

  // Freelancer.
  if (stage.status === "awaiting_client") {
    return {
      actions: [],
      note: "Submitted for client review. Waiting on their approval.",
      active,
    };
  }

  if (stage.status === "approved") return { actions: [], note: "Approved by your client.", active };
  if (stage.status === "upcoming") return { actions: [{ kind: "start", label: "Start stage", emphasis: "primary" }], note: null, active };
  if (stage.status === "in_progress" || stage.status === "changes_requested") {
    if (approvalRequired) {
      return { actions: [{ kind: "submit", label: "Submit for client review", emphasis: "primary" }],
        note: "Share your work in Deliverables before submitting this stage.", active };
    }

    return {
      actions: [
        {
          kind: "complete",
          label: "Mark stage complete",
          emphasis: "primary",
          hint: "No client approval is required on this stage.",
        },
      ],
      note: null,
      active,
    };
  }

  return { actions: [], note: null, active };
}

/* ── Legacy six-stage model (Decision 11) ────────────────────────────────── */

/**
 * The historical stage vocabulary, copied verbatim from the server's own array
 * in `POST /api/projects/:id/advance` so a legacy project reads on mobile
 * exactly as it does on web.
 */
export const LEGACY_STAGES: readonly string[] = [
  "Brief & Kick-off",
  "Pre-production",
  "Production",
  "First Delivery",
  "Revisions",
  "Final Delivery",
] as const;

export type LegacyStageRow = {
  index: number;
  title: string;
  status: "completed" | "in_progress" | "upcoming";
};

/**
 * Render-only projection of `projects.currentStage`. There is no action on any
 * of these rows: advancing a legacy project is a web operation.
 */
export function legacyStageRows(project: WorkProject): LegacyStageRow[] {
  const current = Number.isFinite(project.currentStage) ? project.currentStage : 0;
  const finished = project.status === "completed";

  return LEGACY_STAGES.map((title, index) => ({
    index,
    title,
    status: finished || index < current ? "completed" : index === current ? "in_progress" : "upcoming",
  }));
}

/* ── List sectioning ─────────────────────────────────────────────────────── */

export type WorkSection = "active" | "awaiting_payment" | "completed";

/**
 * Which section of the Work list a project belongs to.
 *
 * "Awaiting payment" is finished work that has not been paid: the project is
 * complete but `paymentStatus` is not "paid". It is a section rather than a
 * badge because it is the one state where a client has something to do and a
 * creative has something to chase.
 *
 * Cancelled work falls under "completed" — it is closed, and hiding it would
 * lose it entirely.
 */
export function sectionFor(project: WorkProject): WorkSection {
  const paid = project.paymentStatus === "paid";
  const closed = project.status === "completed" || project.status === "cancelled";

  if (project.status === "completed" && !paid) return "awaiting_payment";
  if (closed) return "completed";
  return "active";
}
