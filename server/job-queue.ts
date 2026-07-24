/**
 * PRD-008 — Durable PostgreSQL-backed job queue
 * No Redis required. Uses background_jobs table as the queue.
 * Supports: queued → running → succeeded | retry_scheduled → failed → dead_letter
 */

import { neon } from "@neondatabase/serverless";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

export type JobType =
  | "process_stripe_event"
  | "fulfil_payment"
  | "create_transfer"
  | "sync_connect_account"
  | "sync_payout"
  | "send_payment_notification"
  | "reconcile_payment"
  | "generate_finance_summary"
  | "generate_receipt"
  | "process_retainer_cycle";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "retry_scheduled"
  | "failed"
  | "dead_letter";

const MAX_ATTEMPTS: Record<JobType, number> = {
  process_stripe_event: 10,
  fulfil_payment: 5,
  create_transfer: 5,
  sync_connect_account: 3,
  sync_payout: 3,
  send_payment_notification: 5,
  reconcile_payment: 3,
  generate_finance_summary: 3,
  generate_receipt: 3,
  process_retainer_cycle: 3,
};

// Exponential backoff: attempt 1→30s, 2→2m, 3→8m, 4→30m, 5+→2h
function backoffMs(attempt: number): number {
  const delays = [30_000, 120_000, 480_000, 1_800_000, 7_200_000];
  return delays[Math.min(attempt, delays.length - 1)];
}

/**
 * Enqueue a job. Uses dedupeKey to prevent duplicates.
 * Returns job id, or existing id if dedupe hit.
 */
export async function enqueueJob(
  jobType: JobType,
  payload: Record<string, unknown>,
  dedupeKey?: string,
  runAfterMs = 0
): Promise<number> {
  const db = getDb();
  const key = dedupeKey ?? `${jobType}:${Date.now()}:${Math.random()}`;
  const runAfter = new Date(Date.now() + runAfterMs).toISOString();

  try {
    const rows = await db`
      INSERT INTO background_jobs (job_type, dedupe_key, payload, status, max_attempts, run_after)
      VALUES (${jobType}, ${key}, ${JSON.stringify(payload)}, 'queued', ${MAX_ATTEMPTS[jobType]}, ${runAfter})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `;
    if (rows.length > 0) return rows[0].id;
    // Dedupe hit — return existing job id
    const existing = await db`SELECT id FROM background_jobs WHERE dedupe_key = ${key} LIMIT 1`;
    return existing[0]?.id ?? -1;
  } catch (e: any) {
    console.error("[job-queue] enqueueJob failed:", e.message);
    throw e;
  }
}

/**
 * Claim the next available job for processing.
 * Uses optimistic locking via status CAS to prevent concurrent processing.
 */
export async function claimNextJob(workerId: string): Promise<{
  id: number;
  jobType: JobType;
  payload: Record<string, unknown>;
  attemptCount: number;
} | null> {
  const db = getDb();
  const now = new Date().toISOString();

  try {
    const rows = await db`
      UPDATE background_jobs
      SET status = 'running', locked_at = ${now}, locked_by = ${workerId},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id FROM background_jobs
        WHERE (status = 'queued' OR status = 'retry_scheduled')
          AND run_after <= ${now}
        ORDER BY run_after ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, job_type, payload, attempt_count
    `;
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      jobType: row.job_type as JobType,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      attemptCount: row.attempt_count,
    };
  } catch {
    return null;
  }
}

export async function markJobSucceeded(jobId: number): Promise<void> {
  const db = getDb();
  await db`
    UPDATE background_jobs
    SET status = 'succeeded', completed_at = ${new Date().toISOString()}, locked_at = NULL, locked_by = NULL
    WHERE id = ${jobId}
  `;
}

export async function markJobFailed(jobId: number, error: string, maxAttempts: number, attemptCount: number): Promise<void> {
  const db = getDb();
  const isFinal = attemptCount >= maxAttempts;
  const nextStatus = isFinal ? "dead_letter" : "retry_scheduled";
  const runAfter = isFinal ? null : new Date(Date.now() + backoffMs(attemptCount)).toISOString();

  await db`
    UPDATE background_jobs
    SET status = ${nextStatus}, last_error = ${error.slice(0, 1000)},
        locked_at = NULL, locked_by = NULL,
        run_after = COALESCE(${runAfter}, run_after)
    WHERE id = ${jobId}
  `;
}

/**
 * Simple in-process worker loop. Call startWorker() once from server startup.
 * Polls the queue every 5 seconds. Safe to run on Render single-instance.
 */
type JobHandler = (payload: Record<string, unknown>, attemptCount: number) => Promise<void>;
const handlers: Map<JobType, JobHandler> = new Map();

export function registerJobHandler(jobType: JobType, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

let workerRunning = false;

export function startWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  const workerId = `worker_${process.pid}_${Date.now()}`;
  console.log("[job-queue] Worker started:", workerId);

  async function tick() {
    try {
      const job = await claimNextJob(workerId);
      if (!job) return;

      const handler = handlers.get(job.jobType);
      if (!handler) {
        await markJobFailed(job.id, `No handler for job type: ${job.jobType}`, 1, 1);
        return;
      }

      try {
        await handler(job.payload, job.attemptCount);
        await markJobSucceeded(job.id);
      } catch (e: any) {
        const db = getDb();
        const row = await db`SELECT max_attempts FROM background_jobs WHERE id = ${job.id} LIMIT 1`;
        const maxAttempts = row[0]?.max_attempts ?? 5;
        await markJobFailed(job.id, e.message ?? "Unknown error", maxAttempts, job.attemptCount);
        console.error(`[job-queue] Job ${job.id} (${job.jobType}) failed attempt ${job.attemptCount}:`, e.message);
      }
    } catch (e) {
      // Worker tick error — log and continue
    }
  }

  // Poll every 5 seconds
  setInterval(tick, 5_000);
  // Also run a reconciliation trigger every 30 minutes
  setInterval(async () => {
    try {
      await enqueueJob("generate_finance_summary", { triggered: "scheduler" }, `summary:${new Date().toISOString().slice(0, 13)}`);
    } catch {}
  }, 30 * 60 * 1000);
}
