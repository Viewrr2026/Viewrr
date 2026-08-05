/**
 * PRD-012 — Retainer Builder server routes + Founder metrics.
 *
 * Express routes for building, sending, accepting, and running retainer
 * agreements (multi-step retainer proposal builder + ongoing workspace).
 *
 * Conventions followed:
 * - Raw neon() tagged-template SQL only (Drizzle is pinned to 0.43.1, not used here).
 * - No server-side sessions — userId always comes from req.body / req.query.
 * - All monetary amounts are integers in pence.
 * - Public IDs follow `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`.
 */

import type { Express } from "express";
import { neon } from "@neondatabase/serverless";

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

export function registerRetainerBuilderRoutes(app: Express): void {
  // ─── POST /api/retainer-builder/create ────────────────────────────────────
  app.post("/api/retainer-builder/create", async (req, res) => {
    const db = getDb();
    try {
      const {
        userId,
        templateId,
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

      if (!userId) return res.status(400).json({ error: "userId is required" });
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
          0, ${recipient?.name ?? null}, ${requester?.name ?? null}, 1,
          ${billingFrequency}, ${nowIso}
        )
        RETURNING id
      `;
      const projectId = projectRows[0].id;

      const agreementRows = await db`
        INSERT INTO retainer_agreements (
          public_id, project_id, title, template_id, commercial_model,
          goal, success_measures, key_channels, priority_outcomes,
          start_date, billing_frequency, agreed_cycle_amount_pence,
          minimum_term_cycles, renewal_mode, notice_period_cycles,
          intro_price_pence, intro_cycles, setup_fee_pence, max_revisions,
          response_time_hours, client_input_deadline_days, excluded_work,
          draft_step, status, proposal_sent_at, created_by, created_at
        ) VALUES (
          ${agreementPublicId}, ${projectId}, ${agreementTitle}, ${templateId ?? null}, ${commercialModel ?? null},
          ${goal ?? null}, ${asJson(successMeasures)}, ${asJson(keyChannels)}, ${asJson(priorityOutcomes)},
          ${startDate ?? null}, ${billingFrequency}, ${Number(amountPerCyclePence)},
          ${minimumTermCycles ?? null}, ${renewalMode ?? null}, ${noticePeriodCycles ?? null},
          ${introPrice ?? null}, ${introCycles ?? null}, ${setupFeePence ?? null}, ${maxRevisions ?? null},
          ${responseTimeHours ?? null}, ${clientInputDeadlineDays ?? null}, ${excludedWork ?? null},
          8, 'awaiting_client_acceptance', ${nowIso}, ${Number(userId)}, ${nowIso}
        )
        RETURNING id, public_id
      `;
      const agreement = agreementRows[0];
      const retainerAgreementId = agreement.id;

      let deliverableIds: number[] = [];
      if (Array.isArray(deliverables) && deliverables.length > 0) {
        for (const item of deliverables) {
          const d = typeof item === "string" ? { name: item } : item;
          const row = await db`
            INSERT INTO retainer_deliverables (
              public_id, retainer_agreement_id, name, description, quantity_per_cycle, unit
            ) VALUES (
              ${makePublicId("del")}, ${retainerAgreementId}, ${d.name ?? d.title ?? "Deliverable"},
              ${d.description ?? null}, ${d.quantityPerCycle ?? d.quantity ?? null}, ${d.unit ?? null}
            )
            RETURNING id
          `;
          deliverableIds.push(row[0].id);
        }
      }

      const workstreamRows = await db`
        INSERT INTO retainer_workstreams (
          public_id, retainer_agreement_id, stages
        ) VALUES (
          ${makePublicId("ws")}, ${retainerAgreementId}, ${asJson(workflowStages ?? [])}
        )
        RETURNING id
      `;
      const workstreamId = workstreamRows[0].id;

      const fullSnapshot = {
        title: agreementTitle,
        templateId, commercialModel, goal, successMeasures, keyChannels,
        priorityOutcomes, deliverables, workflowStages, startDate,
        billingFrequency, amountPerCyclePence, minimumTermCycles, renewalMode,
        noticePeriodCycles, introPrice, introCycles, setupFeePence, maxRevisions,
        responseTimeHours, clientInputDeadlineDays, excludedWork,
      };

      await db`
        INSERT INTO retainer_agreement_versions (
          public_id, retainer_agreement_id, version, snapshot, created_by, created_at
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

  // ─── GET /api/retainer/:publicId/workspace ────────────────────────────────
  app.get("/api/retainer/:publicId/workspace", async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;

      const rows = await db`
        SELECT ra.*, p.title as project_title, p.client_id, p.freelancer_id,
               u_client.name as client_name, u_freelancer.name as freelancer_name
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        JOIN users u_client ON u_client.id = p.client_id
        JOIN users u_freelancer ON u_freelancer.id = p.freelancer_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = rows[0];

      const [cycles, deliverables, workstreams, requests, usageEntries, tasks, amendments] = await Promise.all([
        db`SELECT * FROM retainer_cycles WHERE retainer_agreement_id = ${agreement.id} ORDER BY cycle_number ASC`,
        db`SELECT * FROM retainer_deliverables WHERE retainer_agreement_id = ${agreement.id} ORDER BY id ASC`,
        db`SELECT * FROM retainer_workstreams WHERE retainer_agreement_id = ${agreement.id} ORDER BY id ASC`,
        db`SELECT * FROM retainer_requests WHERE retainer_agreement_id = ${agreement.id} ORDER BY created_at DESC`,
        db`SELECT * FROM retainer_usage_entries WHERE retainer_agreement_id = ${agreement.id} ORDER BY created_at DESC`,
        db`
          SELECT rct.* FROM retainer_cycle_tasks rct
          JOIN retainer_cycles rc ON rc.id = rct.retainer_cycle_id
          WHERE rc.retainer_agreement_id = ${agreement.id}
          ORDER BY rct.id ASC
        `,
        db`SELECT * FROM retainer_amendments WHERE retainer_agreement_id = ${agreement.id} ORDER BY created_at DESC`,
      ]);

      res.json({
        agreement,
        cycles,
        deliverables,
        workstreams,
        requests,
        usageEntries,
        tasks,
        amendments,
      });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to load retainer workspace" });
    }
  });

  // ─── POST /api/retainer/:publicId/accept ──────────────────────────────────
  app.post("/api/retainer/:publicId/accept", async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const { userId } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "userId is required" });

      const rows = await db`
        SELECT ra.*, p.client_id, p.freelancer_id
        FROM retainer_agreements ra
        JOIN projects p ON p.id = ra.project_id
        WHERE ra.public_id = ${publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Retainer agreement not found" });
      const agreement = rows[0];

      if (Number(userId) !== agreement.client_id) {
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

      const workstreams = await db`
        SELECT * FROM retainer_workstreams WHERE retainer_agreement_id = ${agreement.id}
      `;

      let stages: any[] = [];
      for (const ws of workstreams) {
        try {
          const parsed = typeof ws.stages === "string" ? JSON.parse(ws.stages) : ws.stages;
          if (Array.isArray(parsed)) stages = stages.concat(parsed);
        } catch {}
      }

      for (const stage of stages) {
        const stageName = typeof stage === "string" ? stage : stage?.name ?? stage?.title ?? "Task";
        await db`
          INSERT INTO retainer_cycle_tasks (
            public_id, retainer_cycle_id, name, status, recurs_each_cycle, created_at
          ) VALUES (
            ${makePublicId("rct")}, ${cycle.id}, ${stageName}, 'pending', true, ${nowIso}
          )
        `;
      }

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

  // ─── POST /api/retainer/:publicId/requests ────────────────────────────────
  app.post("/api/retainer/:publicId/requests", async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const { userId, title, description, priority, dueDate, relatedDeliverableId } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "userId is required" });
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
          public_id, retainer_agreement_id, created_by, title, description,
          priority, due_date, related_deliverable_id, status, created_at
        ) VALUES (
          ${requestPublicId}, ${agreement.id}, ${Number(userId)}, ${title}, ${description ?? null},
          ${priority ?? "medium"}, ${dueDate ?? null}, ${relatedDeliverableId ?? null}, 'submitted', ${nowIso}
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
  app.patch("/api/retainer/requests/:requestPublicId", async (req, res) => {
    const db = getDb();
    try {
      const { requestPublicId } = req.params;
      const { userId, status, creativeResponse, outOfScopeQuotePence } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "userId is required" });

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
  app.post("/api/retainer/:publicId/usage", async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const { userId, deliverableId, description, quantity, unit } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "userId is required" });

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
          public_id, retainer_agreement_id, deliverable_id, created_by,
          description, quantity, unit, created_at
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
  app.post("/api/retainer/:publicId/cycle-review", async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const {
        userId,
        cycleId,
        completedDeliverables,
        outstandingItems,
        outcomesSummary,
        satisfactionScore,
        satisfactionComment,
      } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "userId is required" });
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
          public_id, retainer_cycle_id, retainer_agreement_id, created_by,
          completed_deliverables, outstanding_items, outcomes_summary, created_at
        ) VALUES (
          ${makePublicId("rcr")}, ${cycle.id}, ${agreement.id}, ${Number(userId)},
          ${asJson(completedDeliverables)}, ${asJson(outstandingItems)}, ${outcomesSummary ?? null}, ${nowIso}
        )
        RETURNING *
      `;

      await db`
        INSERT INTO retainer_satisfaction_pulses (
          public_id, retainer_cycle_id, retainer_agreement_id, created_by,
          score, comment, created_at
        ) VALUES (
          ${makePublicId("rsp")}, ${cycle.id}, ${agreement.id}, ${Number(userId)},
          ${satisfactionScore ?? null}, ${satisfactionComment ?? null}, ${nowIso}
        )
      `;

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

      res.json({ review: reviewRows[0], nextCycle: nextCycleRows[0] });
    } catch (e: any) {
      const status = e?.status ?? 500;
      res.status(status).json({ error: e.message ?? "Failed to submit cycle review" });
    }
  });

  // ─── POST /api/retainer/:publicId/pause ───────────────────────────────────
  app.post("/api/retainer/:publicId/pause", async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const { userId, reason, effectiveFromCycle, feesContinue, deliverablesContinue, rolloverContinues } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "userId is required" });

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
  app.post("/api/retainer/:publicId/end", async (req, res) => {
    const db = getDb();
    try {
      const { publicId } = req.params;
      const { userId, reason } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "userId is required" });

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
  app.get("/api/founder/retainer-metrics", async (req, res) => {
    const db = getDb();
    try {
      const userId = Number(req.query.userId ?? req.body?.userId);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      if (userId !== FOUNDER_USER_ID) {
        return res.status(403).json({ error: "Forbidden — founder access only" });
      }

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
