import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, or, and, desc, sql as drizzleSql, inArray, isNull } from "drizzle-orm";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export { drizzleSql };

// ─── P0-02: Strip passwordHash from every User object leaving this module ────
// All composite types that embed schema.User go through safeUser() so
// passwordHash can NEVER reach the wire regardless of how routes use the data.
// getUserByEmail() intentionally keeps the hash for authentication use only.
function safeUser<T extends Record<string, any>>(user: T): Omit<T, "passwordHash" | "password_hash"> {
  const { passwordHash, password_hash, ...safe } = user as any;
  return safe as Omit<T, "passwordHash" | "password_hash">;
}

// ─── WS-B PRD-020: Schema migrations are now managed exclusively via migrations/*.sql ─────────
// Run those files (via your deployment pipeline) to apply schema changes.
// This function only verifies the database is reachable before serving traffic.
async function verifyDatabaseConnection() {
  try {
    await sql`SELECT 1`;
    console.log("[db] Database connection verified");
  } catch (e: any) {
    throw new Error(`[db] Database connection failed at startup: ${e.message}`);
  }
}

export interface IStorage {
  // Users
  getUser(id: number): Promise<schema.User | undefined>;
  getUserByEmail(email: string): Promise<schema.User | undefined>;
  updateUserPassword(id: number, passwordHash: string): Promise<void>;
  updateUser(id: number, data: Partial<Pick<schema.User, 'name' | 'email' | 'bio' | 'avatar' | 'banner' | 'headline' | 'location'>>): Promise<schema.User>;
  updateStripeAccount(userId: number, data: { stripeAccountId?: string; stripeOnboarded?: number; stripePendingPence?: number }): Promise<void>;
  updateUserAgencyFields(userId: number, data: { accountSubtype?: string; agencyId?: number | null }): Promise<void>;
  createUser(data: schema.InsertUser): Promise<schema.User>;
  // PRD-016A P0-05: Password reset tokens
  createPasswordResetToken(userId: number, tokenHash: string, expiresAt: string): Promise<void>;
  getPasswordResetToken(tokenHash: string): Promise<{ id: number; userId: number; expiresAt: string; usedAt: string | null } | null>;
  markPasswordResetTokenUsed(id: number): Promise<void>;
  atomicConsumeTokenAndResetPassword(tokenHash: string, newPasswordHash: string): Promise<
    { ok: true; userId: number } | { ok: false; reason: string }
  >;

  // Profiles
  getProfiles(filters?: { specialism?: string; availability?: string; search?: string; boostPro?: boolean }): Promise<ProfileWithUser[]>;
  getProfile(id: number): Promise<ProfileWithUser | undefined>;
  getProfileByUserId(userId: number): Promise<schema.Profile | undefined>;
  getOrCreateProfileForUser(userId: number): Promise<schema.Profile>;
  createProfile(data: schema.InsertProfile): Promise<schema.Profile>;
  updateProfile(id: number, data: Partial<schema.InsertProfile>): Promise<schema.Profile | undefined>;
  getFeaturedProfiles(): Promise<ProfileWithUser[]>;

  // Reviews
  getReviewsByProfile(profileId: number): Promise<schema.Review[]>;
  createReview(data: schema.InsertReview & { verifiedProjectReview?: number }): Promise<schema.Review>;
  markReviewGiven(projectId: number, role: "client" | "freelancer"): Promise<void>;

  // Messages
  getMessagesBetween(fromId: number, toId: number): Promise<schema.Message[]>;
  getMessagesByInterest(interestId: number): Promise<schema.Message[]>;
  getConversations(userId: number): Promise<ConversationSummary[]>;
  createMessage(data: schema.InsertMessage): Promise<schema.Message>;
  markMessagesRead(fromId: number, toId: number): Promise<void>;
  markInterestMessagesRead(interestId: number, userId: number): Promise<void>;
  // PRD-1 wave 3 (Decisions 17, 18) — DM inbox, paging and explicit mark-read.
  getConversationSummaries(userId: number): Promise<ConversationRow[]>;
  getDmMessagePage(
    userId: number,
    otherUserId: number,
    opts?: { after?: number; before?: number; limit?: number }
  ): Promise<DmMessagePage>;
  markDmMessagesRead(userId: number, otherUserId: number, upToMessageId?: number): Promise<number>;
  getDmUnreadCount(userId: number): Promise<number>;

  // Saved
  getSaved(clientId: number): Promise<ProfileWithUser[]>;
  toggleSaved(clientId: number, profileId: number): Promise<boolean>;
  isSaved(clientId: number, profileId: number): Promise<boolean>;

  // Feed
  getFeedPosts(limit?: number, offset?: number, viewerUserId?: number): Promise<PostWithUser[]>;
  getPost(id: number): Promise<PostWithUser | undefined>;
  createPost(data: schema.InsertPost): Promise<schema.Post>;
  updatePost(id: number, userId: number, caption: string, tags: string): Promise<schema.Post | undefined>;
  deletePost(id: number, userId: number): Promise<boolean>;
  toggleLike(postId: number, userId: number): Promise<boolean>;
  isLiked(postId: number, userId: number): Promise<boolean>;
  getComments(postId: number): Promise<CommentWithUser[]>;
  createComment(data: schema.InsertPostComment): Promise<CommentWithUser>;

  // Pro Viewrr
  subscribePro(profileId: number): Promise<schema.Profile | undefined>;
  isProSubscriber(profileId: number): Promise<boolean>;

  // Projects
  getProjectsForUser(userId: number): Promise<ProjectWithDetails[]>;
  getCompletedProjectCount(freelancerUserId: number): Promise<number>;
  getCompletedProjectCountsBulk(freelancerUserIds: number[]): Promise<Map<number, number>>;
  getProject(id: number): Promise<ProjectWithDetails | undefined>;
  getProjectByInterestId(interestId: number): Promise<schema.Project | undefined>;
  createProject(data: schema.InsertProject): Promise<schema.Project>;
  advanceProjectStage(projectId: number, note: string, authorId: number): Promise<schema.Project | undefined>;
  addProjectUpdate(data: schema.InsertProjectUpdate): Promise<schema.ProjectUpdate>;
  getProjectUpdates(projectId: number): Promise<ProjectUpdateWithAuthor[]>;
  // PRD-1 wave 3: the first reader for project_stage_events, merged with updates.
  getProjectActivity(projectId: number, limit?: number): Promise<ProjectActivityItem[]>;

  // Retainer Cycles
  createRetainerCycle(data: schema.InsertRetainerCycle): Promise<schema.RetainerCycle>;
  getRetainerCycles(projectId: number): Promise<schema.RetainerCycle[]>;
  updateRetainerCycle(id: number, data: Partial<schema.InsertRetainerCycle>): Promise<schema.RetainerCycle | undefined>;
  startNextCycle(projectId: number): Promise<schema.RetainerCycle>;

  // Meetings
  getMeetingsForProject(projectId: number): Promise<schema.Meeting[]>;
  getMeeting(id: number): Promise<schema.Meeting | undefined>;
  createMeeting(data: schema.InsertMeeting): Promise<schema.Meeting>;
  cancelMeeting(id: number): Promise<void>;

  // Briefs
  getBriefs(limit?: number, offset?: number): Promise<schema.Brief[]>;
  getBrief(id: number): Promise<schema.Brief | undefined>;
  createBrief(data: schema.InsertBrief): Promise<schema.Brief>;

  // Profile Views
  recordProfileView(profileUserId: number, viewerId: number | null, viewerIp: string): Promise<void>;
  hasRecentProfileView(profileUserId: number, viewerId: number | null, viewerIp: string): Promise<boolean>;
  getProfileViewCount(profileUserId: number): Promise<number>;
  getProfileViewHistory(profileUserId: number, days: number): Promise<{ date: string; count: number }[]>;

  // Brief Interests
  createBriefInterest(data: schema.InsertBriefInterest): Promise<schema.BriefInterest>;
  getBriefInterestsForFreelancer(freelancerId: number): Promise<schema.BriefInterest[]>;
  getBriefInterestsForClient(clientId: number): Promise<schema.BriefInterest[]>;
  updateBriefInterestStatus(id: number, status: string): Promise<void>;
  updateBriefInterestPricing(id: number, data: { proposedPricePence?: number | null; priceBreakdown?: string | null; counterOfferPence?: number | null; status?: string; }): Promise<schema.BriefInterest | undefined>;
  updateProjectAgreedAmount(projectId: number, agreedAmountPence: number): Promise<void>;
  deactivateBrief(briefId: number): Promise<void>;
  getBriefInterest(id: number): Promise<schema.BriefInterest | undefined>;

  // Notifications
  createNotification(data: schema.InsertNotification): Promise<schema.Notification>;
  getNotifications(recipientId: number, limit?: number, offset?: number): Promise<schema.Notification[]>;
  /** PRD-1 wave 3: recipientId is required — ownership is enforced in SQL. */
  markNotificationRead(id: number, recipientId: number): Promise<boolean>;
  markAllNotificationsRead(recipientId: number): Promise<void>;
  getUnreadNotificationCount(recipientId: number): Promise<number>;

  // Workspace — Tasks
  getTasks(userId: number): Promise<schema.Task[]>;
  createTask(data: schema.InsertTask): Promise<schema.Task>;
  updateTask(id: number, userId: number, data: Partial<schema.InsertTask>): Promise<schema.Task | undefined>;
  deleteTask(id: number, userId: number): Promise<boolean>;

  // Workspace — Calendar Events
  getCalendarEvents(userId: number, month: string): Promise<schema.CalendarEvent[]>;
  createCalendarEvent(data: schema.InsertCalendarEvent): Promise<schema.CalendarEvent>;
  updateCalendarEvent(id: number, userId: number, data: Partial<schema.InsertCalendarEvent>): Promise<schema.CalendarEvent | undefined>;
  deleteCalendarEvent(id: number, userId: number): Promise<boolean>;

  // Connection Requests
  sendConnectionRequest(senderId: number, recipientId: number): Promise<schema.ConnectionRequest>;
  getConnectionRequestBetween(userA: number, userB: number): Promise<schema.ConnectionRequest | undefined>;
  getPendingConnectionRequests(recipientId: number): Promise<(schema.ConnectionRequest & { senderName: string; senderAvatar: string | null; senderHeadline: string | null; senderRole: string })[]>;
  respondToConnectionRequest(id: number, status: 'accepted' | 'declined'): Promise<void>;
  getConnections(userId: number): Promise<{ id: number; name: string; avatar: string | null; headline: string | null; role: string; location: string | null }[]>;
  getConnectionUserIds(userId: number): Promise<number[]>;
  isConnected(userA: number, userB: number): Promise<boolean>;
  removeConnection(userA: number, userB: number): Promise<void>;

  // Time Entries
  createTimeEntry(data: schema.InsertTimeEntry): Promise<schema.TimeEntry>;
  getTimeEntriesByProject(projectId: number): Promise<schema.TimeEntry[]>;
  getTimeEntriesByUser(userId: number): Promise<schema.TimeEntry[]>;
  getTimeEntriesByAgency(agencyId: number): Promise<schema.TimeEntry[]>;
  updateTimeEntry(id: number, userId: number, data: Partial<schema.InsertTimeEntry>): Promise<schema.TimeEntry | undefined>;
  deleteTimeEntry(id: number, userId: number): Promise<boolean>;

  // Agencies
  createAgency(data: schema.InsertAgency): Promise<schema.Agency>;
  updateAgencyMemberRate(memberId: number, agencyId: number, data: { role?: string; dayRatePence?: number | null; hourlyRatePence?: number | null }): Promise<schema.AgencyMember | undefined>;
  getAgency(id: number): Promise<schema.Agency | undefined>;
  getAgencyBySlug(slug: string): Promise<schema.Agency | undefined>;
  getAgencyByInviteCode(code: string): Promise<schema.Agency | undefined>;
  getAgencyByOwner(ownerUserId: number): Promise<schema.Agency | undefined>;
  updateAgency(id: number, data: Partial<schema.InsertAgency>): Promise<schema.Agency | undefined>;
  getAgencyMembers(agencyId: number): Promise<AgencyMemberWithUser[]>;
  addAgencyMember(data: schema.InsertAgencyMember): Promise<schema.AgencyMember>;
  approveAgencyMember(memberId: number): Promise<void>;
  removeAgencyMember(agencyId: number, userId: number): Promise<void>;
  getAgencyMemberByUser(userId: number): Promise<schema.AgencyMember | undefined>;
  getAgencyMemberByUserId(userId: number): Promise<schema.AgencyMember | undefined>;
  getAgencyDashboard(agencyId: number): Promise<AgencyDashboard>;
  // Agency Briefs
  createAgencyBrief(data: schema.InsertAgencyBrief): Promise<schema.AgencyBrief>;
  getAgencyBriefs(agencyId: number): Promise<schema.AgencyBrief[]>;
  getAgencyBrief(id: number): Promise<schema.AgencyBrief | undefined>;
  updateAgencyBriefStatus(id: number, status: string): Promise<schema.AgencyBrief | undefined>;
  // Agency Proposals
  createAgencyProposal(data: schema.InsertAgencyProposal): Promise<schema.AgencyProposal>;
  getAgencyProposal(briefId: number): Promise<schema.AgencyProposal | undefined>;
  updateAgencyProposalStatus(id: number, status: string): Promise<schema.AgencyProposal | undefined>;
  getAgencyProposals(agencyId: number): Promise<schema.AgencyProposal[]>;
  // Agency Activity
  createAgencyActivity(data: schema.InsertAgencyActivity): Promise<schema.AgencyActivity>;
  getAgencyActivity(agencyId: number, limit?: number): Promise<schema.AgencyActivity[]>;
  // Invoice Templates
  getInvoiceTemplate(userId: number): Promise<schema.InvoiceTemplate | undefined>;
  upsertInvoiceTemplate(userId: number, data: Partial<schema.InsertInvoiceTemplate>): Promise<schema.InvoiceTemplate>;
  // Invoices
  createInvoice(data: schema.InsertInvoice): Promise<schema.Invoice>;
  getInvoiceById(invoiceId: number): Promise<schema.Invoice | undefined>;
  getInvoiceByProject(projectId: number): Promise<schema.Invoice | undefined>;
  getInvoicesByFreelancer(freelancerId: number): Promise<schema.Invoice[]>;
  markInvoicePaid(invoiceId: number): Promise<void>;
  getNextInvoiceNumber(freelancerId: number): Promise<string>;
}

export interface ProfileWithUser {
  profile: schema.Profile;
  user: schema.User;
}

// ─── PRD-1 Stage 1 (Decision 2): explicit public author allow-list ───────────
// The ONLY user fields that may appear on a public surface (feed posts, feed
// comments). This is an ALLOW-LIST, not a deny-list: new columns added to the
// users table can never leak through it. Do NOT widen it casually, and do NOT
// substitute safeUserDto() (routes.ts) — that is a deny-list and leaks by
// default.
export interface PublicAuthor {
  id: number;
  name: string;
  avatar: string | null;
  headline: string | null;
  location: string | null;
  role: string;
}

/** Project any user-shaped row down to the six public author fields. */
export function toPublicAuthor(user: Record<string, any>): PublicAuthor {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar ?? null,
    headline: user.headline ?? null,
    location: user.location ?? null,
    role: user.role,
  };
}

export interface PostWithUser {
  post: schema.Post;
  // Narrowed to PublicAuthor so a raw user row FAILS TO COMPILE here.
  user: PublicAuthor;
  liked: boolean;
}

export interface CommentWithUser {
  comment: schema.PostComment;
  // Narrowed to PublicAuthor so a raw user row FAILS TO COMPILE here.
  user: PublicAuthor;
}

export interface ProjectWithDetails {
  project: schema.Project;
  client: schema.User;
  freelancer: schema.User;
  updates: ProjectUpdateWithAuthor[];
}

export interface ProjectUpdateWithAuthor {
  update: schema.ProjectUpdate;
  author: schema.User;
}

export interface AgencyMemberWithUser {
  member: schema.AgencyMember;
  user: schema.User;
  profile: schema.Profile | null;
}

export interface AgencyProjectFinancial {
  projectId: number;
  title: string;
  freelancerId: number;
  freelancerName: string;
  clientName: string;
  agreedAmountPence: number | null;
  paymentStatus: string;
  status: string;
  createdAt: string;
}

export interface AgencyDashboard {
  agency: schema.Agency;
  members: AgencyMemberWithUser[];
  totalEarnedPence: number;      // sum of paid project agreedAmountPence across all members
  totalInvoicedPence: number;    // sum of all projects with agreedAmountPence (paid + unpaid)
  totalOutstandingPence: number; // unpaid projects with agreedAmountPence
  activeProjectCount: number;
  recentProjects: ProjectWithDetails[];
  financials: AgencyProjectFinancial[]; // all projects with financial data
}

export interface ConversationSummary {
  otherId: number;
  otherName: string;
  otherAvatar: string | null;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

// ─── PRD-1 wave 3: DM inbox row (contract section D, GET /api/conversations) ──
// Superset of the legacy ConversationSummary. `getConversations` is kept as a
// thin mapper onto the legacy shape so the existing web dashboard keeps working.
export interface ConversationRow {
  otherUserId: number;
  name: string;
  avatar: string | null;
  headline: string | null;
  lastMessage: string;
  lastMessageId: number;
  lastMessageAt: string;
  unread: number;
}

export interface DmMessagePage {
  items: schema.Message[];
  /** Message id to pass as `before=` for the next older page. */
  nextCursor: number | null;
  hasMore: boolean;
}

// ─── PRD-1 wave 3: merged project activity (contract D, /activity) ───────────
// `actor` is the six-field PublicAuthor allow-list, never a raw user row.
export interface ProjectActivityItem {
  /** Namespaced ("stage_event:12" / "update:8") — the two tables share id space. */
  id: string;
  kind: "stage_event" | "update";
  at: string;
  actor: PublicAuthor | null;
  title: string;
  body: string;
  stageLabel?: string;
}

/**
 * Human titles for the `project_stage_events.event_type` values that
 * stage-service.ts actually writes. Unknown types fall back to the raw key with
 * underscores replaced — nothing is invented (Truthful Data Rule).
 */
const STAGE_EVENT_LABELS: Record<string, string> = {
  stage_added: "Stage added",
  stages_bulk_set: "Plan drafted",
  stage_edited_post_start: "Stage updated",
  stage_deleted: "Stage removed",
  stage_reordered: "Stages reordered",
  plan_sent_to_client: "Plan sent to client",
  plan_confirmed: "Plan confirmed",
  plan_approved_by_client: "Plan approved by client",
  plan_change_requested: "Plan changes requested",
  stage_started: "Stage started",
  stage_submitted: "Stage submitted for review",
  stage_approved: "Stage approved",
  stage_completed: "Stage completed",
  stage_changes_requested: "Changes requested",
};

class Storage implements IStorage {
  async getUser(id: number): Promise<schema.User | undefined> {
    const r = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return r[0] ? safeUser(r[0]) as schema.User : undefined;
  }

  async updateUser(id: number, data: Partial<Pick<schema.User, 'name' | 'email' | 'bio' | 'avatar' | 'banner' | 'headline' | 'location'>>): Promise<schema.User> {
    const [updated] = await db.update(schema.users).set(data).where(eq(schema.users.id, id)).returning();
    return safeUser(updated) as schema.User;
  }

  async updateUserPassword(id: number, passwordHash: string): Promise<void> {
    await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, id));
  }

  // ─── PRD-016A Phase 0: Password reset token methods ─────────────────────
  // Raw token never stored — only its SHA-256 hash. Tokens expire in 15 minutes.

  async createPasswordResetToken(
    userId: number,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void> {
    // Invalidate any existing unused tokens for this user before creating a new one.
    await sql`
      UPDATE password_reset_tokens
      SET used_at = NOW()::text
      WHERE user_id = ${userId} AND used_at IS NULL
    `;
    await sql`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, ${expiresAt})
    `;
  }

  async getPasswordResetToken(
    tokenHash: string,
  ): Promise<{ id: number; userId: number; expiresAt: string; usedAt: string | null } | null> {
    const rows = await sql`
      SELECT id, user_id, expires_at, used_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;
    if (!rows.length) return null;
    const r = rows[0] as any;
    return { id: r.id, userId: r.user_id, expiresAt: r.expires_at, usedAt: r.used_at ?? null };
  }

  async markPasswordResetTokenUsed(id: number): Promise<void> {
    await sql`
      UPDATE password_reset_tokens
      SET used_at = NOW()::text
      WHERE id = ${id}
    `;
  }

  // P0-05: Atomic password reset ─────────────────────────────────────────────
  // Marks the token used AND updates the password in a single DB transaction.
  // FOR UPDATE row-level lock prevents two concurrent requests consuming the
  // same token. If the password update fails, the token remains unused.
  async atomicConsumeTokenAndResetPassword(
    tokenHash: string,
    newPasswordHash: string
  ): Promise<{ ok: true } | { ok: false; reason: "not_found" | "used" | "expired" }> {
    try {
      await sql`BEGIN`;
      const rows = await sql`
        SELECT id, user_id AS "userId", expires_at AS "expiresAt", used_at AS "usedAt"
        FROM password_reset_tokens
        WHERE token_hash = ${tokenHash}
        FOR UPDATE
      `;
      const record = rows[0] as any;
      if (!record)                                { await sql`ROLLBACK`; return { ok: false, reason: "not_found" }; }
      if (record.usedAt)                          { await sql`ROLLBACK`; return { ok: false, reason: "used" };      }
      if (new Date(record.expiresAt) < new Date()){ await sql`ROLLBACK`; return { ok: false, reason: "expired" };   }
      await sql`UPDATE password_reset_tokens SET used_at = NOW()::text WHERE id = ${record.id}`;
      // PRD-019: Also update password_algo to 'argon2id' when resetting password
      await sql`UPDATE users SET password_hash = ${newPasswordHash}, password_algo = 'argon2id' WHERE id = ${record.userId}`;
      await sql`COMMIT`;
      return { ok: true, userId: record.userId as number };
    } catch (e) {
      try { await sql`ROLLBACK`; } catch {}
      throw e;
    }
  }

  async updateUserAgencyFields(userId: number, data: { accountSubtype?: string; agencyId?: number | null }): Promise<void> {
    await db.update(schema.users).set(data as any).where(eq(schema.users.id, userId));
  }

  async updateStripeAccount(userId: number, data: { stripeAccountId?: string; stripeOnboarded?: number; stripePendingPence?: number }): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (data.stripeAccountId !== undefined) patch.stripeAccountId = data.stripeAccountId;
    if (data.stripeOnboarded !== undefined) patch.stripeOnboarded = data.stripeOnboarded;
    if (data.stripePendingPence !== undefined) patch.stripePendingPence = data.stripePendingPence;
    await db.update(schema.users).set(patch as any).where(eq(schema.users.id, userId));
  }

  async getUserByEmail(email: string): Promise<schema.User | undefined> {
    // PRD 1: email lookups must be case-insensitive. Addresses are stored
    // lowercased on new signups, but historic rows were stored verbatim, so a
    // case-sensitive eq() let the same person register twice ("Jo@x.com" and
    // "jo@x.com") and made login fail for anyone who typed a capital letter.
    // Both sides are lowercased so old and new rows behave identically.
    const needle = (email ?? "").trim().toLowerCase();
    const r = await db.select().from(schema.users)
      .where(drizzleSql`lower(${schema.users.email}) = ${needle}`)
      .limit(1);
    return r[0];
  }

  async createUser(data: schema.InsertUser): Promise<schema.User> {
    const r = await db.insert(schema.users).values(data).returning();
    return safeUser(r[0]) as schema.User;
  }

  async getProfiles(filters?: { specialism?: string; availability?: string; search?: string; boostPro?: boolean }): Promise<ProfileWithUser[]> {
    const allProfiles = await db.select().from(schema.profiles);
    const allUsers = await db.select().from(schema.users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    let results: ProfileWithUser[] = allProfiles
      .map(p => ({ profile: p, user: safeUser(userMap.get(p.userId)!) as schema.User }))
      .filter(pw => pw.user);

    if (filters?.specialism && filters.specialism !== "all") {
      results = results.filter(pw => {
        const specs = JSON.parse(pw.profile.specialisms || "[]") as string[];
        return specs.some(s => s.toLowerCase() === filters.specialism!.toLowerCase());
      });
    }

    if (filters?.availability && filters.availability !== "all") {
      results = results.filter(pw => pw.profile.availability === filters.availability);
    }

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(pw => {
        const skills = JSON.parse(pw.profile.skills || "[]") as string[];
        const specs = JSON.parse(pw.profile.specialisms || "[]") as string[];
        return (
          pw.user.name.toLowerCase().includes(q) ||
          (pw.user.bio || "").toLowerCase().includes(q) ||
          (pw.user.location || "").toLowerCase().includes(q) ||
          skills.some(s => s.toLowerCase().includes(q)) ||
          specs.some(s => s.toLowerCase().includes(q))
        );
      });
    }

    // Web keeps the Viewrr Pro ranking benefit. Native iOS V1 explicitly
    // opts out until Pro entitlements are offered through the appropriate
    // App Store purchase model.
    const boostPro = filters?.boostPro !== false;

    return results.sort((a, b) => {
      if (boostPro) {
        const proA = a.profile.isPro || 0;
        const proB = b.profile.isPro || 0;
        if (proB !== proA) return proB - proA;
      }
      return (b.profile.rating || 0) - (a.profile.rating || 0);
    });
  }

  async getProfile(id: number): Promise<ProfileWithUser | undefined> {
    const r = await db.select().from(schema.profiles).where(eq(schema.profiles.id, id));
    const profile = r[0];
    if (!profile) return undefined;
    const user = await this.getUser(profile.userId);
    if (!user) return undefined;
    return { profile, user };
  }

  async getProfileByUserId(userId: number): Promise<schema.Profile | undefined> {
    const r = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    return r[0];
  }

  async getOrCreateProfileForUser(userId: number): Promise<schema.Profile> {
    const existing = await this.getProfileByUserId(userId);
    if (existing) return existing;
    // Auto-create a minimal profile stub so reviews can be stored against any user
    const [created] = await db.insert(schema.profiles).values({
      userId,
      specialisms: "[]",
      skills: "[]",
      hourlyRate: null,
      dayRate: null,
      availability: null,
      yearsExperience: null,
      reelUrl: null,
      portfolioItems: "[]",
      socialLinks: "{}",
      rating: 0,
      reviewCount: 0,
      projectCount: 0,
      featured: 0,
      badges: "[]",
      isPro: 0,
      proSince: null,
    }).returning();
    return created;
  }

  async createProfile(data: schema.InsertProfile): Promise<schema.Profile> {
    const r = await db.insert(schema.profiles).values(data).returning();
    return r[0];
  }

  async updateProfile(id: number, data: Partial<schema.InsertProfile>): Promise<schema.Profile | undefined> {
    const r = await db.update(schema.profiles).set(data).where(eq(schema.profiles.id, id)).returning();
    return r[0];
  }

  async getFeaturedProfiles(): Promise<ProfileWithUser[]> {
    const allProfiles = await db.select().from(schema.profiles);
    const allUsers = await db.select().from(schema.users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return allProfiles
      .filter(p => p.featured === 1)
      .map(p => ({ profile: p, user: safeUser(userMap.get(p.userId)!) as schema.User }))
      .filter(pw => pw.user)
      .slice(0, 8);
  }

  async getReviewsByProfile(profileId: number): Promise<schema.Review[]> {
    return db.select().from(schema.reviews).where(eq(schema.reviews.profileId, profileId));
  }

  async createReview(data: schema.InsertReview & { verifiedProjectReview?: number }): Promise<schema.Review> {
    const r = await db.insert(schema.reviews).values(data).returning();
    const review = r[0];
    // Update profile rating
    const reviews = await this.getReviewsByProfile(data.profileId);
    const avg = reviews.reduce((s, rev) => s + rev.rating, 0) / reviews.length;
    await db.update(schema.profiles)
      .set({ rating: Math.round(avg * 10) / 10, reviewCount: reviews.length })
      .where(eq(schema.profiles.id, data.profileId));
    return review;
  }

  async markReviewGiven(projectId: number, role: "client" | "freelancer"): Promise<void> {
    const col = role === "client"
      ? { reviewGivenByClient: 1 }
      : { reviewGivenByFreelancer: 1 };
    await db.update(schema.projects).set(col).where(eq(schema.projects.id, projectId));
  }

  /**
   * PRD-1 wave 3 performance fix: this used to pull the entire thread and sort
   * it in JavaScript by `created_at`, which is a TEXT column and therefore not
   * a reliable order. It now sorts and bounds in SQL by `id` and caps the
   * result. Prefer `getDmMessagePage` — this remains only for the legacy
   * `GET /api/messages/:fromId/:toId` alias the web product still calls.
   */
  async getMessagesBetween(fromId: number, toId: number, cap = 200): Promise<schema.Message[]> {
    // Only return general DMs (not interest-scoped messages)
    const msgs = await db.select().from(schema.messages)
      .where(
        and(
          or(
            and(eq(schema.messages.fromId, fromId), eq(schema.messages.toId, toId)),
            and(eq(schema.messages.fromId, toId), eq(schema.messages.toId, fromId))
          ),
          isNull(schema.messages.interestId)
        )
      )
      .orderBy(desc(schema.messages.id))
      .limit(cap);
    // Newest-first from SQL, flipped to chronological for the chat UI.
    return msgs.reverse();
  }

  /**
   * One page of a DM thread. Cursors are MESSAGE IDS, never `created_at`
   * (section A of the contract: that column is text and unsafe to order by).
   *
   * - `after`  → strictly newer than the id, ascending (the polling cursor).
   * - `before` → strictly older than the id, newest-first internally then
   *              flipped, so `items` is always chronological.
   */
  async getDmMessagePage(
    userId: number,
    otherUserId: number,
    opts: { after?: number; before?: number; limit?: number } = {}
  ): Promise<DmMessagePage> {
    const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 100);
    const pair = and(
      or(
        and(eq(schema.messages.fromId, userId), eq(schema.messages.toId, otherUserId)),
        and(eq(schema.messages.fromId, otherUserId), eq(schema.messages.toId, userId))
      ),
      isNull(schema.messages.interestId)
    );

    if (opts.after != null && Number.isFinite(opts.after)) {
      const rows = await db.select().from(schema.messages)
        .where(and(pair, drizzleSql`${schema.messages.id} > ${Math.trunc(opts.after)}`))
        .orderBy(schema.messages.id)
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return {
        items,
        // Forward paging continues from the newest id returned.
        nextCursor: items.length ? items[items.length - 1].id : null,
        hasMore,
      };
    }

    const where = opts.before != null && Number.isFinite(opts.before)
      ? and(pair, drizzleSql`${schema.messages.id} < ${Math.trunc(opts.before)}`)
      : pair;
    const rows = await db.select().from(schema.messages)
      .where(where)
      .orderBy(desc(schema.messages.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.reverse();
    return {
      items,
      // Backward paging continues from the OLDEST id returned.
      nextCursor: items.length ? items[0].id : null,
      hasMore,
    };
  }

  async getMessagesByInterest(interestId: number): Promise<schema.Message[]> {
    const msgs = await db.select().from(schema.messages)
      .where(eq(schema.messages.interestId, interestId));
    return msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * PRD-1 wave 3 — the DM inbox.
   *
   * Replaces the previous implementation, which loaded EVERY message the user
   * had ever sent or received, grouped them in JavaScript, and then issued one
   * `getUser` per counterparty (N+1). This is a single statement: the
   * counterparty is derived in SQL, unread is a
   * `COUNT(*) FILTER (WHERE to_id = $me AND read is unset)`, the last message
   * is joined by `MAX(id)` (never by `created_at`, which is text), and the user
   * row is joined rather than re-fetched per row.
   *
   * Decision 17: `interest_id IS NULL` excludes interest / negotiation threads
   * from the DM inbox entirely. Those live in Brief/Work context.
   */
  async getConversationSummaries(userId: number): Promise<ConversationRow[]> {
    const rows = await sql`
      WITH dm AS (
        SELECT m.id, m.from_id, m.to_id, m.content, m.created_at, m.read,
               CASE WHEN m.from_id = ${userId} THEN m.to_id ELSE m.from_id END AS other_id
        FROM messages m
        WHERE m.interest_id IS NULL
          AND (m.from_id = ${userId} OR m.to_id = ${userId})
      ),
      agg AS (
        SELECT other_id,
               MAX(id) AS last_message_id,
               COUNT(*) FILTER (
                 WHERE to_id = ${userId} AND (read IS NULL OR read = 0)
               )::int AS unread
        FROM dm
        GROUP BY other_id
      )
      SELECT a.other_id, a.last_message_id, a.unread,
             m.content AS last_message, m.created_at AS last_message_at,
             u.name, u.avatar, u.headline
      FROM agg a
      JOIN messages m ON m.id = a.last_message_id
      JOIN users u ON u.id = a.other_id
      ORDER BY a.last_message_id DESC
    `;
    return (rows as Record<string, any>[]).map(r => ({
      otherUserId: Number(r.other_id),
      name: r.name,
      avatar: r.avatar ?? null,
      headline: r.headline ?? null,
      lastMessage: r.last_message ?? "",
      lastMessageId: Number(r.last_message_id),
      lastMessageAt: r.last_message_at ?? "",
      unread: Number(r.unread ?? 0),
    }));
  }

  /**
   * Legacy shape used by the existing web dashboard
   * (`GET /api/messages/:userId/conversations`). A thin mapper over
   * `getConversationSummaries` — no second query, no N+1.
   */
  async getConversations(userId: number): Promise<ConversationSummary[]> {
    const rows = await this.getConversationSummaries(userId);
    return rows.map(r => ({
      otherId: r.otherUserId,
      otherName: r.name,
      otherAvatar: r.avatar,
      lastMessage: r.lastMessage,
      lastAt: r.lastMessageAt,
      unread: r.unread,
    }));
  }

  async createMessage(data: schema.InsertMessage): Promise<schema.Message> {
    const r = await db.insert(schema.messages).values({ ...data, createdAt: new Date().toISOString() }).returning();
    return r[0];
  }

  async markMessagesRead(fromId: number, toId: number): Promise<void> {
    await db.update(schema.messages)
      .set({ read: 1 })
      .where(and(eq(schema.messages.fromId, fromId), eq(schema.messages.toId, toId)));
  }

  async markInterestMessagesRead(interestId: number, userId: number): Promise<void> {
    await db.update(schema.messages)
      .set({ read: 1 })
      .where(and(eq(schema.messages.interestId, interestId), eq(schema.messages.toId, userId)));
  }

  /**
   * PRD-1 wave 3 (Decision 17) — backs `POST /api/messages/read`.
   *
   * Same shape as `markInterestMessagesRead` above: `to_id = the caller`, which
   * is the only correct direction. The caller's identity comes from the session,
   * never from the path, so the `/:fromId/:toId` ambiguity cannot recur here.
   * Restricted to DM rows (`interest_id IS NULL`).
   *
   * NOTE: `messages.read_at` is being added by migration 0006 (owned by B2).
   * Once that column is declared in shared/schema.ts, set it here as well.
   */
  async markDmMessagesRead(userId: number, otherUserId: number, upToMessageId?: number): Promise<number> {
    const conds = [
      eq(schema.messages.toId, userId),
      eq(schema.messages.fromId, otherUserId),
      isNull(schema.messages.interestId),
      drizzleSql`(${schema.messages.read} IS NULL OR ${schema.messages.read} = 0)`,
    ];
    if (upToMessageId != null && Number.isFinite(upToMessageId)) {
      conds.push(drizzleSql`${schema.messages.id} <= ${Math.trunc(upToMessageId)}`);
    }
    const updated = await db.update(schema.messages)
      .set({ read: 1 })
      .where(and(...conds))
      .returning({ id: schema.messages.id });
    return updated.length;
  }

  /**
   * DM unread total. Counted in SQL, DM-only (Decision 17), and deliberately
   * SEPARATE from `getUnreadNotificationCount` — Decision 18 forbids summing
   * inbox unread with notification-centre unread.
   */
  async getDmUnreadCount(userId: number): Promise<number> {
    const r = await db.select({ count: drizzleSql<number>`count(*)::int` })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.toId, userId),
        isNull(schema.messages.interestId),
        drizzleSql`(${schema.messages.read} IS NULL OR ${schema.messages.read} = 0)`
      ));
    return Number(r[0]?.count ?? 0);
  }

  async getSaved(clientId: number): Promise<ProfileWithUser[]> {
    const savedRows = await db.select().from(schema.saved).where(eq(schema.saved.clientId, clientId));
    const results: ProfileWithUser[] = [];
    for (const s of savedRows) {
      const pw = await this.getProfile(s.profileId);
      if (pw) results.push(pw);
    }
    return results;
  }

  async toggleSaved(clientId: number, profileId: number): Promise<boolean> {
    const r = await db.select().from(schema.saved)
      .where(and(eq(schema.saved.clientId, clientId), eq(schema.saved.profileId, profileId)));
    const existing = r[0];
    if (existing) {
      await db.delete(schema.saved).where(eq(schema.saved.id, existing.id));
      return false;
    } else {
      await db.insert(schema.saved).values({ clientId, profileId });
      return true;
    }
  }

  async isSaved(clientId: number, profileId: number): Promise<boolean> {
    const r = await db.select().from(schema.saved)
      .where(and(eq(schema.saved.clientId, clientId), eq(schema.saved.profileId, profileId)));
    return !!r[0];
  }

  // ── Feed ─────────────────────────────────────────────────────────────────
  async getFeedPosts(limit = 20, offset = 0, viewerUserId?: number): Promise<PostWithUser[]> {
    // Single JOIN query — fetches posts + users in one round trip
    const rows = await db
      .select()
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.posts.userId, schema.users.id))
      .orderBy(desc(schema.posts.createdAt))
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) return [];

    // Batch-fetch likes for the viewer in one query if needed
    let likedPostIds = new Set<number>();
    if (viewerUserId) {
      const postIds = rows.map(r => r.posts.id);
      if (postIds.length > 0) {
        const likes = await db
          .select({ postId: schema.postLikes.postId })
          .from(schema.postLikes)
          .where(
            and(
              eq(schema.postLikes.userId, viewerUserId),
              inArray(schema.postLikes.postId, postIds)
            )
          );
        likedPostIds = new Set(likes.map(l => l.postId));
      }
    }

    return rows.map(r => ({
      post: r.posts,
      // Stage 1 (Decision 2): explicit allow-list — never the raw user row.
      user: toPublicAuthor(r.users),
      liked: likedPostIds.has(r.posts.id),
    }));
  }

  async getPost(id: number): Promise<PostWithUser | undefined> {
    const r = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
    const post = r[0];
    if (!post) return undefined;
    const user = await this.getUser(post.userId);
    if (!user) return undefined;
    // Stage 1 (Decision 2): explicit allow-list — never the raw user row.
    return { post, user: toPublicAuthor(user), liked: false };
  }

  async createPost(data: schema.InsertPost): Promise<schema.Post> {
    const r = await db.insert(schema.posts).values(data).returning();
    return r[0];
  }

  async updatePost(id: number, userId: number, caption: string, tags: string): Promise<schema.Post | undefined> {
    const r = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
    const post = r[0];
    if (!post || post.userId !== userId) return undefined;
    const updated = await db.update(schema.posts)
      .set({ caption, tags })
      .where(eq(schema.posts.id, id))
      .returning();
    return updated[0];
  }

  async deletePost(id: number, userId: number): Promise<boolean> {
    const r = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
    const post = r[0];
    if (!post || post.userId !== userId) return false;
    await db.delete(schema.posts).where(eq(schema.posts.id, id));
    return true;
  }

  // Admin-only: delete any post regardless of ownership, logs to deleted_posts, returns owner userId
  async adminDeletePost(id: number, adminId: number): Promise<number | null> {
    const r = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
    const post = r[0];
    if (!post) return null;
    const owner = await this.getUser(post.userId);
    // Log the deletion before removing
    await db.insert(schema.deletedPosts).values({
      postId: post.id,
      ownerId: post.userId,
      ownerName: owner?.name ?? "Unknown",
      ownerEmail: owner?.email ?? "unknown",
      caption: post.caption,
      mediaUrl: post.mediaUrl,
      mediaType: post.mediaType,
      tags: post.tags,
      deletedBy: adminId,
      deletedAt: new Date().toISOString(),
    });
    await db.delete(schema.posts).where(eq(schema.posts.id, id));
    return post.userId;
  }

  // ── Project Invitations ────────────────────────────────────────────────
  async createInvitation(data: {
    senderId: number; recipientId: number; title: string;
    description?: string; category?: string; budget?: string; timeline?: string;
    startStage?: number;
    isRetainer?: number; billingCycle?: string; deliverablesPerCycle?: string; totalCycles?: number;
  }): Promise<schema.ProjectInvitation> {
    const rows = await db.insert(schema.projectInvitations).values({
      ...data,
      startStage: data.startStage ?? 0,
      isRetainer: data.isRetainer ?? 0,
      status: "pending",
      createdAt: new Date().toISOString(),
    }).returning();
    return rows[0];
  }

  async getInvitationsForUser(userId: number): Promise<schema.ProjectInvitation[]> {
    return db.select().from(schema.projectInvitations)
      .where(or(
        eq(schema.projectInvitations.senderId, userId),
        eq(schema.projectInvitations.recipientId, userId)
      ))
      .orderBy(desc(schema.projectInvitations.id));
  }

  async updateInvitationStatus(id: number, status: "accepted" | "declined"): Promise<schema.ProjectInvitation | null> {
    const rows = await db.update(schema.projectInvitations)
      .set({ status })
      .where(eq(schema.projectInvitations.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async searchUsers(
    query: string,
    excludeId: number,
    allowedIds?: number[],
  ): Promise<{ id: number; name: string; email: string; role: string; avatar: string | null; headline: string | null }[]> {
    const q = `%${query.toLowerCase()}%`;
    // Build WHERE conditions
    const conditions: any[] = [
      drizzleSql`(LOWER(${schema.users.name}) LIKE ${q} OR LOWER(${schema.users.email}) LIKE ${q})`,
      drizzleSql`${schema.users.id} != ${excludeId}`,
    ];
    // If a connection filter is provided, restrict to those IDs
    if (allowedIds && allowedIds.length > 0) {
      const idList = allowedIds.join(",");
      conditions.push(drizzleSql`${schema.users.id} IN (${drizzleSql.raw(idList)})`);
    } else if (allowedIds && allowedIds.length === 0) {
      // Caller explicitly passed an empty list — return nothing
      return [];
    }
    const rows = await db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      avatar: schema.users.avatar,
      headline: schema.users.headline,
    }).from(schema.users)
      .where(and(...conditions))
      .limit(10);
    return rows;
  }

  // ── Deliverables ────────────────────────────────────────────────────────
  async getDeliverables(projectId: number): Promise<schema.Deliverable[]> {
    return db.select().from(schema.deliverables)
      .where(eq(schema.deliverables.projectId, projectId))
      .orderBy(desc(schema.deliverables.id));
  }

  async addDeliverable(data: {
    projectId: number; url: string; label: string;
    platform: string; embedUrl: string; createdBy: number;
  }): Promise<schema.Deliverable> {
    const rows = await db.insert(schema.deliverables).values({
      ...data,
      createdAt: new Date().toISOString(),
    }).returning();
    return rows[0];
  }

  async deleteDeliverable(id: number, userId: number): Promise<boolean> {
    const rows = await db.select().from(schema.deliverables).where(eq(schema.deliverables.id, id));
    const d = rows[0];
    if (!d || d.createdBy !== userId) return false;
    await db.delete(schema.deliverables).where(eq(schema.deliverables.id, id));
    return true;
  }

  async getDeletedPosts(): Promise<schema.DeletedPost[]> {
    const rows = await db.select().from(schema.deletedPosts).orderBy(drizzleSql`${schema.deletedPosts.id} DESC`);
    return rows;
  }

  async toggleLike(postId: number, userId: number): Promise<boolean> {
    const r = await db.select().from(schema.postLikes)
      .where(and(eq(schema.postLikes.postId, postId), eq(schema.postLikes.userId, userId)));
    const existing = r[0];
    if (existing) {
      await db.delete(schema.postLikes).where(eq(schema.postLikes.id, existing.id));
      const pr = await db.select().from(schema.posts).where(eq(schema.posts.id, postId));
      const cur = pr[0];
      await db.update(schema.posts)
        .set({ likeCount: Math.max(0, (cur?.likeCount || 1) - 1) })
        .where(eq(schema.posts.id, postId));
      return false;
    } else {
      await db.insert(schema.postLikes).values({ postId, userId });
      const pr = await db.select().from(schema.posts).where(eq(schema.posts.id, postId));
      const cur = pr[0];
      await db.update(schema.posts)
        .set({ likeCount: (cur?.likeCount || 0) + 1 })
        .where(eq(schema.posts.id, postId));
      return true;
    }
  }

  async isLiked(postId: number, userId: number): Promise<boolean> {
    const r = await db.select().from(schema.postLikes)
      .where(and(eq(schema.postLikes.postId, postId), eq(schema.postLikes.userId, userId)));
    return !!r[0];
  }

  async getComments(postId: number): Promise<CommentWithUser[]> {
    const comments = await db.select().from(schema.postComments)
      .where(eq(schema.postComments.postId, postId));
    const sorted = comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const results: CommentWithUser[] = [];
    for (const comment of sorted) {
      const user = await this.getUser(comment.userId);
      if (!user) continue;
      // Stage 1 (Decision 2): explicit allow-list — never the raw user row.
      results.push({ comment, user: toPublicAuthor(user) });
    }
    return results;
  }

  async createComment(data: schema.InsertPostComment): Promise<CommentWithUser> {
    const r = await db.insert(schema.postComments).values(data).returning();
    const comment = r[0];
    const pr = await db.select().from(schema.posts).where(eq(schema.posts.id, data.postId));
    const cur = pr[0];
    await db.update(schema.posts)
      .set({ commentCount: (cur?.commentCount || 0) + 1 })
      .where(eq(schema.posts.id, data.postId));
    const user = await this.getUser(data.userId);
    // Stage 1 (Decision 2): explicit allow-list — never the raw user row.
    return { comment, user: toPublicAuthor(user!) };
  }

  // ── Pro Viewrr ────────────────────────────────────────────────────────────
  async subscribePro(profileId: number): Promise<schema.Profile | undefined> {
    const r = await db.update(schema.profiles)
      .set({ isPro: 1, proSince: new Date().toISOString() })
      .where(eq(schema.profiles.id, profileId))
      .returning();
    return r[0];
  }

  async isProSubscriber(profileId: number): Promise<boolean> {
    const r = await db.select().from(schema.profiles).where(eq(schema.profiles.id, profileId));
    return r[0]?.isPro === 1;
  }

  // ── Projects ─────────────────────────────────────────────────────────
  async _buildProjectWithDetails(project: schema.Project): Promise<ProjectWithDetails | undefined> {
    const client = await this.getUser(project.clientId);
    const freelancer = await this.getUser(project.freelancerId);
    if (!client || !freelancer) return undefined;
    const updates = await this.getProjectUpdates(project.id);
    return { project, client, freelancer, updates };
  }

  async getProjectsForUser(userId: number): Promise<ProjectWithDetails[]> {
    // FR-09 (PRD: Reliable Project Completion & Deletion): exclude soft-deleted projects
    const all = await db.select().from(schema.projects)
      .where(and(
        or(eq(schema.projects.clientId, userId), eq(schema.projects.freelancerId, userId)),
        isNull((schema.projects as any).deletedAt),
      ));
    const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const results: ProjectWithDetails[] = [];
    for (const p of sorted) {
      const details = await this._buildProjectWithDetails(p);
      if (details) results.push(details);
    }
    return results;
  }

  async getCompletedProjectCount(freelancerUserId: number): Promise<number> {
    const r = await db.select({ count: drizzleSql<number>`count(*)::int` })
      .from(schema.projects)
      .where(and(
        eq(schema.projects.freelancerId, freelancerUserId),
        eq(schema.projects.status, "completed")
      ));
    return r[0]?.count ?? 0;
  }

  // Bulk version for list endpoints — one SQL query for all user ids, avoids N+1.
  async getCompletedProjectCountsBulk(freelancerUserIds: number[]): Promise<Map<number, number>> {
    if (freelancerUserIds.length === 0) return new Map();
    const rows = await db.select({
      freelancerId: schema.projects.freelancerId,
      count: drizzleSql<number>`count(*)::int`,
    })
      .from(schema.projects)
      .where(and(
        inArray(schema.projects.freelancerId, freelancerUserIds),
        eq(schema.projects.status, "completed")
      ))
      .groupBy(schema.projects.freelancerId);
    const map = new Map<number, number>();
    for (const row of rows) {
      if (row.freelancerId !== null) map.set(row.freelancerId, row.count);
    }
    return map;
  }

  async getProject(id: number): Promise<ProjectWithDetails | undefined> {
    const r = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    const project = r[0];
    if (!project) return undefined;
    return this._buildProjectWithDetails(project);
  }

  async getProjectByInterestId(interestId: number): Promise<schema.Project | undefined> {
    const r = await db.select().from(schema.projects).where(eq(schema.projects.interestId, interestId));
    return r[0];
  }

  async createProject(data: schema.InsertProject): Promise<schema.Project> {
    const r = await db.insert(schema.projects).values(data).returning();
    return r[0];
  }

  async advanceProjectStage(projectId: number, note: string, authorId: number): Promise<schema.Project | undefined> {
    const r = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    const project = r[0];
    if (!project) return undefined;
    const nextStage = project.currentStage + 1;
    // 6 stages (0-5). When freelancer advances to stage 5 (Final Delivery),
    // move project into awaiting_payment — work is done, payment needed.
    const FINAL_STAGE = 5;
    const newStatus = nextStage >= FINAL_STAGE ? "awaiting_payment" : project.status;
    await db.update(schema.projects)
      .set({ currentStage: nextStage, status: newStatus })
      .where(eq(schema.projects.id, projectId));
    if (note.trim()) {
      await db.insert(schema.projectUpdates).values({ projectId, authorId, stage: nextStage, note });
    }
    const updated = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    return updated[0];
  }

  async updateProjectStatus(projectId: number, status: string, paymentStatus?: string): Promise<void> {
    const patch: Record<string, any> = { status };
    if (paymentStatus !== undefined) patch.paymentStatus = paymentStatus;
    await db.update(schema.projects).set(patch).where(eq(schema.projects.id, projectId));
  }

  async addProjectUpdate(data: schema.InsertProjectUpdate): Promise<schema.ProjectUpdate> {
    const r = await db.insert(schema.projectUpdates).values(data).returning();
    return r[0];
  }

  /**
   * PRD-1 wave 3 (contract D) — `GET /api/projects/:id/activity`.
   *
   * `project_stage_events` previously had NO reader anywhere in the codebase.
   * This merges it with `project_updates`, newest first, and hydrates the actor
   * through the six-field `PublicAuthor` allow-list — never a raw user row.
   *
   * Ordering is by table + id descending within each source and then merged;
   * `created_at` is a TEXT column (contract section A) so it is used for display
   * only. Actors are fetched in ONE batched query, not per row.
   */
  async getProjectActivity(projectId: number, limit = 100): Promise<ProjectActivityItem[]> {
    const cap = Math.min(Math.max(Number(limit) || 100, 1), 200);

    const [events, updates, stages] = await Promise.all([
      db.select().from(schema.projectStageEvents)
        .where(eq(schema.projectStageEvents.projectId, projectId))
        .orderBy(desc(schema.projectStageEvents.id))
        .limit(cap),
      db.select().from(schema.projectUpdates)
        .where(eq(schema.projectUpdates.projectId, projectId))
        .orderBy(desc(schema.projectUpdates.id))
        .limit(cap),
      db.select({ id: schema.projectStages.id, title: schema.projectStages.title })
        .from(schema.projectStages)
        .where(eq(schema.projectStages.projectId, projectId)),
    ]);

    const stageTitles = new Map<number, string>(stages.map(s => [s.id, s.title]));

    // Single batched actor lookup — deliberately not one getUser() per row.
    const actorIds = Array.from(new Set<number>([
      ...events.map(e => e.actorId),
      ...updates.map(u => u.authorId),
    ].filter(id => Number.isFinite(id))));
    const actorRows = actorIds.length
      ? await db.select().from(schema.users).where(inArray(schema.users.id, actorIds))
      : [];
    const actors = new Map<number, PublicAuthor>(
      actorRows.map(u => [u.id, toPublicAuthor(u)])
    );

    const items: (ProjectActivityItem & { sortKey: number })[] = [];

    for (const e of events) {
      const stageLabel = e.stageId != null ? stageTitles.get(e.stageId) : undefined;
      items.push({
        id: `stage_event:${e.id}`,
        kind: "stage_event",
        at: e.createdAt,
        actor: actors.get(e.actorId) ?? null,
        title: STAGE_EVENT_LABELS[e.eventType] ?? e.eventType.replace(/_/g, " "),
        body: e.note ?? "",
        ...(stageLabel ? { stageLabel } : {}),
        sortKey: e.createdAt ? Date.parse(e.createdAt) || 0 : 0,
      });
    }

    for (const u of updates) {
      items.push({
        id: `update:${u.id}`,
        kind: "update",
        at: u.createdAt,
        actor: actors.get(u.authorId) ?? null,
        title: "Project update",
        body: u.note ?? "",
        sortKey: u.createdAt ? Date.parse(u.createdAt) || 0 : 0,
      });
    }

    // Newest first. Timestamps are text, so ties fall back to the string form,
    // which is stable for the ISO values both tables actually write.
    items.sort((a, b) => (b.sortKey - a.sortKey) || b.at.localeCompare(a.at));

    return items.slice(0, cap).map(({ sortKey, ...item }) => item);
  }

  async getProjectUpdates(projectId: number): Promise<ProjectUpdateWithAuthor[]> {
    const updates = await db.select().from(schema.projectUpdates)
      .where(eq(schema.projectUpdates.projectId, projectId));
    const sorted = updates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const results: ProjectUpdateWithAuthor[] = [];
    for (const update of sorted) {
      const author = await this.getUser(update.authorId);
      if (!author) continue;
      results.push({ update, author });
    }
    return results;
  }

  // ── Retainer Cycles ─────────────────────────────────────────────────────
  async createRetainerCycle(data: schema.InsertRetainerCycle): Promise<schema.RetainerCycle> {
    const r = await db.insert(schema.retainerCycles).values({
      ...data,
      createdAt: new Date().toISOString(),
    }).returning();
    return r[0];
  }

  async getRetainerCycles(projectId: number): Promise<schema.RetainerCycle[]> {
    const r = await db.select().from(schema.retainerCycles)
      .where(eq(schema.retainerCycles.projectId, projectId))
      .orderBy(schema.retainerCycles.cycleNumber);
    return r;
  }

  async updateRetainerCycle(id: number, data: Partial<schema.InsertRetainerCycle>): Promise<schema.RetainerCycle | undefined> {
    const r = await db.update(schema.retainerCycles)
      .set(data)
      .where(eq(schema.retainerCycles.id, id))
      .returning();
    return r[0];
  }

  async startNextCycle(projectId: number): Promise<schema.RetainerCycle> {
    // Get the current project
    const projRows = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    const project = projRows[0];
    if (!project) throw new Error("Project not found");
    const nextCycleNumber = (project.currentCycleNumber ?? 1) + 1;
    // Update project's currentCycleNumber and reset status to active
    await db.update(schema.projects)
      .set({ currentCycleNumber: nextCycleNumber, status: "active" })
      .where(eq(schema.projects.id, projectId));
    // Insert new cycle row
    const r = await db.insert(schema.retainerCycles).values({
      projectId,
      cycleNumber: nextCycleNumber,
      status: "active",
      startDate: new Date().toISOString().slice(0, 10),
      paymentStatus: "unpaid",
      createdAt: new Date().toISOString(),
    }).returning();
    return r[0];
  }

  // ─── Meetings ──────────────────────────────────────────────────────────────
  async getMeetingsForProject(projectId: number): Promise<schema.Meeting[]> {
    const r = await db.select().from(schema.meetings)
      .where(eq(schema.meetings.projectId, projectId))
      .orderBy(schema.meetings.createdAt);
    return r;
  }

  async getMeeting(id: number): Promise<schema.Meeting | undefined> {
    const r = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id)).limit(1);
    return r[0];
  }

  async createMeeting(data: schema.InsertMeeting): Promise<schema.Meeting> {
    const r = await db.insert(schema.meetings).values(data).returning();
    return r[0];
  }

  async cancelMeeting(id: number): Promise<void> {
    await db.update(schema.meetings)
      .set({ status: "cancelled" })
      .where(eq(schema.meetings.id, id));
  }

  // ─── Briefs ────────────────────────────────────────────────────────────────
  async getBriefs(limit = 50, offset = 0): Promise<schema.Brief[]> {
    const r = await db.select().from(schema.briefs)
      .where(eq(schema.briefs.isActive, true))
      .orderBy(desc(schema.briefs.createdAt))
      .limit(limit)
      .offset(offset);
    return r;
  }

  async getBrief(id: number): Promise<schema.Brief | undefined> {
    const r = await db.select().from(schema.briefs).where(eq(schema.briefs.id, id));
    return r[0];
  }

  async createBrief(data: schema.InsertBrief): Promise<schema.Brief> {
    const r = await db.insert(schema.briefs).values({ ...data, createdAt: new Date().toISOString() }).returning();
    return r[0];
  }

  // ─── Profile Views ───────────────────────────────────────────────────────
  async recordProfileView(profileUserId: number, viewerId: number | null, viewerIp: string): Promise<void> {
    // Record every visit — no deduplication. Notification throttling is handled at the route layer.
    await db.insert(schema.profileViews).values({
      profileUserId,
      viewerId,
      viewerIp,
      createdAt: new Date().toISOString(),
    });
  }

  // Returns true if a view from this viewer was already recorded in the last 24h
  // Used by the route to decide whether to send a notification.
  async hasRecentProfileView(profileUserId: number, viewerId: number | null, viewerIp: string): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (viewerId) {
      const existing = await db.select().from(schema.profileViews)
        .where(and(
          eq(schema.profileViews.profileUserId, profileUserId),
          eq(schema.profileViews.viewerId, viewerId),
          drizzleSql`created_at > ${since}`
        ));
      return existing.length > 0; // called before insert, so >0 means already notified today
    } else {
      const existing = await db.select().from(schema.profileViews)
        .where(and(
          eq(schema.profileViews.profileUserId, profileUserId),
          eq(schema.profileViews.viewerIp, viewerIp),
          drizzleSql`created_at > ${since}`
        ));
      return existing.length > 0;
    }
  }

  async getProfileViewCount(profileUserId: number): Promise<number> {
    const r = await db.select().from(schema.profileViews)
      .where(eq(schema.profileViews.profileUserId, profileUserId));
    return r.length;
  }

  async getProfileViewHistory(profileUserId: number, days: number): Promise<{ date: string; count: number }[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const r = await db.select().from(schema.profileViews)
      .where(and(
        eq(schema.profileViews.profileUserId, profileUserId),
        drizzleSql`created_at > ${since}`
      ));
    // Group by date
    const byDate: Record<string, number> = {};
    for (const v of r) {
      const date = v.createdAt.slice(0, 10);
      byDate[date] = (byDate[date] || 0) + 1;
    }
    // Fill in all days including zeros
    const result: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      result.push({ date: d, count: byDate[d] || 0 });
    }
    return result;
  }

  // ─── Brief Interests ───────────────────────────────────────────────────────
  async createBriefInterest(data: schema.InsertBriefInterest): Promise<schema.BriefInterest> {
    const r = await db.insert(schema.briefInterests).values({ ...data, createdAt: new Date().toISOString() }).returning();
    // bump applicationCount on the brief
    await db.update(schema.briefs)
      .set({ applicationCount: (await db.select().from(schema.briefs).where(eq(schema.briefs.id, data.briefId)))[0]?.applicationCount + 1 || 1 })
      .where(eq(schema.briefs.id, data.briefId));
    return r[0];
  }

  async getBriefInterestsForFreelancer(freelancerId: number): Promise<schema.BriefInterest[]> {
    const r = await db.select().from(schema.briefInterests)
      .where(eq(schema.briefInterests.freelancerId, freelancerId));
    return r.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getBriefInterestsForClient(clientId: number): Promise<schema.BriefInterest[]> {
    const r = await db.select().from(schema.briefInterests)
      .where(eq(schema.briefInterests.briefClientId, clientId));
    return r.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async updateBriefInterestStatus(id: number, status: string): Promise<void> {
    const respondedAt = ["accepted", "declined"].includes(status)
      ? new Date().toISOString()
      : undefined;
    await db.update(schema.briefInterests)
      .set(respondedAt ? { status, respondedAt } : { status })
      .where(eq(schema.briefInterests.id, id));
  }

  async deactivateBrief(briefId: number): Promise<void> {
    await db.update(schema.briefs)
      .set({ isActive: false })
      .where(eq(schema.briefs.id, briefId));
  }

  async getBriefInterest(id: number): Promise<schema.BriefInterest | undefined> {
    const r = await db.select().from(schema.briefInterests).where(eq(schema.briefInterests.id, id));
    return r[0];
  }

  async updateBriefInterestPricing(id: number, data: {
    proposedPricePence?: number | null;
    priceBreakdown?: string | null;
    counterOfferPence?: number | null;
    status?: string;
  }): Promise<schema.BriefInterest | undefined> {
    const r = await db.update(schema.briefInterests)
      .set({ ...data } as any)
      .where(eq(schema.briefInterests.id, id))
      .returning();
    return r[0];
  }

  async updateProjectAgreedAmount(projectId: number, agreedAmountPence: number): Promise<void> {
    await db.update(schema.projects)
      .set({ agreedAmountPence } as any)
      .where(eq(schema.projects.id, projectId));
  }

  // ─── Notifications ────────────────────────────────────────────────────────
  async createNotification(data: schema.InsertNotification): Promise<schema.Notification> {
    const r = await db.insert(schema.notifications).values({
      ...data,
      createdAt: new Date().toISOString(),
    }).returning();
    return r[0];
  }

  /**
   * PRD-1 wave 3: paging added (`offset`). Ordered by id descending, not by
   * `created_at` — ordering by a text timestamp cannot page deterministically.
   */
  async getNotifications(recipientId: number, limit = 50, offset = 0): Promise<schema.Notification[]> {
    const cappedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 50), 1), 100);
    const safeOffset = Math.max(Math.trunc(Number(offset) || 0), 0);
    const r = await db.select().from(schema.notifications)
      .where(eq(schema.notifications.recipientId, recipientId))
      .orderBy(desc(schema.notifications.id))
      .limit(cappedLimit)
      .offset(safeOffset);
    return r;
  }

  /**
   * PRD-1 wave 3 ownership fix: `recipientId` is now REQUIRED and part of the
   * WHERE clause. Previously any authenticated user could mark ANY
   * notification id read by guessing it. Returns true when a row was actually
   * updated, so the route can answer 404 instead of a silent ok.
   */
  async markNotificationRead(id: number, recipientId: number): Promise<boolean> {
    const updated = await db.update(schema.notifications)
      .set({ read: 1 })
      .where(and(
        eq(schema.notifications.id, id),
        eq(schema.notifications.recipientId, recipientId)
      ))
      .returning({ id: schema.notifications.id });
    return updated.length > 0;
  }

  async markAllNotificationsRead(recipientId: number): Promise<void> {
    await db.update(schema.notifications)
      .set({ read: 1 })
      .where(eq(schema.notifications.recipientId, recipientId));
  }

  /** Counted in SQL rather than by loading every row (PRD-1 wave 3). */
  async getUnreadNotificationCount(recipientId: number): Promise<number> {
    const r = await db.select({ count: drizzleSql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(and(
        eq(schema.notifications.recipientId, recipientId),
        drizzleSql`(${schema.notifications.read} IS NULL OR ${schema.notifications.read} = 0)`
      ));
    return Number(r[0]?.count ?? 0);
  }

  // ── Workspace: Tasks ────────────────────────────────────────────────────
  async getTasks(userId: number): Promise<schema.Task[]> {
    return db.select().from(schema.tasks)
      .where(eq(schema.tasks.userId, userId))
      .orderBy(desc(schema.tasks.createdAt));
  }

  async createTask(data: schema.InsertTask): Promise<schema.Task> {
    const now = new Date().toISOString();
    const [row] = await db.insert(schema.tasks).values({
      ...data,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return row;
  }

  async updateTask(id: number, userId: number, data: Partial<schema.InsertTask>): Promise<schema.Task | undefined> {
    const [row] = await db.update(schema.tasks)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .returning();
    return row;
  }

  async deleteTask(id: number, userId: number): Promise<boolean> {
    const r = await db.delete(schema.tasks)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .returning();
    return r.length > 0;
  }

  // ── Workspace: Calendar Events ──────────────────────────────────────────
  async getCalendarEvents(userId: number, month: string): Promise<schema.CalendarEvent[]> {
    // month = "YYYY-MM" — filter by prefix match on the date column
    const r = await db.select().from(schema.calendarEvents)
      .where(and(
        eq(schema.calendarEvents.userId, userId),
        drizzleSql`date LIKE ${month + '%'}`
      ))
      .orderBy(schema.calendarEvents.date);
    return r;
  }

  async createCalendarEvent(data: schema.InsertCalendarEvent): Promise<schema.CalendarEvent> {
    const [row] = await db.insert(schema.calendarEvents).values({
      ...data,
      createdAt: new Date().toISOString(),
    }).returning();
    return row;
  }

  async updateCalendarEvent(id: number, userId: number, data: Partial<schema.InsertCalendarEvent>): Promise<schema.CalendarEvent | undefined> {
    const [row] = await db.update(schema.calendarEvents)
      .set(data)
      .where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.userId, userId)))
      .returning();
    return row;
  }

  async deleteCalendarEvent(id: number, userId: number): Promise<boolean> {
    const r = await db.delete(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.userId, userId)))
      .returning();
    return r.length > 0;
  }

  // ── Connection Requests ───────────────────────────────────────────────

  async sendConnectionRequest(senderId: number, recipientId: number): Promise<schema.ConnectionRequest> {
    // Upsert: if previously declined, re-open as pending
    const existing = await this.getConnectionRequestBetween(senderId, recipientId);
    if (existing) {
      const rows = await db.update(schema.connectionRequests)
        .set({ status: 'pending', respondedAt: null })
        .where(eq(schema.connectionRequests.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await db.insert(schema.connectionRequests)
      .values({ senderId, recipientId, createdAt: new Date().toISOString() })
      .returning();
    return rows[0];
  }

  async getConnectionRequestBetween(userA: number, userB: number): Promise<schema.ConnectionRequest | undefined> {
    // Check both directions
    const rows = await db.select().from(schema.connectionRequests)
      .where(
        or(
          and(eq(schema.connectionRequests.senderId, userA), eq(schema.connectionRequests.recipientId, userB)),
          and(eq(schema.connectionRequests.senderId, userB), eq(schema.connectionRequests.recipientId, userA))
        )
      );
    return rows[0];
  }

  async getPendingConnectionRequests(recipientId: number) {
    const rows = await db.select().from(schema.connectionRequests)
      .where(and(
        eq(schema.connectionRequests.recipientId, recipientId),
        eq(schema.connectionRequests.status, 'pending')
      ))
      .orderBy(desc(schema.connectionRequests.id));

    const result = [];
    for (const row of rows) {
      const sender = await db.select().from(schema.users).where(eq(schema.users.id, row.senderId));
      const s = sender[0];
      if (s) {
        result.push({ ...row, senderName: s.name, senderAvatar: s.avatar, senderHeadline: s.headline, senderRole: s.role });
      }
    }
    return result;
  }

  async respondToConnectionRequest(id: number, status: 'accepted' | 'declined'): Promise<void> {
    await db.update(schema.connectionRequests)
      .set({ status, respondedAt: new Date().toISOString() })
      .where(eq(schema.connectionRequests.id, id));
  }

  async getConnections(userId: number): Promise<{ id: number; name: string; avatar: string | null; headline: string | null; role: string; location: string | null }[]> {
    // Accepted requests where this user is either sender or recipient
    const rows = await db.select().from(schema.connectionRequests)
      .where(and(
        eq(schema.connectionRequests.status, 'accepted'),
        or(
          eq(schema.connectionRequests.senderId, userId),
          eq(schema.connectionRequests.recipientId, userId)
        )
      ));

    const otherIds = rows.map(r => r.senderId === userId ? r.recipientId : r.senderId);
    if (otherIds.length === 0) return [];

    const result = [];
    for (const otherId of otherIds) {
      const u = await db.select({
        id: schema.users.id,
        name: schema.users.name,
        avatar: schema.users.avatar,
        headline: schema.users.headline,
        role: schema.users.role,
        location: schema.users.location,
      }).from(schema.users).where(eq(schema.users.id, otherId));
      if (u[0]) result.push(u[0]);
    }
    return result;
  }

  async getConnectionUserIds(userId: number): Promise<number[]> {
    const conns = await this.getConnections(userId);
    return conns.map(c => c.id);
  }

  async isConnected(userA: number, userB: number): Promise<boolean> {
    const req = await this.getConnectionRequestBetween(userA, userB);
    return req?.status === 'accepted';
  }

  async removeConnection(userA: number, userB: number): Promise<void> {
    await db.update(schema.connectionRequests)
      .set({ status: 'declined', respondedAt: new Date().toISOString() })
      .where(
        or(
          and(eq(schema.connectionRequests.senderId, userA), eq(schema.connectionRequests.recipientId, userB)),
          and(eq(schema.connectionRequests.senderId, userB), eq(schema.connectionRequests.recipientId, userA))
        )
      );
  }

  // ─── Agencies ──────────────────────────────────────────────────

  // Time Entries ─────────────────────────────────────────────────────────────

  async createTimeEntry(data: schema.InsertTimeEntry): Promise<schema.TimeEntry> {
    const r = await db.insert(schema.timeEntries).values(data).returning();
    return r[0];
  }

  async getTimeEntriesByProject(projectId: number): Promise<schema.TimeEntry[]> {
    return await db
      .select()
      .from(schema.timeEntries)
      .where(drizzleSql`${schema.timeEntries.projectId} = ${projectId}`)
      .orderBy(drizzleSql`${schema.timeEntries.loggedAt} DESC, ${schema.timeEntries.id} DESC`);
  }

  async getTimeEntriesByUser(userId: number): Promise<schema.TimeEntry[]> {
    return await db
      .select()
      .from(schema.timeEntries)
      .where(drizzleSql`${schema.timeEntries.userId} = ${userId}`)
      .orderBy(drizzleSql`${schema.timeEntries.loggedAt} DESC, ${schema.timeEntries.id} DESC`);
  }

  async getTimeEntriesByAgency(agencyId: number): Promise<schema.TimeEntry[]> {
    return await db
      .select()
      .from(schema.timeEntries)
      .where(drizzleSql`${schema.timeEntries.agencyId} = ${agencyId}`)
      .orderBy(drizzleSql`${schema.timeEntries.loggedAt} DESC, ${schema.timeEntries.id} DESC`);
  }

  async updateTimeEntry(id: number, userId: number, data: Partial<schema.InsertTimeEntry>): Promise<schema.TimeEntry | undefined> {
    const r = await db
      .update(schema.timeEntries)
      .set(data)
      .where(drizzleSql`${schema.timeEntries.id} = ${id} AND ${schema.timeEntries.userId} = ${userId}`)
      .returning();
    return r[0];
  }

  async deleteTimeEntry(id: number, userId: number): Promise<boolean> {
    const r = await db
      .delete(schema.timeEntries)
      .where(drizzleSql`${schema.timeEntries.id} = ${id} AND ${schema.timeEntries.userId} = ${userId}`)
      .returning();
    return r.length > 0;
  }

  async createAgency(data: schema.InsertAgency): Promise<schema.Agency> {
    const r = await db.insert(schema.agencies).values(data).returning();
    return r[0];
  }

  async getAgency(id: number): Promise<schema.Agency | undefined> {
    const r = await db.select().from(schema.agencies).where(eq(schema.agencies.id, id));
    return r[0];
  }

  async getAgencyBySlug(slug: string): Promise<schema.Agency | undefined> {
    const r = await db.select().from(schema.agencies).where(eq(schema.agencies.slug, slug));
    return r[0];
  }

  async getAgencyByInviteCode(code: string): Promise<schema.Agency | undefined> {
    const r = await db.select().from(schema.agencies).where(eq(schema.agencies.inviteCode, code));
    return r[0];
  }

  async getAgencyByOwner(ownerUserId: number): Promise<schema.Agency | undefined> {
    const r = await db.select().from(schema.agencies).where(eq(schema.agencies.ownerUserId, ownerUserId));
    return r[0];
  }

  async updateAgency(id: number, data: Partial<schema.InsertAgency>): Promise<schema.Agency | undefined> {
    const r = await db.update(schema.agencies).set(data).where(eq(schema.agencies.id, id)).returning();
    return r[0];
  }

  async getAgencyMembers(agencyId: number): Promise<AgencyMemberWithUser[]> {
    const members = await db.select().from(schema.agencyMembers)
      .where(eq(schema.agencyMembers.agencyId, agencyId));
    const result: AgencyMemberWithUser[] = [];
    for (const member of members) {
      const uRows = await db.select().from(schema.users).where(eq(schema.users.id, member.userId));
      const user = uRows[0];
      if (!user) continue;
      const pRows = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, member.userId));
      const profile = pRows[0] ?? null;
      result.push({ member, user, profile });
    }
    return result;
  }

  async addAgencyMember(data: schema.InsertAgencyMember): Promise<schema.AgencyMember> {
    const r = await db.insert(schema.agencyMembers).values(data).returning();
    return r[0];
  }

  async approveAgencyMember(memberId: number): Promise<void> {
    await db.update(schema.agencyMembers)
      .set({ status: 'active', joinedAt: new Date().toISOString() })
      .where(eq(schema.agencyMembers.id, memberId));
  }

  async removeAgencyMember(agencyId: number, userId: number): Promise<void> {
    await db.delete(schema.agencyMembers)
      .where(and(eq(schema.agencyMembers.agencyId, agencyId), eq(schema.agencyMembers.userId, userId)));
    // Reset the user's accountSubtype back to sole
    await db.update(schema.users)
      .set({ accountSubtype: 'sole', agencyId: null })
      .where(eq(schema.users.id, userId));
  }

  async getAgencyMemberByUser(userId: number): Promise<schema.AgencyMember | undefined> {
    const r = await db.select().from(schema.agencyMembers).where(eq(schema.agencyMembers.userId, userId));
    return r[0];
  }

  async getAgencyMemberByUserId(userId: number): Promise<schema.AgencyMember | undefined> {
    const r = await db.select().from(schema.agencyMembers).where(eq(schema.agencyMembers.userId, userId));
    return r[0];
  }

  async updateAgencyMemberRate(memberId: number, agencyId: number, data: { role?: string; dayRatePence?: number | null; hourlyRatePence?: number | null }): Promise<schema.AgencyMember | undefined> {
    const r = await db
      .update(schema.agencyMembers)
      .set(data as any)
      .where(drizzleSql`${schema.agencyMembers.id} = ${memberId} AND ${schema.agencyMembers.agencyId} = ${agencyId}`)
      .returning();
    return r[0];
  }

  async getAgencyDashboard(agencyId: number): Promise<AgencyDashboard> {
    const agency = await this.getAgency(agencyId);
    if (!agency) throw new Error('Agency not found');
    const members = await this.getAgencyMembers(agencyId);
    // Collect all projects for all members
    const allProjects: ProjectWithDetails[] = [];
    let totalEarnedPence = 0;
    let totalInvoicedPence = 0;
    let totalOutstandingPence = 0;
    const financials: AgencyProjectFinancial[] = [];

    for (const { user } of members) {
      if (user) {
        const projects = await this.getProjectsForUser(user.id);
        for (const pd of projects) {
          if (pd.project.freelancerId === user.id) {
            allProjects.push(pd);
            if (pd.project.agreedAmountPence) {
              totalInvoicedPence += pd.project.agreedAmountPence;
              if (pd.project.paymentStatus === 'paid') {
                totalEarnedPence += pd.project.agreedAmountPence;
              } else {
                totalOutstandingPence += pd.project.agreedAmountPence;
              }
            }
            // All projects with any financial data go into financials
            financials.push({
              projectId: pd.project.id,
              title: pd.project.title,
              freelancerId: pd.project.freelancerId,
              freelancerName: pd.freelancer?.name ?? 'Unknown',
              clientName: pd.client?.name ?? 'Unknown',
              agreedAmountPence: pd.project.agreedAmountPence ?? null,
              paymentStatus: pd.project.paymentStatus ?? 'unpaid',
              status: pd.project.status,
              createdAt: pd.project.createdAt,
            });
          }
        }
      }
    }

    const activeProjectCount = allProjects.filter(p => p.project.status === 'active').length;
    const recentProjects = allProjects
      .sort((a, b) => new Date(b.project.createdAt).getTime() - new Date(a.project.createdAt).getTime())
      .slice(0, 10);

    return {
      agency,
      members,
      totalEarnedPence,
      totalInvoicedPence,
      totalOutstandingPence,
      activeProjectCount,
      recentProjects,
      financials,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Agency Briefs
  // ─────────────────────────────────────────────────────────────

  async createAgencyBrief(data: schema.InsertAgencyBrief): Promise<schema.AgencyBrief> {
    const result = await db.insert(schema.agencyBriefs).values({
      ...data,
      createdAt: new Date().toISOString(),
    }).returning().get();
    return result;
  }

  async getAgencyBriefs(agencyId: number): Promise<schema.AgencyBrief[]> {
    return db.select().from(schema.agencyBriefs)
      .where(eq(schema.agencyBriefs.agencyId, agencyId))
      .orderBy(desc(schema.agencyBriefs.createdAt))
      .all();
  }

  async getAgencyBrief(id: number): Promise<schema.AgencyBrief | undefined> {
    return db.select().from(schema.agencyBriefs)
      .where(eq(schema.agencyBriefs.id, id))
      .get();
  }

  async updateAgencyBriefStatus(id: number, status: string): Promise<schema.AgencyBrief | undefined> {
    return db.update(schema.agencyBriefs)
      .set({ status })
      .where(eq(schema.agencyBriefs.id, id))
      .returning().get();
  }

  // ─────────────────────────────────────────────────────────────
  // Agency Proposals
  // ─────────────────────────────────────────────────────────────

  async createAgencyProposal(data: schema.InsertAgencyProposal): Promise<schema.AgencyProposal> {
    const result = await db.insert(schema.agencyProposals).values({
      ...data,
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }).returning().get();
    return result;
  }

  async getAgencyProposal(briefId: number): Promise<schema.AgencyProposal | undefined> {
    return db.select().from(schema.agencyProposals)
      .where(eq(schema.agencyProposals.agencyBriefId, briefId))
      .get();
  }

  async getAgencyProposals(agencyId: number): Promise<schema.AgencyProposal[]> {
    return db.select().from(schema.agencyProposals)
      .where(eq(schema.agencyProposals.agencyId, agencyId))
      .orderBy(desc(schema.agencyProposals.createdAt))
      .all();
  }

  async updateAgencyProposalStatus(id: number, status: string): Promise<schema.AgencyProposal | undefined> {
    return db.update(schema.agencyProposals)
      .set({ status, respondedAt: new Date().toISOString() })
      .where(eq(schema.agencyProposals.id, id))
      .returning().get();
  }

  // ─────────────────────────────────────────────────────────────
  // Agency Activity Feed
  // ─────────────────────────────────────────────────────────────

  async createAgencyActivity(data: schema.InsertAgencyActivity): Promise<schema.AgencyActivity> {
    const result = await db.insert(schema.agencyActivity).values({
      ...data,
      createdAt: new Date().toISOString(),
    }).returning().get();
    return result;
  }

  async getAgencyActivity(agencyId: number, limit = 50): Promise<schema.AgencyActivity[]> {
    return db.select().from(schema.agencyActivity)
      .where(eq(schema.agencyActivity.agencyId, agencyId))
      .orderBy(desc(schema.agencyActivity.createdAt))
      .limit(limit)
      .all();
  }

  async getInvoiceTemplate(userId: number): Promise<schema.InvoiceTemplate | undefined> {
    const r = await db.select().from(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.userId, userId));
    return r[0];
  }

  async upsertInvoiceTemplate(userId: number, data: Partial<schema.InsertInvoiceTemplate>): Promise<schema.InvoiceTemplate> {
    const existing = await this.getInvoiceTemplate(userId);
    if (existing) {
      const r = await db.update(schema.invoiceTemplates)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(schema.invoiceTemplates.userId, userId))
        .returning();
      return r[0];
    } else {
      const r = await db.insert(schema.invoiceTemplates)
        .values({ userId, businessName: '', businessAddress: '', businessEmail: '', businessPhone: '', vatNumber: '', paymentTerms: 'Payment processed securely through Viewrr', footerNote: '', accentColor: '#FF5A1F', updatedAt: new Date().toISOString(), ...data })
        .returning();
      return r[0];
    }
  }

  async createInvoice(data: schema.InsertInvoice): Promise<schema.Invoice> {
    const r = await db.insert(schema.invoices).values(data).returning();
    return r[0];
  }

  async getInvoiceById(invoiceId: number): Promise<schema.Invoice | undefined> {
    const r = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    return r[0];
  }

  async getInvoiceByProject(projectId: number): Promise<schema.Invoice | undefined> {
    const r = await db.select().from(schema.invoices).where(eq(schema.invoices.projectId, projectId));
    return r[0];
  }

  async getInvoicesByFreelancer(freelancerId: number): Promise<schema.Invoice[]> {
    return db.select().from(schema.invoices).where(eq(schema.invoices.freelancerId, freelancerId));
  }

  async markInvoicePaid(invoiceId: number): Promise<void> {
    await db.update(schema.invoices)
      .set({ status: 'paid', paidAt: new Date().toISOString() })
      .where(eq(schema.invoices.id, invoiceId));
  }

  async getNextInvoiceNumber(freelancerId: number): Promise<string> {
    const all = await this.getInvoicesByFreelancer(freelancerId);
    const next = all.length + 1;
    return `INV-${String(next).padStart(5, '0')}`;
  }

  // ── Founder Dashboard ────────────────────────────────────────────────────────
  async getUserById(id: number): Promise<schema.User | undefined> {
    return this.getUser(id);
  }

  async getAllUsers(): Promise<schema.User[]> {
    const rows = await db.select().from(schema.users).orderBy(desc(schema.users.id));
    return rows.map(u => safeUser(u) as schema.User);
  }

  async getAllProjects(): Promise<schema.Project[]> {
    return db.select().from(schema.projects).orderBy(desc(schema.projects.id));
  }

  // ── Accreditation System ─────────────────────────────────────────────────

  /** Get all freelancer profiles with accreditation data (for founder panel) */
  async getFreelancerProfilesWithAccreditation(): Promise<(schema.Profile & { userName: string; userEmail: string; userAvatar: string | null })[]> {
    const rows = await db
      .select({
        profile: schema.profiles,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
      })
      .from(schema.profiles)
      .innerJoin(schema.users, eq(schema.profiles.userId, schema.users.id))
      .where(eq(schema.users.role, "freelancer"))
      .orderBy(desc(schema.profiles.id));
    return rows.map(r => ({ ...r.profile, userName: r.userName, userEmail: r.userEmail, userAvatar: r.userAvatar }));
  }

  /** Update accreditation level on a profile */
  async updateAccreditation(profileId: number, data: {
    accreditationLevel: string | null;
    accreditationApprovedBy: number | null;
    accreditationApprovedByName: string | null;
    accreditationApprovedDate: string | null;
    accreditationNotes: string | null;
    accreditationLastReviewed: string;
  }): Promise<schema.Profile> {
    const r = await db
      .update(schema.profiles)
      .set(data)
      .where(eq(schema.profiles.id, profileId))
      .returning();
    return r[0];
  }

  /** Update only internal notes (founder private notes) */
  async updateAccreditationNotes(profileId: number, notes: string): Promise<void> {
    await db
      .update(schema.profiles)
      .set({ accreditationNotes: notes, accreditationLastReviewed: new Date().toISOString() })
      .where(eq(schema.profiles.id, profileId));
  }

  /** Write an audit log entry */
  async createAccreditationHistory(data: schema.InsertAccreditationHistory): Promise<schema.AccreditationHistory> {
    const r = await db.insert(schema.accreditationHistory).values(data).returning();
    return r[0];
  }

  /** Get full history for a freelancer */
  async getAccreditationHistory(freelancerUserId: number): Promise<schema.AccreditationHistory[]> {
    return db
      .select()
      .from(schema.accreditationHistory)
      .where(eq(schema.accreditationHistory.freelancerUserId, freelancerUserId))
      .orderBy(desc(schema.accreditationHistory.actionDate));
  }

  /** Get all history (for founder panel overview) */
  async getAllAccreditationHistory(limit = 50): Promise<schema.AccreditationHistory[]> {
    return db
      .select()
      .from(schema.accreditationHistory)
      .orderBy(desc(schema.accreditationHistory.actionDate))
      .limit(limit);
  }
}

export const storage = new Storage();


export async function initStorage() {
  await verifyDatabaseConnection();
}

// ── Extend Storage with notification preferences methods ──
(Storage.prototype as any).getNotifPrefs = async function(userId: number): Promise<schema.NotifPrefs | null> {
  const r = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, userId));
  return r[0] ?? null;
};

// PRD 1 security fix: mass-assignment guard.
// PATCH /api/notifications/preferences/:userId passed req.body straight through
// to this function, which spread it into a Drizzle .set()/.values(). Any column
// on notification_preferences — including `id` and `userId` — could be written
// by the client, letting a caller re-point their preferences row at another
// user's id. Only these keys are ever accepted now; everything else is dropped
// silently rather than 400-ing, so an older app build that sends extra fields
// keeps working.
export const NOTIF_PREF_KEYS = [
  "emailProjectInvitations",
  "emailNewOffers",
  "emailCounterOffers",
  "emailMessages",
  "emailStageUpdates",
  "emailPaymentUpdates",
  "emailReviewRequests",
  "emailProductUpdates",
] as const;

export type NotifPrefKey = typeof NOTIF_PREF_KEYS[number];

/** Keep only whitelisted boolean preference keys. Never trust req.body shape. */
export function sanitiseNotifPrefs(input: unknown): Partial<Record<NotifPrefKey, boolean>> {
  const out: Partial<Record<NotifPrefKey, boolean>> = {};
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const key of NOTIF_PREF_KEYS) {
    if (!(key in src)) continue;
    const v = src[key];
    // Coerce only unambiguous booleans; ignore anything else.
    if (typeof v === "boolean") out[key] = v;
    else if (v === 1 || v === "true" || v === "1") out[key] = true;
    else if (v === 0 || v === "false" || v === "0") out[key] = false;
  }
  return out;
}

(Storage.prototype as any).upsertNotifPrefs = async function(userId: number, prefs: unknown): Promise<schema.NotifPrefs> {
  const safe = sanitiseNotifPrefs(prefs);
  const existing = await (storage as any).getNotifPrefs(userId);
  const updatedAt = new Date().toISOString();
  if (existing) {
    const r = await db.update(schema.notificationPreferences)
      .set({ ...safe, updatedAt })
      .where(eq(schema.notificationPreferences.userId, userId))
      .returning();
    return r[0];
  }
  const r = await db.insert(schema.notificationPreferences).values({ userId, ...safe, updatedAt }).returning();
  return r[0];
};
