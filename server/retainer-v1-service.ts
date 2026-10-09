import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import {
  customRetainerSchema,
  cycleAccess,
  type CustomRetainerPlan,
} from "../shared/retainer-v1";
import {
  retainerPool,
  retainerError,
  retainerTransaction,
  type RetainerDb,
} from "./retainer-v1-db";

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export async function event(
  db: RetainerDb,
  a: any,
  actor: number | null,
  key: string,
  kind: string,
  detail: object = {},
) {
  await db.query(
    `INSERT INTO retainer_events (agreement_id,actor_id,event_key,kind,detail) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING`,
    [a.id, actor, key, kind, JSON.stringify(detail)],
  );
}
export async function notice(
  db: RetainerDb,
  a: any,
  key: string,
  message: string,
  recipients = [a.client_id, a.freelancer_id],
) {
  for (const recipient of recipients)
    await db.query(
      `INSERT INTO retainer_notice_outbox(agreement_id,recipient_id,event_key,message) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING`,
      [a.id, recipient, `${key}:${recipient}`, message],
    );
}
export async function lockAgreement(
  db: RetainerDb,
  publicId: string,
  userId?: number,
) {
  const a = (
    await db.query(
      `SELECT * FROM retainer_agreements WHERE public_id=$1 AND workflow_version=1 FOR UPDATE`,
      [publicId],
    )
  ).rows[0];
  if (!a) retainerError("Custom retainer not found", 404);
  if (userId !== undefined && ![a.client_id, a.freelancer_id].includes(userId))
    retainerError("You do not have access to this retainer", 403);
  return a;
}
export async function loadCycles(db: RetainerDb, agreementId: number) {
  return (
    await db.query(
      "SELECT * FROM retainer_cycles WHERE retainer_agreement_id=$1 ORDER BY cycle_number",
      [agreementId],
    )
  ).rows;
}
async function currentPlan(
  db: RetainerDb,
  a: any,
): Promise<CustomRetainerPlan> {
  return (
    await db.query(
      "SELECT snapshot FROM retainer_agreement_versions WHERE retainer_agreement_id=$1 AND version_number=$2 ORDER BY id DESC LIMIT 1",
      [a.id, a.current_version],
    )
  ).rows[0].snapshot;
}
export async function requireWork(db: RetainerDb, a: any, cycleId: number) {
  const cycles = await loadCycles(db, a.id);
  const cycle = cycles.find((c) => c.id === cycleId);
  if (!cycle) retainerError("Cycle not found", 404);
  const access = cycleAccess(cycles, cycle, a.status);
  if (!access.canWork) retainerError(access.reason);
  return cycle;
}
async function validateAmendment(
  db: RetainerDb,
  a: any,
  plan: CustomRetainerPlan,
) {
  if (a.status !== "active" && a.status !== "paused") return;
  const original = await currentPlan(db, a);
  const cycles = await loadCycles(db, a.id);
  for (const c of cycles) {
    const before = original.cycles.find((p) => p.id === c.plan_key)!;
    const after = plan.cycles.find((p) => p.id === c.plan_key);
    if (c.started_at || c.accepted_at || c.paid_at) {
      if (!after || plan.cycles.indexOf(after) !== c.cycle_number - 1)
        retainerError("Started cycles must keep their position");
      const frozen = c.accepted_at || c.paid_at;
      const compare = (p: any) =>
        frozen ? p : { ...p, startDate: "", endDate: "" };
      if (!isDeepStrictEqual(compare(before), compare(after)))
        retainerError(
          frozen
            ? "Approved and paid cycles cannot change"
            : "Only dates can change on a started cycle",
        );
    }
  }
}
async function materialize(db: RetainerDb, a: any, plan: CustomRetainerPlan) {
  const cycles = await loadCycles(db, a.id);
  // Delete only unstarted draft/future cycles. Preserve all operational records.
  for (const c of cycles.filter(
    (c) => !c.started_at && !c.accepted_at && !c.paid_at,
  )) {
    await db.query(
      "DELETE FROM retainer_cycle_tasks WHERE retainer_cycle_id=$1",
      [c.id],
    );
    await db.query("DELETE FROM retainer_deliverables WHERE cycle_id=$1", [
      c.id,
    ]);
    await db.query("DELETE FROM retainer_cycles WHERE id=$1", [c.id]);
  }
  for (const index of plan.cycles.map((_, i) => i)) {
    const cp = plan.cycles[index];
    const existing = cycles.find(
      (c) =>
        c.plan_key === cp.id && (c.started_at || c.accepted_at || c.paid_at),
    );
    if (existing) {
      await db.query(
        "UPDATE retainer_cycles SET period_start=$2,period_end=$3,start_date=$2 WHERE id=$1",
        [existing.id, cp.startDate, cp.endDate],
      );
      continue;
    }
    const c = (
      await db.query(
        `INSERT INTO retainer_cycles(public_id,retainer_agreement_id,project_id,cycle_number,status,start_date,period_start,period_end,amount_pence,payment_status,created_at,plan_key,cycle_name,revision_allowance,payment_days) VALUES($1,$2,$3,$4,'scheduled',$5,$5,$6,$7,'unpaid',$8,$9,$10,$11,$12) RETURNING *`,
        [
          id("rc"),
          a.id,
          a.project_id,
          index + 1,
          cp.startDate,
          cp.endDate,
          cp.amountPence,
          new Date().toISOString(),
          cp.id,
          cp.name,
          cp.revisionAllowance,
          cp.paymentDays,
        ],
      )
    ).rows[0];
    for (const groupIndex of cp.deliverables.map((_, i) => i)) {
      const group = cp.deliverables[groupIndex];
      const d = (
        await db.query(
          `INSERT INTO retainer_deliverables(public_id,retainer_agreement_id,cycle_id,plan_key,name,quantity,frequency,notes,sort_order) VALUES($1,$2,$3,$4,$5,$6,'per_cycle',$7,$8) RETURNING id`,
          [
            id("del"),
            a.id,
            c.id,
            group.id,
            group.name,
            group.quantity,
            group.brief,
            groupIndex,
          ],
        )
      ).rows[0];
      for (let item = 1; item <= group.quantity; item++)
        await db.query(
          `INSERT INTO retainer_cycle_tasks(public_id,retainer_cycle_id,retainer_deliverable_id,item_number,title,description,status,assigned_to,due_date,stages,stage,sort_order) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,'Production',$10)`,
          [
            id("rct"),
            c.id,
            d.id,
            item,
            `${group.name} ${item}`,
            group.itemBriefs?.[item - 1] || group.brief,
            a.freelancer_id,
            cp.endDate,
            JSON.stringify(["Production", "Client review", "Approved"]),
            groupIndex * 200 + item,
          ],
        );
    }
  }
}
export async function createCustomRetainer(
  userId: number,
  recipientId: number,
  raw: unknown,
) {
  const plan = customRetainerSchema.parse(raw);
  if (userId === recipientId) retainerError("Choose another person", 400);
  return retainerTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [userId]);
    const prior = (
      await db.query(
        "SELECT public_id FROM retainer_agreements WHERE proposal_creator_id=$1 AND creation_key=$2",
        [userId, plan.cycles[0].id],
      )
    ).rows[0];
    if (prior) return { agreementPublicId: prior.public_id };
    const users = (
      await db.query("SELECT id,name,role FROM users WHERE id=ANY($1::int[])", [
        [userId, recipientId],
      ])
    ).rows;
    const sender = users.find((u) => u.id === userId),
      recipient = users.find((u) => u.id === recipientId);
    if (
      !sender ||
      !recipient ||
      !["client", "freelancer"].includes(sender.role) ||
      !["client", "freelancer"].includes(recipient.role) ||
      sender.role === recipient.role
    )
      retainerError("Choose a client and a freelancer", 400);
    const client = sender.role === "client" ? sender : recipient;
    const freelancer = sender.role === "freelancer" ? sender : recipient;
    const now = new Date().toISOString();
    const p = (
      await db.query(
        `INSERT INTO projects(client_id,freelancer_id,title,description,status,current_stage,freelancer_name,client_name,is_retainer,billing_cycle,total_cycles,created_at) VALUES($1,$2,$3,'','draft',0,$4,$5,1,'custom',$6,$7) RETURNING id`,
        [
          client.id,
          freelancer.id,
          plan.title,
          freelancer.name,
          client.name,
          plan.cycles.length,
          now,
        ],
      )
    ).rows[0];
    const a = (
      await db.query(
        `INSERT INTO retainer_agreements(public_id,project_id,client_id,freelancer_id,title,start_date,end_date,status,billing_frequency,agreed_cycle_amount_pence,workflow_version,proposal_creator_id,current_version,renewal_mode,proposal_sent_at,draft_data,creation_key) VALUES($1,$2,$3,$4,$5,$6,$7,'awaiting_client_acceptance','custom',$8,1,$9,1,'fixed',$10,$11,$12) RETURNING *`,
        [
          id("ra"),
          p.id,
          client.id,
          freelancer.id,
          plan.title,
          plan.startDate,
          plan.endDate,
          plan.cycles[0].amountPence,
          userId,
          now,
          JSON.stringify({ plan, version: 1, proposedBy: userId }),
          plan.cycles[0].id,
        ],
      )
    ).rows[0];
    await writeVersion(db, a, plan, 1, userId);
    await materialize(db, a, plan);
    await notice(
      db,
      a,
      `proposal:${a.id}:1`,
      `${plan.title}: a retainer proposal is ready for review`,
      [recipientId],
    );
    return { agreementPublicId: a.public_id };
  });
}
async function writeVersion(
  db: RetainerDb,
  a: any,
  plan: CustomRetainerPlan,
  version: number,
  by: number,
) {
  await db.query(
    `INSERT INTO retainer_agreement_versions(public_id,retainer_agreement_id,version_number,snapshot,created_by,accepted_by_client_at,accepted_by_freelancer_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      id("rav"),
      a.id,
      version,
      JSON.stringify(plan),
      by,
      by === a.client_id ? new Date().toISOString() : null,
      by === a.freelancer_id ? new Date().toISOString() : null,
    ],
  );
  await event(db, a, by, `proposal:${a.id}:${version}`, "proposal_sent", {
    version,
  });
}
export async function proposeCustomRetainer(
  publicId: string,
  userId: number,
  expectedVersion: number,
  raw: unknown,
) {
  const plan = customRetainerSchema.parse(raw);
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    if (
      ![
        "active",
        "paused",
        "changes_requested",
        "awaiting_client_acceptance",
      ].includes(a.status)
    )
      retainerError("This agreement cannot be revised");
    const latest = (
      await db.query(
        "SELECT MAX(version_number)::int AS version FROM retainer_agreement_versions WHERE retainer_agreement_id=$1",
        [a.id],
      )
    ).rows[0].version;
    if (latest !== expectedVersion)
      retainerError("The proposal changed. Refresh before sending");
    await validateAmendment(db, a, plan);
    const version = latest + 1;
    await writeVersion(db, a, plan, version, userId);
    await db.query(
      `UPDATE retainer_agreements SET draft_data=$2,proposal_feedback=NULL,status=CASE WHEN status IN ('active','paused') THEN status ELSE 'awaiting_client_acceptance' END WHERE id=$1`,
      [a.id, JSON.stringify({ plan, version, proposedBy: userId, requestedChanges: a.proposal_feedback })],
    );
    await notice(
      db,
      a,
      `proposal:${a.id}:${version}`,
      `${a.title}: revised terms are ready for review`,
      [userId === a.client_id ? a.freelancer_id : a.client_id],
    );
    return { version };
  });
}
export async function reviewProposal(
  publicId: string,
  userId: number,
  version: number,
  action: "accept" | "request_changes" | "decline",
  feedback: string,
) {
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId),
      pending = a.draft_data;
    if (
      !pending ||
      pending.version !== version ||
      pending.proposedBy === userId
    )
      retainerError(
        "Refresh and review the current proposal from the other party",
      );
    if (action === "decline") {
      const alreadyAccepted = !!a.client_accepted_at && !!a.freelancer_accepted_at;
      await db.query(`UPDATE retainer_agreements SET draft_data=NULL,proposal_feedback=$2,
        status=CASE WHEN $3 THEN status ELSE 'declined' END WHERE id=$1`,
        [a.id, feedback.trim().slice(0, 5000) || null, alreadyAccepted]);
      if (!alreadyAccepted) await db.query("UPDATE projects SET status='declined' WHERE id=$1", [a.project_id]);
    } else if (action === "request_changes") {
      if (!feedback.trim()) retainerError("Explain the requested changes", 400);
      await db.query(
        `UPDATE retainer_agreements SET draft_data=NULL,proposal_feedback=$2,status=CASE WHEN status IN ('active','paused') THEN status ELSE 'changes_requested' END WHERE id=$1`,
        [a.id, feedback.trim().slice(0, 5000)],
      );
    } else {
      await validateAmendment(db, a, pending.plan);
      await materialize(db, a, pending.plan);
      const now = new Date().toISOString();
      await db.query(
        `UPDATE retainer_agreements SET title=$2,start_date=$3,end_date=$4,current_version=$5,draft_data=NULL,proposal_feedback=NULL,client_accepted_at=$6,freelancer_accepted_at=$6,status=CASE WHEN status='paused' THEN 'paused' ELSE 'active' END WHERE id=$1`,
        [
          a.id,
          pending.plan.title,
          pending.plan.startDate,
          pending.plan.endDate,
          version,
          now,
        ],
      );
      await db.query(
        `UPDATE retainer_agreement_versions SET accepted_by_client_at=COALESCE(accepted_by_client_at,$3),accepted_by_freelancer_at=COALESCE(accepted_by_freelancer_at,$3) WHERE retainer_agreement_id=$1 AND version_number=$2`,
        [a.id, version, now],
      );
      await db.query(
        `UPDATE projects SET title=$2,status='active',total_cycles=$3 WHERE id=$1`,
        [a.project_id, pending.plan.title, pending.plan.cycles.length],
      );
    }
    await event(db, a, userId, `proposal-review:${a.id}:${version}`, action, {
      version,
      feedback,
    });
    await notice(
      db,
      a,
      `proposal-review:${a.id}:${version}`,
      `${a.title}: proposal ${action === "accept" ? "accepted" : action === "decline" ? "declined" : "changes requested"}`,
    );
    return { ok: true };
  });
}
export async function customWorkspace(publicId: string, userId: number) {
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    const cycles = await loadCycles(db, a.id);
    const tasks = (
      await db.query(
        `SELECT t.*, d.name AS group_name FROM retainer_cycle_tasks t JOIN retainer_cycles c ON c.id=t.retainer_cycle_id LEFT JOIN retainer_deliverables d ON d.id=t.retainer_deliverable_id WHERE c.retainer_agreement_id=$1 ORDER BY c.cycle_number,t.sort_order`,
        [a.id],
      )
    ).rows;
    const submissions = (
      await db.query(
        `SELECT s.id,s.public_id,s.retainer_cycle_task_id,s.version,s.note,s.status,s.client_feedback,s.submitted_at,s.media_id,s.deliverable_url,m.mime_type,m.filename FROM retainer_work_item_submissions s JOIN retainer_cycle_tasks t ON t.id=s.retainer_cycle_task_id JOIN retainer_cycles c ON c.id=t.retainer_cycle_id LEFT JOIN retainer_media m ON m.id=s.media_id WHERE c.retainer_agreement_id=$1 ORDER BY s.version DESC`,
        [a.id],
      )
    ).rows;
    const media = (
      await db.query(
        `SELECT m.id,m.task_id,m.filename,m.mime_type,m.status,m.error FROM retainer_media m JOIN retainer_cycle_tasks t ON t.id=m.task_id JOIN retainer_cycles c ON c.id=t.retainer_cycle_id WHERE c.retainer_agreement_id=$1 ORDER BY m.created_at DESC`,
        [a.id],
      )
    ).rows;
    const latest = (
      await db.query(
        "SELECT snapshot,version_number FROM retainer_agreement_versions WHERE retainer_agreement_id=$1 ORDER BY version_number DESC LIMIT 1",
        [a.id],
      )
    ).rows[0];
    const versions = (await db.query(`SELECT version_number,snapshot,created_by,created_at,
      accepted_by_client_at,accepted_by_freelancer_at FROM retainer_agreement_versions
      WHERE retainer_agreement_id=$1 ORDER BY version_number DESC`,[a.id])).rows;
    const refundHistory = (await db.query(`SELECT p.retainer_cycle_id,r.stripe_refund_id,r.amount_pence,r.status,r.created_at
      FROM payment_refunds r JOIN payments p ON p.id=r.payment_id JOIN retainer_cycles c ON c.id=p.retainer_cycle_id
      WHERE c.retainer_agreement_id=$1 ORDER BY r.created_at DESC`,[a.id])).rows;
    return {
      versions, refundHistory,
      plan: await currentPlan(db, a),
      latestPlan: latest.snapshot,
      latestVersion: latest.version_number,
      pending: a.draft_data,
      feedback: a.proposal_feedback,
      status: a.status,
      hasAcceptedAgreement: !!a.client_accepted_at && !!a.freelancer_accepted_at,
      clientId: a.client_id,
      freelancerId: a.freelancer_id,
      cycles: cycles.map((c) => ({
        ...c,
        ...cycleAccess(cycles, c, a.status),
      })),
      tasks,
      submissions,
      media,
    };
  });
}
export async function submitCustomWork(
  publicId: string,
  userId: number,
  taskPublicId: string,
  mediaId: string | undefined,
  note: string,
  deliverableUrl?: string,
) {
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    if (userId !== a.freelancer_id)
      retainerError("Only the freelancer can submit work", 403);
    const t = (
      await db.query(
        `SELECT t.* FROM retainer_cycle_tasks t JOIN retainer_cycles c ON c.id=t.retainer_cycle_id WHERE t.public_id=$1 AND c.retainer_agreement_id=$2`,
        [taskPublicId, a.id],
      )
    ).rows[0];
    if (!t) retainerError("Work item not found", 404);
    const c = await requireWork(db, a, t.retainer_cycle_id);
    if (!note.trim()) retainerError("Add a submission note", 400);
    let link: string | null = null;
    if (deliverableUrl !== undefined) {
      try {
        const parsed = new URL(deliverableUrl.trim());
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || deliverableUrl.length > 4000)
          throw new Error("Invalid link");
        link = parsed.href;
      } catch {
        retainerError("Enter a valid http or https delivery link without embedded credentials", 400);
      }
    }
    if (Boolean(mediaId) === Boolean(link))
      retainerError("Choose either a delivery link or a processed file", 400);
    if (mediaId) {
      const m = (await db.query(
        "SELECT * FROM retainer_media WHERE id=$1 AND task_id=$2 AND status='ready'",
        [mediaId, t.id],
      )).rows[0];
      if (!m) retainerError("Choose a processed preview for this item");
    }
    const latest = (
      await db.query(
        "SELECT * FROM retainer_work_item_submissions WHERE retainer_cycle_task_id=$1 ORDER BY version DESC LIMIT 1",
        [t.id],
      )
    ).rows[0];
    if (latest?.status === "submitted" &&
        latest.media_id === (mediaId ?? null) &&
        latest.deliverable_url === link &&
        latest.note === note.trim().slice(0, 5000)) return { ok: true };
    await db.query(
      "UPDATE retainer_work_item_submissions SET status='superseded' WHERE retainer_cycle_task_id=$1 AND status IN ('submitted','approved')",
      [t.id],
    );
    await db.query(
      `INSERT INTO retainer_work_item_submissions(public_id,retainer_cycle_task_id,version,submitted_by,note,media_id,deliverable_url,status,submitted_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$8)`,
      [
        id("rws"),
        t.id,
        (latest?.version ?? 0) + 1,
        userId,
        note.trim().slice(0, 5000),
        mediaId ?? null,
        link,
        new Date().toISOString(),
      ],
    );
    await db.query(
      "UPDATE retainer_cycle_tasks SET status='awaiting_client_review',completed_at=NULL WHERE id=$1",
      [t.id],
    );
    await db.query(
      "UPDATE retainer_cycles SET started_at=COALESCE(started_at,$2) WHERE id=$1",
      [c.id, new Date().toISOString()],
    );
    await notice(
      db,
      a,
      `submitted:${t.id}:${(latest?.version ?? 0) + 1}`,
      `${t.title} is ready for review`,
      [a.client_id],
    );
    return { ok: true };
  });
}
export async function reviewCustomWork(
  publicId: string,
  userId: number,
  submissionId: number,
  action: "approve" | "request_changes",
  feedback: string,
) {
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    if (userId !== a.client_id)
      retainerError("Only the client can review work", 403);
    const s = (
      await db.query(
        `SELECT s.*,t.retainer_cycle_id,t.title FROM retainer_work_item_submissions s JOIN retainer_cycle_tasks t ON t.id=s.retainer_cycle_task_id JOIN retainer_cycles c ON c.id=t.retainer_cycle_id WHERE s.id=$1 AND c.retainer_agreement_id=$2`,
        [submissionId, a.id],
      )
    ).rows[0];
    if (!s) retainerError("Submission not found", 404);
    if (action === "approve" && s.status === "approved") return { ok: true };
    if (s.status !== "submitted")
      retainerError("Review the current submitted version");
    const c = await requireWork(db, a, s.retainer_cycle_id);
    if (action === "request_changes" && !feedback.trim())
      retainerError("Add revision feedback", 400);
    const status = action === "approve" ? "approved" : "changes_requested",
      now = new Date().toISOString();
    await db.query(
      "UPDATE retainer_work_item_submissions SET status=$2,client_feedback=$3,reviewed_by=$4,reviewed_at=$5 WHERE id=$1",
      [s.id, status, feedback.slice(0, 5000), userId, now],
    );
    await db.query(
      "UPDATE retainer_cycle_tasks SET status=$2,completed_at=$3 WHERE id=$1",
      [
        s.retainer_cycle_task_id,
        action === "approve" ? "complete" : "changes_requested",
        action === "approve" ? now : null,
      ],
    );
    const remaining = (
      await db.query(
        "SELECT COUNT(*)::int AS count FROM retainer_cycle_tasks WHERE retainer_cycle_id=$1 AND status<>'complete'",
        [c.id],
      )
    ).rows[0].count;
    if (!remaining && !c.accepted_at) {
      const client = (
        await db.query("SELECT name,email FROM users WHERE id=$1", [
          a.client_id,
        ])
      ).rows[0];
      const inv = (
        await db.query(
          `INSERT INTO invoices(invoice_number,project_id,freelancer_id,client_id,client_name,client_email,project_title,line_items,subtotal_pence,total_pence,status,issued_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'sent',$10,$10) RETURNING id`,
          [
            `RC-${c.public_id}`,
            a.project_id,
            a.freelancer_id,
            a.client_id,
            client.name,
            client.email,
            a.title,
            JSON.stringify([
              {
                description: c.cycle_name,
                quantity: 1,
                unitPricePence: c.amount_pence,
                totalPence: c.amount_pence,
              },
            ]),
            c.amount_pence,
            now,
          ],
        )
      ).rows[0];
      await db.query(
        `UPDATE retainer_cycles SET accepted_at=$2::text,due_at=((($2::text::timestamptz AT TIME ZONE 'Europe/London')+make_interval(days=>payment_days)) AT TIME ZONE 'Europe/London')::text,invoice_id=$3,status='awaiting_payment' WHERE id=$1`,
        [c.id, now, inv.id],
      );
      await event(db, a, userId, `cycle-accepted:${c.id}`, "cycle_accepted", {
        cycleId: c.id,
        invoiceId: inv.id,
      });
      await notice(
        db,
        a,
        `cycle-accepted:${c.id}`,
        `${c.cycle_name}: all deliverables approved; the cycle invoice is now payable`,
      );
    }
    await notice(
      db,
      a,
      `review:${s.id}`,
      `${s.title}: ${status === "approved" ? "approved" : "changes requested"}`,
      [a.freelancer_id],
    );
    return { ok: true };
  });
}

// Invitations are derived from agreement acceptance, including existing proposals.
// No second invitation record can independently activate a retainer.
export async function customRetainerInvitations(userId: number) {
  return (await retainerPool().query(`
    SELECT a.public_id AS "publicId", a.project_id AS "projectId", a.status,
      v.created_by AS "senderId",
      CASE WHEN v.created_by=a.client_id THEN a.freelancer_id ELSE a.client_id END AS "recipientId",
      u.name AS "senderName", other_user.name AS "recipientName",
      v.version_number AS version, v.snapshot->>'title' AS title,
      v.snapshot->>'startDate' AS "startDate", v.snapshot->>'endDate' AS "endDate"
    FROM retainer_agreements a
    JOIN LATERAL (SELECT created_by,version_number,snapshot FROM retainer_agreement_versions
      WHERE retainer_agreement_id=a.id ORDER BY version_number DESC LIMIT 1) v ON true
    JOIN users u ON u.id=v.created_by
    JOIN users other_user ON other_user.id=CASE WHEN v.created_by=a.client_id THEN a.freelancer_id ELSE a.client_id END
    WHERE a.workflow_version=1 AND (a.client_id=$1 OR a.freelancer_id=$1)
      AND (a.client_accepted_at IS NULL OR a.freelancer_accepted_at IS NULL)
    ORDER BY a.id DESC`, [userId])).rows;
}
export async function unacceptedRetainerProjectIds(userId: number) {
  return new Set((await retainerPool().query(`SELECT project_id FROM retainer_agreements
    WHERE workflow_version=1 AND (client_id=$1 OR freelancer_id=$1)
    AND (client_accepted_at IS NULL OR freelancer_accepted_at IS NULL)`, [userId])).rows.map(r => r.project_id as number));
}
