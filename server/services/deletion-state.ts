import type { RetainerDb } from '../retainer-v1-db';

// A data-modifying CTE shares its snapshot with the UPDATE, so explicitly
// exclude the removed author's rows when calculating the surviving scores.
export const DELETE_AUTHORED_REVIEWS = `WITH removed AS (
  DELETE FROM reviews WHERE client_id=$1 RETURNING profile_id
) UPDATE profiles p SET
  review_count=(SELECT COUNT(*) FROM reviews r WHERE r.profile_id=p.id AND r.client_id<>$1),
  rating=COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.profile_id=p.id AND r.client_id<>$1),0)
  WHERE p.id IN (SELECT profile_id FROM removed)`;

/** Call only after password verification. Persist before revoking access. */
export async function recordConfirmedDeletion(db: RetainerDb, userId: number, assessment: {
  state: string; scheduledFor: string | null; blockers: { code: string }[];
}, proTiming: 'immediate' | 'pro_period_end' | null = null): Promise<number> {
  const state = proTiming ? 'processing' : assessment.state === 'scheduled' ? 'scheduled' : 'processing';
  const now = new Date().toISOString();
  const result = await db.query(`
    WITH eligible AS (
      SELECT id FROM users WHERE id=$1 AND account_status='active'
        AND NOT EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id=$1 AND state='blocked')
    ), superseded AS (
      UPDATE account_deletion_requests SET state='cancelled',status='cancelled'
      WHERE user_id IN (SELECT id FROM eligible) AND state IN ('pending','scheduled','processing')
    )
    INSERT INTO account_deletion_requests
      (user_id,status,state,requested_at,scheduled_for,deferred_reason,pro_deletion_timing)
    SELECT id,$2,$2,$3,$4,$5,$6 FROM eligible
    RETURNING id`, [userId,state,now,(proTiming ? now : assessment.scheduledFor ?? now),assessment.blockers.map(b => b.code).join(',') || null,proTiming]);
  if (!result.rows.length) throw Object.assign(new Error('Account deletion cannot be confirmed in its current state.'), { status: 409 });
  return Number(result.rows[0].id);
}

export type CleanupStep = { name: string; optional?: string; run: () => Promise<void> };
export type CleanupReport = {
  completedSteps: string[];
  skippedSteps: { step: string; why: string }[];
  failedSteps: { step: string; error: string }[];
};

/** Missing tables may be skipped; a failed existence lookup is a failed step. */
export async function runDeletionCleanup(steps: CleanupStep[], report: CleanupReport,
  tableExists: (name: string) => Promise<boolean>, complete: () => Promise<void>) {
  for (const step of steps) {
    try {
      if (step.optional && !(await tableExists(step.optional))) {
        report.skippedSteps.push({ step: step.name, why: `relation ${step.optional} does not exist` });
        continue;
      }
      await step.run();
      report.completedSteps.push(step.name);
    } catch (e: any) {
      report.failedSteps.push({ step: step.name, error: e?.message ?? String(e) });
    }
  }
  if (report.failedSteps.length) {
    throw Object.assign(new Error('Account cleanup is incomplete and must be retried.'), { partial: true, report });
  }
  // Never publish completion before all cleanup writes have succeeded.
  await complete();
}
