/**
 * PRD-012 — Retainer Builder server routes + Founder metrics.
 *
 * Express routes for building, sending, accepting, and running retainer
 * agreements (multi-step retainer proposal builder + ongoing workspace).
 *
 * Conventions followed:
 * - Raw neon() tagged-template SQL only (Drizzle is pinned to 0.43.1, not used here).
 * - PRD-018: No req.body.userId for identity. requireAuth sets req.auth!.userId.
 * - All monetary amounts are integers in pence.
 * - Public IDs follow `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`.
 */

import type { Express } from "express";
import { neon } from "@neondatabase/serverless";
import { requireAuth, requireAdminGuard } from "./auth-middleware";

const FOUNDER_USER_ID = 22;

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

function makePublicId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function asJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

/**
 * Calculate a cycle's period_end (ISO date string) from a period_start and
 * a billing frequency.
 */
function calculatePeriodEnd(periodStart: string, billingFrequency: string): string {
  const start = new Date(periodStart);
  const end = new Date(start);
  switch (billingFrequency) {
    case "weekly":
      end.setDate(end.getDate() + 7);
      break;
    case "fortnightly":
      end.setDate(end.getDate() + 14);
      break;
    case "quarterly":
      end.setMonth(end.getMonth() + 3);
      break;
    case "monthly":
    default:
      end.setMonth(end.getMonth() + 1);
      break;
  }
  end.setDate(end.getDate() - 1);
  return end.toISOString().slice(0, 10);
}

async function loadUser(db: ReturnType<typeof neon>, userId: number) {
  const rows = await db`SELECT * FROM users WHERE id = ${userId} LIMIT 1`;
  return rows[0] ?? null;
}

async function insertNotification(
  db: ReturnType<typeof neon>,
  params: {
    recipientId: number;
    actorId: number;
    actorName: string;
    type: string;
    message: string;
    link?: string | null;
  }
) {
  await db`
    INSERT INTO notifications (recipient_id, actor_id, actor_name, type, message, link)
    VALUES (${params.recipientId}, ${params.actorId}, ${params.actorName}, ${params.type}, ${params.message}, ${params.link ?? null})
  `;
}

function parseWorkItemStages(raw: any): string[] {
  try {
    const parsed =
      typeof raw === "string"
        ? JSON.parse(raw)
        : raw;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((stage: any) =>
        typeof stage === "string"
          ? stage
          : stage?.name ??
            stage?.title ??
            stage?.label
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findFinalApprovalStageIndex(
  stages: string[],
): number {
  return Math.max(
    0,
    stages.length - 1,
  );
}

function findRevisionStageIndex(
  stages: string[],
  reviewIndex: number,
): number {
  const index = stages.findIndex((stage) =>
    String(stage)
      .toLowerCase()
      .includes("revision"),
  );

  if (index >= 0) {
    return index;
  }

  return Math.max(
    0,
    reviewIndex - 1,
  );
}

async function loadRetainerWorkItem(
  db: any,
  agreementPublicId: string,
  taskPublicId: string,
) {
  const rows = await db`
    SELECT
      rct.*,
      rc.retainer_agreement_id,
      ra.client_id,
      ra.freelancer_id,
      ra.project_id
    FROM retainer_cycle_tasks rct
    JOIN retainer_cycles rc
      ON rc.id = rct.retainer_cycle_id
    JOIN retainer_agreements ra
      ON ra.id = rc.retainer_agreement_id
    WHERE rct.public_id = ${taskPublicId}
      AND ra.public_id = ${agreementPublicId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function createCycleWorkItems(
  db: any,
  agreementId: number,
  cycleId: number,
  nowIso: string,
): Promise<void> {
  const deliverables = await db`
    SELECT *
    FROM retainer_deliverables
    WHERE retainer_agreement_id = ${agreementId}
      AND item_type = 'included'
    ORDER BY sort_order ASC, id ASC
  `;

  const workstreams = await db`
    SELECT *
    FROM retainer_workstreams
    WHERE retainer_agreement_id = ${agreementId}
    ORDER BY is_default DESC, sort_order ASC, id ASC
  `;

  const workflow = workstreams[0];
  let stages: string[] = [];

  if (workflow?.stages) {
    try {
      const parsed =
        typeof workflow.stages === "string"
          ? JSON.parse(workflow.stages)
          : workflow.stages;

      if (Array.isArray(parsed)) {
        stages = parsed
          .map((stage: any) =>
            typeof stage === "string"
              ? stage
              : stage?.name ?? stage?.title ?? stage?.label
          )
          .filter(Boolean);
      }
    } catch {}
  }

  if (!stages.length) {
    stages = [
      "Brief / Requests",
      "Production",
      "Client Review",
      "Revisions",
      "Approved",
      "Complete",
    ];
  }

  let sortOrder = 0;

  for (const deliverable of deliverables) {
    const quantity = Math.max(0, Number(deliverable.quantity ?? 0));

    for (let index = 0; index < quantity; index += 1) {
      const itemNumber = index + 1;

      const title =
        quantity > 1
          ? `${deliverable.name} ${String(itemNumber).padStart(2, "0")}`
          : deliverable.name;

      await db`
        INSERT INTO retainer_cycle_tasks (
          public_id,
          retainer_cycle_id,
          retainer_deliverable_id,
          title,
          status,
          stage,
          stage_index,
          stages,
          item_number,
          sort_order,
          recurs_each_cycle,
          created_at
        ) VALUES (
          ${makePublicId("rct")},
          ${cycleId},
          ${deliverable.id},
          ${title},
          'in_progress',
          ${stages[0]},
          0,
          ${asJson(stages)},
          ${itemNumber},
          ${sortOrder},
          true,
          ${nowIso}
        )
      `;

      sortOrder += 1;
    }
  }
}

export function registerRetainerBuilderRoutes(app: Express): void {
  // ─── POST /api/retainer-builder/create ────────────────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.post("/api/retainer-builder/create", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const userId = req.auth!.userId;
      const {
        templateIds,
        commercialModel,
        goal,
        successMeasures,
        keyChannels,
        priorityOutcomes,
        deliverables,
        workflowStages,
        startDate,
        billingFrequency,
        amountPerCyclePence,
        minimumTermCycles,
        renewalMode,
        noticePeriodCycles,
        introPrice,
        introCycles,
        setupFeePence,
        maxRevisions,
        responseTimeHours,
        clientInputDeadlineDays,
        excludedWork,
        recipientUserId,
        title,
      } = req.body ?? {};

      if (!recipientUserId) return res.status(400).json({ error: "recipientUserId is required" });
      if (!billingFrequency) return res.status(400).json({ error: "billingFrequency is required" });
      if (!Number.isFinite(Number(amountPerCyclePence))) {
        return res.status(400).json({ error: "amountPerCyclePence is required" });
      }

      const requester = await loadUser(db, Number(userId));
      if (!requester) return res.status(404).json({ error: "User not found" });

      const recipient = await loadUser(db, Number(recipientUserId));
      if (!recipient) return res.status(404).json({ error: "Recipient not found" });

      // Determine roles: freelancer sends proposal to a client, or a client sends
      // an invite to a freelancer. Default assumption — sender's role decides.
      const isFreelancerSending = requester.role === "freelancer";
      const freelancerId = isFreelancerSending ? Number(userId) : Number(recipientUserId);
      const clientId = isFreelancerSending ? Number(recipientUserId) : Number(userId);
      const freelancerName = isFreelancerSending ? requester.name : recipient.name;
      const clientName = isFreelancerSending ? recipient.name : requester.name;

      const templateCategory =
        Array.isArray(templateIds) && templateIds.length > 0
          ? String(templateIds[0])
          : null;

      let templateDbId: number | null = null;
      if (templateCategory) {
        const templateRows = await db`
          SELECT id
          FROM retainer_templates
          WHERE category = ${templateCategory}
          ORDER BY is_system DESC, id ASC
          LIMIT 1
        `;
        templateDbId = templateRows[0]?.id ?? null;
      }

      const agreementTitle: string = title || goal || "Retainer proposal";

      const projectPublicId = makePublicId("proj");
      const retainerPublicId = makePublicId("ret");
      const agreementPublicId = makePublicId("ra");

      const nowIso = new Date().toISOString();

      const projectRows = await db`
        INSERT INTO projects (
          client_id, freelancer_id, title, description, status,
          current_stage, freelancer_name, client_name, is_retainer,
          billing_cycle, created_at
        ) VALUES (
          ${clientId}, ${freelancerId}, ${agreementTitle}, ${goal ?? ""}, 'draft',
          0, ${freelancerName ?? null}, ${clientName ?? null}, 1,
          ${billingFrequency}, ${nowIso}
        )
        RETURNING id
      `;
      const projectId = projectRows[0].id;

      const agreementRows = await db`
        INSERT INTO retainer_agreements (
          public_id, project_id, client_id, freelancer_id, title,
          template_id, commercial_model,
          retainer_goal, success_measures, key_channels, priority_outcomes,
          start_date, billing_frequency, agreed_cycle_amount_pence,
          minimum_term_cycles, renewal_mode, notice_period_cycles,
          intro_price_pence, intro_cycles, setup_fee_pence, max_revisions,
          response_time_hours, client_input_deadline_days, excluded_work,
          draft_step, status, proposal_sent_at, created_at
        ) VALUES (
          ${agreementPublicId}, ${projectId}, ${clientId}, ${freelancerId}, ${agreementTitle},
          ${templateDbId}, ${commercialModel ?? null},
          ${goal ?? null}, ${successMeasures ?? null}, ${asJson(keyChannels)}, ${asJson(priorityOutcomes)},
          ${startDate ?? null}, ${billingFrequency}, ${Number(amountPerCyclePence)},
          ${minimumTermCycles ?? null}, ${renewalMode ?? null}, ${noticePeriodCycles ?? null},
          ${introPrice ?? null}, ${introCycles ?? null}, ${setupFeePence ?? null}, ${maxRevisions ?? null},
          ${responseTimeHours ?? null}, ${clientInputDeadlineDays ?? null}, ${excludedWork ?? null},
          8, 'awaiting_client_acceptance', ${nowIso}, ${nowIso}
        )
        RETURNING id, public_id
      `;
      const agreement = agreementRows[0];
      const retainerAgreementId = agreement.id;

      let deliverableIds: number[] = [];
      if (Array.isArray(deliverables) && deliverables.length > 0) {
        for (const [index, item] of deliverables.entries()) {
          const d = typeof item === "string" ? { name: item } : item;
          const row = await db`
            INSERT INTO retainer_deliverables (
              public_id, retainer_agreement_id, name, quantity, frequency,
              turnaround_days, rollover_rule, item_type, sort_order
            ) VALUES (
              ${makePublicId("del")},
              ${retainerAgreementId},
              ${d.name ?? d.title ?? "Deliverable"},
              ${Number(d.quantity ?? 1)},
              ${d.frequency ?? "per_cycle"},
              ${d.turnaroundDays ?? null},
              ${d.rollover ?? "none"},
              ${d.type ?? "included"},
              ${index}
            )
            RETURNING id
          `;
          deliverableIds.push(row[0].id);
        }
      }

      const workstreamRows = await db`
        INSERT INTO retainer_workstreams (
          public_id, retainer_agreement_id, name, stages, is_default
        ) VALUES (
          ${makePublicId("ws")},
          ${retainerAgreementId},
          'Default workflow',
          ${asJson(workflowStages ?? [])},
          true
        )
        RETURNING id
      `;
      const workstreamId = workstreamRows[0].id;

      const fullSnapshot = {
        title: agreementTitle,
        templateIds, commercialModel, goal, successMeasures, keyChannels,
        priorityOutcomes, deliverables, workflowStages, startDate,
        billingFrequency, amountPerCyclePence, minimumTermCycles, renewalMode,
        noticePeriodCycles, introPrice, introCycles, setupFeePence, maxRevisions,
        responseTimeHours, clientInputDeadlineDays, excludedWork,
      };

      await db`
        INSERT INTO retainer_agreement_versions (
          public_id, retainer_agreement_id, version_number, snapshot, created_by, created_at
        ) VALUES (
          ${makePublicId("rav")}, ${retainerAgreementId}, 1, ${asJson(fullSnapshot)}, ${Number(userId)}, ${nowIso}
        )
      `;

      await insertNotification(db, {
        recipientId: Number(recipientUserId),
        actorId: Number(userId),
        actorName: requester?.name ?? "A user",
        type: "retainer_proposal",
        message: `${requester?.name ?? "Someone"} has sent you a retainer proposal: ${agreementTitle}`,
        link: `/retainer/${agreement.public_id}`,
      });

      res.json({
        projectPublicId,
        retainerPublicId,
        agreementPublicId: agreement.public_id,
      });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to create retainer proposal" });
    }
  });

  // ─── GET /api/projects/:projectId/retainer-agreement ─────────────────────
  app.get(
    "/api/projects/:projectId/retainer-agreement",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const projectId = Number(req.params.projectId);
        const userId = req.auth!.userId;

        if (!Number.isFinite(projectId)) {
          return res.status(400).json({
            error: "Invalid project id",
          });
        }

        const rows = await db`
          SELECT
            ra.public_id,
            ra.status,
            p.client_id,
            p.freelancer_id
          FROM retainer_agreements ra
          JOIN projects p
            ON p.id = ra.project_id
          WHERE ra.project_id = ${projectId}
          ORDER BY ra.id DESC
          LIMIT 1
        `;

        if (!rows.length) {
          return res.status(404).json({
            error: "Retainer agreement not found",
          });
        }

        const agreement = rows[0];

        if (
          Number(userId) !== Number(agreement.client_id) &&
          Number(userId) !== Number(agreement.freelancer_id)
        ) {
          return res.status(403).json({
            error: "You do not have access to this retainer",
          });
        }

        res.json({
          publicId: agreement.public_id,
          status: agreement.status,
        });
      } catch (e: any) {
        const status = e?.status ?? 500;

        res.status(status).json({
          error:
            e.message ??
            "Failed to resolve retainer agreement",
        });
      }
    },
  );

  // ─── GET /api/retainer/:publicId/workspace ────────────────────────────────
  app.get(
    "/api/retainer/:publicId/workspace",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const { publicId } = req.params;
        const userId = req.auth!.userId;

      const rows = await db`
        SELECT ra.*, p.title as project_title, p.client_id, p.freelancer_id,
               u_client.name as client_name,
               u_freelancer.name as freelancer_name,
               rt.name as template_label
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        JOIN users u_client ON u_client.id = p.client_id
        JOIN users u_freelancer ON u_freelancer.id = p.freelancer_id
        LEFT JOIN retainer_templates rt ON rt.id = ra.template_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
        if (!rows.length) {
          return res.status(404).json({
            error: "Retainer agreement not found",
          });
        }

        const agreement = rows[0];

        if (
          Number(userId) !== Number(agreement.client_id) &&
          Number(userId) !== Number(agreement.freelancer_id)
        ) {
          return res.status(403).json({
            error: "You do not have access to this retainer",
          });
        }

        const [
          cycles,
          deliverables,
          workstreams,
          requests,
          usageEntries,
          tasks,
          amendments,
        ] = await Promise.all([
        db`SELECT * FROM retainer_cycles WHERE retainer_agreement_id = ${agreement.id} ORDER BY cycle_number ASC`,
        db`SELECT * FROM retainer_deliverables WHERE retainer_agreement_id = ${agreement.id} ORDER BY id ASC`,
        db`SELECT * FROM retainer_workstreams WHERE retainer_agreement_id = ${agreement.id} ORDER BY id ASC`,
        db`SELECT * FROM retainer_requests WHERE retainer_agreement_id = ${agreement.id} ORDER BY created_at DESC`,
        db`SELECT * FROM retainer_usage_entries WHERE retainer_agreement_id = ${agreement.id} ORDER BY recorded_at DESC`,
        db`
          SELECT rct.* FROM retainer_cycle_tasks rct
          JOIN retainer_cycles rc ON rc.id = rct.retainer_cycle_id
          WHERE rc.retainer_agreement_id = ${agreement.id}
          ORDER BY rct.id ASC
        `,
        db`SELECT * FROM retainer_amendments WHERE retainer_agreement_id = ${agreement.id} ORDER BY created_at DESC`,
      ]);

      const parseArray = (value: any): any[] => {
        if (Array.isArray(value)) return value;

        if (typeof value !== "string") {
          return [];
        }

        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      const workflowStages = workstreams
        .flatMap((workstream: any) =>
          parseArray(workstream.stages)
            .map((stage: any) =>
              typeof stage === "string"
                ? stage
                : stage?.name ??
                  stage?.title ??
                  stage?.label
            )
            .filter(Boolean)
        );

      const currentCycleRaw =
        [...cycles]
          .reverse()
          .find((cycle: any) => cycle.status === "active") ??
        cycles[cycles.length - 1] ??
        null;

      const currentCycleTasksRaw = currentCycleRaw
        ? tasks.filter(
            (task: any) =>
              Number(task.retainer_cycle_id) ===
              Number(currentCycleRaw.id)
          )
        : [];

      const completedTaskStatuses = new Set([
        "complete",
        "done",
      ]);

      const currentCycle = currentCycleRaw
        ? {
            ...currentCycleRaw,
            publicId: currentCycleRaw.public_id,
            cycleNumber: currentCycleRaw.cycle_number,
            periodStart: currentCycleRaw.period_start,
            periodEnd: currentCycleRaw.period_end,
            amountPence: currentCycleRaw.amount_pence,
            paymentStatus: currentCycleRaw.payment_status,

            deliverablesTotal:
              currentCycleTasksRaw.length,

            deliverablesDone:
              currentCycleTasksRaw.filter((task: any) =>
                completedTaskStatuses.has(task.status)
              ).length,
          }
        : null;

      const normalisedCycles = cycles.map((cycle: any) => ({
        ...cycle,
        publicId: cycle.public_id,
        cycleNumber: cycle.cycle_number,
        periodStart: cycle.period_start,
        periodEnd: cycle.period_end,
        amountPence: cycle.amount_pence,
        paymentStatus: cycle.payment_status,
      }));

      const normalisedDeliverables = deliverables.map(
        (deliverable: any) => {
          const cycleItems = currentCycleRaw
            ? currentCycleTasksRaw.filter(
                (task: any) =>
                  Number(task.retainer_deliverable_id) ===
                  Number(deliverable.id)
              )
            : [];

          const completedItems = cycleItems.filter(
            (task: any) =>
              completedTaskStatuses.has(task.status)
          ).length;

          return {
            ...deliverable,
            publicId: deliverable.public_id,
            quantityIncluded: deliverable.quantity,
            turnaroundDays: deliverable.turnaround_days,
            rolloverRule: deliverable.rollover_rule,
            itemType: deliverable.item_type,

            workItemsTotal: cycleItems.length,
            workItemsDone: completedItems,

            usedThisCycle: completedItems,
            rolloverBalance: 0,
            status: "active",
          };
        }
      );

      const normalisedTasks = tasks.map((task: any) => ({
        ...task,
        publicId: task.public_id,
        retainerCycleId: task.retainer_cycle_id,
        deliverableId: task.retainer_deliverable_id,
        itemNumber: task.item_number,
        stageIndex: task.stage_index,
        stages: parseArray(task.stages),
        sortOrder: task.sort_order,
        assigneeId: task.assigned_to,
        dueDate: task.due_date,
        completedAt: task.completed_at,
      }));

      res.json({
        agreement: {
          ...agreement,

          publicId: agreement.public_id,
          name: agreement.title,

          clientUserId: agreement.client_id,
          freelancerUserId: agreement.freelancer_id,

          clientName: agreement.client_name,
          freelancerName: agreement.freelancer_name,

          templateLabel:
            agreement.template_label ?? "Retainer",

          amountPerCyclePence:
            agreement.agreed_cycle_amount_pence,

          billingFrequency:
            agreement.billing_frequency,

          minimumTermCycles:
            agreement.minimum_term_cycles,

          noticePeriodCycles:
            agreement.notice_period_cycles,

          maxRevisions:
            agreement.max_revisions,

          responseTimeHours:
            agreement.response_time_hours,

          renewalMode:
            agreement.renewal_mode,

          version:
            agreement.current_version,

          goal:
            agreement.retainer_goal,

          workflowStages,

          nextInvoiceDate:
            currentCycleRaw?.period_end ?? null,
        },

        currentCycle,
        cycles: normalisedCycles,
        deliverables: normalisedDeliverables,
        workstreams,

        requests: requests.map((request: any) => ({
          ...request,
          publicId: request.public_id,
          dueDate: request.due_date,
          relatedDeliverableId:
            request.related_deliverable_id,
        })),

        usage: usageEntries.map((entry: any) => ({
          ...entry,
          publicId: entry.public_id,
          deliverableId: entry.deliverable_id,
          recordedBy: entry.recorded_by,
          date: entry.recorded_at,
        })),

        usageEntries,
        tasks: normalisedTasks,
        amendments,
      });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to load retainer workspace" });
    }
  });

  // ─── POST /api/retainer/:publicId/accept ──────────────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.post("/api/retainer/:publicId/accept", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const userId = req.auth!.userId;

      const rows = await db`
        SELECT ra.*, p.client_id, p.freelancer_id
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = rows[0];

      if (userId !== agreement.client_id) {
        return res.status(403).json({ error: "Only the client can accept this retainer proposal" });
      }
      if (agreement.status !== "awaiting_client_acceptance") {
        return res.status(409).json({ error: `Agreement cannot be accepted in status: ${agreement.status}` });
      }

      const nowIso = new Date().toISOString();

      await db`
        UPDATE retainer_agreements
        SET client_accepted_at = ${nowIso}, status = 'active'
        WHERE id = ${agreement.id}
      `;

      const periodStart = agreement.start_date ?? nowIso.slice(0, 10);
      const periodEnd = calculatePeriodEnd(periodStart, agreement.billing_frequency);

      const cycleRows = await db`
        INSERT INTO retainer_cycles (
          public_id, retainer_agreement_id, project_id, cycle_number, status,
          start_date, period_start, period_end, amount_pence, payment_status, created_at
        ) VALUES (
          ${makePublicId("rc")}, ${agreement.id}, ${agreement.project_id}, 1, 'active',
          ${periodStart}, ${periodStart}, ${periodEnd}, ${agreement.agreed_cycle_amount_pence}, 'unpaid', ${nowIso}
        )
        RETURNING id, public_id
      `;
      const cycle = cycleRows[0];

      await createCycleWorkItems(
        db,
        agreement.id,
        cycle.id,
        nowIso,
      );

      await db`
        UPDATE projects SET status = 'active' WHERE id = ${agreement.project_id}
      `;

      const client = await loadUser(db, agreement.client_id);

      await insertNotification(db, {
        recipientId: agreement.freelancer_id,
        actorId: Number(userId),
        actorName: client?.name ?? "The client",
        type: "retainer_accepted",
        message: "Your retainer proposal has been accepted",
        link: `/retainer/${publicId}`,
      });

      res.json({ status: "active", cyclePublicId: cycle.public_id });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to accept retainer proposal" });
    }
  });

  // ─── POST /api/retainer/:publicId/decline ─────────────────────────────────
  app.post(
    "/api/retainer/:publicId/decline",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const { publicId } = req.params;
        const userId = req.auth!.userId;

        const rows = await db`
          SELECT
            ra.*,
            p.client_id,
            p.freelancer_id
          FROM retainer_agreements ra
          JOIN projects p
            ON p.id = ra.project_id
          WHERE ra.public_id = ${publicId}
          LIMIT 1
        `;

        if (!rows.length) {
          return res.status(404).json({
            error: "Retainer agreement not found",
          });
        }

        const agreement = rows[0];

        if (Number(userId) !== Number(agreement.client_id)) {
          return res.status(403).json({
            error:
              "Only the client can decline this retainer proposal",
          });
        }

        if (
          agreement.status !==
          "awaiting_client_acceptance"
        ) {
          return res.status(409).json({
            error:
              `Agreement cannot be declined in status: ${agreement.status}`,
          });
        }

        const nowIso = new Date().toISOString();

        await db`
          UPDATE retainer_agreements
          SET
            status = 'declined',
            updated_at = ${nowIso}
          WHERE id = ${agreement.id}
        `;

        await db`
          UPDATE projects
          SET status = 'cancelled'
          WHERE id = ${agreement.project_id}
        `;

        const client = await loadUser(
          db,
          agreement.client_id,
        );

        await insertNotification(db, {
          recipientId: agreement.freelancer_id,
          actorId: Number(userId),
          actorName: client?.name ?? "The client",
          type: "retainer_declined",
          message:
            "Your retainer proposal was declined",
          link: `/retainer/${publicId}`,
        });

        res.json({
          status: "declined",
        });
      } catch (e: any) {
        const status = e?.status ?? 500;

        res.status(status).json({
          error:
            e.message ??
            "Failed to decline retainer proposal",
        });
      }
    },
  );

  // ─── POST /api/retainer/:publicId/tasks/:taskPublicId/advance ──────────────
  // ─── GET retainer work-item submissions ────────────────────────────────
  app.get(
    "/api/retainer/:publicId/submissions",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const { publicId } = req.params;
        const userId = req.auth!.userId;

        const agreementRows = await db`
          SELECT
            id,
            client_id,
            freelancer_id
          FROM retainer_agreements
          WHERE public_id = ${publicId}
          LIMIT 1
        `;

        if (!agreementRows.length) {
          return res.status(404).json({
            error: "Retainer agreement not found",
          });
        }

        const agreement =
          agreementRows[0];

        if (
          Number(userId) !==
            Number(agreement.client_id) &&
          Number(userId) !==
            Number(agreement.freelancer_id)
        ) {
          return res.status(403).json({
            error:
              "You do not have access to this retainer",
          });
        }

        const submissions = await db`
          SELECT
            rws.id,
            rws.public_id AS "publicId",
            rct.public_id AS "taskPublicId",
            rws.version,
            rws.note,
            rws.deliverable_url
              AS "deliverableUrl",
            rws.upload_object_id
              AS "uploadId",
            u.original_filename
              AS "originalFilename",
            u.mime_type
              AS "mimeType",
            u.status
              AS "uploadStatus",
            rws.status,
            rws.client_feedback
              AS "clientFeedback",
            rws.submitted_by
              AS "submittedBy",
            rws.reviewed_by
              AS "reviewedBy",
            rws.submitted_at
              AS "submittedAt",
            rws.reviewed_at
              AS "reviewedAt",
            rws.created_at
              AS "createdAt"
          FROM retainer_work_item_submissions rws
          JOIN retainer_cycle_tasks rct
            ON rct.id =
              rws.retainer_cycle_task_id
          JOIN retainer_cycles rc
            ON rc.id =
              rct.retainer_cycle_id
          LEFT JOIN upload_objects u
            ON u.id =
              rws.upload_object_id
          WHERE rc.retainer_agreement_id =
            ${agreement.id}
          ORDER BY
            rws.retainer_cycle_task_id ASC,
            rws.version ASC
        `;

        res.json(submissions);
      } catch (e: any) {
        res.status(e?.status ?? 500).json({
          error:
            e.message ??
            "Failed to load work submissions",
        });
      }
    },
  );

  // ─── Freelancer submits work for client review ────────────────────────────
  // ─── GET retainer work-item stage updates ────────────────────────────────
  app.get(
    "/api/retainer/:publicId/stage-updates",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const { publicId } = req.params;
        const userId = req.auth!.userId;

        const agreementRows = await db`
          SELECT
            id,
            client_id,
            freelancer_id
          FROM retainer_agreements
          WHERE public_id = ${publicId}
          LIMIT 1
        `;

        if (!agreementRows.length) {
          return res.status(404).json({
            error: "Retainer agreement not found",
          });
        }

        const agreement =
          agreementRows[0];

        if (
          Number(userId) !==
            Number(agreement.client_id) &&
          Number(userId) !==
            Number(agreement.freelancer_id)
        ) {
          return res.status(403).json({
            error:
              "You do not have access to this retainer",
          });
        }

        const updates = await db`
          SELECT
            rsu.id,
            rsu.public_id
              AS "publicId",
            rct.public_id
              AS "taskPublicId",

            rsu.stage_index
              AS "stageIndex",
            rsu.stage_name
              AS "stageName",

            rsu.next_stage_index
              AS "nextStageIndex",
            rsu.next_stage_name
              AS "nextStageName",

            rsu.note,
            rsu.deliverable_url
              AS "deliverableUrl",

            rsu.created_by
              AS "createdBy",
            rsu.created_at
              AS "createdAt"

          FROM retainer_work_item_stage_updates rsu

          JOIN retainer_cycle_tasks rct
            ON rct.id =
              rsu.retainer_cycle_task_id

          JOIN retainer_cycles rc
            ON rc.id =
              rct.retainer_cycle_id

          WHERE
            rc.retainer_agreement_id =
              ${agreement.id}

          ORDER BY
            rsu.created_at ASC,
            rsu.id ASC
        `;

        res.json(updates);
      } catch (e: any) {
        res.status(
          e?.status ?? 500,
        ).json({
          error:
            e.message ??
            "Failed to load stage updates",
        });
      }
    },
  );

  // ─── Save stage update + move freelancer to next stage ────────────────────
  app.post(
    "/api/retainer/:publicId/tasks/:taskPublicId/progress",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const {
          publicId,
          taskPublicId,
        } = req.params;

        const userId =
          req.auth!.userId;

        const task =
          await loadRetainerWorkItem(
            db,
            publicId,
            taskPublicId,
          );

        if (!task) {
          return res.status(404).json({
            error: "Work item not found",
          });
        }

        if (
          Number(userId) !==
          Number(task.freelancer_id)
        ) {
          return res.status(403).json({
            error:
              "Only the freelancer can progress this work item",
          });
        }

        if (
          task.status === "complete" ||
          task.status === "done"
        ) {
          return res.status(409).json({
            error:
              "This work item is already complete",
          });
        }

        if (
          task.status ===
          "awaiting_client_review"
        ) {
          return res.status(409).json({
            error:
              "This work item is awaiting final client approval",
          });
        }

        const note =
          typeof req.body?.note ===
          "string"
            ? req.body.note.trim()
            : "";

        const deliverableUrl =
          typeof req.body?.deliverableUrl ===
          "string"
            ? req.body.deliverableUrl.trim()
            : "";

        if (!note) {
          return res.status(400).json({
            error:
              "Add a comment about the work completed at this stage",
          });
        }

        if (!deliverableUrl) {
          return res.status(400).json({
            error:
              "Add a work link before moving to the next stage",
          });
        }

        try {
          const parsedUrl =
            new URL(deliverableUrl);

          if (
            parsedUrl.protocol !== "http:" &&
            parsedUrl.protocol !== "https:"
          ) {
            throw new Error(
              "Unsupported protocol",
            );
          }
        } catch {
          return res.status(400).json({
            error:
              "Work link must be a valid http or https URL",
          });
        }

        const stages =
          parseWorkItemStages(
            task.stages,
          );

        if (!stages.length) {
          return res.status(409).json({
            error:
              "This work item does not have a workflow",
          });
        }

        const currentIndex =
          Math.max(
            0,
            Number(
              task.stage_index ?? 0,
            ),
          );

        const finalIndex =
          findFinalApprovalStageIndex(
            stages,
          );

        if (
          currentIndex >=
          finalIndex
        ) {
          return res.status(409).json({
            error:
              "This work item is at its final stage. Submit the final work for client approval.",
          });
        }

        const nextIndex =
          currentIndex + 1;

        const nowIso =
          new Date().toISOString();

        const updateRows = await db`
          INSERT INTO
            retainer_work_item_stage_updates (
              public_id,
              retainer_cycle_task_id,

              stage_index,
              stage_name,

              next_stage_index,
              next_stage_name,

              note,
              deliverable_url,

              created_by,
              created_at
            )
          VALUES (
            ${makePublicId("rsu")},
            ${task.id},

            ${currentIndex},
            ${stages[currentIndex]},

            ${nextIndex},
            ${stages[nextIndex]},

            ${note},
            ${deliverableUrl},

            ${Number(userId)},
            ${nowIso}
          )
          RETURNING *
        `;

        const updatedTaskRows =
          await db`
            UPDATE retainer_cycle_tasks
            SET
              stage =
                ${stages[nextIndex]},
              stage_index =
                ${nextIndex},
              status =
                'in_progress',
              completed_at = NULL
            WHERE id =
              ${task.id}
            RETURNING *
          `;

        res.json({
          stageUpdate:
            updateRows[0],
          task:
            updatedTaskRows[0],
        });
      } catch (e: any) {
        res.status(
          e?.status ?? 500,
        ).json({
          error:
            e.message ??
            "Failed to save stage update",
        });
      }
    },
  );

  app.post(
    "/api/retainer/:publicId/tasks/:taskPublicId/submit",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const {
          publicId,
          taskPublicId,
        } = req.params;

        const userId =
          req.auth!.userId;

        const task =
          await loadRetainerWorkItem(
            db,
            publicId,
            taskPublicId,
          );

        if (!task) {
          return res.status(404).json({
            error: "Work item not found",
          });
        }

        if (
          Number(userId) !==
          Number(task.freelancer_id)
        ) {
          return res.status(403).json({
            error:
              "Only the freelancer can submit work",
          });
        }

        if (
          task.status === "complete" ||
          task.status === "done"
        ) {
          return res.status(409).json({
            error:
              "This work item is already complete",
          });
        }

        if (
          task.status ===
          "awaiting_client_review"
        ) {
          return res.status(409).json({
            error:
              "This work item is already awaiting client review",
          });
        }

        const note =
          typeof req.body?.note === "string"
            ? req.body.note.trim()
            : "";

        const deliverableUrl =
          typeof req.body?.deliverableUrl ===
          "string"
            ? req.body.deliverableUrl.trim()
            : "";

        if (deliverableUrl) {
          try {
            const parsedUrl =
              new URL(deliverableUrl);

            if (
              parsedUrl.protocol !== "http:" &&
              parsedUrl.protocol !== "https:"
            ) {
              throw new Error(
                "Unsupported protocol",
              );
            }
          } catch {
            return res.status(400).json({
              error:
                "Deliverable link must be a valid http or https URL",
            });
          }
        }

        if (!note) {
          return res.status(400).json({
            error:
              "Add a comment before submitting final work for approval",
          });
        }

        if (!deliverableUrl) {
          return res.status(400).json({
            error:
              "Add a final work link before submitting for approval",
          });
        }

        const stages =
          parseWorkItemStages(
            task.stages,
          );

        if (!stages.length) {
          return res.status(409).json({
            error:
              "This work item does not have a workflow",
          });
        }

        const approvalIndex =
          findFinalApprovalStageIndex(
            stages,
          );

        const currentIndex =
          Math.max(
            0,
            Number(
              task.stage_index ?? 0,
            ),
          );

        if (
          currentIndex <
          approvalIndex
        ) {
          return res.status(409).json({
            error:
              "Move this work item to its final stage before submitting for client approval",
          });
        }

        const versionRows = await db`
          SELECT
            COALESCE(
              MAX(version),
              0
            )::int + 1 AS next_version
          FROM retainer_work_item_submissions
          WHERE retainer_cycle_task_id =
            ${task.id}
        `;

        const version =
          Number(
            versionRows[0]?.next_version ??
              1,
          );

        const nowIso =
          new Date().toISOString();

        const submissionRows = await db`
          INSERT INTO
            retainer_work_item_submissions (
              public_id,
              retainer_cycle_task_id,
              version,
              submitted_by,
              note,
              deliverable_url,
              status,
              submitted_at,
              created_at
            )
          VALUES (
            ${makePublicId("rws")},
            ${task.id},
            ${version},
            ${Number(userId)},
            ${note || null},
            ${deliverableUrl},
            'submitted',
            ${nowIso},
            ${nowIso}
          )
          RETURNING *
        `;

        const updatedTaskRows =
          await db`
            UPDATE
              retainer_cycle_tasks
            SET
              stage =
                ${stages[approvalIndex]},
              stage_index =
                ${approvalIndex},
              status =
                'awaiting_client_review',
              completed_at = NULL
            WHERE id = ${task.id}
            RETURNING *
          `;

        const freelancer =
          await loadUser(
            db,
            task.freelancer_id,
          );

        await insertNotification(
          db,
          {
            recipientId:
              task.client_id,
            actorId:
              Number(userId),
            actorName:
              freelancer?.name ??
              "The freelancer",
            type:
              "retainer_work_submitted",
            message:
              `${task.title} is ready for your review`,
            link:
              `/retainer/${publicId}`,
          },
        );

        res.json({
          submission:
            submissionRows[0],
          task:
            updatedTaskRows[0],
        });
      } catch (e: any) {
        res.status(
          e?.status ?? 500,
        ).json({
          error:
            e.message ??
            "Failed to submit work item",
        });
      }
    },
  );

  // ─── Client requests changes ───────────────────────────────────────────────
  app.post(
    "/api/retainer/:publicId/tasks/:taskPublicId/request-changes",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const {
          publicId,
          taskPublicId,
        } = req.params;

        const userId =
          req.auth!.userId;

        const task =
          await loadRetainerWorkItem(
            db,
            publicId,
            taskPublicId,
          );

        if (!task) {
          return res.status(404).json({
            error: "Work item not found",
          });
        }

        if (
          Number(userId) !==
          Number(task.client_id)
        ) {
          return res.status(403).json({
            error:
              "Only the client can request changes",
          });
        }

        if (
          task.status !==
          "awaiting_client_review"
        ) {
          return res.status(409).json({
            error:
              "This work item is not awaiting client review",
          });
        }

        const feedback =
          typeof req.body?.feedback ===
          "string"
            ? req.body.feedback.trim()
            : "";

        if (!feedback) {
          return res.status(400).json({
            error:
              "Please add feedback before requesting changes",
          });
        }

        const submissionRows =
          await db`
            SELECT *
            FROM
              retainer_work_item_submissions
            WHERE
              retainer_cycle_task_id =
                ${task.id}
              AND status = 'submitted'
            ORDER BY version DESC
            LIMIT 1
          `;

        if (!submissionRows.length) {
          return res.status(409).json({
            error:
              "No submitted work was found for review",
          });
        }

        const submission =
          submissionRows[0];

        const stages =
          parseWorkItemStages(
            task.stages,
          );

        if (!stages.length) {
          return res.status(409).json({
            error:
              "This work item does not have a workflow",
          });
        }

        const approvalIndex =
          findFinalApprovalStageIndex(
            stages,
          );

        const revisionIndex =
          findRevisionStageIndex(
            stages,
            approvalIndex,
          );

        const nowIso =
          new Date().toISOString();

        await db`
          UPDATE
            retainer_work_item_submissions
          SET
            status =
              'changes_requested',
            client_feedback =
              ${feedback},
            reviewed_by =
              ${Number(userId)},
            reviewed_at =
              ${nowIso}
          WHERE id = ${submission.id}
        `;

        const updatedTaskRows =
          await db`
            UPDATE
              retainer_cycle_tasks
            SET
              stage =
                ${stages[revisionIndex]},
              stage_index =
                ${revisionIndex},
              status =
                'changes_requested',
              completed_at = NULL
            WHERE id = ${task.id}
            RETURNING *
          `;

        const client =
          await loadUser(
            db,
            task.client_id,
          );

        await insertNotification(
          db,
          {
            recipientId:
              task.freelancer_id,
            actorId:
              Number(userId),
            actorName:
              client?.name ??
              "The client",
            type:
              "retainer_changes_requested",
            message:
              `Changes were requested for ${task.title}`,
            link:
              `/retainer/${publicId}`,
          },
        );

        res.json({
          status:
            "changes_requested",
          task:
            updatedTaskRows[0],
        });
      } catch (e: any) {
        res.status(
          e?.status ?? 500,
        ).json({
          error:
            e.message ??
            "Failed to request changes",
        });
      }
    },
  );

  // ─── Client approves final work ────────────────────────────────────────────
  app.post(
    "/api/retainer/:publicId/tasks/:taskPublicId/approve",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const {
          publicId,
          taskPublicId,
        } = req.params;

        const userId =
          req.auth!.userId;

        const task =
          await loadRetainerWorkItem(
            db,
            publicId,
            taskPublicId,
          );

        if (!task) {
          return res.status(404).json({
            error: "Work item not found",
          });
        }

        if (
          Number(userId) !==
          Number(task.client_id)
        ) {
          return res.status(403).json({
            error:
              "Only the client can approve this work item",
          });
        }

        if (
          task.status !==
          "awaiting_client_review"
        ) {
          return res.status(409).json({
            error:
              "This work item is not awaiting client review",
          });
        }

        const submissionRows =
          await db`
            SELECT *
            FROM
              retainer_work_item_submissions
            WHERE
              retainer_cycle_task_id =
                ${task.id}
              AND status = 'submitted'
            ORDER BY version DESC
            LIMIT 1
          `;

        if (!submissionRows.length) {
          return res.status(409).json({
            error:
              "No submitted work was found for approval",
          });
        }

        const submission =
          submissionRows[0];

        const stages =
          parseWorkItemStages(
            task.stages,
          );

        if (!stages.length) {
          return res.status(409).json({
            error:
              "This work item does not have a workflow",
          });
        }

        const finalIndex =
          stages.length - 1;

        const feedback =
          typeof req.body?.feedback ===
          "string"
            ? req.body.feedback.trim()
            : "";

        const nowIso =
          new Date().toISOString();

        await db`
          UPDATE
            retainer_work_item_submissions
          SET
            status = 'approved',
            client_feedback =
              ${feedback || null},
            reviewed_by =
              ${Number(userId)},
            reviewed_at =
              ${nowIso}
          WHERE id = ${submission.id}
        `;

        const updatedTaskRows =
          await db`
            UPDATE
              retainer_cycle_tasks
            SET
              stage =
                ${stages[finalIndex]},
              stage_index =
                ${finalIndex},
              status = 'complete',
              completed_at =
                ${nowIso}
            WHERE id = ${task.id}
            RETURNING *
          `;

        const remainingRows =
          await db`
            SELECT
              COUNT(*)::int
                AS remaining
            FROM retainer_cycle_tasks
            WHERE
              retainer_cycle_id =
                ${task.retainer_cycle_id}
              AND id <> ${task.id}
              AND status NOT IN (
                'complete',
                'done'
              )
          `;

        const remaining =
          Number(
            remainingRows[0]?.remaining ??
              0,
          );

        if (remaining === 0) {
          await db`
            UPDATE retainer_agreements
            SET
              status =
                'cycle_review_due',
              updated_at =
                ${nowIso}
            WHERE id =
              ${task.retainer_agreement_id}
          `;
        }

        const client =
          await loadUser(
            db,
            task.client_id,
          );

        await insertNotification(
          db,
          {
            recipientId:
              task.freelancer_id,
            actorId:
              Number(userId),
            actorName:
              client?.name ??
              "The client",
            type:
              "retainer_work_approved",
            message:
              `${task.title} has been approved`,
            link:
              `/retainer/${publicId}`,
          },
        );

        res.json({
          status: "complete",
          task:
            updatedTaskRows[0],
        });
      } catch (e: any) {
        res.status(
          e?.status ?? 500,
        ).json({
          error:
            e.message ??
            "Failed to approve work item",
        });
      }
    },
  );

  // ─── Legacy naked advancement is disabled ─────────────────────────────
  app.post(
    "/api/retainer/:publicId/tasks/:taskPublicId/advance",
    requireAuth,
    async (req, res) => {
      const db = getDb();

      try {
        const {
          publicId,
          taskPublicId,
        } = req.params;

        const userId =
          req.auth!.userId;

        const task =
          await loadRetainerWorkItem(
            db,
            publicId,
            taskPublicId,
          );

        if (!task) {
          return res.status(404).json({
            error: "Work item not found",
          });
        }

        if (
          Number(userId) !==
          Number(task.freelancer_id)
        ) {
          return res.status(403).json({
            error:
              "Only the freelancer can progress this work item",
          });
        }

        return res.status(409).json({
          error:
            "Add a work link and comment, then use Save update & move forward",
        });
      } catch (e: any) {
        res.status(
          e?.status ?? 500,
        ).json({
          error:
            e.message ??
            "Failed to validate work-item progression",
        });
      }
    },
  );

  // ─── POST /api/retainer/:publicId/requests ────────────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.post("/api/retainer/:publicId/requests", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const userId = req.auth!.userId;
      const { title, description, priority, dueDate, relatedDeliverableId } = req.body ?? {};
      if (!title) return res.status(400).json({ error: "title is required" });

      const rows = await db`
        SELECT ra.*, p.client_id, p.freelancer_id
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = rows[0];

      if (Number(userId) !== agreement.client_id && Number(userId) !== agreement.freelancer_id) {
        return res.status(403).json({ error: "You do not have access to this retainer agreement" });
      }

      const nowIso = new Date().toISOString();
      const requestPublicId = makePublicId("req");

      const requestRows = await db`
        INSERT INTO retainer_requests (
          public_id, retainer_agreement_id, submitted_by, title, description,
          priority, due_date, related_deliverable_id, status, created_at
        ) VALUES (
          ${requestPublicId}, ${agreement.id}, ${Number(userId)}, ${title}, ${description ?? null},
          ${priority ?? "normal"}, ${dueDate ?? null}, ${relatedDeliverableId ?? null}, 'submitted', ${nowIso}
        )
        RETURNING *
      `;

      const requester = await loadUser(db, Number(userId));

      await insertNotification(db, {
        recipientId: agreement.freelancer_id,
        actorId: Number(userId),
        actorName: requester?.name ?? "A client",
        type: "retainer_request",
        message: `New request submitted for ${agreement.title}`,
        link: `/retainer/${publicId}`,
      });

      res.json(requestRows[0]);
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to create retainer request" });
    }
  });

  // ─── PATCH /api/retainer/requests/:requestPublicId ────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.patch("/api/retainer/requests/:requestPublicId", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const { requestPublicId } = req.params;
      const userId = req.auth!.userId;
      const { status, creativeResponse, outOfScopeQuotePence } = req.body ?? {};

      const rows = await db`
        SELECT rr.*, ra.title as agreement_title, ra.id as agreement_id, p.client_id, p.freelancer_id
        FROM retainer_requests rr
        JOIN retainer_agreements ra ON ra.id = rr.retainer_agreement_id
        JOIN projects p ON p.id = ra.project_id
        WHERE rr.public_id = ${requestPublicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Request not found" });
      const request = rows[0];

      if (Number(userId) !== request.freelancer_id) {
        return res.status(403).json({ error: "Only the freelancer can respond to this request" });
      }

      const nowIso = new Date().toISOString();

      const updated = await db`
        UPDATE retainer_requests
        SET status = COALESCE(${status ?? null}, status),
            creative_response = COALESCE(${creativeResponse ?? null}, creative_response),
            out_of_scope_quote_pence = COALESCE(${outOfScopeQuotePence ?? null}, out_of_scope_quote_pence),
            responded_at = ${nowIso}
        WHERE public_id = ${requestPublicId}
        RETURNING *
      `;

      const responder = await loadUser(db, Number(userId));

      await insertNotification(db, {
        recipientId: request.client_id,
        actorId: Number(userId),
        actorName: responder?.name ?? "Your freelancer",
        type: "retainer_request_update",
        message: `Your request "${request.title}" was updated to ${status ?? request.status}`,
        link: `/retainer/${request.agreement_id}`,
      });

      res.json(updated[0]);
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to update request" });
    }
  });

  // ─── POST /api/retainer/:publicId/usage ───────────────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.post("/api/retainer/:publicId/usage", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const userId = req.auth!.userId;
      const { deliverableId, description, quantity, unit } = req.body ?? {};

      const rows = await db`
        SELECT ra.*, p.client_id, p.freelancer_id
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = rows[0];

      if (Number(userId) !== agreement.client_id && Number(userId) !== agreement.freelancer_id) {
        return res.status(403).json({ error: "You do not have access to this retainer agreement" });
      }

      const nowIso = new Date().toISOString();

      const usageRows = await db`
        INSERT INTO retainer_usage_entries (
          public_id, retainer_agreement_id, deliverable_id, recorded_by,
          description, quantity, unit, recorded_at
        ) VALUES (
          ${makePublicId("use")}, ${agreement.id}, ${deliverableId ?? null}, ${Number(userId)},
          ${description ?? null}, ${quantity ?? null}, ${unit ?? null}, ${nowIso}
        )
        RETURNING *
      `;

      res.json(usageRows[0]);
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to log usage entry" });
    }
  });

  // ─── POST /api/retainer/:publicId/cycle-review ────────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.post("/api/retainer/:publicId/cycle-review", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const userId = req.auth!.userId;
      const {
        cycleId,
        completedDeliverables,
        outstandingItems,
        outcomesSummary,
        satisfactionScore,
        satisfactionComment,
      } = req.body ?? {};
      if (!cycleId) return res.status(400).json({ error: "cycleId is required" });

      const agreementRows = await db`
        SELECT ra.*, p.client_id, p.freelancer_id
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!agreementRows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = agreementRows[0];

      if (Number(userId) !== agreement.client_id && Number(userId) !== agreement.freelancer_id) {
        return res.status(403).json({ error: "You do not have access to this retainer agreement" });
      }

      const cycleRows = await db`
        SELECT * FROM retainer_cycles WHERE id = ${Number(cycleId)} AND retainer_agreement_id = ${agreement.id} LIMIT 1
      `;
      if (!cycleRows.length) return res.status(404).json({ error: "Cycle not found" });
      const cycle = cycleRows[0];

      const nowIso = new Date().toISOString();

      const reviewRows = await db`
        INSERT INTO retainer_cycle_reviews (
          public_id, retainer_cycle_id, retainer_agreement_id,
          completed_deliverables, outstanding_items, outcomes_summary, created_at
        ) VALUES (
          ${makePublicId("rcr")},
          ${cycle.id},
          ${agreement.id},
          ${asJson(completedDeliverables)},
          ${asJson(outstandingItems)},
          ${outcomesSummary ?? null},
          ${nowIso}
        )
        RETURNING *
      `;

      const satisfactionRole =
        Number(userId) === Number(agreement.client_id)
          ? "client"
          : "freelancer";

      const parsedSatisfactionScore =
        Number(satisfactionScore);

      if (
        Number.isInteger(parsedSatisfactionScore) &&
        parsedSatisfactionScore >= 1 &&
        parsedSatisfactionScore <= 5
      ) {
        await db`
          INSERT INTO retainer_satisfaction_pulses (
            public_id,
            retainer_cycle_id,
            retainer_agreement_id,
            submitted_by,
            role,
            score,
            comment,
            created_at
          ) VALUES (
            ${makePublicId("rsp")},
            ${cycle.id},
            ${agreement.id},
            ${Number(userId)},
            ${satisfactionRole},
            ${parsedSatisfactionScore},
            ${satisfactionComment ?? null},
            ${nowIso}
          )
        `;
      }

      await db`
        UPDATE retainer_cycles SET status = 'complete', end_date = ${nowIso.slice(0, 10)}
        WHERE id = ${cycle.id}
      `;

      const nextCycleNumber = Number(cycle.cycle_number) + 1;
      const nextPeriodStart = cycle.period_end
        ? new Date(new Date(cycle.period_end).getTime() + 86400_000).toISOString().slice(0, 10)
        : nowIso.slice(0, 10);
      const nextPeriodEnd = calculatePeriodEnd(nextPeriodStart, agreement.billing_frequency);

      const nextCycleRows = await db`
        INSERT INTO retainer_cycles (
          public_id, retainer_agreement_id, project_id, cycle_number, status,
          start_date, period_start, period_end, amount_pence, payment_status, created_at
        ) VALUES (
          ${makePublicId("rc")}, ${agreement.id}, ${agreement.project_id}, ${nextCycleNumber}, 'active',
          ${nextPeriodStart}, ${nextPeriodStart}, ${nextPeriodEnd}, ${agreement.agreed_cycle_amount_pence}, 'unpaid', ${nowIso}
        )
        RETURNING *
      `;

      await createCycleWorkItems(
        db,
        agreement.id,
        nextCycleRows[0].id,
        nowIso,
      );

      await db`
        UPDATE retainer_agreements
        SET
          status = 'active',
          updated_at = ${nowIso}
        WHERE id = ${agreement.id}
      `;

      res.json({
        review: reviewRows[0],
        nextCycle: nextCycleRows[0],
      });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to submit cycle review" });
    }
  });

  // ─── POST /api/retainer/:publicId/pause ───────────────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.post("/api/retainer/:publicId/pause", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const userId = req.auth!.userId;
      const { reason, effectiveFromCycle, feesContinue, deliverablesContinue, rolloverContinues } = req.body ?? {};

      const rows = await db`
        SELECT ra.*, p.client_id, p.freelancer_id
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = rows[0];

      if (Number(userId) !== agreement.client_id && Number(userId) !== agreement.freelancer_id) {
        return res.status(403).json({ error: "You do not have access to this retainer agreement" });
      }

      const nowIso = new Date().toISOString();
      const otherPartyId = Number(userId) === agreement.client_id ? agreement.freelancer_id : agreement.client_id;
      const requester = await loadUser(db, Number(userId));

      const pauseRows = await db`
        INSERT INTO retainer_pause_requests (
          public_id, retainer_agreement_id, requested_by, reason, effective_from_cycle,
          fees_continue, deliverables_continue, rollover_continues, status, created_at
        ) VALUES (
          ${makePublicId("pr")}, ${agreement.id}, ${Number(userId)}, ${reason ?? null}, ${effectiveFromCycle ?? null},
          ${feesContinue ?? false}, ${deliverablesContinue ?? false}, ${rolloverContinues ?? false}, 'pending', ${nowIso}
        )
        RETURNING *
      `;

      await insertNotification(db, {
        recipientId: otherPartyId,
        actorId: Number(userId),
        actorName: requester?.name ?? "Your partner",
        type: "retainer_pause_requested",
        message: `${requester?.name ?? "Your partner"} has requested to pause the retainer "${agreement.title}"`,
        link: `/retainer/${publicId}`,
      });

      res.json(pauseRows[0]);
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to create pause request" });
    }
  });

  // ─── POST /api/retainer/:publicId/end ──────────────────────────────────────
  // PRD-018: requireAuth + session-derived userId
  app.post("/api/retainer/:publicId/end", requireAuth, async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const userId = req.auth!.userId;
      const { reason } = req.body ?? {};

      const rows = await db`
        SELECT ra.*, p.client_id, p.freelancer_id
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = rows[0];

      if (userId !== agreement.client_id && userId !== agreement.freelancer_id) {
        return res.status(403).json({ error: "You do not have access to this retainer agreement" });
      }

      const nowIso = new Date().toISOString();
      const otherPartyId = Number(userId) === agreement.client_id ? agreement.freelancer_id : agreement.client_id;
      const requester = await loadUser(db, Number(userId));

      await db`
        UPDATE retainer_agreements SET status = 'ending' WHERE id = ${agreement.id}
      `;

      const eventRows = await db`
        INSERT INTO retainer_renewal_events (
          public_id, retainer_agreement_id, event_type, reason, created_by, created_at
        ) VALUES (
          ${makePublicId("rre")}, ${agreement.id}, 'cancelled', ${reason ?? null}, ${Number(userId)}, ${nowIso}
        )
        RETURNING *
      `;

      await insertNotification(db, {
        recipientId: otherPartyId,
        actorId: Number(userId),
        actorName: requester?.name ?? "Your partner",
        type: "retainer_ended",
        message: `${requester?.name ?? "Your partner"} has ended the retainer "${agreement.title}"`,
        link: `/retainer/${publicId}`,
      });

      res.json({ status: "ending", event: eventRows[0] });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to end retainer agreement" });
    }
  });

  // ─── GET /api/founder/retainer-metrics ─────────────────────────────────────
  // PRD-018: requireAdminGuard
  app.get("/api/founder/retainer-metrics", requireAdminGuard, async (req, res) => {
    const db = getDb();
    try {
      // requireAdminGuard has already verified admin status

      const nowIso = new Date().toISOString();
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString();

      const [activeCountRow] = await db`
        SELECT COUNT(*) AS c FROM retainer_agreements WHERE status = 'active'
      `;

      const [mrvRow] = await db`
        SELECT COALESCE(SUM(agreed_cycle_amount_pence), 0) AS total
        FROM retainer_agreements
        WHERE status = 'active' AND billing_frequency = 'monthly'
      `;

      const [renewalWindowRow] = await db`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'renewed') AS renewed_count,
          COUNT(*) FILTER (WHERE event_type = 'cancelled') AS cancelled_count
        FROM retainer_renewal_events
        WHERE created_at >= ${ninetyDaysAgo}
      `;
      const renewedCount = Number(renewalWindowRow?.renewed_count ?? 0);
      const cancelledCount = Number(renewalWindowRow?.cancelled_count ?? 0);
      const totalRenewalEvents = renewedCount + cancelledCount;
      const renewalRate = totalRenewalEvents > 0 ? (renewedCount / totalRenewalEvents) * 100 : 0;

      const [pauseCountRow] = await db`
        SELECT COUNT(*) AS c FROM retainer_pause_requests WHERE status = 'pending'
      `;

      const [overdueCyclesRow] = await db`
        SELECT COUNT(*) AS c FROM retainer_cycles
        WHERE status != 'complete' AND period_end < ${nowIso}
      `;

      const recentAgreements = await db`
        SELECT ra.public_id, ra.title, ra.status, ra.agreed_cycle_amount_pence, ra.billing_frequency,
               ra.created_at, p.title AS project_title,
               u_client.name AS client_name, u_freelancer.name AS freelancer_name
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        JOIN users u_client ON u_client.id = p.client_id
        JOIN users u_freelancer ON u_freelancer.id = p.freelancer_id
        ORDER BY ra.created_at DESC
        LIMIT 10
      `;

      res.json({
        active_count: Number(activeCountRow?.c ?? 0),
        monthly_recurring_value_pence: Number(mrvRow?.total ?? 0),
        renewal_rate: renewalRate,
        pause_count: Number(pauseCountRow?.c ?? 0),
        overdue_cycles: Number(overdueCyclesRow?.c ?? 0),
        recent_agreements: recentAgreements,
      });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to load retainer metrics" });
    }
  });
}
