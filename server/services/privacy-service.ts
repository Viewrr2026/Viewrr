// server/services/privacy-service.ts
// PRD-021 WS-B: Data export and account deletion/anonymisation

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, or, and, inArray } from "drizzle-orm";
import * as schema from "../../shared/schema";
import { revokeAllUserSessions } from "../auth-sessions";

function getDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
}

// ─── Data Export ──────────────────────────────────────────────────────────────

/**
 * Compile all personal data held for a user.
 * NEVER includes: passwordHash, token hashes, verification code hashes,
 * internal security data, or another user's private information.
 */
export async function compileUserExport(userId: number): Promise<object> {
  const db = getDb();
  const sql = neon(process.env.DATABASE_URL!);

  // Account
  const [user] = await db.select({
    id: schema.users.id,
    name: schema.users.name,
    email: schema.users.email,
    phone: schema.users.phone,
    role: schema.users.role,
    accountSubtype: schema.users.accountSubtype,
    avatar: schema.users.avatar,
    banner: schema.users.banner,
    headline: schema.users.headline,
    bio: schema.users.bio,
    location: schema.users.location,
    createdAt: schema.users.createdAt,
    accountStatus: schema.users.accountStatus,
  }).from(schema.users).where(eq(schema.users.id, userId));

  if (!user) throw new Error("User not found");

  // Profile
  const profile = await db.select({
    specialisms: schema.profiles.specialisms,
    skills: schema.profiles.skills,
    hourlyRate: schema.profiles.hourlyRate,
    dayRate: schema.profiles.dayRate,
    availability: schema.profiles.availability,
    yearsExperience: schema.profiles.yearsExperience,
    reelUrl: schema.profiles.reelUrl,
    portfolioItems: schema.profiles.portfolioItems,
    socialLinks: schema.profiles.socialLinks,
    rating: schema.profiles.rating,
    reviewCount: schema.profiles.reviewCount,
    projectCount: schema.profiles.projectCount,
    cardThumbnail: schema.profiles.cardThumbnail,
  }).from(schema.profiles).where(eq(schema.profiles.userId, userId));

  // Projects
  const projects = await db.select({
    id: schema.projects.id,
    title: schema.projects.title,
    description: schema.projects.description,
    status: schema.projects.status,
    createdAt: schema.projects.createdAt,
    completedAt: schema.projects.completedAt,
    clientId: schema.projects.clientId,
    freelancerId: schema.projects.freelancerId,
  }).from(schema.projects).where(
    or(eq(schema.projects.clientId, userId), eq(schema.projects.freelancerId, userId))
  );

  // Reviews written by this user
  const reviewsWritten = await db.select({
    profileId: schema.reviews.profileId,
    rating: schema.reviews.rating,
    comment: schema.reviews.comment,
    createdAt: schema.reviews.createdAt,
  }).from(schema.reviews).where(eq(schema.reviews.clientId, userId));

  // Reviews received (on this user's profile)
  const profileRow = await db.select({ id: schema.profiles.id })
    .from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const profileId = profileRow[0]?.id ?? null;
  const reviewsReceived = profileId
    ? await db.select({
        clientName: schema.reviews.clientName,
        rating: schema.reviews.rating,
        comment: schema.reviews.comment,
        createdAt: schema.reviews.createdAt,
      }).from(schema.reviews).where(eq(schema.reviews.profileId, profileId))
    : [];

  // Briefs
  const briefs = await db.select({
    id: schema.briefs.id,
    title: schema.briefs.title,
    description: schema.briefs.description,
    category: schema.briefs.category,
    status: schema.briefs.status,
    createdAt: schema.briefs.createdAt,
  }).from(schema.briefs).where(eq(schema.briefs.clientId, userId));

  // Brief interests (applications)
  const briefInterests = await db.select({
    briefId: schema.briefInterests.briefId,
    briefTitle: schema.briefInterests.briefTitle,
    coverNote: schema.briefInterests.coverNote,
    status: schema.briefInterests.status,
    createdAt: schema.briefInterests.createdAt,
  }).from(schema.briefInterests).where(eq(schema.briefInterests.freelancerId, userId));

  // Messages (sent and received)
  const messagesSent = await db.select({
    toId: schema.messages.toId,
    content: schema.messages.content,
    createdAt: schema.messages.createdAt,
  }).from(schema.messages).where(eq(schema.messages.fromId, userId));

  const messagesReceived = await db.select({
    fromId: schema.messages.fromId,
    content: schema.messages.content,
    createdAt: schema.messages.createdAt,
    read: schema.messages.read,
  }).from(schema.messages).where(eq(schema.messages.toId, userId));

  // Notifications (recipient only — own records)
  const notifications = await db.select({
    type: schema.notifications.type,
    message: schema.notifications.message,
    read: schema.notifications.read,
    createdAt: schema.notifications.createdAt,
  }).from(schema.notifications).where(eq(schema.notifications.recipientId, userId));

  // Legal acceptances
  const legalAcceptances = await sql`
    SELECT ta.document, ta.version, ta.accepted_at, ta.context, ta.acceptance_method
    FROM terms_acceptances ta
    WHERE ta.user_id = ${userId}
    ORDER BY ta.accepted_at DESC
  `;

  // Auth session metadata (not token hashes)
  const sessions = await db.select({
    clientType: schema.authSessions.clientType,
    createdAt: schema.authSessions.createdAt,
    lastUsedAt: schema.authSessions.lastUsedAt,
    expiresAt: schema.authSessions.expiresAt,
    revokedAt: schema.authSessions.revokedAt,
    revokedReason: schema.authSessions.revokedReason,
  }).from(schema.authSessions).where(eq(schema.authSessions.userId, userId));

  // Invoices
  const invoices = await db.select({
    invoiceNumber: schema.invoices.invoiceNumber,
    projectId: schema.invoices.projectId,
    clientName: schema.invoices.clientName,
    projectTitle: schema.invoices.projectTitle,
    totalPence: schema.invoices.totalPence,
    status: schema.invoices.status,
    issuedAt: schema.invoices.issuedAt,
    paidAt: schema.invoices.paidAt,
  }).from(schema.invoices).where(
    or(eq(schema.invoices.clientId, userId), eq(schema.invoices.freelancerId, userId))
  );

  // Payment records (client or freelancer)
  const payments = await db.select({
    publicId: schema.payments.publicId,
    paymentKind: schema.payments.paymentKind,
    currency: schema.payments.currency,
    grossPence: schema.payments.grossPence,
    freelancerPence: schema.payments.freelancerPence,
    status: schema.payments.status,
    createdAt: schema.payments.createdAt,
    succeededAt: schema.payments.succeededAt,
  }).from(schema.payments).where(
    or(eq(schema.payments.clientId, userId), eq(schema.payments.freelancerId, userId))
  );

  // Upload object metadata (not raw file bytes)
  const uploadObjects = await db.select({
    objectKey: schema.uploadObjects.objectKey,
    resourceType: schema.uploadObjects.resourceType,
    mimeType: schema.uploadObjects.mimeType,
    sizeBytes: schema.uploadObjects.sizeBytes,
    originalFilename: schema.uploadObjects.originalFilename,
    status: schema.uploadObjects.status,
    confirmedAt: schema.uploadObjects.confirmedAt,
    createdAt: schema.uploadObjects.createdAt,
  }).from(schema.uploadObjects).where(
    eq(schema.uploadObjects.ownerUserId, userId)
  );

  return {
    exportedAt: new Date().toISOString(),
    exportVersion: "1.0",
    account: user,
    profile: profile[0] ?? null,
    projects,
    reviewsWritten,
    reviewsReceived,
    briefs,
    briefInterests,
    messagesSent,
    messagesReceived,
    notifications,
    legalAcceptances,
    sessions,
    invoices,
    payments,
    uploadObjects,
  };
}

// ─── Account Deletion / Anonymisation ────────────────────────────────────────
//
// PRD 1, Decision 6. Read `docs/RETENTION_SCHEDULE.md` alongside this file —
// the two must stay in sync. If you change what is deleted, anonymised or
// retained here, change the schedule document in the same commit.
//
// Two hard rules:
//   1. Deletion is NEVER indefinitely refused. When a legal, financial or
//      contractual obligation prevents immediate erasure, the request is
//      SCHEDULED, not rejected.
//   2. `users.password_algo` is `text NOT NULL` in production. Writing NULL to
//      it throws a not-null violation, which is why confirm-deletion has been
//      failing in production. A sentinel value is written instead.

/**
 * Sentinel written to users.password_algo on anonymisation.
 *
 * PRODUCTION BUG FIX (contract §A): the column is `text NOT NULL`. The previous
 * implementation set it to NULL, so every POST /api/me/confirm-deletion failed
 * with a not-null violation and no account could ever be deleted. Any value
 * that is not a real algorithm name works, because `password_hash` is NULL and
 * the login route rejects null-hash accounts before it ever looks at the algo.
 */
export const DELETED_PASSWORD_ALGO = "deleted";

// ─── Retention schedule (mirrors docs/RETENTION_SCHEDULE.md) ─────────────────

export type RetentionAction = "deleted" | "anonymised" | "retained";

export type RetentionEntry = {
  category: string;
  action: RetentionAction;
  /** 0 = at the moment of deletion. >0 = retained for this many days. */
  periodDays: number;
  detail: string;
};

/**
 * The single machine-readable retention schedule, returned verbatim by
 * GET /api/me/deletion-status so the app can show the user the truth rather
 * than a reassuring summary.
 *
 * 2190 days ≈ 6 years — the UK statutory minimum for financial records.
 * HMRC requires business records to be kept for 6 years from the end of the
 * accounting period they relate to (Companies Act 2006 s.388 / HMRC guidance).
 * Invoices and payment records therefore CANNOT be erased on request; they are
 * anonymised as far as is possible while remaining a valid tax record.
 */
export const RETENTION_SCHEDULE: RetentionEntry[] = [
  { category: "Account identifiers (name, email, phone, avatar, bio, location)",
    action: "anonymised", periodDays: 0,
    detail: "Replaced with [deleted-<id>] / deleted-<id>@viewrr-deleted.invalid immediately." },
  { category: "Password hash and reset tokens",
    action: "deleted", periodDays: 0,
    detail: "Hash nulled, all password reset tokens deleted immediately." },
  { category: "Login sessions and push device tokens",
    action: "deleted", periodDays: 0,
    detail: "All sessions revoked and all push tokens deleted immediately." },
  { category: "Profile, portfolio, reel and social links",
    action: "deleted", periodDays: 0,
    detail: "Cleared immediately. Rating/review counts are zeroed." },
  { category: "Feed posts, comments, likes and saved profiles",
    action: "anonymised", periodDays: 0,
    detail: "Post and comment bodies replaced with a removed-content placeholder; likes and saves deleted. Threads survive so other users' replies still make sense." },
  { category: "Direct messages you sent",
    action: "anonymised", periodDays: 0,
    detail: "Content replaced with [message deleted]. The row is kept so the other party's thread is not corrupted." },
  { category: "Direct messages you received",
    action: "retained", periodDays: 2190,
    detail: "Belongs to the other party as well; kept as their record. Your identity in it is already anonymised." },
  { category: "Briefs, interests, project titles and stage history",
    action: "anonymised", periodDays: 0,
    detail: "Your display name is replaced everywhere it was denormalised. The work record itself is kept for the counterparty." },
  { category: "Reviews you wrote",
    action: "anonymised", periodDays: 0,
    detail: "Reviewer name/avatar anonymised. The rating and comment stay, because deleting them would silently rewrite another user's public rating." },
  { category: "Invoices and invoice templates",
    action: "retained", periodDays: 2190,
    detail: "UK statutory retention: HMRC requires business records for ~6 years. Client name/email on invoices are anonymised; the financial figures, invoice numbers and dates are NOT erasable." },
  { category: "Payments, transfers, refunds, payouts, Stripe records",
    action: "retained", periodDays: 2190,
    detail: "Financial and anti-fraud records. Retained in full for ~6 years, keyed to your (now anonymised) user id." },
  { category: "Pro subscription records",
    action: "retained", periodDays: 2190,
    detail: "Billing record. Retained; an active subscription is cancelled first." },
  { category: "Retainer agreements and cycles",
    action: "retained", periodDays: 2190,
    detail: "Contractual records between two parties. Retained; your identifiers within them are anonymised." },
  { category: "Terms and policy acceptances",
    action: "retained", periodDays: 2190,
    detail: "Legal evidence of consent — this is the record that proves what you agreed to. Retained; IP address and user agent are deleted immediately." },
  { category: "Moderation reports and content flags",
    action: "retained", periodDays: 730,
    detail: "Reports you filed and flags raised against your content are kept for 2 years for safety and repeat-abuse detection, with excerpts anonymised." },
  { category: "Admin/moderation audit log",
    action: "retained", periodDays: 2190,
    detail: "Append-only. Records that an action was taken, by whom and when. Never rewritten." },
  { category: "Uploaded file metadata",
    action: "deleted", periodDays: 0,
    detail: "Object records marked deleted and original filenames cleared. Object bytes are purged by the storage lifecycle rule within 30 days." },
  { category: "Notification history and preferences",
    action: "deleted", periodDays: 0,
    detail: "Your notification rows and both preference records deleted; your name is scrubbed from other users' notification rows." },
  { category: "Profile view analytics",
    action: "deleted", periodDays: 0,
    detail: "Views you made are deleted; views of your profile are aggregated and de-identified." },
  { category: "Tasks, calendar events and time entries",
    action: "deleted", periodDays: 0,
    detail: "Personal planning data deleted. Time entries attached to a billable project are anonymised, not deleted." },
];

// ─── Blockers ────────────────────────────────────────────────────────────────

export type DeletionBlockerCode =
  | "active_project"
  | "unpaid_invoice"
  | "pending_transfer"
  | "stripe_pending_balance"
  | "pending_payout"
  | "active_pro_subscription"
  | "sole_agency_owner";

export type DeletionBlockerInfo = {
  code: DeletionBlockerCode;
  label: string;
  detail: string;
  /**
   * true  — resolves on its own (a transfer settles, a payout arrives, a
   *         subscription period ends). The user needs to do nothing.
   * false — needs an action from the user or the counterparty (finish the
   *         project, pay the invoice, hand over the agency).
   */
  clearsAutomatically: boolean;
  /** Days added to `scheduledFor` when this blocker is present. */
  deferDays: number;
};

export type DeletionAssessment = {
  /** Back-compat with PRD-021 callers and server/tests/prd021.test.ts. */
  blocked: boolean;
  /** "none" = can be confirmed now. "scheduled" = deferred, never refused. */
  state: "none" | "scheduled";
  /** ISO timestamp. Present iff state === "scheduled". */
  scheduledFor: string | null;
  blockers: DeletionBlockerInfo[];
  /** Legacy single-reason fields — first blocker, for old web copy. */
  reason?: string;
  code?: DeletionBlockerCode;
};

/** Longest deferral we will ever quote, so the user always gets a real date. */
const MAX_DEFER_DAYS = 90;

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Assess whether deletion can proceed immediately.
 *
 * DECISION 6: this NEVER produces a refusal. It produces either
 *   state "none"      — nothing in the way, confirm-deletion will anonymise now
 *   state "scheduled" — obligations outstanding, so the request is scheduled
 *                       for `scheduledFor` and processed then.
 * The old behaviour (HTTP 409 forever, with no path to deletion) was not a
 * lawful answer to an erasure request.
 */
export async function checkDeletionBlockers(userId: number): Promise<DeletionAssessment> {
  const db = getDb();
  const sql = neon(process.env.DATABASE_URL!);
  const blockers: DeletionBlockerInfo[] = [];

  // 1. Active projects (contractual obligation to a counterparty).
  const activeProjects = await db.select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(
      or(eq(schema.projects.clientId, userId), eq(schema.projects.freelancerId, userId)),
      inArray(schema.projects.status, ["active", "pending"])
    ));
  if (activeProjects.length > 0) {
    blockers.push({
      code: "active_project",
      label: `${activeProjects.length} project${activeProjects.length === 1 ? "" : "s"} still open`,
      detail: "We cannot erase your account while you owe work to, or are owed work by, another Viewrr user. Complete or cancel the project and deletion proceeds immediately.",
      clearsAutomatically: false,
      deferDays: 90,
    });
  }

  // 2. Unpaid invoices (financial obligation).
  const unpaidInvoices = await sql`
    SELECT COUNT(*)::int AS n FROM invoices
    WHERE (client_id = ${userId} OR freelancer_id = ${userId})
      AND status NOT IN ('paid', 'cancelled', 'void')
  `;
  if (Number(unpaidInvoices[0]?.n ?? 0) > 0) {
    blockers.push({
      code: "unpaid_invoice",
      label: `${unpaidInvoices[0].n} unsettled invoice${Number(unpaidInvoices[0].n) === 1 ? "" : "s"}`,
      detail: "Outstanding invoices must be settled or cancelled. The invoice record itself is retained for ~6 years regardless (HMRC), but it cannot be left unsettled against an anonymised account.",
      clearsAutomatically: false,
      deferDays: 90,
    });
  }

  // 3. Pending payment transfers (money in flight).
  const pendingTransfers = await sql`
    SELECT COUNT(*)::int AS n FROM payment_transfers pt
    JOIN payments p ON p.id = pt.payment_id
    WHERE (p.client_id = ${userId} OR p.freelancer_id = ${userId})
      AND pt.status IN ('pending', 'processing')
  `;
  if (Number(pendingTransfers[0]?.n ?? 0) > 0) {
    blockers.push({
      code: "pending_transfer",
      label: "Payment transfer in progress",
      detail: "Money is moving between Stripe accounts. This settles on its own, normally within a few working days.",
      clearsAutomatically: true,
      deferDays: 30,
    });
  }

  // 4. Held earnings on the user record (users.stripe_pending_pence).
  //    MISSING BEFORE: a freelancer could be anonymised while Viewrr still owed
  //    them money, with no identity left to pay it to.
  const heldBalance = await sql`
    SELECT COALESCE(stripe_pending_pence, 0)::int AS pence FROM users WHERE id = ${userId} LIMIT 1
  `;
  const pence = Number(heldBalance[0]?.pence ?? 0);
  if (pence > 0) {
    blockers.push({
      code: "stripe_pending_balance",
      label: `£${(pence / 100).toFixed(2)} of earnings not yet paid out`,
      detail: "We will not anonymise an account we still owe money to. Withdraw the balance (or wait for the next automatic payout) and deletion proceeds.",
      clearsAutomatically: true,
      deferDays: 30,
    });
  }

  // 5. Payouts in flight (payment_payouts).
  const pendingPayouts = await sql`
    SELECT COUNT(*)::int AS n FROM payment_payouts
    WHERE freelancer_id = ${userId}
      AND status IN ('pending', 'in_transit')
  `;
  if (Number(pendingPayouts[0]?.n ?? 0) > 0) {
    blockers.push({
      code: "pending_payout",
      label: "Payout on its way to your bank",
      detail: "A Stripe payout has not landed yet. It arrives on its own, normally within a few working days.",
      clearsAutomatically: true,
      deferDays: 30,
    });
  }

  // 6. Live Pro subscription (recurring billing must be stopped first, or the
  //    user gets charged after they believe their account is gone).
  const proSub = await sql`
    SELECT status FROM pro_subscriptions
    WHERE user_id = ${userId}
      AND status IN ('active', 'past_due', 'payment_failed', 'cancellation_scheduled')
    LIMIT 1
  `;
  if (proSub.length > 0) {
    blockers.push({
      code: "active_pro_subscription",
      label: "Pro Viewrr subscription still live",
      detail: `Your subscription status is "${proSub[0].status}". Cancel it in Pro settings so Stripe stops billing you; deletion then proceeds at the end of the paid period.`,
      clearsAutomatically: false,
      deferDays: 30,
    });
  }

  // 7. Sole agency owner with other members. Anonymising the owner would leave
  //    an agency nobody can administer, and its members without a route out.
  const soleOwner = await sql`
    SELECT a.id, a.name,
           (SELECT COUNT(*)::int FROM agency_members m
             WHERE m.agency_id = a.id AND m.user_id <> ${userId}) AS other_members
    FROM agencies a
    WHERE a.owner_user_id = ${userId}
    LIMIT 1
  `;
  if (soleOwner.length > 0 && Number(soleOwner[0].other_members ?? 0) > 0) {
    blockers.push({
      code: "sole_agency_owner",
      label: `You are the only owner of ${soleOwner[0].name}`,
      detail: `${soleOwner[0].other_members} other member(s) rely on this agency. Transfer ownership or remove the members first — otherwise the agency is left with no administrator.`,
      clearsAutomatically: false,
      deferDays: 90,
    });
  }

  if (blockers.length === 0) {
    return { blocked: false, state: "none", scheduledFor: null, blockers: [] };
  }

  const deferDays = Math.min(
    Math.max(...blockers.map((b) => b.deferDays)),
    MAX_DEFER_DAYS,
  );

  return {
    blocked: true,
    state: "scheduled",
    scheduledFor: isoInDays(deferDays),
    blockers,
    reason: blockers[0].detail,
    code: blockers[0].code,
  };
}

// ─── Deletion status (contract §D: GET /api/me/deletion-status) ──────────────

export type DeletionStatus = {
  state: "none" | "scheduled" | "blocked";
  scheduledFor?: string;
  blockers: { code: string; label: string; detail: string; clearsAutomatically: boolean }[];
  retention: { category: string; action: string; periodDays: number; detail: string }[];
};

/**
 * Contract §D. NEVER returns 409 and never returns state "blocked" from a fresh
 * assessment — "blocked" exists in the union only because the contract declares
 * it, and is reserved for an admin hold placed on a specific account.
 */
export async function getDeletionStatus(userId: number): Promise<DeletionStatus> {
  const sql = neon(process.env.DATABASE_URL!);
  const assessment = await checkDeletionBlockers(userId);

  // An already-submitted request wins: show the user the date we committed to.
  let existingScheduledFor: string | null = null;
  let adminHold = false;
  try {
    const rows = await sql`
      SELECT state, status, scheduled_for
      FROM account_deletion_requests
      WHERE user_id = ${userId}
        AND COALESCE(state, status) NOT IN ('anonymised', 'cancelled')
      ORDER BY id DESC
      LIMIT 1
    `;
    if (rows.length) {
      existingScheduledFor = rows[0].scheduled_for ? new Date(rows[0].scheduled_for).toISOString() : null;
      adminHold = rows[0].state === "blocked";
    }
  } catch (e: any) {
    // Pre-migration-0006 databases have no `state`/`scheduled_for` column.
    // Degrade to the live assessment rather than failing the request.
    console.warn("[privacy] deletion-status: request lookup failed:", e?.message);
  }

  const retention = RETENTION_SCHEDULE.map((r) => ({
    category: r.category,
    action: r.action,
    periodDays: r.periodDays,
    detail: r.detail,
  }));

  const blockers = assessment.blockers.map((b) => ({
    code: b.code,
    label: b.label,
    detail: b.detail,
    clearsAutomatically: b.clearsAutomatically,
  }));

  if (adminHold) {
    return { state: "blocked", scheduledFor: existingScheduledFor ?? undefined, blockers, retention };
  }
  if (assessment.state === "scheduled" || existingScheduledFor) {
    return {
      state: "scheduled",
      scheduledFor: existingScheduledFor ?? assessment.scheduledFor ?? undefined,
      blockers,
      retention,
    };
  }
  return { state: "none", blockers, retention };
}

// ─── Anonymisation ───────────────────────────────────────────────────────────

/** Does this relation exist? Used for tables that may predate/postdate a migration. */
async function tableExists(name: string): Promise<boolean> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`SELECT to_regclass(${`public.${name}`}) AS reg`;
    return Boolean(rows[0]?.reg);
  } catch {
    return false;
  }
}

export type AnonymisationReport = {
  userId: number;
  completedSteps: string[];
  skippedSteps: { step: string; why: string }[];
  failedSteps: { step: string; error: string }[];
};

/**
 * Anonymise a user account. Irreversible. Call checkDeletionBlockers first.
 *
 * Coverage note: the previous implementation touched SEVEN tables (users,
 * profiles, messages, connection_requests, notifications and the deletion
 * request row) and left plaintext identifiers behind in at least
 * deleted_posts.owner_email, reviews.client_name, briefs.client_name,
 * invoices.client_email, invoice_templates.business_email, every post and
 * comment, and upload_objects.original_filename. All of those are covered here.
 *
 * Several tables are raw-SQL-only and invisible to Drizzle
 * (`terms_acceptances`, `terms_versions`, `password_reset_tokens`, the
 * `retainer_*` family, `session`) — they are handled with raw SQL and guarded
 * by `tableExists` where their presence is not guaranteed.
 *
 * Failure model: every step is idempotent, so the whole function is safe to
 * re-run. Step 1 (the users row) is the critical one and throws immediately on
 * failure; every later step is attempted even if an earlier one failed, so a
 * single bad table cannot leave most of the PII in place. If any later step
 * failed, the function throws at the end with a list — the caller must surface
 * that and the operation must be retried.
 */
export async function anonymiseUserAccount(userId: number): Promise<AnonymisationReport> {
  const sql = neon(process.env.DATABASE_URL!);
  const anonName = `[deleted-${userId}]`;
  const anonEmail = `deleted-${userId}@viewrr-deleted.invalid`;
  const now = new Date().toISOString();
  const report: AnonymisationReport = { userId, completedSteps: [], skippedSteps: [], failedSteps: [] };

  // Capture the real email BEFORE step 1 overwrites it — needed to invalidate
  // outstanding verification codes, which are keyed by a hash of the address.
  let originalEmail = "";
  try {
    const rows = await sql`SELECT email FROM users WHERE id = ${userId} LIMIT 1`;
    originalEmail = String(rows[0]?.email ?? "");
  } catch { /* non-fatal: only used to invalidate verification codes */ }

  // 0. Revoke all active sessions FIRST — single bulk UPDATE, no N+1.
  //    Deliberately before anything else: the account must stop being usable
  //    before its data starts changing underneath it.
  await revokeAllUserSessions(userId, "user_deleted");
  report.completedSteps.push("auth_sessions (revoked)");

  // 1. users — CRITICAL. Throws on failure.
  //    password_algo gets a SENTINEL, never NULL: the column is text NOT NULL
  //    in production and the old NULL write is exactly why confirm-deletion
  //    has been failing.
  await sql`
    UPDATE users SET
      name = ${anonName},
      email = ${anonEmail},
      phone = NULL,
      avatar = NULL,
      banner = NULL,
      headline = NULL,
      bio = NULL,
      location = NULL,
      password_hash = NULL,
      password_algo = ${DELETED_PASSWORD_ALGO},
      account_status = 'anonymised'
    WHERE id = ${userId}
  `;
  report.completedSteps.push("users");

  // Every step below is best-effort-but-reported.
  const steps: { name: string; optional?: string; run: () => Promise<void> }[] = [
    // ── Profile & presentation ──────────────────────────────────────────────
    { name: "profiles", run: async () => {
      await sql`
        UPDATE profiles SET
          specialisms = '[]', skills = '[]', social_links = '{}', portfolio_items = '[]',
          reel_url = NULL, card_thumbnail = NULL, hourly_rate = NULL, day_rate = NULL,
          badges = '[]', featured = 0, availability = 'unavailable',
          rating = 0, review_count = 0, project_count = 0, is_pro = 0, pro_since = NULL,
          accreditation_level = NULL, accreditation_notes = NULL,
          accreditation_approved_by = NULL, accreditation_approved_by_name = NULL
        WHERE user_id = ${userId}
      `;
    }},

    // ── Feed / social content ───────────────────────────────────────────────
    { name: "posts", run: async () => {
      // MISSED BEFORE: post bodies and media links survived deletion entirely.
      await sql`
        UPDATE posts SET
          caption = '[removed with deleted account]',
          media_url = NULL, media_type = NULL, tags = '[]'
        WHERE user_id = ${userId}
      `;
    }},
    { name: "post_comments", run: async () => {
      // MISSED BEFORE.
      await sql`UPDATE post_comments SET content = '[removed with deleted account]' WHERE user_id = ${userId}`;
    }},
    { name: "post_likes", run: async () => {
      await sql`DELETE FROM post_likes WHERE user_id = ${userId}`;
    }},
    { name: "saved", run: async () => {
      await sql`DELETE FROM saved WHERE client_id = ${userId}`;
    }},
    { name: "deleted_posts", run: async () => {
      // MISSED BEFORE — this table stores owner_email in PLAINTEXT and is the
      // worst single leak in the old implementation.
      await sql`
        UPDATE deleted_posts SET
          owner_name = ${anonName},
          owner_email = ${anonEmail},
          caption = '[removed with deleted account]',
          media_url = NULL, tags = NULL
        WHERE owner_id = ${userId}
      `;
    }},
    { name: "content_flags", optional: "content_flags", run: async () => {
      await sql`UPDATE content_flags SET excerpt = '[removed with deleted account]' WHERE author_user_id = ${userId}`;
    }},

    // ── Messaging ───────────────────────────────────────────────────────────
    { name: "messages", run: async () => {
      // Only messages SENT by this user are cleared. Messages received are the
      // other party's record; the sender identity there is already anonymised
      // via users. Thread structure is preserved on purpose.
      await sql`UPDATE messages SET content = '[message deleted]' WHERE from_id = ${userId}`;
    }},
    { name: "connection_requests", run: async () => {
      await sql`DELETE FROM connection_requests WHERE sender_id = ${userId} OR recipient_id = ${userId}`;
    }},

    // ── Notifications ───────────────────────────────────────────────────────
    { name: "notifications (actor)", run: async () => {
      await sql`UPDATE notifications SET actor_name = '[deleted user]', actor_avatar = NULL WHERE actor_id = ${userId}`;
    }},
    { name: "notifications (recipient)", run: async () => {
      await sql`DELETE FROM notifications WHERE recipient_id = ${userId}`;
    }},
    { name: "notification_preferences", run: async () => {
      await sql`DELETE FROM notification_preferences WHERE user_id = ${userId}`;
    }},
    { name: "push_tokens", optional: "push_tokens", run: async () => {
      // Must be explicit: the FK cascade only fires on DELETE of the users row,
      // and we anonymise rather than delete it.
      await sql`DELETE FROM push_tokens WHERE user_id = ${userId}`;
    }},
    { name: "push_preferences", optional: "push_preferences", run: async () => {
      await sql`DELETE FROM push_preferences WHERE user_id = ${userId}`;
    }},

    // ── Discovery / analytics ───────────────────────────────────────────────
    { name: "profile_views", run: async () => {
      // Views this user made: delete. Views OF this user's profile: keep the
      // row (it is an aggregate count) but drop the identifying IP.
      await sql`DELETE FROM profile_views WHERE viewer_id = ${userId}`;
      await sql`UPDATE profile_views SET viewer_ip = NULL WHERE profile_user_id = ${userId}`;
    }},

    // ── Work: briefs, interests, projects ───────────────────────────────────
    { name: "briefs", run: async () => {
      // MISSED BEFORE — briefs.client_name is a denormalised plaintext name.
      await sql`UPDATE briefs SET client_name = ${anonName}, client_avatar = NULL WHERE client_id = ${userId}`;
    }},
    { name: "brief_interests", run: async () => {
      await sql`
        UPDATE brief_interests SET freelancer_name = ${anonName}, freelancer_avatar = NULL
        WHERE freelancer_id = ${userId}
      `;
      await sql`UPDATE brief_interests SET brief_client_name = ${anonName} WHERE brief_client_id = ${userId}`;
    }},
    { name: "projects", run: async () => {
      // The project itself is a contractual record for the counterparty and is
      // retained; only the denormalised display names are scrubbed.
      await sql`UPDATE projects SET client_name = ${anonName} WHERE client_id = ${userId}`;
      await sql`UPDATE projects SET freelancer_name = ${anonName} WHERE freelancer_id = ${userId}`;
    }},
    { name: "project_invitations", run: async () => {
      await sql`DELETE FROM project_invitations WHERE (sender_id = ${userId} OR recipient_id = ${userId}) AND status = 'pending'`;
    }},
    { name: "project_updates", run: async () => {
      // Free-text notes authored by this user on a shared project. The other
      // party legitimately relies on these, so they are kept but attributed to
      // an anonymised id. Nothing to scrub beyond that.
      await sql`SELECT 1 FROM project_updates WHERE author_id = ${userId} LIMIT 1`;
    }},
    { name: "meetings", run: async () => {
      await sql`UPDATE meetings SET meet_link = '', status = 'cancelled' WHERE created_by = ${userId} AND status = 'scheduled'`;
    }},
    { name: "tasks", run: async () => {
      await sql`DELETE FROM tasks WHERE user_id = ${userId}`;
    }},
    { name: "calendar_events", run: async () => {
      await sql`DELETE FROM calendar_events WHERE user_id = ${userId}`;
    }},
    { name: "time_entries", run: async () => {
      // Billable evidence — retained, free-text description scrubbed.
      await sql`UPDATE time_entries SET description = '' WHERE user_id = ${userId}`;
    }},

    // ── Reviews ─────────────────────────────────────────────────────────────
    { name: "reviews", run: async () => {
      // MISSED BEFORE — reviews.client_name is a plaintext reviewer name.
      // Rating and comment are retained deliberately: deleting them would
      // silently rewrite the reviewed freelancer's public rating.
      await sql`UPDATE reviews SET client_name = ${anonName}, client_avatar = NULL WHERE client_id = ${userId}`;
    }},

    // ── Agencies ────────────────────────────────────────────────────────────
    { name: "agency_members", run: async () => {
      await sql`DELETE FROM agency_members WHERE user_id = ${userId}`;
    }},
    { name: "agency_activity", run: async () => {
      await sql`UPDATE agency_activity SET actor_name = ${anonName} WHERE actor_id = ${userId}`;
    }},
    { name: "agency_briefs", run: async () => {
      await sql`UPDATE agency_briefs SET client_name = ${anonName}, client_avatar = NULL WHERE client_id = ${userId}`;
    }},
    { name: "agencies", run: async () => {
      // Only reachable when the sole_agency_owner blocker has cleared, i.e. the
      // agency has no other members. Scrub the owner's personal branding.
      await sql`
        UPDATE agencies SET bio = '', logo = NULL, banner = NULL, website = NULL,
                            reel_url = NULL, testimonials = '[]', featured_work = '[]'
        WHERE owner_user_id = ${userId}
      `;
    }},

    // ── Financial: RETAINED, identifiers anonymised (see RETENTION_SCHEDULE) ─
    { name: "invoices", run: async () => {
      // MISSED BEFORE — invoices.client_email is a plaintext email address.
      // The financial content of the invoice is NOT erasable (HMRC ~6 years).
      await sql`UPDATE invoices SET client_name = ${anonName}, client_email = ${anonEmail} WHERE client_id = ${userId}`;
    }},
    { name: "invoice_templates", run: async () => {
      // MISSED BEFORE — business_email / business_phone / business_address are
      // sole-trader personal data in practice.
      await sql`
        UPDATE invoice_templates SET
          business_name = ${anonName}, business_address = '', business_email = ${anonEmail},
          business_phone = '', logo_url = NULL, vat_number = '', footer_note = ''
        WHERE user_id = ${userId}
      `;
    }},
    { name: "stripe_connect_accounts", run: async () => {
      // Retained in full: anti-fraud + financial record. Nothing to scrub here
      // that is not already a Stripe-side identifier.
      await sql`SELECT 1 FROM stripe_connect_accounts WHERE user_id = ${userId} LIMIT 1`;
    }},

    // ── Uploads ─────────────────────────────────────────────────────────────
    { name: "upload_objects", run: async () => {
      // MISSED BEFORE — original_filename is user-supplied and frequently
      // contains a real name ("Jane-Smith-CV.pdf").
      await sql`
        UPDATE upload_objects SET status = 'deleted', original_filename = NULL
        WHERE owner_user_id = ${userId}
      `;
    }},

    // ── Raw-SQL-only tables, invisible to Drizzle ───────────────────────────
    { name: "password_reset_tokens", optional: "password_reset_tokens", run: async () => {
      // MISSED BEFORE. Live tokens for a deleted account are an account-takeover
      // vector: the address is no longer controlled by the person.
      await sql`DELETE FROM password_reset_tokens WHERE user_id = ${userId}`;
    }},
    { name: "verification_codes", optional: "verification_codes", run: async () => {
      // Destination is stored only as a SHA-256 hash, so there is no plaintext
      // to scrub — but live codes must not survive the account. The hash is
      // computed in Node (matching verification-service) rather than in SQL so
      // this does not depend on the pgcrypto extension being installed.
      const { createHash } = await import("node:crypto");
      const destinationHash = createHash("sha256").update(originalEmail.toLowerCase().trim()).digest("hex");
      await sql`
        UPDATE verification_codes SET invalidated_at = ${now}
        WHERE destination_hash = ${destinationHash}
          AND used_at IS NULL AND invalidated_at IS NULL
      `;
    }},
    { name: "terms_acceptances", optional: "terms_acceptances", run: async () => {
      // MISSED BEFORE. The acceptance itself is legal evidence and is RETAINED;
      // ip_address and user_agent are personal data with no evidential need
      // once the account is gone, so they go immediately.
      await sql`UPDATE terms_acceptances SET ip_address = NULL, user_agent = NULL WHERE user_id = ${userId}`;
    }},
    { name: "terms_versions", optional: "terms_versions", run: async () => {
      // Contains no per-user data (document/version/hash only). Explicitly
      // listed so the coverage audit is complete rather than silent.
      await sql`SELECT 1 FROM terms_versions LIMIT 1`;
    }},
    { name: "retainer_agreements", optional: "retainer_agreements", run: async () => {
      // Two-party contract — RETAINED. Free-text description scrubbed.
      await sql`
        UPDATE retainer_agreements SET description = NULL
        WHERE client_id = ${userId} OR freelancer_id = ${userId}
      `;
    }},
    { name: "retainer_templates", optional: "retainer_templates", run: async () => {
      await sql`DELETE FROM retainer_templates WHERE freelancer_id = ${userId}`;
    }},
    { name: "retainer_amendments", optional: "retainer_amendments", run: async () => {
      await sql`SELECT 1 FROM retainer_amendments WHERE created_by = ${userId} LIMIT 1`;
    }},
    { name: "retainer_pause_requests", optional: "retainer_pause_requests", run: async () => {
      await sql`SELECT 1 FROM retainer_pause_requests WHERE requested_by = ${userId} LIMIT 1`;
    }},
    { name: "session", optional: "session", run: async () => {
      // Legacy express-session store. Not referenced by current server code but
      // present in production, and its `sess` payload can contain a user id.
      await sql`DELETE FROM session WHERE sess::text LIKE ${`%"userId":${userId}%`}`;
    }},

    // ── Moderation history: RETAINED for safety, excerpts already scrubbed ──
    { name: "user_reports", run: async () => {
      // Reports filed BY this user keep their reporter id (repeat-abuse
      // detection) but the free-text description can name third parties.
      await sql`UPDATE user_reports SET description = NULL WHERE reporter_user_id = ${userId}`;
    }},
    { name: "user_blocks", run: async () => {
      await sql`DELETE FROM user_blocks WHERE blocker_user_id = ${userId} OR blocked_user_id = ${userId}`;
    }},

    // ── Close out the request ───────────────────────────────────────────────
    { name: "data_export_requests", run: async () => {
      await sql`DELETE FROM data_export_requests WHERE user_id = ${userId}`;
    }},
    { name: "account_deletion_requests", run: async () => {
      await sql`
        UPDATE account_deletion_requests
        SET status = 'anonymised', anonymised_at = ${now}
        WHERE user_id = ${userId} AND status IN ('pending', 'processing')
      `;
      // `state` only exists after migration 0006 — separate statement so a
      // pre-migration database still closes the request out above.
      try {
        await sql`
          UPDATE account_deletion_requests
          SET state = 'anonymised'
          WHERE user_id = ${userId} AND state IN ('pending', 'scheduled', 'processing')
        `;
      } catch { /* pre-0006 database */ }
    }},
  ];

  for (const step of steps) {
    if (step.optional && !(await tableExists(step.optional))) {
      report.skippedSteps.push({ step: step.name, why: `relation ${step.optional} does not exist` });
      continue;
    }
    try {
      await step.run();
      report.completedSteps.push(step.name);
    } catch (e: any) {
      report.failedSteps.push({ step: step.name, error: e?.message ?? String(e) });
      console.error(`[privacy] anonymise step FAILED for user ${userId}: ${step.name}:`, e?.message);
    }
  }

  if (report.failedSteps.length > 0) {
    const err: any = new Error(
      `Anonymisation incomplete: ${report.failedSteps.length} step(s) failed (${report.failedSteps.map((f) => f.step).join(", ")}). The account identity has been anonymised; re-run deletion to finish. Every step is idempotent.`,
    );
    err.report = report;
    err.partial = true;
    throw err;
  }

  return report;
}

// TABLES DELIBERATELY UNTOUCHED (financial / legal / audit retention):
//   payments, payment_transfers, payment_refunds, payment_payouts,
//   payment_audit_log, moderation_audit_log, invoices (figures only),
//   stripe_events, stripe_connect_accounts, pro_subscriptions,
//   pro_subscription_events, founding_pro_allocations, retainer_cycles and the
//   rest of the retainer_* cycle family, project_stages, project_stage_events,
//   deliverables, agency_proposals, accreditation_history, schema_migrations,
//   finance_* operational tables.
// Every one of these is keyed by user id only, and that id now resolves to an
// anonymised user row. See docs/RETENTION_SCHEDULE.md for the justification and
// the retention period of each.
