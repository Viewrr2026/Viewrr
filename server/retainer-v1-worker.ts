import { Resend } from "resend";
import { retainerPool, retainerTransaction } from "./retainer-v1-db";
import { lockAgreement, notice, loadCycles } from "./retainer-v1-service";
import { processNextRetainerMedia } from "./retainer-v1-media";
export async function scanRetainerDeadlines() {
  const agreements = (
    await retainerPool().query(
      `SELECT DISTINCT a.public_id FROM retainer_agreements a JOIN retainer_cycles c ON c.retainer_agreement_id=a.id WHERE a.workflow_version=1 AND c.accepted_at IS NOT NULL AND c.paid_at IS NULL AND c.due_at IS NOT NULL`,
    )
  ).rows;
  for (const row of agreements)
    await retainerTransaction(async (db) => {
      const a = await lockAgreement(db, row.public_id),
        cycles = await loadCycles(db, a.id);
      const now = Date.now();
      for (const c of cycles.filter(
        (c) => c.accepted_at && !c.paid_at && c.due_at,
      )) {
        const due = new Date(c.due_at).getTime();
        // At most 24h ahead; for shorter terms warn halfway through.
        const lead = Math.min(
          24 * 60 * 60 * 1000,
          Math.max(0, (due - new Date(c.accepted_at).getTime()) / 2),
        );
        if (now >= due) {
          await notice(
            db,
            a,
            `overdue:${c.id}`,
            `${c.cycle_name}: payment is overdue. Subsequent-cycle work is frozen until payment and any required schedule changes are resolved.`,
          );
          await db.query(
            "UPDATE retainer_cycles SET freeze_notified_at=COALESCE(freeze_notified_at,$2) WHERE id=$1",
            [c.id, new Date().toISOString()],
          );
        } else if (lead > 0 && now >= due - lead)
          await notice(
            db,
            a,
            `due-soon:${c.id}`,
            `${c.cycle_name}: payment is due ${new Date(due).toLocaleString("en-GB", { timeZone: "Europe/London" })} Europe/London. Subsequent work freezes if payment becomes overdue.`,
          );
      }
    });
  await retainerTransaction(async (db) => {
    const batch = (
      await db.query(
        `SELECT n.*,a.public_id FROM retainer_notice_outbox n JOIN retainer_agreements a ON a.id=n.agreement_id WHERE n.delivered_at IS NULL ORDER BY n.id LIMIT 100 FOR UPDATE OF n SKIP LOCKED`,
      )
    ).rows;
    for (const n of batch) {
      await db.query(
        `INSERT INTO notifications(recipient_id,actor_id,actor_name,type,message,link) VALUES($1,$1,'Viewrr','retainer_update',$2,$3)`,
        [n.recipient_id, n.message, `/retainer/${n.public_id}`],
      );
      await db.query(
        "UPDATE retainer_notice_outbox SET delivered_at=NOW() WHERE id=$1",
        [n.id],
      );
    }
  });
  await deliverRetainerEmails();
}
async function deliverRetainerEmails() {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  await retainerTransaction(async (db) => {
    const rows = (
      await db.query(`SELECT n.*,a.public_id,u.email,p.email_payment_updates,p.email_stage_updates,p.email_project_invitations
      FROM retainer_notice_outbox n JOIN retainer_agreements a ON a.id=n.agreement_id JOIN users u ON u.id=n.recipient_id
      LEFT JOIN notification_preferences p ON p.user_id=u.id
      WHERE n.delivered_at IS NOT NULL AND n.email_delivered_at IS NULL ORDER BY n.id LIMIT 10 FOR UPDATE OF n SKIP LOCKED`)
    ).rows;
    for (const n of rows) {
      const payment = /^(payment|overdue|due-soon|cycle-accepted):/.test(
        n.event_key,
      );
      const proposal = n.event_key.startsWith("proposal");
      const permitted = payment
        ? n.email_payment_updates
        : proposal
          ? n.email_project_invitations
          : n.email_stage_updates;
      if (permitted !== false && n.email) {
        const origin = process.env.APP_BASE_URL ?? "https://www.viewrr.co.uk";
        const result = await resend.emails.send(
          {
            from: "Viewrr <notifications@viewrr.co.uk>",
            to: n.email,
            subject: "Viewrr retainer update",
            text: `${n.message}\n\nView your retainer: ${origin.replace(/\/$/, "")}/#/retainer/${n.public_id}`,
          },
          { idempotencyKey: `retainer-notice-${n.id}` },
        );
        if (result.error) throw new Error("Retainer email delivery failed");
      }
      await db.query(
        "UPDATE retainer_notice_outbox SET email_delivered_at=NOW() WHERE id=$1",
        [n.id],
      );
    }
  });
}
let started = false;
export function startRetainerWorker() {
  if (
    started ||
    (process.env.CUSTOM_RETAINERS_ENABLED !== "true" &&
      process.env.RETAINER_WORKER_ENABLED !== "true")
  )
    return;
  started = true;
  let mediaBusy = false,
    noticesBusy = false;
  const tick = () => {
    if (!mediaBusy) {
      mediaBusy = true;
      void processNextRetainerMedia()
        .catch((e) => console.error("[retainer-preview]", e.message))
        .finally(() => {
          mediaBusy = false;
        });
    }
    if (!noticesBusy) {
      noticesBusy = true;
      void scanRetainerDeadlines()
        .catch((e) => console.error("[retainer-notices]", e.message))
        .finally(() => {
          noticesBusy = false;
        });
    }
  };
  tick();
  setInterval(tick, 15_000).unref();
}
