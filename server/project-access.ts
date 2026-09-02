/**
 * PRD-1 prerequisite: project read-path authorisation.
 *
 * Before this file, every project read endpoint (`GET /api/projects`,
 * `/api/projects/:id`, `/stages`, `/plan-summary`, `/deliverables`, `/updates`,
 * `/meetings`, `/time-entries`, the retainer cycle read) was unauthenticated and
 * IDOR-able by project id. Mobile must not ship on top of that.
 *
 * `assertProjectParty` is the single authority for "is this caller a party on
 * this project?". Route handlers pair it with `requireAuth` and map the thrown
 * `ProjectAccessError` onto an HTTP status with `sendProjectAccessError`.
 *
 * Deliberately narrow (contract section D):
 *   - Returns the caller's party role, "client" | "freelancer".
 *   - No admin bypass. Admin/founder surfaces must use their own
 *     requireAdminGuard-protected routes rather than widening this helper.
 */

import type { Response } from "express";
import { storage } from "./storage";
import type * as schema from "../shared/schema";

export type ProjectPartyRole = "client" | "freelancer";

export interface ProjectPartyResult {
  project: schema.Project;
  role: ProjectPartyRole;
}

/**
 * Thrown by assertProjectParty. `status` is the HTTP status a route should use
 * (404 when the project does not exist, 403 when the caller is not a party).
 */
export class ProjectAccessError extends Error {
  readonly status: number;
  readonly code: "PROJECT_NOT_FOUND" | "NOT_PROJECT_PARTY";

  constructor(status: number, code: "PROJECT_NOT_FOUND" | "NOT_PROJECT_PARTY", message: string) {
    super(message);
    this.name = "ProjectAccessError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Resolve a project and assert the given user is the client or the freelancer
 * on it. Throws ProjectAccessError (403-mappable) otherwise.
 */
export async function assertProjectParty(
  projectId: number,
  userId: number
): Promise<ProjectPartyResult> {
  if (!Number.isFinite(projectId) || projectId <= 0) {
    throw new ProjectAccessError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  const pw = await storage.getProject(projectId);
  if (!pw) {
    throw new ProjectAccessError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  const project = pw.project;
  if (project.clientId === userId) return { project, role: "client" };
  if (project.freelancerId === userId) return { project, role: "freelancer" };
  throw new ProjectAccessError(403, "NOT_PROJECT_PARTY", "Not authorised");
}

/** True when the user is a party on the project; never throws for access denial. */
export async function isProjectParty(projectId: number, userId: number): Promise<boolean> {
  try {
    await assertProjectParty(projectId, userId);
    return true;
  } catch (e) {
    if (e instanceof ProjectAccessError) return false;
    throw e;
  }
}

/**
 * Map a thrown error onto a response. Returns true when the error was a
 * ProjectAccessError and a response has been sent; false when the caller should
 * handle it as a generic failure.
 */
export function sendProjectAccessError(res: Response, e: unknown): boolean {
  if (e instanceof ProjectAccessError) {
    res.status(e.status).json({ error: e.message, code: e.code });
    return true;
  }
  return false;
}
