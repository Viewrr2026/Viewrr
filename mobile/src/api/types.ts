/**
 * Mobile-local mirrors of the Viewrr backend response shapes.
 *
 * These are hand-written on purpose. /mobile is an isolated package and must
 * never import runtime code (or types) from shared/schema.ts, so every shape
 * here was read off server/routes.ts + server/storage.ts at origin/main and
 * transcribed. Only the fields mobile actually consumes are declared; the
 * backend sends more, and extra keys are simply ignored.
 *
 * Booleans from Postgres integer columns arrive as 0 | 1 — modelled as such
 * rather than coerced, so screens branch on the real wire value.
 */

/** GET /api/notifications/:userId — schema.notifications rows, newest first. */
export type Notification = {
  id: number;
  recipientId: number;
  actorId: number | null;
  actorName: string;
  actorAvatar: string | null;
  /** "like" | "comment" | "message" | "interest" | "interest_accepted" | … */
  type: string;
  message: string;
  /** Web-style path such as "/your-work". Resolve via navigation/linkResolver. */
  link: string | null;
  read: number;
  createdAt: string;
};

/** GET /api/notifications/:userId/unread-count */
export type UnreadCount = { count: number };

/** safeUserDto(user) — password fields stripped. */
export type PublicUser = {
  id: number;
  name: string;
  email?: string | null;
  role: string;
  /** "sole" | "agency_owner" | "agency_member" */
  accountSubtype?: string | null;
  agencyId?: number | null;
  avatar?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  isAdmin?: boolean | null;
  accountStatus?: string | null;
};

/** GET /api/profile-by-user/:userId — accreditation notes stripped server-side. */
export type UserProfile = {
  id: number;
  userId: number;
  /** JSON-encoded arrays on the wire. */
  specialisms: string;
  skills: string;
  portfolioItems: string;
  socialLinks: string;
  hourlyRate: number | null;
  dayRate: number | null;
  availability: string;
  yearsExperience: number | null;
  reelUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  projectCount: number | null;
  isPro: number | null;
  accreditationLevel: string | null;
};

/** One project row inside ProjectWithDetails. */
export type Project = {
  id: number;
  clientId: number;
  freelancerId: number;
  title: string;
  description: string;
  /** "active" | "completed" | … */
  status: string;
  currentStage: number;
  freelancerName: string | null;
  clientName: string | null;
  briefCategory: string | null;
  paymentStatus: string | null;
  isRetainer: number | null;
  agreedAmountPence: number | null;
  createdAt: string;
  completedAt: string | null;
};

/** GET /api/projects?userId= — storage.ProjectWithDetails. */
export type ProjectWithDetails = {
  project: Project;
  client: PublicUser;
  freelancer: PublicUser;
  updates: unknown[];
};

/** GET /api/messages/:userId/conversations — storage.ConversationSummary. */
export type ConversationSummary = {
  otherId: number;
  otherName: string;
  otherAvatar: string | null;
  lastMessage: string;
  lastAt: string;
  unread: number;
};

/** GET /api/briefs (paginated: limit default 50, max 200; offset). */
export type Brief = {
  id: number;
  clientId: number;
  clientName: string;
  clientAvatar: string | null;
  title: string;
  description: string;
  category: string;
  location: string;
  remote: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetType: string;
  status: string;
  applicationCount: number;
  isActive: boolean;
  createdAt: string;
};

/** GET /api/interests/freelancer/:id and /api/interests/client/:id. */
export type BriefInterest = {
  id: number;
  briefId: number;
  briefTitle: string;
  briefClientId: number;
  briefClientName: string;
  freelancerId: number;
  freelancerName: string;
  freelancerAvatar: string | null;
  proposedPricePence: number | null;
  counterOfferPence: number | null;
  /** "pending" | "viewed" | "accepted" | "declined" | "counter_offered" */
  status: string;
  createdAt: string;
};

/* ── Feed ──────────────────────────────────────────────────────────────────
 * GET /api/feed returns storage.PostWithUser[]: `{ post, user, liked }`.
 *
 * SECURITY NOTE (reported, not worked around): the backend embeds the FULL
 * users row on every post and comment — safeUser() strips only the password
 * hash, so `email`, `phone`, `stripeAccountId`, `stripePendingPence` and
 * `suspendedReason` are all on the wire, to unauthenticated callers. Mobile
 * models the author as `FeedAuthor` below, which declares ONLY the fields a
 * post header may render. Anything absent from this type cannot reach a screen
 * by accident. The over-exposure itself is a backend fix.
 */

/** The subset of a post/comment author mobile is permitted to render. */
export type FeedAuthor = {
  id: number;
  name: string;
  avatar?: string | null;
  headline?: string | null;
  location?: string | null;
  role?: string | null;
};

/** schema.Post. `tags` is a JSON-encoded array in a TEXT column. */
export type Post = {
  id: number;
  userId: number;
  caption: string;
  mediaUrl: string | null;
  /** Free text; web writes "image" | "video". */
  mediaType: string | null;
  tags: string;
  likeCount: number;
  commentCount: number;
  createdAt: string;
};

/** One row of GET /api/feed. */
export type FeedItem = {
  post: Post;
  user: FeedAuthor;
  liked: boolean;
};

/** POST /api/feed/:id/like */
export type LikeResult = { liked: boolean; likeCount: number };

/** schema.PostComment. */
export type PostComment = {
  id: number;
  postId: number;
  userId: number;
  content: string;
  createdAt: string;
};

/** One row of GET /api/feed/:id/comments. */
export type CommentItem = {
  comment: PostComment;
  user: FeedAuthor;
};

/* ── Browse Talent ─────────────────────────────────────────────────────────
 * GET /api/profiles returns storage.ProfileWithUser[] — `{ profile, user }`,
 * with safePublicProfile() applied and projectCount overridden by the
 * DB-authoritative completed-project count (server/routes.ts:948-957).
 *
 * Same PII caveat as the feed: the embedded `user` is the full row. `TalentUser`
 * below is deliberately narrow for the same reason.
 */

export type TalentUser = {
  id: number;
  name: string;
  avatar?: string | null;
  banner?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  role?: string | null;
  accountSubtype?: string | null;
  createdAt?: string | null;
};

/** schema.Profile minus the internal accreditation columns. */
export type TalentProfile = {
  id: number | null;
  userId: number;
  /** JSON-encoded arrays / object on the wire. */
  specialisms: string;
  skills: string;
  portfolioItems: string;
  socialLinks: string;
  badges: string;
  hourlyRate: number | null;
  dayRate: number | null;
  /** "available" | "busy" | "unavailable" */
  availability: string | null;
  yearsExperience: number | null;
  reelUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  projectCount: number | null;
  cardThumbnail: string | null;
  isPro: number | null;
  accreditationLevel: string | null;
  reviewAverage?: number | null;
  verifiedReviewCount?: number | null;
};

/** One row of GET /api/profiles. */
export type TalentItem = {
  profile: TalentProfile;
  user: TalentUser;
};

/** schema.Review — reviews are inlined into GET /api/profiles/:id. */
export type Review = {
  id: number;
  profileId: number;
  clientId: number;
  clientName: string;
  clientAvatar: string | null;
  rating: number;
  comment: string;
  projectType: string | null;
  verifiedProjectReview: number | null;
  createdAt: string;
};

/**
 * GET /api/profiles/:id. The id may be a profile id OR a user id — the handler
 * resolves both. `isClientStub` is returned when the id belongs to a user with
 * no profile row (a client), in which case `profile.id` is null.
 */
export type TalentDetail = {
  profile: TalentProfile;
  user: TalentUser;
  reviews: Review[];
  isClientStub?: boolean;
};

/** An entry of the profile's `portfolioItems` JSON array. */
export type PortfolioItem = {
  url: string;
  title?: string;
  clientName?: string;
  thumbnail?: string;
};
