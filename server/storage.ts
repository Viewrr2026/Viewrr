import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, or, and, desc, sql } from "drizzle-orm";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema });

// Run migrations — create all tables if they don't exist
async function runMigrations() {
await sql`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'freelancer',
    avatar TEXT,
    bio TEXT,
    location TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
// Add new columns to existing users table if they don't exist
try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`; } catch {}
try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`; } catch {}

await sql`
  CREATE TABLE IF NOT EXISTS profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    specialisms TEXT NOT NULL DEFAULT '[]',
    skills TEXT NOT NULL DEFAULT '[]',
    hourly_rate REAL,
    day_rate REAL,
    availability TEXT NOT NULL DEFAULT 'available',
    years_experience INTEGER,
    reel_url TEXT,
    portfolio_items TEXT NOT NULL DEFAULT '[]',
    social_links TEXT NOT NULL DEFAULT '{}',
    rating REAL DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    project_count INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    badges TEXT NOT NULL DEFAULT '[]',
    is_pro INTEGER DEFAULT 0,
    pro_since TEXT
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    client_avatar TEXT,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL,
    project_type TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS profile_views (
    id SERIAL PRIMARY KEY,
    profile_user_id INTEGER NOT NULL,
    viewer_ip TEXT,
    viewer_id INTEGER,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS brief_interests (
    id SERIAL PRIMARY KEY,
    brief_id INTEGER NOT NULL,
    brief_title TEXT NOT NULL,
    brief_client_id INTEGER NOT NULL,
    brief_client_name TEXT NOT NULL,
    freelancer_id INTEGER NOT NULL,
    freelancer_name TEXT NOT NULL,
    freelancer_avatar TEXT,
    cover_note TEXT NOT NULL,
    rate TEXT,
    availability TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    responded_at TEXT
  )
`;
// Add responded_at column if it doesn't exist (for existing deployments)
await sql`ALTER TABLE brief_interests ADD COLUMN IF NOT EXISTS responded_at TEXT`.catch(() => {});
await sql`
  CREATE TABLE IF NOT EXISTS saved (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    freelancer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    current_stage INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS project_updates (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    stage INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS briefs (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    client_avatar TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    remote INTEGER DEFAULT 0,
    start_date TEXT,
    duration TEXT,
    budget_min REAL,
    budget_max REAL,
    budget_type TEXT NOT NULL DEFAULT 'project',
    requirements TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    application_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    media_type TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    like_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS post_likes (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS post_comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )
`;
}

export interface IStorage {
  // Users
  getUser(id: number): Promise<schema.User | undefined>;
  getUserByEmail(email: string): Promise<schema.User | undefined>;
  updateUserPassword(id: number, passwordHash: string): Promise<void>;
  createUser(data: schema.InsertUser): Promise<schema.User>;

  // Profiles
  getProfiles(filters?: { specialism?: string; availability?: string; search?: string }): Promise<ProfileWithUser[]>;
  getProfile(id: number): Promise<ProfileWithUser | undefined>;
  getProfileByUserId(userId: number): Promise<schema.Profile | undefined>;
  createProfile(data: schema.InsertProfile): Promise<schema.Profile>;
  updateProfile(id: number, data: Partial<schema.InsertProfile>): Promise<schema.Profile | undefined>;
  getFeaturedProfiles(): Promise<ProfileWithUser[]>;

  // Reviews
  getReviewsByProfile(profileId: number): Promise<schema.Review[]>;
  createReview(data: schema.InsertReview): Promise<schema.Review>;

  // Messages
  getMessagesBetween(fromId: number, toId: number): Promise<schema.Message[]>;
  getConversations(userId: number): Promise<ConversationSummary[]>;
  createMessage(data: schema.InsertMessage): Promise<schema.Message>;
  markMessagesRead(fromId: number, toId: number): Promise<void>;

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
  getProject(id: number): Promise<ProjectWithDetails | undefined>;
  createProject(data: schema.InsertProject): Promise<schema.Project>;
  advanceProjectStage(projectId: number, note: string, authorId: number): Promise<schema.Project | undefined>;
  addProjectUpdate(data: schema.InsertProjectUpdate): Promise<schema.ProjectUpdate>;
  getProjectUpdates(projectId: number): Promise<ProjectUpdateWithAuthor[]>;

  // Briefs
  getBriefs(): Promise<schema.Brief[]>;
  getBrief(id: number): Promise<schema.Brief | undefined>;
  createBrief(data: schema.InsertBrief): Promise<schema.Brief>;

  // Profile Views
  recordProfileView(profileUserId: number, viewerId: number | null, viewerIp: string): Promise<void>;
  getProfileViewCount(profileUserId: number): Promise<number>;
  getProfileViewHistory(profileUserId: number, days: number): Promise<{ date: string; count: number }[]>;

  // Brief Interests
  createBriefInterest(data: schema.InsertBriefInterest): Promise<schema.BriefInterest>;
  getBriefInterestsForFreelancer(freelancerId: number): Promise<schema.BriefInterest[]>;
  getBriefInterestsForClient(clientId: number): Promise<schema.BriefInterest[]>;
  updateBriefInterestStatus(id: number, status: string): Promise<void>;
}

export interface ProfileWithUser {
  profile: schema.Profile;
  user: schema.User;
}

export interface PostWithUser {
  post: schema.Post;
  user: schema.User;
  liked: boolean;
}

export interface CommentWithUser {
  comment: schema.PostComment;
  user: schema.User;
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

export interface ConversationSummary {
  otherId: number;
  otherName: string;
  otherAvatar: string | null;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

class Storage implements IStorage {
  async getUser(id: number): Promise<schema.User | undefined> {
    const r = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return r[0];
  }

  async updateUserPassword(id: number, passwordHash: string): Promise<void> {
    await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, id));
  }

  async getUserByEmail(email: string): Promise<schema.User | undefined> {
    const r = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return r[0];
  }

  async createUser(data: schema.InsertUser): Promise<schema.User> {
    const r = await db.insert(schema.users).values(data).returning();
    return r[0];
  }

  async getProfiles(filters?: { specialism?: string; availability?: string; search?: string }): Promise<ProfileWithUser[]> {
    const allProfiles = await db.select().from(schema.profiles);
    const allUsers = await db.select().from(schema.users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    let results: ProfileWithUser[] = allProfiles
      .map(p => ({ profile: p, user: userMap.get(p.userId)! }))
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

    // Pro Viewrrs always sort to top, then by rating
    return results.sort((a, b) => {
      const proA = a.profile.isPro || 0;
      const proB = b.profile.isPro || 0;
      if (proB !== proA) return proB - proA;
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
      .map(p => ({ profile: p, user: userMap.get(p.userId)! }))
      .filter(pw => pw.user)
      .slice(0, 8);
  }

  async getReviewsByProfile(profileId: number): Promise<schema.Review[]> {
    return db.select().from(schema.reviews).where(eq(schema.reviews.profileId, profileId));
  }

  async createReview(data: schema.InsertReview): Promise<schema.Review> {
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

  async getMessagesBetween(fromId: number, toId: number): Promise<schema.Message[]> {
    const msgs = await db.select().from(schema.messages)
      .where(
        or(
          and(eq(schema.messages.fromId, fromId), eq(schema.messages.toId, toId)),
          and(eq(schema.messages.fromId, toId), eq(schema.messages.toId, fromId))
        )
      );
    return msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getConversations(userId: number): Promise<ConversationSummary[]> {
    const allMessages = await db.select().from(schema.messages)
      .where(or(eq(schema.messages.fromId, userId), eq(schema.messages.toId, userId)));

    const convMap = new Map<number, schema.Message[]>();
    for (const msg of allMessages) {
      const otherId = msg.fromId === userId ? msg.toId : msg.fromId;
      if (!convMap.has(otherId)) convMap.set(otherId, []);
      convMap.get(otherId)!.push(msg);
    }

    const results: ConversationSummary[] = [];
    for (const [otherId, msgs] of Array.from(convMap.entries())) {
      const other = await this.getUser(otherId);
      if (!other) continue;
      const sorted = msgs.sort((a: schema.Message, b: schema.Message) => b.createdAt.localeCompare(a.createdAt));
      const unread = msgs.filter((m: schema.Message) => m.toId === userId && !m.read).length;
      results.push({
        otherId,
        otherName: other.name,
        otherAvatar: other.avatar,
        lastMessage: sorted[0].content,
        lastAt: sorted[0].createdAt,
        unread,
      });
    }

    return results.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
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
    const allPosts = await db.select().from(schema.posts);
    const sorted = allPosts
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit);

    const results: PostWithUser[] = [];
    for (const post of sorted) {
      const user = await this.getUser(post.userId);
      if (!user) continue;
      const liked = viewerUserId ? await this.isLiked(post.id, viewerUserId) : false;
      results.push({ post, user, liked });
    }
    return results;
  }

  async getPost(id: number): Promise<PostWithUser | undefined> {
    const r = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
    const post = r[0];
    if (!post) return undefined;
    const user = await this.getUser(post.userId);
    if (!user) return undefined;
    return { post, user, liked: false };
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
      results.push({ comment, user });
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
    return { comment, user: user! };
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
    const all = await db.select().from(schema.projects)
      .where(or(eq(schema.projects.clientId, userId), eq(schema.projects.freelancerId, userId)));
    const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const results: ProjectWithDetails[] = [];
    for (const p of sorted) {
      const details = await this._buildProjectWithDetails(p);
      if (details) results.push(details);
    }
    return results;
  }

  async getProject(id: number): Promise<ProjectWithDetails | undefined> {
    const r = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    const project = r[0];
    if (!project) return undefined;
    return this._buildProjectWithDetails(project);
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
    await db.update(schema.projects).set({ currentStage: nextStage }).where(eq(schema.projects.id, projectId));
    if (note.trim()) {
      await db.insert(schema.projectUpdates).values({ projectId, authorId, stage: nextStage, note });
    }
    const updated = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    return updated[0];
  }

  async addProjectUpdate(data: schema.InsertProjectUpdate): Promise<schema.ProjectUpdate> {
    const r = await db.insert(schema.projectUpdates).values(data).returning();
    return r[0];
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

  // ─── Briefs ────────────────────────────────────────────────────────────────
  async getBriefs(): Promise<schema.Brief[]> {
    const r = await db.select().from(schema.briefs);
    return r.reverse();
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
    // Deduplicate: same viewer (by ID or IP) can only register one view per 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (viewerId) {
      const existing = await db.select().from(schema.profileViews)
        .where(and(
          eq(schema.profileViews.profileUserId, profileUserId),
          eq(schema.profileViews.viewerId, viewerId),
          sql`created_at > ${since}`
        ));
      if (existing.length > 0) return; // already counted today
    } else {
      const existing = await db.select().from(schema.profileViews)
        .where(and(
          eq(schema.profileViews.profileUserId, profileUserId),
          eq(schema.profileViews.viewerIp, viewerIp),
          sql`created_at > ${since}`
        ));
      if (existing.length > 0) return;
    }
    await db.insert(schema.profileViews).values({
      profileUserId,
      viewerId,
      viewerIp,
      createdAt: new Date().toISOString(),
    });
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
        sql`created_at > ${since}`
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
}

export const storage = new Storage();

// ─── Seed data ───────────────────────────────────────────────────────────────
async function seedIfEmpty() {
  const existing = await db.select().from(schema.users);
  if (existing.length > 0) return;

  const freelancers = [
    { name: "Marcus Reid", email: "marcus@viewrr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=11", bio: "Award-winning cinematographer with 8 years shooting brand films and documentaries. I help brands tell stories that actually move people.", location: "London, UK" },
    { name: "Sophia Chen", email: "sophia@viewrr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=47", bio: "Post-production specialist and colour grader. Worked with Netflix, BBC, and global ad agencies. Obsessed with making footage look extraordinary.", location: "Manchester, UK" },
    { name: "Jaden Williams", email: "jaden@viewr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=12", bio: "Social media marketing strategist turned video creator. I build scroll-stopping content for e-commerce and lifestyle brands.", location: "Birmingham, UK" },
    { name: "Priya Sharma", email: "priya@viewr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=48", bio: "Commercial photographer and content director. My aesthetic is bold, editorial, and always on-brand. 200+ campaigns delivered.", location: "Leeds, UK" },
    { name: "Tom Hargreaves", email: "tom@viewr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=15", bio: "Motion designer and video editor. I bring scripts to life with clean animation, tight cuts, and punchy sound design.", location: "Bristol, UK" },
    { name: "Aisha Okonkwo", email: "aisha@viewr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=49", bio: "Documentary filmmaker and brand storyteller. My work has screened at Sundance and SXSW. Let's make something worth watching.", location: "London, UK" },
    { name: "Ryan Park", email: "ryan@viewr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=17", bio: "Drone operator and aerial cinematographer. FAA certified, insured, and ready to make your project look cinematic from above.", location: "Glasgow, UK" },
    { name: "Lena Müller", email: "lena@viewr.co", role: "freelancer", avatar: "https://i.pravatar.cc/150?img=50", bio: "Brand photographer and creative director. I help startups and established brands build a consistent, high-end visual identity.", location: "London, UK" },
  ];

  const profileData = [
    { specialisms: ["Videographer"], skills: ["Cinematography", "Camera Op", "Lighting", "Brand Films", "Documentaries"], hourlyRate: 150, dayRate: 950, availability: "available", yearsExperience: 8, rating: 4.9, reviewCount: 34, projectCount: 89, featured: 1, badges: ["Top Rated", "Fast Responder"] },
    { specialisms: ["Video Editor"], skills: ["Colour Grading", "DaVinci Resolve", "Premiere Pro", "After Effects", "Sound Design"], hourlyRate: 120, dayRate: 800, availability: "available", yearsExperience: 6, rating: 4.8, reviewCount: 28, projectCount: 64, featured: 1, badges: ["Top Rated"] },
    { specialisms: ["Marketer"], skills: ["Social Strategy", "Content Creation", "Paid Ads", "TikTok", "Instagram"], hourlyRate: 90, dayRate: 600, availability: "busy", yearsExperience: 5, rating: 4.7, reviewCount: 19, projectCount: 43, featured: 1, badges: ["Rising Star"] },
    { specialisms: ["Photographer"], skills: ["Commercial Photography", "Art Direction", "Retouching", "Studio", "Location"], hourlyRate: 140, dayRate: 900, availability: "available", yearsExperience: 7, rating: 4.9, reviewCount: 42, projectCount: 120, featured: 1, badges: ["Top Rated", "Pro Verified"] },
    { specialisms: ["Video Editor"], skills: ["Motion Graphics", "Animation", "Sound Design", "Color Correction", "VFX"], hourlyRate: 100, dayRate: 700, availability: "available", yearsExperience: 4, rating: 4.6, reviewCount: 15, projectCount: 38, featured: 0, badges: ["Rising Star"] },
    { specialisms: ["Videographer"], skills: ["Documentary", "Interviews", "Storytelling", "Festival Films", "Brand Content"], hourlyRate: 160, dayRate: 1000, availability: "available", yearsExperience: 9, rating: 5.0, reviewCount: 22, projectCount: 55, featured: 1, badges: ["Top Rated", "Award Winner"] },
    { specialisms: ["Videographer"], skills: ["Drone", "Aerial", "FPV", "Real Estate", "Events"], hourlyRate: 110, dayRate: 750, availability: "available", yearsExperience: 3, rating: 4.7, reviewCount: 11, projectCount: 29, featured: 0, badges: ["Rising Star"] },
    { specialisms: ["Photographer"], skills: ["Brand Identity", "Product Photography", "Lookbooks", "Campaigns", "Art Direction"], hourlyRate: 130, dayRate: 850, availability: "unavailable", yearsExperience: 6, rating: 4.8, reviewCount: 31, projectCount: 78, featured: 1, badges: ["Top Rated"] },
  ];

  const reelUrls = [
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    null, null,
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    null, null, null, null,
  ];

  const portfolioSets = [
    [
      { title: "Nike Campaign '24", thumbnail: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=600&q=80", type: "video" },
      { title: "Hublot Brand Film", thumbnail: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&q=80", type: "video" },
      { title: "Thames Documentary", thumbnail: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&q=80", type: "video" },
    ],
    [
      { title: "Feature Film Grade", thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&q=80", type: "video" },
      { title: "BBC Documentary", thumbnail: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=600&q=80", type: "video" },
    ],
    [
      { title: "TikTok Campaign", thumbnail: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=600&q=80", type: "image" },
      { title: "Instagram Strategy", thumbnail: "https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=600&q=80", type: "image" },
    ],
    [
      { title: "Zara Campaign", thumbnail: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&q=80", type: "image" },
      { title: "ASOS Lookbook", thumbnail: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80", type: "image" },
      { title: "Luxury Watches", thumbnail: "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=600&q=80", type: "image" },
    ],
    [
      { title: "App Launch Video", thumbnail: "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=600&q=80", type: "video" },
      { title: "Motion Reel '24", thumbnail: "https://images.unsplash.com/photo-1601506521793-dc748fc80b67?w=600&q=80", type: "video" },
    ],
    [
      { title: "Sundance Short", thumbnail: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=600&q=80", type: "video" },
      { title: "Brand Documentary", thumbnail: "https://images.unsplash.com/photo-1492619375914-88005aa9e8fb?w=600&q=80", type: "video" },
      { title: "SXSW Film", thumbnail: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=600&q=80", type: "video" },
    ],
    [
      { title: "Aerial London", thumbnail: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&q=80", type: "video" },
      { title: "FPV Racing", thumbnail: "https://images.unsplash.com/photo-1524143986875-3b098d78b363?w=600&q=80", type: "video" },
    ],
    [
      { title: "Startup Identity", thumbnail: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&q=80", type: "image" },
      { title: "Product Campaign", thumbnail: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80", type: "image" },
      { title: "Lookbook SS25", thumbnail: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80", type: "image" },
    ],
  ];

  const reviewSets = [
    [{ clientName: "James Okafor", rating: 5, comment: "Marcus delivered beyond expectations. The brand film he shot for us has generated 3x our normal engagement.", projectType: "Brand Film" }],
    [{ clientName: "Ellie Brooks", rating: 5, comment: "Sophia's colour work is genuinely magical. Our footage looked like a completely different production after she was done.", projectType: "Post Production" }],
    [{ clientName: "Dan Yeo", rating: 4, comment: "Jaden understood our brand instantly. The content calendar he built has been running brilliantly for 3 months.", projectType: "Social Strategy" }],
    [{ clientName: "Charlotte Reed", rating: 5, comment: "Priya is an absolute pro. Every shot was considered, every frame was perfect.", projectType: "Campaign" }],
    [{ clientName: "Sam Liu", rating: 5, comment: "Tom animated our product launch video in a week and it was spectacular.", projectType: "Motion Design" }],
    [{ clientName: "Fiona Walsh", rating: 5, comment: "Aisha made our team cry (in a good way). The documentary she produced is genuinely moving and authentic.", projectType: "Documentary" }],
    [{ clientName: "Mike Turner", rating: 5, comment: "Ryan's aerial footage of our property developments sold three units before we even launched.", projectType: "Aerial Photography" }],
    [{ clientName: "Claudia Moss", rating: 5, comment: "Lena's creative direction transformed our brand. Every photo tells our story exactly as we imagined.", projectType: "Brand Identity" }],
  ];

  for (let i = 0; i < freelancers.length; i++) {
    const user = await storage.createUser(freelancers[i] as any);
    const pd = profileData[i];
    await storage.createProfile({
      userId: user.id,
      specialisms: JSON.stringify(pd.specialisms),
      skills: JSON.stringify(pd.skills),
      hourlyRate: pd.hourlyRate,
      dayRate: pd.dayRate,
      availability: pd.availability,
      yearsExperience: pd.yearsExperience,
      reelUrl: reelUrls[i] || undefined,
      portfolioItems: JSON.stringify(portfolioSets[i]),
      socialLinks: JSON.stringify({ instagram: "#", linkedin: "#" }),
      rating: pd.rating,
      reviewCount: pd.reviewCount,
      projectCount: pd.projectCount,
      featured: pd.featured,
      badges: JSON.stringify(pd.badges),
    } as any);

    // Add a client user for reviews
    let clientUser = await storage.getUserByEmail(`client${i}@viewr.co`);
    if (!clientUser) {
      clientUser = await storage.createUser({ name: reviewSets[i][0].clientName, email: `client${i}@viewr.co`, role: "client", avatar: `https://i.pravatar.cc/150?img=${60 + i}` });
    }
    const profile = await storage.getProfileByUserId(user.id);
    if (profile) {
      await storage.createReview({
        profileId: profile.id,
        clientId: clientUser.id,
        clientName: reviewSets[i][0].clientName,
        clientAvatar: `https://i.pravatar.cc/150?img=${60 + i}`,
        rating: reviewSets[i][0].rating,
        comment: reviewSets[i][0].comment,
        projectType: reviewSets[i][0].projectType,
      });
    }
  }

  // Add a demo client
  const alexClient = await storage.createUser({ name: "Alex Taylor", email: "alex@business.co", role: "client", avatar: "https://i.pravatar.cc/150?img=32", bio: "Marketing Director at Taylor & Co.", location: "London, UK" });

  // Seed demo projects (after users created)
  const freshUsers = await db.select().from(schema.users);
  const marcus = freshUsers.find(u => u.email === "marcus@viewrr.co");
  const sophia = freshUsers.find(u => u.email === "sophia@viewrr.co");
  const priya  = freshUsers.find(u => u.email === "priya@viewr.co");

  if (marcus && sophia && priya) {
    // Project 1: Alex + Marcus — Brand Film, stage 3
    const p1 = await storage.createProject({ clientId: alexClient.id, freelancerId: marcus.id, title: "Taylor & Co. Brand Film", description: "60-second brand film for social media and website hero.", status: "active", currentStage: 3 });
    await storage.addProjectUpdate({ projectId: p1.id, authorId: alexClient.id, stage: 0, note: "Project kicked off. Brief shared with Marcus." });
    await storage.addProjectUpdate({ projectId: p1.id, authorId: marcus.id, stage: 1, note: "Pre-production complete. Shot list and location scouting done. Ready to shoot Thursday." });
    await storage.addProjectUpdate({ projectId: p1.id, authorId: alexClient.id, stage: 2, note: "Shoot day looked amazing — really happy with the rushes. Great work on set." });
    await storage.addProjectUpdate({ projectId: p1.id, authorId: marcus.id, stage: 3, note: "First cut delivered. Please review and leave feedback by Friday." });

    // Project 2: Alex + Sophia — Post Production, stage 2
    const p2 = await storage.createProject({ clientId: alexClient.id, freelancerId: sophia.id, title: "Product Launch Video Grade", description: "Colour grade and audio mix for 3-part product launch series.", status: "active", currentStage: 2 });
    await storage.addProjectUpdate({ projectId: p2.id, authorId: alexClient.id, stage: 0, note: "Footage sent over to Sophia. Three files, all in BRAW." });
    await storage.addProjectUpdate({ projectId: p2.id, authorId: sophia.id, stage: 1, note: "Ingested and organised. Starting grade on part 1 today." });
    await storage.addProjectUpdate({ projectId: p2.id, authorId: sophia.id, stage: 2, note: "Part 1 grade done. Preview link sent. Parts 2 & 3 in progress." });

    // Project 3: Alex + Priya — Photography, stage 4 (complete)
    const p3 = await storage.createProject({ clientId: alexClient.id, freelancerId: priya.id, title: "SS26 Campaign Photography", description: "Product and lifestyle photography for Spring/Summer 2026 campaign.", status: "completed", currentStage: 5 });
    await storage.addProjectUpdate({ projectId: p3.id, authorId: alexClient.id, stage: 0, note: "Brief sent. 3 looks, 2 locations, 1 day shoot." });
    await storage.addProjectUpdate({ projectId: p3.id, authorId: priya.id, stage: 1, note: "Moodboard and shot list approved. Studio booked for the 3rd." });
    await storage.addProjectUpdate({ projectId: p3.id, authorId: priya.id, stage: 2, note: "Shoot complete. 400+ selects to review." });
    await storage.addProjectUpdate({ projectId: p3.id, authorId: alexClient.id, stage: 3, note: "Selection done — 42 finals chosen. Retouching can begin." });
    await storage.addProjectUpdate({ projectId: p3.id, authorId: priya.id, stage: 4, note: "All retouching complete. Full gallery delivered via WeTransfer." });
    await storage.addProjectUpdate({ projectId: p3.id, authorId: alexClient.id, stage: 5, note: "Incredible work. Campaign goes live next week. Thank you Priya!" });
  }

  // Seed demo feed posts
  const allUsers = await db.select().from(schema.users);
  const seedPosts = [
    {
      email: "marcus@viewrr.co",
      caption: "Just wrapped a two-day brand shoot for a luxury watchmaker in the City. Shooting on the ARRI Alexa 35 — the skin tones are something else. Can't wait to show the final cut. 🎬",
      mediaUrl: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["BrandFilm", "Cinematography", "London"]),
      likeCount: 142,
    },
    {
      email: "sophia@viewrr.co",
      caption: "Before & after colour grade on a feature documentary. The original log footage looked flat — here's what a proper grade can do. DaVinci Resolve + custom LUTs built from scratch.",
      mediaUrl: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["ColourGrade", "PostProduction", "DaVinci"]),
      likeCount: 98,
    },
    {
      email: "aisha@viewr.co",
      caption: "Excited to share — my short documentary 'Roots' has been officially selected for the SXSW 2026 programme. Three years of work, hundreds of interviews, one story. ❤️",
      mediaUrl: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["Documentary", "SXSW", "Storytelling"]),
      likeCount: 317,
    },
    {
      email: "priya@viewr.co",
      caption: "Campaign stills from last week's shoot for a SS26 fashion label. Natural light, minimal retouching. Let the clothes do the talking.",
      mediaUrl: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["FashionPhotography", "Campaign", "Editorial"]),
      likeCount: 204,
    },
    {
      email: "ryan@viewr.co",
      caption: "FPV through an abandoned warehouse in East London at golden hour. This was one take, no cuts. Pure flying. 🚀",
      mediaUrl: "https://images.unsplash.com/photo-1524143986875-3b098d78b363?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["Drone", "FPV", "Aerial"]),
      likeCount: 176,
    },
    {
      email: "tom@viewr.co",
      caption: "Motion reel drop 🎬 New showreel for 2026. 12 months of brand animations, app launches, and title sequences. Sound on.",
      mediaUrl: "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["MotionDesign", "Animation", "Showreel"]),
      likeCount: 89,
    },
    {
      email: "jaden@viewr.co",
      caption: "This TikTok for a fitness brand hit 2.4M views in 48 hours. Hook in the first 2 seconds, pattern interrupt, strong CTA. Formula works every time.",
      mediaUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["TikTok", "SocialMedia", "ContentStrategy"]),
      likeCount: 253,
    },
    {
      email: "lena@viewr.co",
      caption: "Lookbook preview for a Berlin-based skincare startup. Shot over two days in a studio space in Shoreditch. Clean, clinical, confident.",
      mediaUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["ProductPhotography", "Lookbook", "Skincare"]),
      likeCount: 131,
    },
  ];

  for (const p of seedPosts) {
    const u = allUsers.find(u => u.email === p.email);
    if (!u) continue;
    await storage.createPost({
      userId: u.id,
      caption: p.caption,
      mediaUrl: p.mediaUrl,
      mediaType: p.mediaType,
      tags: p.tags,
    });
    // Manually set like counts since createPost doesn't accept them
    const postsForUser = await db.select().from(schema.posts).where(eq(schema.posts.userId, u.id));
    const created = postsForUser.slice(-1)[0];
    if (created) {
      await db.update(schema.posts).set({ likeCount: p.likeCount }).where(eq(schema.posts.id, created.id));
    }
  }

  // Add a few demo comments
  const postsAll = await db.select().from(schema.posts);
  const clientUser = allUsers.find(u => u.email === "alex@business.co");
  if (clientUser && postsAll.length > 0) {
    const demoComments = [
      { postIdx: 0, content: "This is stunning work Marcus. Would love to discuss a project." },
      { postIdx: 2, content: "Congratulations Aisha! Well deserved, this story needed to be told." },
      { postIdx: 3, content: "Love the natural light approach — so refreshing to see." },
    ];
    for (const c of demoComments) {
      const post = postsAll[c.postIdx];
      if (post) {
        await storage.createComment({ postId: post.id, userId: clientUser.id, content: c.content });
      }
    }
  }
}

// ─── Seed briefs ─────────────────────────────────────────────────────────────
async function seedBriefs() {
  const existing = await db.select().from(schema.briefs);
  if (existing.length > 0) return;

  const demoBriefs: schema.InsertBrief[] = [
    {
      clientId: 1,
      clientName: "Alex Turner",
      clientAvatar: "https://i.pravatar.cc/60?img=11",
      title: "Videographer needed for Glastonbury warm-up festival",
      description: "We're running a 3-day music festival in Somerset in July with 8 stages and approximately 4,000 attendees. We need an experienced videographer to capture highlight reels, artist interviews, and crowd atmosphere. Footage will be used for social media and a 5-minute documentary short.",
      category: "Videography",
      location: "Somerset, UK",
      remote: 0,
      startDate: "2026-07-10",
      duration: "3 days",
      budgetMin: 800,
      budgetMax: 1500,
      budgetType: "project",
      requirements: "Minimum 3 years festival/event experience. Must own 4K camera and gimbal. Drone licence (A2 CofC) preferred. Own transport required.",
      status: "open",
    },
    {
      clientId: 1,
      clientName: "Alex Turner",
      clientAvatar: "https://i.pravatar.cc/60?img=11",
      title: "Wedding videographer — Cotswolds barn wedding",
      description: "Looking for an experienced wedding videographer for our barn wedding in the Cotswolds. We want a cinematic highlight film (5–8 min) plus full ceremony and speeches edit. Style reference: emotional, natural light, minimal music overlay.",
      category: "Videography",
      location: "Cotswolds, UK",
      remote: 0,
      startDate: "2026-09-06",
      duration: "1 day",
      budgetMin: 1200,
      budgetMax: 2000,
      budgetType: "project",
      requirements: "Wedding portfolio required. Must have backup camera body. Delivery within 8 weeks of wedding date.",
      status: "open",
    },
    {
      clientId: 1,
      clientName: "Drift Studio",
      clientAvatar: "https://i.pravatar.cc/60?img=22",
      title: "Social media content photographer — ongoing retainer",
      description: "Growing lifestyle brand looking for a photographer to shoot monthly content for Instagram and TikTok. 1 shoot per month, approx 4 hours, across London locations. Must understand brand aesthetics and be able to shoot both product and lifestyle.",
      category: "Photography",
      location: "London, UK",
      remote: 0,
      startDate: "2026-05-01",
      duration: "Ongoing",
      budgetMin: 300,
      budgetMax: 500,
      budgetType: "day",
      requirements: "Strong editorial portfolio. Experience with product and lifestyle photography. Adobe Lightroom editing included in rate.",
      status: "open",
    },
    {
      clientId: 1,
      clientName: "Peak Performance Ltd",
      clientAvatar: "https://i.pravatar.cc/60?img=33",
      title: "Video editor needed for sports brand YouTube channel",
      description: "We produce 2–3 YouTube videos per week for our fitness and sports brand (180k subscribers). Looking for a skilled editor to handle colour grading, motion graphics, and audio mixing. All raw footage supplied. Remote work, flexible hours.",
      category: "Video Editing",
      location: "Remote",
      remote: 1,
      startDate: "2026-05-15",
      duration: "Ongoing",
      budgetMin: 150,
      budgetMax: 250,
      budgetType: "day",
      requirements: "Proficient in Premiere Pro or DaVinci Resolve. Motion graphics experience (After Effects). Sports/fitness content portfolio preferred. Fast turnaround essential.",
      status: "open",
    },
    {
      clientId: 1,
      clientName: "Nova Interiors",
      clientAvatar: "https://i.pravatar.cc/60?img=44",
      title: "Marketing consultant for luxury interior design brand rebrand",
      description: "High-end interior design studio undergoing a full rebrand. We need a marketing consultant to develop our brand positioning, content strategy, and social media playbook. Must have experience in the luxury or design sector.",
      category: "Marketing",
      location: "London, UK",
      remote: 1,
      startDate: "2026-06-01",
      duration: "6 weeks",
      budgetMin: 3000,
      budgetMax: 6000,
      budgetType: "project",
      requirements: "Luxury brand experience required. Portfolio of previous brand strategy work. Must be available for 2 in-person kick-off meetings in London.",
      status: "open",
    },
  ];

  for (const b of demoBriefs) {
    await storage.createBrief(b);
  }
}

export async function initStorage() {
  await runMigrations();
  await seedIfEmpty();
  await seedBriefs();
}
