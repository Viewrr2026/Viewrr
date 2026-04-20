import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("freelancer"), // "freelancer" | "client"
  avatar: text("avatar"),
  bio: text("bio"),
  location: text("location"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Freelancer Profiles ──────────────────────────────────────────────────────
export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  specialisms: text("specialisms").notNull().default("[]"), // JSON array
  skills: text("skills").notNull().default("[]"),           // JSON array
  hourlyRate: real("hourly_rate"),
  dayRate: real("day_rate"),
  availability: text("availability").notNull().default("available"), // available | busy | unavailable
  yearsExperience: integer("years_experience"),
  reelUrl: text("reel_url"),
  portfolioItems: text("portfolio_items").notNull().default("[]"), // JSON array of {title, url, thumbnail, type}
  socialLinks: text("social_links").notNull().default("{}"),       // JSON object
  rating: real("rating").default(0),
  reviewCount: integer("review_count").default(0),
  projectCount: integer("project_count").default(0),
  featured: integer("featured").default(0), // boolean
  badges: text("badges").notNull().default("[]"), // JSON array
  isPro: integer("is_pro").default(0), // boolean — Pro Viewrr subscriber
  proSince: text("pro_since"),
});

export const insertProfileSchema = createInsertSchema(profiles).omit({ id: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profiles.$inferSelect;

// ─── Reviews ─────────────────────────────────────────────────────────────────
export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromId: integer("from_id").notNull(),
  toId: integer("to_id").notNull(),
  content: text("content").notNull(),
  read: integer("read").default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ─── Feed Posts ─────────────────────────────────────────────────────────────
export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  caption: text("caption").notNull().default(""),
  mediaUrl: text("media_url"),           // image or video URL
  mediaType: text("media_type"),          // "image" | "video" | null
  tags: text("tags").notNull().default("[]"), // JSON array of strings
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertPostSchema = createInsertSchema(posts).omit({ id: true, createdAt: true, likeCount: true, commentCount: true });
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof posts.$inferSelect;

// ─── Post Likes ───────────────────────────────────────────────────────────────
export const postLikes = sqliteTable("post_likes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").notNull(),
  userId: integer("user_id").notNull(),
});

export const insertPostLikeSchema = createInsertSchema(postLikes).omit({ id: true });
export type InsertPostLike = z.infer<typeof insertPostLikeSchema>;
export type PostLike = typeof postLikes.$inferSelect;

// ─── Post Comments ────────────────────────────────────────────────────────────
export const postComments = sqliteTable("post_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").notNull(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertPostCommentSchema = createInsertSchema(postComments).omit({ id: true, createdAt: true });
export type InsertPostComment = z.infer<typeof insertPostCommentSchema>;
export type PostComment = typeof postComments.$inferSelect;

// ─── Projects ────────────────────────────────────────────────────────────────
// A project links a client to a freelancer with a shared progress timeline.
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull(),
  freelancerId: integer("freelancer_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"), // active | completed | paused
  currentStage: integer("current_stage").notNull().default(0), // index into stages array
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Stage updates — a log entry for each milestone advance or comment
export const projectUpdates = sqliteTable("project_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  authorId: integer("author_id").notNull(),
  stage: integer("stage").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertProjectUpdateSchema = createInsertSchema(projectUpdates).omit({ id: true, createdAt: true });
export type InsertProjectUpdate = z.infer<typeof insertProjectUpdateSchema>;
export type ProjectUpdate = typeof projectUpdates.$inferSelect;

// ─── Briefs (Client Job Posts) ──────────────────────────────────────────────
export const briefs = sqliteTable("briefs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull(),
  clientName: text("client_name").notNull(),
  clientAvatar: text("client_avatar"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // "Videography" | "Video Editing" | "Photography" | "Marketing" | "Other"
  location: text("location").notNull(),
  remote: integer("remote").default(0), // boolean — remote/hybrid ok
  startDate: text("start_date"),
  duration: text("duration"),           // e.g. "1 day", "1 week", "Ongoing"
  budgetMin: real("budget_min"),
  budgetMax: real("budget_max"),
  budgetType: text("budget_type").notNull().default("project"), // "project" | "day" | "hour"
  requirements: text("requirements").notNull().default(""),
  status: text("status").notNull().default("open"), // "open" | "closed"
  applicationCount: integer("application_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertBriefSchema = createInsertSchema(briefs).omit({ id: true, createdAt: true, applicationCount: true });
export type InsertBrief = z.infer<typeof insertBriefSchema>;
export type Brief = typeof briefs.$inferSelect;

// ─── Saved Freelancers ────────────────────────────────────────────────────────
export const saved = sqliteTable("saved", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull(),
  profileId: integer("profile_id").notNull(),
});

export const insertSavedSchema = createInsertSchema(saved).omit({ id: true });
export type InsertSaved = z.infer<typeof insertSavedSchema>;
export type Saved = typeof saved.$inferSelect;
