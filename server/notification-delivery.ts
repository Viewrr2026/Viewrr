import { Resend } from "resend";
import { retainerTransaction, type RetainerDb } from "./retainer-v1-db";

export type DeliveryNotice = {
  recipientId: number; type: string; message: string; link?: string | null;
  actorId?: number; actorName?: string; actorAvatar?: string | null; read?: number; targetId?: number;
};
export async function queueDelivery(db: RetainerDb, key: string, notice: DeliveryNotice,
  preference = "email_payment_updates", notificationId: number | null = null) {
  await db.query(`INSERT INTO notification_delivery_outbox(event_key,recipient_id,message,type,link,email_preference,notification_id,target_project_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key,recipient_id) DO NOTHING`,
    [key,notice.recipientId,notice.message,notice.type,notice.link ?? "/your-work",preference,notificationId,notice.targetId ?? null]);
}
export async function queuePayoutNotice(key: string, notice: DeliveryNotice) {
  await retainerTransaction(db => queueDelivery(db,key,notice));
}
export type DeliveryAdapters = {
  email: (row: any) => Promise<void>;
  push: (row: any, accepted: (token: string) => Promise<void>) => Promise<void>;
};
const adapters: DeliveryAdapters = {
  async email(row) {
    if (!process.env.RESEND_API_KEY) throw new Error("Email delivery is not configured");
    const origin = (process.env.APP_BASE_URL ?? "https://www.viewrr.co.uk").replace(/\/$/, "");
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: "Viewrr <notifications@viewrr.co.uk>", to: row.email,
      subject: row.type.startsWith("retainer") ? "Viewrr retainer update" : "Viewrr payment update",
      text: `${row.message}\n\nView on Viewrr: ${origin}/#${row.link}`,
    }, { idempotencyKey: `delivery-${row.id}` });
    if (result.error) throw new Error("Email provider rejected delivery");
  },
  async push(row, accepted) {
    const { dispatchPush } = await import("./services/push-service");
    const result = await dispatchPush({ recipientId: row.recipient_id, type: row.type,
      message: row.message, link: row.link, notificationId: row.notification_id,
      actorId: row.recipient_id, actorName: "Viewrr",
      targetType: row.target_project_id ? "project" : null, targetId: row.target_project_id,
      skipTokens: row.accepted_push_tokens, onAccepted: accepted, reliable: true });
    if (result.skipped === "no-credentials" || result.skipped === "degraded")
      throw new Error("Push delivery is not configured or temporarily unavailable");
  },
};
export async function deliverNotificationBatch(delivery: DeliveryAdapters = adapters) {
  for (let i=0;i<10;i++) {
    const found = await retainerTransaction(async db => {
      const row = (await db.query(`SELECT o.*,u.email,u.account_status,p.email_payment_updates,p.email_stage_updates,p.email_project_invitations
        FROM notification_delivery_outbox o JOIN users u ON u.id=o.recipient_id
        LEFT JOIN notification_preferences p ON p.user_id=o.recipient_id
        WHERE (NOT o.email_done OR NOT o.push_done) AND o.next_attempt_at<=NOW()
        ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`)).rows[0];
      if (!row) return false;
      if (row.account_status === "anonymised") {
        await db.query("DELETE FROM notification_delivery_outbox WHERE id=$1",[row.id]); return true;
      }
      if (!row.notification_id) {
        row.notification_id = (await db.query(`INSERT INTO notifications(recipient_id,actor_id,actor_name,type,message,link)
          VALUES($1,$1,'Viewrr',$2,$3,$4) RETURNING id`,[row.recipient_id,row.type,row.message,row.link])).rows[0].id;
        await db.query("UPDATE notification_delivery_outbox SET notification_id=$2 WHERE id=$1",[row.id,row.notification_id]);
      }
      const errors: string[] = [];
      if (!row.email_done) {
        try {
          if (row[row.email_preference] !== false && row.email) await delivery.email(row);
          await db.query("UPDATE notification_delivery_outbox SET email_done=TRUE WHERE id=$1",[row.id]);
        } catch { errors.push("email pending"); }
      }
      if (!row.push_done) {
        try {
          await delivery.push(row, async token => {
            await db.query(`UPDATE notification_delivery_outbox SET accepted_push_tokens=accepted_push_tokens || $2::jsonb WHERE id=$1`,[row.id,JSON.stringify([token])]);
          });
          await db.query("UPDATE notification_delivery_outbox SET push_done=TRUE,accepted_push_tokens='[]'::jsonb WHERE id=$1",[row.id]);
        } catch { errors.push("push pending"); }
      }
      await db.query(`UPDATE notification_delivery_outbox SET attempts=attempts+1,last_error=$2,
        next_attempt_at=NOW()+make_interval(secs=>LEAST(7200,30*power(2,LEAST(attempts,8)))::int) WHERE id=$1`,[row.id,errors.join("; ") || null]);
      return true;
    });
    if (!found) break;
  }
}
let started = false;
export function startNotificationDeliveryWorker() {
  if (started) return;
  started=true;
  let busy=false;
  const tick=async()=>{ if(busy) return; busy=true; try { await deliverNotificationBatch(); }
    catch { console.error("[notification-delivery] Delivery scan failed; queued records will retry"); }
    finally { busy=false; } };
  void tick(); setInterval(()=>void tick(),15000).unref();
}
