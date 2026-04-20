import { Database } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import BetterSqlite3 from "better-sqlite3";
import { eq, like, or, and, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import path from "path";

const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), "viewr.db");
console.log(`[db] Opening database at: ${dbPath}`);
const sqlite: Database = new BetterSqlite3(dbPath);
const db = drizzle(sqlite, { schema });

// Run migrations
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'freelancer',
    avatar TEXT,
    bio TEXT,
    location TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    client_avatar TEXT,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL,
    project_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL
  );

  -- Add is_pro columns if upgrading an existing DB
  -- (no-op if already present)
`);
try { sqlite.exec(`ALTER TABLE profiles ADD COLUMN is_pro INTEGER DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE profiles ADD COLUMN pro_since TEXT`); } catch {}
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    freelancer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    current_stage INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    stage INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    media_type TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    like_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS post_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface IStorage {
  // Users
  getUser(id: number): schema.User | undefined;
  getUserByEmail(email: string): schema.User | undefined;
  createUser(data: schema.InsertUser): schema.User;
  
  // Profiles
  getProfiles(filters?: { specialism?: string; availability?: string; search?: string }): ProfileWithUser[];
  getProfile(id: number): ProfileWithUser | undefined;
  getProfileByUserId(userId: number): schema.Profile | undefined;
  createProfile(data: schema.InsertProfile): schema.Profile;
  updateProfile(id: number, data: Partial<schema.InsertProfile>): schema.Profile | undefined;
  getFeaturedProfiles(): ProfileWithUser[];

  // Reviews
  getReviewsByProfile(profileId: number): schema.Review[];
  createReview(data: schema.InsertReview): schema.Review;

  // Messages
  getMessagesBetween(fromId: number, toId: number): schema.Message[];
  getConversations(userId: number): ConversationSummary[];
  createMessage(data: schema.InsertMessage): schema.Message;
  markMessagesRead(fromId: number, toId: number): void;

  // Saved
  getSaved(clientId: number): ProfileWithUser[];
  toggleSaved(clientId: number, profileId: number): boolean;
  isSaved(clientId: number, profileId: number): boolean;

  // Feed
  getFeedPosts(limit?: number, offset?: number): PostWithUser[];
  getPost(id: number): PostWithUser | undefined;
  createPost(data: schema.InsertPost): schema.Post;
  deletePost(id: number, userId: number): boolean;
  toggleLike(postId: number, userId: number): boolean;
  isLiked(postId: number, userId: number): boolean;
  getComments(postId: number): CommentWithUser[];
  createComment(data: schema.InsertPostComment): CommentWithUser;

  // Pro Viewrrr
  subscribePro(profileId: number): schema.Profile | undefined;
  isProSubscriber(profileId: number): boolean;

  // Projects
  getProjectsForUser(userId: number): ProjectWithDetails[];
  getProject(id: number): ProjectWithDetails | undefined;
  createProject(data: schema.InsertProject): schema.Project;
  advanceProjectStage(projectId: number, note: string, authorId: number): schema.Project | undefined;
  addProjectUpdate(data: schema.InsertProjectUpdate): schema.ProjectUpdate;
  getProjectUpdates(projectId: number): ProjectUpdateWithAuthor[];

  // Briefs
  getBriefs(): schema.Brief[];
  getBrief(id: number): schema.Brief | undefined;
  createBrief(data: schema.InsertBrief): schema.Brief;
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
  getUser(id: number) {
    return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  }

  getUserByEmail(email: string) {
    return db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  }

  createUser(data: schema.InsertUser) {
    return db.insert(schema.users).values(data).returning().get();
  }

  getProfiles(filters?: { specialism?: string; availability?: string; search?: string }): ProfileWithUser[] {
    const allProfiles = db.select().from(schema.profiles).all();
    const allUsers = db.select().from(schema.users).all();
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

    // Pro Viewrrrs always sort to top, then by rating
    return results.sort((a, b) => {
      const proA = a.profile.isPro || 0;
      const proB = b.profile.isPro || 0;
      if (proB !== proA) return proB - proA;
      return (b.profile.rating || 0) - (a.profile.rating || 0);
    });
  }

  getProfile(id: number): ProfileWithUser | undefined {
    const profile = db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).get();
    if (!profile) return undefined;
    const user = this.getUser(profile.userId);
    if (!user) return undefined;
    return { profile, user };
  }

  getProfileByUserId(userId: number) {
    return db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get();
  }

  createProfile(data: schema.InsertProfile) {
    return db.insert(schema.profiles).values(data).returning().get();
  }

  updateProfile(id: number, data: Partial<schema.InsertProfile>) {
    return db.update(schema.profiles).set(data).where(eq(schema.profiles.id, id)).returning().get();
  }

  getFeaturedProfiles(): ProfileWithUser[] {
    const allProfiles = db.select().from(schema.profiles).all();
    const allUsers = db.select().from(schema.users).all();
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    return allProfiles
      .filter(p => p.featured === 1)
      .map(p => ({ profile: p, user: userMap.get(p.userId)! }))
      .filter(pw => pw.user)
      .slice(0, 8);
  }

  getReviewsByProfile(profileId: number) {
    return db.select().from(schema.reviews).where(eq(schema.reviews.profileId, profileId)).all();
  }

  createReview(data: schema.InsertReview) {
    const review = db.insert(schema.reviews).values(data).returning().get();
    // Update profile rating
    const reviews = this.getReviewsByProfile(data.profileId);
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    db.update(schema.profiles)
      .set({ rating: Math.round(avg * 10) / 10, reviewCount: reviews.length })
      .where(eq(schema.profiles.id, data.profileId))
      .run();
    return review;
  }

  getMessagesBetween(fromId: number, toId: number) {
    return db.select().from(schema.messages)
      .where(
        or(
          and(eq(schema.messages.fromId, fromId), eq(schema.messages.toId, toId)),
          and(eq(schema.messages.fromId, toId), eq(schema.messages.toId, fromId))
        )
      )
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getConversations(userId: number): ConversationSummary[] {
    const allMessages = db.select().from(schema.messages)
      .where(or(eq(schema.messages.fromId, userId), eq(schema.messages.toId, userId)))
      .all();

    const convMap = new Map<number, schema.Message[]>();
    for (const msg of allMessages) {
      const otherId = msg.fromId === userId ? msg.toId : msg.fromId;
      if (!convMap.has(otherId)) convMap.set(otherId, []);
      convMap.get(otherId)!.push(msg);
    }

    const results: ConversationSummary[] = [];
    for (const [otherId, msgs] of convMap.entries()) {
      const other = this.getUser(otherId);
      if (!other) continue;
      const sorted = msgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const unread = msgs.filter(m => m.toId === userId && !m.read).length;
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

  createMessage(data: schema.InsertMessage) {
    return db.insert(schema.messages).values(data).returning().get();
  }

  markMessagesRead(fromId: number, toId: number) {
    db.update(schema.messages)
      .set({ read: 1 })
      .where(and(eq(schema.messages.fromId, fromId), eq(schema.messages.toId, toId)))
      .run();
  }

  getSaved(clientId: number): ProfileWithUser[] {
    const savedRows = db.select().from(schema.saved).where(eq(schema.saved.clientId, clientId)).all();
    return savedRows.map(s => this.getProfile(s.profileId)).filter(Boolean) as ProfileWithUser[];
  }

  toggleSaved(clientId: number, profileId: number): boolean {
    const existing = db.select().from(schema.saved)
      .where(and(eq(schema.saved.clientId, clientId), eq(schema.saved.profileId, profileId)))
      .get();
    if (existing) {
      db.delete(schema.saved).where(eq(schema.saved.id, existing.id)).run();
      return false;
    } else {
      db.insert(schema.saved).values({ clientId, profileId }).run();
      return true;
    }
  }

  isSaved(clientId: number, profileId: number): boolean {
    return !!db.select().from(schema.saved)
      .where(and(eq(schema.saved.clientId, clientId), eq(schema.saved.profileId, profileId)))
      .get();
  }

  // ── Feed ─────────────────────────────────────────────────────────────────
  getFeedPosts(limit = 20, offset = 0, viewerUserId?: number): PostWithUser[] {
    const allPosts = db.select().from(schema.posts).all()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit);
    return allPosts.map(post => {
      const user = this.getUser(post.userId)!;
      const liked = viewerUserId ? this.isLiked(post.id, viewerUserId) : false;
      return { post, user, liked };
    }).filter(p => p.user);
  }

  getPost(id: number): PostWithUser | undefined {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();
    if (!post) return undefined;
    const user = this.getUser(post.userId);
    if (!user) return undefined;
    return { post, user, liked: false };
  }

  createPost(data: schema.InsertPost): schema.Post {
    return db.insert(schema.posts).values(data).returning().get();
  }

  deletePost(id: number, userId: number): boolean {
    const post = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();
    if (!post || post.userId !== userId) return false;
    db.delete(schema.posts).where(eq(schema.posts.id, id)).run();
    return true;
  }

  toggleLike(postId: number, userId: number): boolean {
    const existing = db.select().from(schema.postLikes)
      .where(and(eq(schema.postLikes.postId, postId), eq(schema.postLikes.userId, userId)))
      .get();
    if (existing) {
      db.delete(schema.postLikes).where(eq(schema.postLikes.id, existing.id)).run();
      db.update(schema.posts).set({ likeCount: Math.max(0, (db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get()?.likeCount || 1) - 1) }).where(eq(schema.posts.id, postId)).run();
      return false;
    } else {
      db.insert(schema.postLikes).values({ postId, userId }).run();
      const cur = db.select().from(schema.posts).where(eq(schema.posts.id, postId)).get();
      db.update(schema.posts).set({ likeCount: (cur?.likeCount || 0) + 1 }).where(eq(schema.posts.id, postId)).run();
      return true;
    }
  }

  isLiked(postId: number, userId: number): boolean {
    return !!db.select().from(schema.postLikes)
      .where(and(eq(schema.postLikes.postId, postId), eq(schema.postLikes.userId, userId)))
      .get();
  }

  getComments(postId: number): CommentWithUser[] {
    const comments = db.select().from(schema.postComments)
      .where(eq(schema.postComments.postId, postId)).all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return comments.map(comment => {
      const user = this.getUser(comment.userId);
      if (!user) return null;
      return { comment, user };
    }).filter(Boolean) as CommentWithUser[];
  }

  createComment(data: schema.InsertPostComment): CommentWithUser {
    const comment = db.insert(schema.postComments).values(data).returning().get();
    const cur = db.select().from(schema.posts).where(eq(schema.posts.id, data.postId)).get();
    db.update(schema.posts).set({ commentCount: (cur?.commentCount || 0) + 1 }).where(eq(schema.posts.id, data.postId)).run();
    const user = this.getUser(data.userId)!;
    return { comment, user };
  }

  // ── Pro Viewrrr ────────────────────────────────────────────────────────────
  subscribePro(profileId: number): schema.Profile | undefined {
    return db.update(schema.profiles)
      .set({ isPro: 1, proSince: new Date().toISOString() })
      .where(eq(schema.profiles.id, profileId))
      .returning()
      .get();
  }

  isProSubscriber(profileId: number): boolean {
    const p = db.select().from(schema.profiles).where(eq(schema.profiles.id, profileId)).get();
    return p?.isPro === 1;
  }

  // ── Projects ─────────────────────────────────────────────────────────
  _buildProjectWithDetails(project: schema.Project): ProjectWithDetails | undefined {
    const client = this.getUser(project.clientId);
    const freelancer = this.getUser(project.freelancerId);
    if (!client || !freelancer) return undefined;
    const updates = this.getProjectUpdates(project.id);
    return { project, client, freelancer, updates };
  }

  getProjectsForUser(userId: number): ProjectWithDetails[] {
    const all = db.select().from(schema.projects)
      .where(or(eq(schema.projects.clientId, userId), eq(schema.projects.freelancerId, userId)))
      .all()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.map(p => this._buildProjectWithDetails(p)).filter(Boolean) as ProjectWithDetails[];
  }

  getProject(id: number): ProjectWithDetails | undefined {
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    if (!project) return undefined;
    return this._buildProjectWithDetails(project);
  }

  createProject(data: schema.InsertProject): schema.Project {
    return db.insert(schema.projects).values(data).returning().get();
  }

  advanceProjectStage(projectId: number, note: string, authorId: number): schema.Project | undefined {
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (!project) return undefined;
    const nextStage = project.currentStage + 1;
    db.update(schema.projects).set({ currentStage: nextStage }).where(eq(schema.projects.id, projectId)).run();
    if (note.trim()) {
      db.insert(schema.projectUpdates).values({ projectId, authorId, stage: nextStage, note }).run();
    }
    return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  }

  addProjectUpdate(data: schema.InsertProjectUpdate): schema.ProjectUpdate {
    return db.insert(schema.projectUpdates).values(data).returning().get();
  }

  getProjectUpdates(projectId: number): ProjectUpdateWithAuthor[] {
    const updates = db.select().from(schema.projectUpdates)
      .where(eq(schema.projectUpdates.projectId, projectId))
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return updates.map(update => {
      const author = this.getUser(update.authorId);
      if (!author) return null;
      return { update, author };
    }).filter(Boolean) as ProjectUpdateWithAuthor[];
  }

  // ─── Briefs ──────────────────────────────────────────────────────────────
  getBriefs(): schema.Brief[] {
    return db.select().from(schema.briefs).all().reverse();
  }

  getBrief(id: number): schema.Brief | undefined {
    return db.select().from(schema.briefs).where(eq(schema.briefs.id, id)).get();
  }

  createBrief(data: schema.InsertBrief): schema.Brief {
    return db.insert(schema.briefs).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
}

export const storage = new Storage();

// ─── Seed data ───────────────────────────────────────────────────────────────
function seedIfEmpty() {
  const existing = db.select().from(schema.users).all();
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
    const user = storage.createUser(freelancers[i] as any);
    const pd = profileData[i];
    storage.createProfile({
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
    let clientUser = storage.getUserByEmail(`client${i}@viewr.co`);
    if (!clientUser) {
      clientUser = storage.createUser({ name: reviewSets[i][0].clientName, email: `client${i}@viewr.co`, role: "client", avatar: `https://i.pravatar.cc/150?img=${60 + i}` });
    }
    const profile = storage.getProfileByUserId(user.id);
    if (profile) {
      storage.createReview({
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
  const alexClient = storage.createUser({ name: "Alex Taylor", email: "alex@business.co", role: "client", avatar: "https://i.pravatar.cc/150?img=32", bio: "Marketing Director at Taylor & Co.", location: "London, UK" });

  // Seed demo projects (after users created)
  const freshUsers = db.select().from(schema.users).all();
  const marcus = freshUsers.find(u => u.email === "marcus@viewrr.co");
  const sophia = freshUsers.find(u => u.email === "sophia@viewrr.co");
  const priya  = freshUsers.find(u => u.email === "priya@viewr.co");

  if (marcus && sophia && priya) {
    // Project 1: Alex + Marcus — Brand Film, stage 3
    const p1 = storage.createProject({ clientId: alexClient.id, freelancerId: marcus.id, title: "Taylor & Co. Brand Film", description: "60-second brand film for social media and website hero.", status: "active", currentStage: 3 });
    storage.addProjectUpdate({ projectId: p1.id, authorId: alexClient.id, stage: 0, note: "Project kicked off. Brief shared with Marcus." });
    storage.addProjectUpdate({ projectId: p1.id, authorId: marcus.id, stage: 1, note: "Pre-production complete. Shot list and location scouting done. Ready to shoot Thursday." });
    storage.addProjectUpdate({ projectId: p1.id, authorId: alexClient.id, stage: 2, note: "Shoot day looked amazing — really happy with the rushes. Great work on set." });
    storage.addProjectUpdate({ projectId: p1.id, authorId: marcus.id, stage: 3, note: "First cut delivered. Please review and leave feedback by Friday." });

    // Project 2: Alex + Sophia — Post Production, stage 2
    const p2 = storage.createProject({ clientId: alexClient.id, freelancerId: sophia.id, title: "Product Launch Video Grade", description: "Colour grade and audio mix for 3-part product launch series.", status: "active", currentStage: 2 });
    storage.addProjectUpdate({ projectId: p2.id, authorId: alexClient.id, stage: 0, note: "Footage sent over to Sophia. Three files, all in BRAW." });
    storage.addProjectUpdate({ projectId: p2.id, authorId: sophia.id, stage: 1, note: "Ingested and organised. Starting grade on part 1 today." });
    storage.addProjectUpdate({ projectId: p2.id, authorId: sophia.id, stage: 2, note: "Part 1 grade done. Preview link sent. Parts 2 & 3 in progress." });

    // Project 3: Alex + Priya — Photography, stage 4 (complete)
    const p3 = storage.createProject({ clientId: alexClient.id, freelancerId: priya.id, title: "SS26 Campaign Photography", description: "Product and lifestyle photography for Spring/Summer 2026 campaign.", status: "completed", currentStage: 5 });
    storage.addProjectUpdate({ projectId: p3.id, authorId: alexClient.id, stage: 0, note: "Brief sent. 3 looks, 2 locations, 1 day shoot." });
    storage.addProjectUpdate({ projectId: p3.id, authorId: priya.id, stage: 1, note: "Moodboard and shot list approved. Studio booked for the 3rd." });
    storage.addProjectUpdate({ projectId: p3.id, authorId: priya.id, stage: 2, note: "Shoot complete. 400+ selects to review." });
    storage.addProjectUpdate({ projectId: p3.id, authorId: alexClient.id, stage: 3, note: "Selection done — 42 finals chosen. Retouching can begin." });
    storage.addProjectUpdate({ projectId: p3.id, authorId: priya.id, stage: 4, note: "All retouching complete. Full gallery delivered via WeTransfer." });
    storage.addProjectUpdate({ projectId: p3.id, authorId: alexClient.id, stage: 5, note: "Incredible work. Campaign goes live next week. Thank you Priya!" });
  }

  // Seed demo feed posts
  const allUsers = db.select().from(schema.users).all();
  const seedPosts = [
    {
      email: "marcus@viewrr.co",
      caption: "Just wrapped a two-day brand shoot for a luxury watchmaker in the City. Shooting on the ARRI Alexa 35 — the skin tones are something else. Can\'t wait to show the final cut. 🎬",
      mediaUrl: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["BrandFilm", "Cinematography", "London"]),
      likeCount: 142,
    },
    {
      email: "sophia@viewrr.co",
      caption: "Before & after colour grade on a feature documentary. The original log footage looked flat — here\'s what a proper grade can do. DaVinci Resolve + custom LUTs built from scratch.",
      mediaUrl: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["ColourGrade", "PostProduction", "DaVinci"]),
      likeCount: 98,
    },
    {
      email: "aisha@viewr.co",
      caption: "Excited to share — my short documentary \'Roots\' has been officially selected for the SXSW 2026 programme. Three years of work, hundreds of interviews, one story. ❤️",
      mediaUrl: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=900&q=85",
      mediaType: "image",
      tags: JSON.stringify(["Documentary", "SXSW", "Storytelling"]),
      likeCount: 317,
    },
    {
      email: "priya@viewr.co",
      caption: "Campaign stills from last week\'s shoot for a SS26 fashion label. Natural light, minimal retouching. Let the clothes do the talking.",
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
    storage.createPost({
      userId: u.id,
      caption: p.caption,
      mediaUrl: p.mediaUrl,
      mediaType: p.mediaType,
      tags: p.tags,
    });
    // Manually set like counts since createPost doesn\'t accept them
    const created = db.select().from(schema.posts).where(eq(schema.posts.userId, u.id)).all().slice(-1)[0];
    if (created) {
      db.update(schema.posts).set({ likeCount: p.likeCount }).where(eq(schema.posts.id, created.id)).run();
    }
  }

  // Add a few demo comments
  const postsAll = db.select().from(schema.posts).all();
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
        storage.createComment({ postId: post.id, userId: clientUser.id, content: c.content });
      }
    }
  }
}

seedIfEmpty();

// Seed demo briefs
function seedBriefs() {
  const existing = db.select().from(schema.briefs).all();
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
    storage.createBrief(b);
  }
}

seedBriefs();
