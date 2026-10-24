import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';
import { retainerPool, retainerTransaction, type RetainerDb } from '../retainer-v1-db';

export type ProDeletionTiming = 'immediate' | 'pro_period_end';
export function parseProDeletionTiming(value: unknown): ProDeletionTiming | null {
  if (value === undefined || value === null) return null; // Older apps never consented to ending Pro.
  if (value === 'immediate' || value === 'pro_period_end') return value;
  throw Object.assign(new Error('Choose immediate deletion or deletion at the end of Pro Viewrr.'), { status: 400 });
}

function iso(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date(String(value ?? ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function getProDeletionOptions(userId: number, db: RetainerDb = retainerPool()) {
  const { rows } = await db.query(`SELECT status,current_period_end,stripe_subscription_id
    FROM pro_subscriptions WHERE user_id=$1 AND membership_type='paid'
      AND status IN ('active','past_due','payment_failed','cancellation_scheduled')`, [userId]);
  const sub = rows[0];
  if (!sub) return null;
  const periodEnd = iso(sub.current_period_end);
  return {
    periodEnd,
    canScheduleEnd: Boolean(sub.stripe_subscription_id && periodEnd && Date.parse(periodEnd) > Date.now()
      && ['active', 'cancellation_scheduled'].includes(sub.status)),
  };
}

/** The transaction-scoped lock also works through Neon's transaction pooler.
 * The lock connection performs no data writes. Separately committed HTTP
 * writes keep consent durable before Stripe calls or account cleanup.
 */
export async function withAccountDeletionLock<T>(userId: number, run: (db: RetainerDb) => Promise<T>) {
  return retainerTransaction(async lockDb => {
    await lockDb.query('SELECT pg_advisory_xact_lock(17342, $1)', [userId]);
    const sql = neon(process.env.DATABASE_URL!);
    return run({ query: async (text, values) => ({ rows: await sql.query(text, values ?? []) as any[] }) });
  });
}

type Subscription = { id: string; status: string; current_period_end?: number; cancel_at_period_end?: boolean };
export type DeletionStripe = { subscriptions: {
  retrieve(id: string): Promise<Subscription>;
  update(id: string, options: { cancel_at_period_end: boolean }): Promise<Subscription>;
  cancel(id: string, options: { invoice_now: boolean; prorate: boolean }): Promise<Subscription>;
} };
function stripeClient(): DeletionStripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' as any });
}

/** Runs only for a password-confirmed, durable request. Never trusts a client date. */
export async function settleProForDeletion(db: RetainerDb, request: {
  id: number; user_id: number; pro_deletion_timing: ProDeletionTiming | null; pro_delete_after: unknown;
}, options: { stripe?: DeletionStripe; now?: number } = {}): Promise<string | null> {
  const timing = request.pro_deletion_timing;
  if (!timing) return null;
  const now = options.now ?? Date.now();
  const { rows } = await db.query(`SELECT id,status,stripe_subscription_id,current_period_end FROM pro_subscriptions
    WHERE user_id=$1 AND membership_type='paid'`, [request.user_id]);
  const sub = rows[0];
  let notBefore = timing === 'pro_period_end' ? iso(request.pro_delete_after) : null;
  if (!sub?.stripe_subscription_id) {
    if (sub && ['active','past_due','payment_failed','cancellation_scheduled'].includes(sub.status)) {
      throw new Error('Cannot verify Pro cancellation without its Stripe subscription. Deletion will retry.');
    }
    return notBefore;
  }

  const stripe = options.stripe ?? stripeClient();
  let live = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  const terminal = () => ['canceled', 'incomplete_expired'].includes(live.status);

  if (timing === 'pro_period_end' && !notBefore) {
    const periodEnd = typeof live.current_period_end === 'number'
      ? iso(live.current_period_end * 1000) : terminal() ? iso(sub.current_period_end) : null;
    if (!periodEnd) throw new Error('Stripe has not returned a valid Pro expiry date. Deletion will retry.');
    notBefore = periodEnd;
    // Save the verified date BEFORE changing Stripe. Retries must not move it
    // forward or delete early if a cancellation webhook arrives meanwhile.
    await db.query('UPDATE account_deletion_requests SET pro_delete_after=$2 WHERE id=$1', [request.id, notBefore]);
  }

  const wait = timing === 'pro_period_end' && notBefore !== null && Date.parse(notBefore) > now;
  if (!terminal()) {
    live = wait
      ? await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true })
      : await stripe.subscriptions.cancel(sub.stripe_subscription_id, { invoice_now: false, prorate: false });
    if (wait ? (!terminal() && live.cancel_at_period_end !== true) : !terminal()) {
      throw new Error('Stripe has not confirmed Pro cancellation. Deletion will retry.');
    }
  }
  const ended = terminal();
  await db.query(`UPDATE pro_subscriptions SET status=$2,cancel_at_period_end=$3,updated_at=$4
    WHERE id=$1`, [sub.id, ended ? 'cancelled' : 'cancellation_scheduled', ended ? 0 : 1, new Date(now).toISOString()]);
  if (ended) await db.query('UPDATE profiles SET is_pro=0 WHERE user_id=$1', [request.user_id]);
  return notBefore;
}

/** Delayed subscription events must not restore access after immediate termination. */
export async function mayGrantProEntitlement(userId: number, db: RetainerDb = retainerPool()): Promise<boolean> {
  const { rows } = await db.query(`SELECT id FROM users WHERE id=$1 AND account_status='active'
    AND NOT EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id=$1
      AND pro_deletion_timing='immediate' AND state IN ('scheduled','processing','anonymised'))`, [userId]);
  return rows.length > 0;
}

type Blocker = { code: string; label: string; detail: string; clearsAutomatically: boolean; deferDays?: number };
type Assessment = { state: 'none' | 'scheduled'; scheduledFor: string | null; blockers: Blocker[] };
export function applyProDeletionDate(assessment: Assessment, notBefore: string | null, now = Date.now()): Assessment {
  if (!notBefore || Date.parse(notBefore) <= now) return assessment;
  return {
    state: 'scheduled',
    scheduledFor: assessment.scheduledFor && Date.parse(assessment.scheduledFor) > Date.parse(notBefore)
      ? assessment.scheduledFor : notBefore,
    blockers: [...assessment.blockers, {
      code: 'pro_period_end', label: 'End of Pro Viewrr', clearsAutomatically: true,
      detail: `You chose to keep your account until ${new Date(notBefore).toLocaleDateString('en-GB', { timeZone: 'UTC' })}. Pro will not renew.`,
    }],
  };
}

export type DeletionResult = { state: 'scheduled' | 'anonymised' | 'ignored'; scheduledFor: string | null;
  blockers: Blocker[]; proDeletionTiming?: ProDeletionTiming | null; proDeleteAfter?: string | null; message: string };

/** Shared by the confirmation endpoint and its durable background retry. Call under the user lock. */
export async function processConfirmedDeletion(db: RetainerDb, userId: number, requestId: number, deps: {
  assess: (userId: number, options: { skipPro: boolean }) => Promise<Assessment>;
  anonymise: (userId: number) => Promise<unknown>;
  stripe?: DeletionStripe; now?: number;
  retryCompleted?: boolean;
}): Promise<DeletionResult> {
  const { rows } = await db.query(`SELECT adr.*,u.account_status FROM account_deletion_requests adr
    JOIN users u ON u.id=adr.user_id WHERE adr.id=$1 AND adr.user_id=$2
      AND (adr.state IN ('scheduled','processing') OR ($3 AND adr.state='anonymised' AND u.account_status='anonymised'))
      AND NOT EXISTS (SELECT 1 FROM account_deletion_requests hold WHERE hold.user_id=$2 AND hold.state='blocked')
      AND NOT EXISTS (SELECT 1 FROM account_deletion_requests newer WHERE newer.user_id=$2
        AND newer.id>adr.id AND newer.state IN ('scheduled','processing','anonymised'))`, [requestId,userId, deps.retryCompleted === true]);
  if (!rows.length) return { state:'ignored',scheduledFor:null,blockers:[],message:'This deletion request is no longer active.' };
  const request = rows[0];
  try {
    const notBefore = await settleProForDeletion(db, request, deps);
    const assessment = request.account_status === 'anonymised'
      ? { state: 'none' as const, scheduledFor: null, blockers: [] }
      : applyProDeletionDate(await deps.assess(userId, { skipPro: Boolean(request.pro_deletion_timing) }), notBefore, deps.now);
    await db.query(`UPDATE account_deletion_requests SET state=$2,status=$2,scheduled_for=$3,deferred_reason=$4
      WHERE id=$1`, [requestId, assessment.state === 'scheduled' ? 'scheduled' : 'processing',
      assessment.scheduledFor ?? new Date(deps.now ?? Date.now()).toISOString(), assessment.blockers.map(b=>b.code).join(',') || null]);
    if (assessment.state === 'scheduled') {
      return { ...assessment, state: 'scheduled', proDeletionTiming: request.pro_deletion_timing, proDeleteAfter: notBefore,
        message: notBefore && Date.parse(notBefore) > (deps.now ?? Date.now())
          ? `Pro renewal is stopped. Your account will remain available until ${new Date(notBefore).toLocaleDateString('en-GB', { timeZone: 'UTC' })}, then deletion will run automatically once any other outstanding obligations clear.`
          : 'Your deletion is confirmed. Any selected Pro cancellation is complete; deletion will run automatically once the remaining obligations clear.' };
    }
    await deps.anonymise(userId);
    return { state:'anonymised',scheduledFor:null,blockers:[],message:'Your account identity and personal content have been removed. Personal uploads are queued for erasure. Records subject to the disclosed retention policy are retained.' };
  } catch (error) {
    // Confirmed intent and the original paid-through date remain durable.
    await db.query(`UPDATE account_deletion_requests SET state='scheduled',status='scheduled'
      WHERE id=$1 AND state IN ('processing','scheduled')`, [requestId]);
    throw error;
  }
}
