import { pgTable, text, integer, real, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
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
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true });
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
  actorId: integer("actor_id").notNull(),           // who triggered it
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
