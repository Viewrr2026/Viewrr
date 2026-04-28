import { pgTable, text, integer, real, serial, boolean } from "drizzle-orm/pg-core";
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
  avatar: text("avatar"),
  banner: text("banner"),
  headline: text("headline"),   // e.g. "Videographer & Director · London"
  bio: text("bio"),
  location: text("location"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
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
});

export const insertProfileSchema = createInsertSchema(profiles).omit({ id: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profiles.$inferSelect;

// ─── Reviews ─────────────────────────────────────────────────────────────────
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  clientId: integer("client_id").notNull(),
  clientName: text("client_name").notNull(),
  clientAvatar: text("client_avatar"),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  projectType: text("project_type"),
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
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

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
  status: text("status").notNull().default("pending"), // "pending" | "viewed" | "accepted" | "declined"
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
