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

export type DeletionBlocker =
  | { blocked: true; reason: string; code: "active_project" | "unpaid_invoice" | "pending_transfer" }
  | { blocked: false };

/**
 * Check whether account deletion can proceed safely.
 * Returns a blocker if there are active financial or project obligations.
 */
export async function checkDeletionBlockers(userId: number): Promise<DeletionBlocker> {
  const db = getDb();

  // Active projects (not completed/deleted)
  const activeProjects = await db.select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(
      or(eq(schema.projects.clientId, userId), eq(schema.projects.freelancerId, userId)),
      inArray(schema.projects.status, ["active", "pending"])
    ));
  if (activeProjects.length > 0) {
    return { blocked: true, reason: `You have ${activeProjects.length} active project(s). Please complete or cancel them before requesting deletion.`, code: "active_project" };
  }

  // Unpaid invoices
  const sql = neon(process.env.DATABASE_URL!);
  const unpaidInvoices = await sql`
    SELECT id FROM invoices
    WHERE (client_id = ${userId} OR freelancer_id = ${userId})
      AND status NOT IN ('paid', 'cancelled', 'void')
    LIMIT 1
  `;
  if (unpaidInvoices.length > 0) {
    return { blocked: true, reason: "You have outstanding invoices. Please resolve them before requesting deletion.", code: "unpaid_invoice" };
  }

  // Pending payment transfers
  const pendingTransfers = await sql`
    SELECT pt.id FROM payment_transfers pt
    JOIN payments p ON p.id = pt.payment_id
    WHERE (p.client_id = ${userId} OR p.freelancer_id = ${userId})
      AND pt.status IN ('pending', 'processing')
    LIMIT 1
  `;
  if (pendingTransfers.length > 0) {
    return { blocked: true, reason: "You have pending payment transfers. Please wait for them to settle.", code: "pending_transfer" };
  }

  return { blocked: false };
}

/**
 * Anonymise a user account:
 * - Clears PII from users, profiles, messages
 * - Preserves financial records (payments, invoices, audit logs) with anonymised references
 * - Revokes all active sessions
 * - Records the anonymisation timestamp
 *
 * This is irreversible. Call checkDeletionBlockers first.
 */
export async function anonymiseUserAccount(userId: number): Promise<void> {
  const db = getDb();
  const sql = neon(process.env.DATABASE_URL!);
  const anonName = `[deleted-${userId}]`;
  const anonEmail = `deleted-${userId}@viewrr-deleted.invalid`;
  const now = new Date().toISOString();

  // 1. Revoke all active sessions — single bulk UPDATE, no N+1
  await revokeAllUserSessions(userId, "user_deleted");

  // 2. Anonymise users table PII
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
      password_algo = NULL,
      account_status = 'anonymised'
    WHERE id = ${userId}
  `;

  // 3. Anonymise profile
  await sql`
    UPDATE profiles SET
      specialisms = '[]',
      skills = '[]',
      social_links = '{}',
      portfolio_items = '[]',
      reel_url = NULL,
      card_thumbnail = NULL
    WHERE user_id = ${userId}
  `;

  // 4. Anonymise message content (preserve thread structure for other party)
  await sql`
    UPDATE messages SET content = '[message deleted]'
    WHERE from_id = ${userId}
  `;

  // 5. Anonymise connection requests
  await sql`DELETE FROM connection_requests WHERE sender_id = ${userId} OR recipient_id = ${userId}`;

  // 6. Anonymise notifications referencing this user as actor
  await sql`UPDATE notifications SET actor_name = '[deleted user]', actor_avatar = NULL WHERE actor_id = ${userId}`;

  // 7. Mark deletion request as anonymised
  await sql`
    UPDATE account_deletion_requests
    SET status = 'anonymised', anonymised_at = ${now}
    WHERE user_id = ${userId} AND status = 'processing'
  `;

  // NOTE: Do NOT delete: payments, payment_transfers, payment_refunds, payment_audit_log,
  // invoices, stripe_events, stripe_connect_accounts, auth_sessions, terms_acceptances.
  // These must be retained for financial/legal/security purposes.
}
