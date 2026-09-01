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
