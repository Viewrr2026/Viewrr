import { pgTable, text, integer, real, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  // PRD-019: password algorithm discriminator ('sha256_v1' | 'argon2id')
  passwordAlgo: text("password_algo").notNull().default("sha256_v1"),
  phone: text("phone"),
  role: text("role").notNull().default("freelancer"), // "freelancer" | "client"
  accountSubtype: text("account_subtype").default("sole"), // "sole" | "agency_owner" | "agency_member"
  agencyId: integer("agency_id"),  // set if agency_owner or agency_member
  avatar: text("avatar"),
  banner: text("banner"),
  headline: text("headline"),   // e.g. "Videographer & Director · London"
  bio: text("bio"),
  location: text("location"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  isAdmin: boolean("is_admin").notNull().default(false),
  // ─ Stripe Connect ─
  stripeAccountId: text("stripe_account_id"),           // Express account ID (acct_...)
  stripeOnboarded: integer("stripe_onboarded").default(0), // 1 = fully verified
  stripePendingPence: integer("stripe_pending_pence").default(0), // held earnings in pence
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Freelancer Profiles ──────────────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  specialisms: text("specialisms").notNull().default("[]"), // JSON array
  skills: text("skills").notNull().default("[]"),           // JSON array
  hourlyRate: real("hourly_rate"),
  dayRate: real("day_rate"),
  availability: text("availability").notNull().default("available"),
  yearsExperience: integer("years_experience"),
  reelUrl: text("reel_url"),
  portfolioItems: text("portfolio_items").notNull().default("[]"),
  socialLinks: text("social_links").notNull().default("{}"),
  rating: real("rating").default(0),
  reviewCount: integer("review_count").default(0),
  projectCount: integer("project_count").default(0),
  featured: integer("featured").default(0),
  badges: text("badges").notNull().default("[]"),
  isPro: integer("is_pro").default(0),
  proSince: text("pro_since"),
  cardThumbnail: text("card_thumbnail"),
  // ─ Accreditation ───────────────────────────────────────────────────────────
  accreditationLevel: text("accreditation_level"),    // null | "verified" | "approved" | "elite" | future
  accreditationApprovedBy: integer("accreditation_approved_by"), // founder user id
  accreditationApprovedByName: text("accreditation_approved_by_name"),
  accreditationApprovedDate: text("accreditation_approved_date"), // ISO datetime
  accreditationNotes: text("accreditation_notes"),     // internal founder notes (NEVER shown to freelancer)
  accreditationLastReviewed: text("accreditation_last_reviewed"), // ISO datetime
  reviewAverage: real("review_average").default(0),
  verifiedReviewCount: integer("verified_review_count").default(0),
  completedProjectCount: integer("completed_project_count").default(0),
});

export const insertProfileSchema = createInsertSchema(profiles).omit({ id: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profiles.$inferSelect;

// ─── Reviews ─────────────────────────────────────────────────────────────────
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),    // profile being reviewed
  clientId: integer("client_id").notNull(),       // reviewer user id
  clientName: text("client_name").notNull(),      // reviewer display name
  clientAvatar: text("client_avatar"),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  projectType: text("project_type"),
  projectId: integer("project_id"),               // which project this review is for
  verifiedProjectReview: integer("verified_project_review").default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

// verifiedProjectReview is ALWAYS server-set — never accepted from request body
export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true, verifiedProjectReview: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

// ─── Messages ────────────────────────────────────────────────────────────────
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  fromId: integer("from_id").notNull(),
  toId: integer("to_id").notNull(),
  content: text("content").notNull(),
  read: integer("read").default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  interestId: integer("interest_id"),  // null = general DM; set = scoped to a brief interest
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ─── Feed Posts ─────────────────────────────────────────────────────────────
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  caption: text("caption").notNull().default(""),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
  tags: text("tags").notNull().default("[]"),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertPostSchema = createInsertSchema(posts).omit({ id: true, createdAt: true, likeCount: true, commentCount: true });
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof posts.$inferSelect;

// ─── Post Likes ───────────────────────────────────────────────────────────────
export const postLikes = pgTable("post_likes", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  userId: integer("user_id").notNull(),
});

export const insertPostLikeSchema = createInsertSchema(postLikes).omit({ id: true });
export type InsertPostLike = z.infer<typeof insertPostLikeSchema>;
export type PostLike = typeof postLikes.$inferSelect;

// ─── Post Comments ────────────────────────────────────────────────────────────
export const postComments = pgTable("post_comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertPostCommentSchema = createInsertSchema(postComments).omit({ id: true, createdAt: true });
export type InsertPostComment = z.infer<typeof insertPostCommentSchema>;
export type PostComment = typeof postComments.$inferSelect;

// ─── Projects ────────────────────────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  freelancerId: integer("freelancer_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  currentStage: integer("current_stage").notNull().default(0),
  briefId: integer("brief_id"),           // source brief (if created from interest)
  interestId: integer("interest_id"),     // source interest
  freelancerName: text("freelancer_name"), // denormalised for easy display
  clientName: text("client_name"),         // denormalised for easy display
  briefCategory: text("brief_category"),   // e.g. "Videographer"
  paymentStatus: text("payment_status").default("unpaid"), // "unpaid" | "paid"
  reviewGivenByClient: integer("review_given_by_client").default(0),
  reviewGivenByFreelancer: integer("review_given_by_freelancer").default(0),
  // ─ Retainer fields (null on one-off projects) ─
  isRetainer: integer("is_retainer").default(0),                          // 1 = retainer, 0 = one-off
  billingCycle: text("billing_cycle"),                                     // "weekly" | "fortnightly" | "monthly" | "per_deliverable"
  deliverablesPerCycle: text("deliverables_per_cycle"),                    // free-text, e.g. "2 Reels, 4 TikToks"
  totalCycles: integer("total_cycles"),                                    // agreed number of cycles (null = open-ended)
  currentCycleNumber: integer("current_cycle_number").default(1),          // which cycle is live
  agreedAmountPence: integer("agreed_amount_pence"),                        // locked agreed price in pence
  agencyId: integer("agency_id"),           // set if project sourced via agency member
  agencyBriefId: integer("agency_brief_id"), // set if project created from accepted agency proposal
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  // ─ Completion & soft-delete (PRD: Reliable Project Completion & Deletion) ─
  completedAt: text("completed_at"),   // ISO timestamp when marked complete
  completedBy: integer("completed_by"), // userId who triggered completion
  deletedAt: text("deleted_at"),        // ISO timestamp of soft-delete
  deletedBy: integer("deleted_by"),     // userId who triggered deletion
  deletionReason: text("deletion_reason"), // "onboarding_cleanup" | "user_request" etc
  // ─ PRD-014: Dynamic Project Stages ─────────────────────────────────────────
  // 'legacy' | 'planning_required' | 'plan_draft' | 'awaiting_client' | 'client_changes' | 'confirmed'
  planningStatus: text("planning_status").notNull().default("legacy"),
  planConfirmedAt: text("plan_confirmed_at"),
  planSentToClientAt: text("plan_sent_to_client_at"),
});

// ─── Retainer Cycles ─────────────────────────────────────────────────────────
// Each row is one billing cycle within a retainer project.
export const retainerCycles = pgTable("retainer_cycles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  cycleNumber: integer("cycle_number").notNull(),          // 1, 2, 3…
  status: text("status").notNull().default("active"),      // active | awaiting_signoff | awaiting_payment | paid | paused
  startDate: text("start_date").notNull(),                 // ISO date
  endDate: text("end_date"),                               // ISO date — set when cycle closes
  freelancerNote: text("freelancer_note"),                 // note when submitting
  paymentStatus: text("payment_status").notNull().default("unpaid"), // unpaid | paid
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export const insertRetainerCycleSchema = createInsertSchema(retainerCycles).omit({ id: true, createdAt: true });
export type InsertRetainerCycle = z.infer<typeof insertRetainerCycleSchema>;
export type RetainerCycle = typeof retainerCycles.$inferSelect;

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// ─── Project Updates ─────────────────────────────────────────────────────────
export const projectUpdates = pgTable("project_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  authorId: integer("author_id").notNull(),
  stage: integer("stage").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertProjectUpdateSchema = createInsertSchema(projectUpdates).omit({ id: true, createdAt: true });
export type InsertProjectUpdate = z.infer<typeof insertProjectUpdateSchema>;
export type ProjectUpdate = typeof projectUpdates.$inferSelect;

// ─── Briefs ──────────────────────────────────────────────────────────────────
export const briefs = pgTable("briefs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  clientName: text("client_name").notNull(),
  clientAvatar: text("client_avatar"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  location: text("location").notNull(),
  remote: integer("remote").default(0),
  startDate: text("start_date"),
  duration: text("duration"),
  budgetMin: real("budget_min"),
  budgetMax: real("budget_max"),
  budgetType: text("budget_type").notNull().default("project"),
  requirements: text("requirements").notNull().default(""),
  status: text("status").notNull().default("open"),
  applicationCount: integer("application_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true), // false once a freelancer is accepted
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertBriefSchema = createInsertSchema(briefs).omit({ id: true, createdAt: true, applicationCount: true });
export type InsertBrief = z.infer<typeof insertBriefSchema>;
export type Brief = typeof briefs.$inferSelect;

// ─── Profile Views ──────────────────────────────────────────────────────────
export const profileViews = pgTable("profile_views", {
  id: serial("id").primaryKey(),
  profileUserId: integer("profile_user_id").notNull(), // the freelancer being viewed
  viewerIp: text("viewer_ip"),                         // deduplicate anonymous views
  viewerId: integer("viewer_id"),                      // null if not logged in
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type ProfileView = typeof profileViews.$inferSelect;

// ─── Brief Interests (applications) ─────────────────────────────────────────
export const briefInterests = pgTable("brief_interests", {
  id: serial("id").primaryKey(),
  briefId: integer("brief_id").notNull(),
  briefTitle: text("brief_title").notNull(),
  briefClientId: integer("brief_client_id").notNull(),
  briefClientName: text("brief_client_name").notNull(),
  freelancerId: integer("freelancer_id").notNull(),
  freelancerName: text("freelancer_name").notNull(),
  freelancerAvatar: text("freelancer_avatar"),
  coverNote: text("cover_note").notNull(),
  rate: text("rate"),
  availability: text("availability"),
  proposedPricePence: integer("proposed_price_pence"),   // freelancer's fixed price proposal
  priceBreakdown: text("price_breakdown"),               // optional notes on what's included
  counterOfferPence: integer("counter_offer_pence"),     // client counter-offer
  status: text("status").notNull().default("pending"), // "pending" | "viewed" | "accepted" | "declined" | "counter_offered"
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  respondedAt: text("responded_at"),
});

export const insertBriefInterestSchema = createInsertSchema(briefInterests).omit({ id: true, createdAt: true });
export type InsertBriefInterest = z.infer<typeof insertBriefInterestSchema>;
export type BriefInterest = typeof briefInterests.$inferSelect;

// ─── Notifications ──────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  recipientId: integer("recipient_id").notNull(),  // who receives this
  actorId: integer("actor_id"),                     // who triggered it (null for system events)
  actorName: text("actor_name").notNull(),
  actorAvatar: text("actor_avatar"),
  type: text("type").notNull(), // "like" | "comment" | "message" | "interest" | "interest_accepted" | "interest_declined" | "profile_view" | "connection"
  message: text("message").notNull(),
  link: text("link"),          // optional route to navigate to
  read: integer("read").notNull().default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ─── Saved Freelancers ────────────────────────────────────────────────────────
export const saved = pgTable("saved", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  profileId: integer("profile_id").notNull(),
});

export const insertSavedSchema = createInsertSchema(saved).omit({ id: true });
export type InsertSaved = z.infer<typeof insertSavedSchema>;
export type Saved = typeof saved.$inferSelect;

// ── Workspace: Tasks ──────────────────────────────────────────────────
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("todo"),   // todo | in_progress | done
  priority: text("priority").notNull().default("medium"), // low | medium | high
  dueDate: text("due_date"),                           // ISO date string or null
  tags: text("tags").notNull().default("[]"),          // JSON string[]
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ── Workspace: Calendar Events ─────────────────────────────────────────
export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  date: text("date").notNull(),     // ISO date YYYY-MM-DD
  startTime: text("start_time"),   // HH:MM or null (all-day)
  endTime: text("end_time"),
  color: text("color").notNull().default("#FF5A1F"),  // Viewrr orange default
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({ id: true });
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

// ─── Meetings ────────────────────────────────────────────────────────────────
export const meetings = pgTable("meetings", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  createdBy: integer("created_by").notNull(),
  title: text("title").notNull().default("Project call"),
  meetLink: text("meet_link").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  isInstant: boolean("is_instant").notNull().default(false),
  status: text("status").notNull().default("scheduled"), // "scheduled" | "cancelled" | "completed"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertMeetingSchema = createInsertSchema(meetings).omit({ id: true, createdAt: true });
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type Meeting = typeof meetings.$inferSelect;

// ─── Deleted Posts Log (admin moderation history) ─────────────────────────────
export const deletedPosts = pgTable("deleted_posts", {
  id: serial("id").primaryKey(),
  postId: integer("post_id").notNull(),
  ownerId: integer("owner_id").notNull(),
  ownerName: text("owner_name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  caption: text("caption"),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
  tags: text("tags"),
  deletedBy: integer("deleted_by").notNull(),
  deletedAt: text("deleted_at").notNull(),
});
export type DeletedPost = typeof deletedPosts.$inferSelect;

// ─── Deliverables (WIP file sharing) ─────────────────────────────────────────
export const deliverables = pgTable("deliverables", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  url: text("url").notNull(),
  label: text("label").notNull(),
  platform: text("platform").notNull(),
  embedUrl: text("embed_url").notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});
export type Deliverable = typeof deliverables.$inferSelect;

// ─── Connection Requests (LinkedIn-style) ───────────────────────────────────
export const connectionRequests = pgTable("connection_requests", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull(),
  recipientId: integer("recipient_id").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "accepted" | "declined"
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  respondedAt: text("responded_at"),
});
export type ConnectionRequest = typeof connectionRequests.$inferSelect;

// ─── Project Invitations (private briefs) ─────────────────────────────────────
export const projectInvitations = pgTable("project_invitations", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull(),
  recipientId: integer("recipient_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  budget: text("budget"),
  timeline: text("timeline"),
  startStage: integer("start_stage").notNull().default(0), // 0–5 maps to STAGES array
  status: text("status").notNull().default("pending"), // pending | accepted | declined
  createdAt: text("created_at").notNull(),
  // Retainer fields (null for one-off)
  isRetainer: integer("is_retainer").default(0),
  billingCycle: text("billing_cycle"),
  deliverablesPerCycle: text("deliverables_per_cycle"),
  totalCycles: integer("total_cycles"),
});
export type ProjectInvitation = typeof projectInvitations.$inferSelect;

// ─── Agencies ─────────────────────────────────────────────────────────────────
export const agencies = pgTable("agencies", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),          // URL-safe e.g. "spark-films"
  bio: text("bio").notNull().default(""),
  logo: text("logo"),                             // avatar URL
  banner: text("banner"),                         // banner image URL
  location: text("location"),
  website: text("website"),
  specialisms: text("specialisms").notNull().default("[]"), // JSON array
  reelUrl: text("reel_url"),
  inviteCode: text("invite_code").notNull().unique(), // random token for invite links
  featuredWork: text("featured_work").notNull().default("[]"),  // JSON array of {url, label, type: "image"|"video"}
  testimonials: text("testimonials").notNull().default("[]"),   // JSON array of {name, role, company, quote, avatar}
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertAgencySchema = createInsertSchema(agencies).omit({ id: true, createdAt: true });
export type InsertAgency = z.infer<typeof insertAgencySchema>;
export type Agency = typeof agencies.$inferSelect;

// ─── Agency Members ───────────────────────────────────────────────────────────
export const agencyMembers = pgTable("agency_members", {
  id: serial("id").primaryKey(),
  agencyId: integer("agency_id").notNull(),
  userId: integer("user_id").notNull().unique(), // one agency per freelancer
  status: text("status").notNull().default("pending"), // "pending" | "active"
  role: text("role").notNull().default("member"),        // display role e.g. "Lead Editor"
  dayRatePence: integer("day_rate_pence"),               // agency-internal rate (pence)
  hourlyRatePence: integer("hourly_rate_pence"),         // agency-internal rate (pence)
  joinedAt: text("joined_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertAgencyMemberSchema = createInsertSchema(agencyMembers).omit({ id: true, createdAt: true });
export type InsertAgencyMember = z.infer<typeof insertAgencyMemberSchema>;
export type AgencyMember = typeof agencyMembers.$inferSelect;

// ─── Time Entries ─────────────────────────────────────────────────────────────
export const timeEntries = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(),
  agencyId: integer("agency_id"),               // null for sole freelancers
  description: text("description").notNull().default(""),
  minutes: integer("minutes").notNull(),         // total minutes logged
  billable: boolean("billable").notNull().default(true),
  loggedAt: text("logged_at").notNull(),         // ISO date string "YYYY-MM-DD"
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({ id: true, createdAt: true });
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;

// ─── Agency Briefs (client → agency direct briefs) ───────────────────────────────────
export const agencyBriefs = pgTable("agency_briefs", {
  id: serial("id").primaryKey(),
  agencyId: integer("agency_id").notNull(),
  clientId: integer("client_id").notNull(),
  clientName: text("client_name").notNull(),
  clientAvatar: text("client_avatar"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default(""),
  budgetMin: integer("budget_min"),               // pence
  budgetMax: integer("budget_max"),               // pence
  startDate: text("start_date"),
  duration: text("duration"),
  requirements: text("requirements").notNull().default(""),
  status: text("status").notNull().default("incoming"), // "incoming"|"viewed"|"proposal_sent"|"won"|"lost"|"declined"
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export const insertAgencyBriefSchema = createInsertSchema(agencyBriefs).omit({ id: true, createdAt: true });
export type InsertAgencyBrief = z.infer<typeof insertAgencyBriefSchema>;
export type AgencyBrief = typeof agencyBriefs.$inferSelect;

// ─── Agency Proposals (agency response to a brief) ─────────────────────────────
export const agencyProposals = pgTable("agency_proposals", {
  id: serial("id").primaryKey(),
  agencyBriefId: integer("agency_brief_id").notNull().unique(), // one proposal per brief
  agencyId: integer("agency_id").notNull(),
  quotedAmountPence: integer("quoted_amount_pence").notNull(),
  coverNote: text("cover_note").notNull().default(""),
  timeline: text("timeline").notNull().default(""),           // e.g. "4–6 weeks"
  teamMemberIds: text("team_member_ids").notNull().default("[]"), // JSON array of agencyMember.userId
  breakdown: text("breakdown").notNull().default(""),          // free-text cost breakdown
  status: text("status").notNull().default("sent"),           // "sent"|"accepted"|"declined"
  sentAt: text("sent_at").notNull().default(new Date().toISOString()),
  respondedAt: text("responded_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export const insertAgencyProposalSchema = createInsertSchema(agencyProposals).omit({ id: true, createdAt: true });
export type InsertAgencyProposal = z.infer<typeof insertAgencyProposalSchema>;
export type AgencyProposal = typeof agencyProposals.$inferSelect;

// ─── Agency Activity Feed ─────────────────────────────────────────────────────────
export const agencyActivity = pgTable("agency_activity", {
  id: serial("id").primaryKey(),
  agencyId: integer("agency_id").notNull(),
  type: text("type").notNull(), // "brief_received"|"brief_viewed"|"proposal_sent"|"proposal_accepted"|"proposal_declined"|"member_joined"|"member_left"|"rate_updated"|"profile_updated"|"time_logged"
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  entityType: text("entity_type"),   // "brief"|"proposal"|"member"|"project" — the related entity
  entityId: integer("entity_id"),    // id of the related entity
  actorId: integer("actor_id"),      // userId who triggered the event (null for system events)
  actorName: text("actor_name"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export const insertAgencyActivitySchema = createInsertSchema(agencyActivity).omit({ id: true, createdAt: true });
export type InsertAgencyActivity = z.infer<typeof insertAgencyActivitySchema>;
export type AgencyActivity = typeof agencyActivity.$inferSelect;

// ─── Accreditation ──────────────────────────────────────────────────────────
//
// Levels are stored as text (not a pg enum) so future levels can be added
// without a migration. The application layer validates against ACCREDITATION_LEVELS.
//
// Current: null | "verified" | "approved" | "elite"
// Future:  "champion" | ...

export const ACCREDITATION_LEVELS = ["verified", "approved", "elite"] as const;
export type AccreditationLevel = (typeof ACCREDITATION_LEVELS)[number];

// Extends the profiles table in-DB via ALTER TABLE (see migration).
// These columns map to the profiles table below.

export const accreditationHistory = pgTable("accreditation_history", {
  id: serial("id").primaryKey(),
  freelancerUserId: integer("freelancer_user_id").notNull(), // profiles.userId
  actionDate: text("action_date").notNull(),                 // ISO datetime
  founderUserId: integer("founder_user_id").notNull(),       // who performed the action
  founderName: text("founder_name").notNull(),
  previousLevel: text("previous_level"),                     // null = no accreditation
  newLevel: text("new_level"),                               // null = accreditation removed
  action: text("action").notNull(),                          // "granted" | "promoted" | "demoted" | "removed" | "rejected" | "changes_requested"
  reason: text("reason").notNull().default(""),
  internalNotes: text("internal_notes").notNull().default(""),
});

export const insertAccreditationHistorySchema = createInsertSchema(accreditationHistory).omit({ id: true });
export type InsertAccreditationHistory = z.infer<typeof insertAccreditationHistorySchema>;
export type AccreditationHistory = typeof accreditationHistory.$inferSelect;

// ─── Invoice Templates (freelancer's branding/letterhead settings) ─────────
export const invoiceTemplates = pgTable("invoice_templates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(), // one template per freelancer
  businessName: text("business_name").notNull().default(""),
  businessAddress: text("business_address").notNull().default(""),
  businessEmail: text("business_email").notNull().default(""),
  businessPhone: text("business_phone").notNull().default(""),
  logoUrl: text("logo_url"),
  vatNumber: text("vat_number").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default("Payment processed securely through Viewrr"),
  footerNote: text("footer_note").notNull().default(""),
  accentColor: text("accent_color").notNull().default("#FF5A1F"),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export const insertInvoiceTemplateSchema = createInsertSchema(invoiceTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoiceTemplate = z.infer<typeof insertInvoiceTemplateSchema>;
export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;

// ─── Invoices ─────────────────────────────────────────────────────────────────
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(), // e.g. "INV-00001"
  projectId: integer("project_id").notNull(),
  freelancerId: integer("freelancer_id").notNull(),
  clientId: integer("client_id").notNull(),
  clientName: text("client_name").notNull().default(""),
  clientEmail: text("client_email").notNull().default(""),
  projectTitle: text("project_title").notNull().default(""),
  lineItems: text("line_items").notNull().default("[]"), // JSON: [{description, quantity, unitPricePence, totalPence}]
  subtotalPence: integer("subtotal_pence").notNull().default(0),
  vatPence: integer("vat_pence").notNull().default(0),
  totalPence: integer("total_pence").notNull().default(0),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("sent"), // "sent"|"paid"
  issuedAt: text("issued_at").notNull().default(new Date().toISOString()),
  paidAt: text("paid_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ─── Notification Preferences ────────────────────────────────────────────────
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  emailProjectInvitations: boolean("email_project_invitations").notNull().default(true),
  emailNewOffers: boolean("email_new_offers").notNull().default(true),
  emailCounterOffers: boolean("email_counter_offers").notNull().default(true),
  emailMessages: boolean("email_messages").notNull().default(true),
  emailStageUpdates: boolean("email_stage_updates").notNull().default(true),
  emailPaymentUpdates: boolean("email_payment_updates").notNull().default(true),
  emailReviewRequests: boolean("email_review_requests").notNull().default(true),
  emailProductUpdates: boolean("email_product_updates").notNull().default(false),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});
export const insertNotifPrefsSchema = createInsertSchema(notificationPreferences).omit({ id: true, updatedAt: true });
export type InsertNotifPrefs = z.infer<typeof insertNotifPrefsSchema>;
export type NotifPrefs = typeof notificationPreferences.$inferSelect;

// ─── Custom Project Stage Templates ──────────────────────────────────────────
export const STAGE_TEMPLATES: Record<string, string[]> = {
  "Videography": ["Discovery", "Pre-production", "Filming", "Editing", "First Draft", "Revisions", "Final Delivery"],
  "Photography": ["Brief", "Shoot Planning", "Shoot Day", "Editing", "Client Review", "Final Images"],
  "Graphic Design": ["Discovery", "Concepts", "First Draft", "Revisions", "Final Artwork"],
  "Website Design": ["Discovery", "Wireframes", "Design", "Development", "Testing", "Launch"],
  "Marketing Campaign": ["Strategy", "Creative", "Review", "Approval", "Launch"],
  "Custom": [],
};

// ─── PRD-007: Payment Ledger Tables ──────────────────────────────────────────

// payments — one row per payment attempt (source of truth for all money movement)
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),          // pay_vrr_<nanoid>
  projectId: integer("project_id").notNull(),
  invoiceId: integer("invoice_id"),                        // nullable for retainer cycles
  retainerCycleId: integer("retainer_cycle_id"),
  clientId: integer("client_id").notNull(),
  freelancerId: integer("freelancer_id").notNull(),
  paymentKind: text("payment_kind").notNull().default("one_off"), // one_off | retainer_cycle
  currency: text("currency").notNull().default("gbp"),
  grossPence: integer("gross_pence").notNull(),
  platformFeePence: integer("platform_fee_pence").notNull(),
  freelancerPence: integer("freelancer_pence").notNull(),
  stripeFeePence: integer("stripe_fee_pence"),             // filled after charge succeeds
  netPlatformRevenuePence: integer("net_platform_revenue_pence"), // grossFee - stripeFee
  status: text("status").notNull().default("pending"),
  // pending | requires_payment_method | processing | succeeded | failed | cancelled | refunded | partially_refunded
  transferStrategy: text("transfer_strategy").notNull().default("platform_held"),
  // direct_transfer | platform_held
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeChargeId: text("stripe_charge_id"),
  stripeBalanceTransactionId: text("stripe_balance_transaction_id"),
  stripeApplicationFeeId: text("stripe_application_fee_id"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  authorisedAt: text("authorised_at"),
  succeededAt: text("succeeded_at"),
  failedAt: text("failed_at"),
  cancelledAt: text("cancelled_at"),
  version: integer("version").notNull().default(1),
});
export type Payment = typeof payments.$inferSelect;

// payment_transfers — one row per Stripe transfer to a connected account
export const paymentTransfers = pgTable("payment_transfers", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  stripeTransferId: text("stripe_transfer_id").notNull().unique(),
  destinationAccountId: text("destination_account_id").notNull(),
  amountPence: integer("amount_pence").notNull(),
  status: text("status").notNull().default("pending"),
  // pending | processing | transferred | partially_reversed | reversed | failed
  failureCode: text("failure_code"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  reversedPence: integer("reversed_pence").notNull().default(0),
  lastReconciledAt: text("last_reconciled_at"),
});
export type PaymentTransfer = typeof paymentTransfers.$inferSelect;

// payment_refunds — one row per refund (full or partial)
export const paymentRefunds = pgTable("payment_refunds", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  paymentId: integer("payment_id").notNull(),
  stripeRefundId: text("stripe_refund_id").unique(),
  amountPence: integer("amount_pence").notNull(),
  reasonCode: text("reason_code").notNull(),
  // client_cancellation | defective_work | duplicate | fraud | admin_goodwill | statutory_right
  status: text("status").notNull().default("requested"),
  // requested | under_review | approved | submitted_to_stripe | processing | succeeded
  // | partially_succeeded | failed | manual_recovery_required | cancelled
  reverseTransfer: integer("reverse_transfer").notNull().default(1),
  refundApplicationFee: integer("refund_application_fee").notNull().default(0),
  requestedBy: integer("requested_by").notNull(),
  approvedBy: integer("approved_by"),
  internalNote: text("internal_note"),
  failureCode: text("failure_code"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  succeededAt: text("succeeded_at"),
});
export type PaymentRefund = typeof paymentRefunds.$inferSelect;

// payment_payouts — synced from Stripe payout events
export const paymentPayouts = pgTable("payment_payouts", {
  id: serial("id").primaryKey(),
  freelancerId: integer("freelancer_id").notNull(),
  stripePayoutId: text("stripe_payout_id").notNull().unique(),
  amountPence: integer("amount_pence").notNull(),
  currency: text("currency").notNull().default("gbp"),
  status: text("status").notNull().default("pending"),
  // pending | in_transit | paid | failed | cancelled
  arrivalDate: text("arrival_date"),
  failureCode: text("failure_code"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  paidAt: text("paid_at"),
});
export type PaymentPayout = typeof paymentPayouts.$inferSelect;

// stripe_events — idempotent event store (prevents duplicate processing)
export const stripeEvents = pgTable("stripe_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  livemode: integer("livemode").notNull().default(0),
  apiVersion: text("api_version"),
  processingStatus: text("processing_status").notNull().default("received"),
  // received | processing | processed | failed | skipped
  attemptCount: integer("attempt_count").notNull().default(0),
  receivedAt: text("received_at").notNull().default(new Date().toISOString()),
  processedAt: text("processed_at"),
  errorCode: text("error_code"),
  errorSummary: text("error_summary"),
  // WS-A: PRD-020 stale-event recovery fields (migration 0008)
  processingStartedAt: text("processing_started_at"),
  lastAttemptAt: text("last_attempt_at"),
  maxAttempts: integer("max_attempts").notNull().default(5),
  rawPayload: text("raw_payload"),
});
export type StripeEvent = typeof stripeEvents.$inferSelect;

// payment_audit_log — immutable audit trail for all payment actions
export const paymentAuditLog = pgTable("payment_audit_log", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id"),
  actorType: text("actor_type").notNull(), // system | user | admin | webhook
  actorId: integer("actor_id"),
  action: text("action").notNull(),
  beforeState: text("before_state"),       // JSON snapshot
  afterState: text("after_state"),         // JSON snapshot
  reason: text("reason"),
  correlationId: text("correlation_id"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type PaymentAuditEntry = typeof paymentAuditLog.$inferSelect;

// stripe_connect_accounts — richer Connect readiness state (FR-13)
export const stripeConnectAccounts = pgTable("stripe_connect_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  stripeAccountId: text("stripe_account_id").notNull().unique(),
  readinessState: text("readiness_state").notNull().default("not_created"),
  // not_created | onboarding_required | verification_pending | transfers_ready | payouts_ready | restricted | disabled
  detailsSubmitted: integer("details_submitted").notNull().default(0),
  chargesEnabled: integer("charges_enabled").notNull().default(0),
  payoutsEnabled: integer("payouts_enabled").notNull().default(0),
  transfersCapability: text("transfers_capability").default("inactive"),
  currentlyDue: text("currently_due").notNull().default("[]"),    // JSON
  eventuallyDue: text("eventually_due").notNull().default("[]"),
  pastDue: text("past_due").notNull().default("[]"),
  pendingVerification: text("pending_verification").notNull().default("[]"),
  disabledReason: text("disabled_reason"),
  payoutSchedule: text("payout_schedule"),     // JSON {interval, delay_days}
  termsAcceptedAt: text("terms_accepted_at"),  // when freelancer accepted platform payment terms
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;

// ─── PRD-013: Pro Viewrr Subscription Infrastructure ─────────────────────────

// pro_subscriptions — one row per user's subscription record
export const proSubscriptions = pgTable("pro_subscriptions", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),          // e.g. prosub_abc123
  userId: integer("user_id").notNull().unique(),           // one active record per user
  membershipType: text("membership_type").notNull().default("paid"), // "paid" | "founding_pro"
  stripeCustomerId: text("stripe_customer_id"),            // cus_... (null for founding_pro)
  stripeSubscriptionId: text("stripe_subscription_id"),    // sub_... (null for founding_pro)
  stripePriceId: text("stripe_price_id"),                  // price_... locked at checkout
  status: text("status").notNull().default("checkout_pending"),
  // checkout_pending | active | past_due | payment_failed | cancellation_scheduled | cancelled | expired | founding_pro
  amountPence: integer("amount_pence").default(4999),      // 4999 = £49.99
  currency: text("currency").default("gbp"),
  currentPeriodStart: text("current_period_start"),
  currentPeriodEnd: text("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end").default(0),
  termsVersion: text("terms_version"),                     // terms accepted at signup
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});
export type ProSubscription = typeof proSubscriptions.$inferSelect;

// founding_pro_allocations — max 10, enforced server-side atomically
export const foundingProAllocations = pgTable("founding_pro_allocations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),           // one per user
  allocationNumber: integer("allocation_number").notNull(), // 1–10
  allocatedAt: text("allocated_at").notNull().default(new Date().toISOString()),
  active: integer("active").notNull().default(1),
});
export type FoundingProAllocation = typeof foundingProAllocations.$inferSelect;

// pro_subscription_events — audit trail for every state change
export const proSubscriptionEvents = pgTable("pro_subscription_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subscriptionId: integer("subscription_id"),              // FK to pro_subscriptions
  eventType: text("event_type").notNull(),
  // subscription_created | checkout_initiated | subscription_activated | founding_pro_claimed
  // payment_succeeded | payment_failed | subscription_renewed | cancellation_requested
  // cancellation_completed | entitlement_granted | entitlement_removed | commission_rate_applied
  // founder_intervention
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  commissionRateBps: integer("commission_rate_bps"),       // 800 = 8%, 1100 = 11%
  stripeEventId: text("stripe_event_id"),                  // idempotency
  metadata: text("metadata"),                              // JSON
  correlationId: text("correlation_id"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type ProSubscriptionEvent = typeof proSubscriptionEvents.$inferSelect;

// ── PRD-014: Dynamic Project Stages ──────────────────────────────────────────
export const projectStages = pgTable("project_stages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  position: integer("position").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  expectedDeliverable: text("expected_deliverable"),
  targetDate: text("target_date"),
  approvalRequired: integer("approval_required").notNull().default(0),
  revisionAllowance: text("revision_allowance").notNull().default("none"),
  // upcoming | in_progress | awaiting_client | changes_requested | approved | completed
  status: text("status").notNull().default("upcoming"),
  startedAt: text("started_at"),
  submittedAt: text("submitted_at"),
  approvedAt: text("approved_at"),
  completedAt: text("completed_at"),
  createdBy: integer("created_by").notNull(),
  updatedAt: text("updated_at"),
  notes: text("notes"),
  clientChangeRequest: text("client_change_request"),
});
export type ProjectStage = typeof projectStages.$inferSelect;
export type InsertProjectStage = typeof projectStages.$inferInsert;

export const projectStageEvents = pgTable("project_stage_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  stageId: integer("stage_id"),
  eventType: text("event_type").notNull(),
  actorId: integer("actor_id").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type ProjectStageEvent = typeof projectStageEvents.$inferSelect;

// ─── Auth Sessions (PRD-019) ──────────────────────────────────────────────────
export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),    // public UUID; safe to log
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),    // SHA-256(rawToken); raw NEVER stored
  clientType: text("client_type").notNull().default("web"), // 'web' | 'mobile'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }),  // mobile only
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),  // 'logout'|'password_reset'|'user_deleted'
});

export type AuthSession = typeof authSessions.$inferSelect;
export type InsertAuthSession = typeof authSessions.$inferInsert;

// ─── Upload Objects (PRD-020 WS-D) ───────────────────────────────────────────
// Durable record for every uploaded file — backed by Cloudflare R2 object storage
export const uploadObjects = pgTable("upload_objects", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  resourceType: text("resource_type").notNull(), // portfolio | profile | project | deliverable | message
  resourceId: integer("resource_id"),            // nullable — set after resource is created
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  originalFilename: text("original_filename"),    // stored as metadata only (never used as path)
  status: text("status").notNull().default("pending"), // pending | uploaded | ready | deleted
  uploadIntentExpiresAt: text("upload_intent_expires_at").notNull(), // when presigned PUT URL expires
  confirmedAt: text("confirmed_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export type UploadObject = typeof uploadObjects.$inferSelect;
export type InsertUploadObject = typeof uploadObjects.$inferInsert;

// ─── Verification Codes (PRD-020 WS-E) ───────────────────────────────────────
// DB-backed verification codes — restart-safe replacement for in-memory Map
export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  purpose: text("purpose").notNull(),            // email_verification | sms_verification
  destinationHash: text("destination_hash").notNull(), // SHA-256(lowercased destination)
  codeHash: text("code_hash").notNull(),          // SHA-256(code + destination + purpose)
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  attemptCount: integer("attempt_count").notNull().default(0),
  invalidatedAt: text("invalidated_at"),          // set when resend invalidates this code
});

export type VerificationCode = typeof verificationCodes.$inferSelect;
export type InsertVerificationCode = typeof verificationCodes.$inferInsert;
