import { api } from "@/api/client";
import type {
  Brief,
  BriefInterest,
  ConversationSummary,
  ProjectWithDetails,
  PublicUser,
  UserProfile,
} from "@/api/types";

/**
 * Home's data layer.
 *
 * One loader per role, each firing its reads in parallel and returning a single
 * snapshot. Screens never call these endpoints individually — that is the rule
 * that stops two cards on the same screen fetching the same resource twice.
 *
 * Endpoint notes (server/routes.ts @ origin/main):
 *   • GET /api/messages/:userId/conversations is authorised (403 unless it is
 *     your own id) and, unlike the thread endpoint, does NOT mark anything
 *     read. It is the only safe source of message unread counts on mobile.
 *   • GET /api/briefs paginates (limit default 50, hard max 200, offset).
 *     Home asks for a small page — it is a summary, not a feed.
 *   • GET /api/projects, /api/interests/* and /api/profile-by-user/* are
 *     currently unauthenticated on the server and trust the id in the request.
 *     Mobile always sends the signed-in user's own id; the backend hardening
 *     ticket closes the hole itself.
 */

/** Home asks for a short page of briefs — enough to show "what's live". */
const BRIEF_PAGE = 20;

export type CreativeHomeData = {
  user: PublicUser | null;
  profile: UserProfile | null;
  projects: ProjectWithDetails[];
  conversations: ConversationSummary[];
  briefs: Brief[];
  interests: BriefInterest[];
};

export type ClientHomeData = {
  user: PublicUser | null;
  projects: ProjectWithDetails[];
  conversations: ConversationSummary[];
  myBriefs: Brief[];
  interests: BriefInterest[];
};

export type HomeData =
  | ({ role: "freelancer" } & CreativeHomeData)
  | ({ role: "client" } & ClientHomeData);

/**
 * A read that is allowed to fail without failing the screen.
 *
 * Home aggregates several independent resources. If the briefs list 500s, that
 * is a reason to hide the briefs card — not to blank the whole dashboard. Hard
 * failures (offline, 401) still propagate, because those come from the primary
 * reads below and mean the snapshot as a whole is not trustworthy.
 */
async function optional<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function fetchUser(userId: number, signal?: AbortSignal) {
  return api.get<PublicUser>(`/api/users/${userId}`, { signal });
}

function fetchProjects(userId: number, signal?: AbortSignal) {
  return api.get<ProjectWithDetails[]>("/api/projects", { query: { userId }, signal });
}

function fetchConversations(userId: number, signal?: AbortSignal) {
  return api.get<ConversationSummary[]>(`/api/messages/${userId}/conversations`, { signal });
}

export async function loadCreativeHome(
  userId: number,
  signal?: AbortSignal,
): Promise<CreativeHomeData> {
  const [user, profile, projects, conversations, briefs, interests] = await Promise.all([
    optional(fetchUser(userId, signal), null as PublicUser | null),
    optional(
      api.get<UserProfile>(`/api/profile-by-user/${userId}`, { signal }),
      null as UserProfile | null,
    ),
    fetchProjects(userId, signal),
    fetchConversations(userId, signal),
    optional(
      api.get<Brief[]>("/api/briefs", { query: { limit: BRIEF_PAGE, offset: 0 }, signal }),
      [] as Brief[],
    ),
    optional(
      api.get<BriefInterest[]>(`/api/interests/freelancer/${userId}`, { signal }),
      [] as BriefInterest[],
    ),
  ]);

  return { user, profile, projects, conversations, briefs, interests };
}

export async function loadClientHome(
  userId: number,
  signal?: AbortSignal,
): Promise<ClientHomeData> {
  const [user, projects, conversations, myBriefs, interests] = await Promise.all([
    optional(fetchUser(userId, signal), null as PublicUser | null),
    fetchProjects(userId, signal),
    fetchConversations(userId, signal),
    optional(
      api.get<Brief[]>("/api/briefs", {
        query: { clientId: userId, limit: BRIEF_PAGE, offset: 0 },
        signal,
      }),
      [] as Brief[],
    ),
    optional(
      api.get<BriefInterest[]>(`/api/interests/client/${userId}`, { signal }),
      [] as BriefInterest[],
    ),
  ]);

  return { user, projects, conversations, myBriefs, interests };
}

export async function loadHome(
  userId: number,
  role: "client" | "freelancer" | "admin",
  signal?: AbortSignal,
): Promise<HomeData> {
  // Admin accounts are Viewrr staff; the founder console is web-only, so they
  // see the client dashboard rather than an empty or broken surface.
  if (role === "freelancer") {
    return { role: "freelancer", ...(await loadCreativeHome(userId, signal)) };
  }
  return { role: "client", ...(await loadClientHome(userId, signal)) };
}
