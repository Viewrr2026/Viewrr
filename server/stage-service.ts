/**
 * PRD-014 — Dynamic Project Stage Service
 * Single source of truth for all project stage operations.
 * planning_status values:
 *   'legacy'            — existing projects, use currentStage/STAGES as before
 *   'planning_required' — new project, freelancer needs to build plan
 *   'plan_draft'        — freelancer building plan
 *   'awaiting_client'   — plan sent, waiting for client approval
 *   'client_changes'    — client requested changes
 *   'confirmed'         — plan agreed, work underway
 */

import { db } from "./storage";
import * as schema from "../shared/schema";
import { eq, asc, and } from "drizzle-orm";
import { drizzleSql } from "./storage";

export const MAX_STAGES = 20;

// ── Smart templates (FR-07) ────────────────────────────────────────────────────
export const STAGE_TEMPLATES: Record<string, Array<{ title: string; description: string; approvalRequired: boolean }>> = {
  Videography: [
    { title: "Planning", description: "Brief confirmed, shoot dates locked, locations scouted.", approvalRequired: false },
    { title: "Filming", description: "Capture agreed footage on location.", approvalRequired: false },
    { title: "First Edit", description: "First cut uploaded for client review.", approvalRequired: true },
    { title: "Revisions", description: "Agreed amendments following client feedback.", approvalRequired: false },
    { title: "Final Delivery", description: "Final approved files supplied.", approvalRequired: true },
  ],
  Photography: [
    { title: "Planning", description: "Shot list agreed, location confirmed, schedule set.", approvalRequired: false },
    { title: "Shoot", description: "Photography session takes place.", approvalRequired: false },
    { title: "Image Selection", description: "Selects shared for client to choose favourites.", approvalRequired: true },
    { title: "Retouching", description: "Final retouching applied to approved selects.", approvalRequired: false },
    { title: "Final Delivery", description: "Full resolution finals delivered.", approvalRequired: true },
  ],
  "Graphic Design": [
    { title: "Discovery", description: "Brief deep-dive, brand review, references gathered.", approvalRequired: false },
    { title: "Concepts", description: "Initial design directions presented.", approvalRequired: true },
    { title: "Design Development", description: "Chosen concept developed in full.", approvalRequired: false },
    { title: "Revisions", description: "Amends applied following client feedback.", approvalRequired: false },
    { title: "Final Artwork", description: "Production-ready files delivered.", approvalRequired: true },
  ],
  "Social Content": [
    { title: "Content Planning", description: "Content calendar and scripts agreed.", approvalRequired: true },
    { title: "Production", description: "Filming or design work.", approvalRequired: false },
    { title: "First Drafts", description: "First versions shared for review.", approvalRequired: true },
    { title: "Approval", description: "Final amendments and sign-off.", approvalRequired: true },
    { title: "Publishing / Delivery", description: "Content published or final files delivered.", approvalRequired: false },
  ],
  "Web Design": [
    { title: "Discovery", description: "Goals, audience and technical requirements defined.", approvalRequired: false },
    { title: "Wireframes", description: "Page layouts and user flows presented.", approvalRequired: true },
    { title: "Design", description: "Full visual design applied.", approvalRequired: true },
    { title: "Build", description: "Development and testing.", approvalRequired: false },
    { title: "Review", description: "Client walkthrough and final amends.", approvalRequired: true },
    { title: "Launch", description: "Site goes live.", approvalRequired: false },
  ],
};

// ── Reads ──────────────────────────────────────────────────────────────────────

export async function getProjectStages(projectId: number): Promise<schema.ProjectStage[]> {
  return db.select().from(schema.projectStages)
    .where(eq(schema.projectStages.projectId, projectId))
    .orderBy(asc(schema.projectStages.position));
}

export async function getProjectStage(stageId: number): Promise<schema.ProjectStage | undefined> {
  const rows = await db.select().from(schema.projectStages).where(eq(schema.projectStages.id, stageId));
  return rows[0];
}

// ── Writes ─────────────────────────────────────────────────────────────────────

export async function addProjectStage(
  projectId: number,
  createdBy: number,
  data: {
    title: string;
    description?: string;
    expectedDeliverable?: string;
    targetDate?: string;
    approvalRequired?: boolean;
    revisionAllowance?: string;
    notes?: string;
  }
): Promise<schema.ProjectStage> {
  // Get current max position
  const existing = await getProjectStages(projectId);
  if (existing.length >= MAX_STAGES) throw new Error(`Maximum of ${MAX_STAGES} stages allowed`);
  const position = existing.length > 0 ? Math.max(...existing.map(s => s.position)) + 1 : 0;
  const now = new Date().toISOString();
  const rows = await db.insert(schema.projectStages).values({
    projectId,
    position,
    title: data.title,
    description: data.description ?? null,
    expectedDeliverable: data.expectedDeliverable ?? null,
    targetDate: data.targetDate ?? null,
    approvalRequired: data.approvalRequired ? 1 : 0,
    revisionAllowance: data.revisionAllowance ?? "none",
    status: "upcoming",
    createdBy,
    updatedAt: now,
    notes: data.notes ?? null,
  }).returning();
  return rows[0];
}

export async function updateProjectStage(
  stageId: number,
  data: Partial<{
    title: string;
    description: string;
    expectedDeliverable: string;
    targetDate: string;
    approvalRequired: boolean;
    revisionAllowance: string;
    notes: string;
    position: number;
    status: string;
    startedAt: string;
    submittedAt: string;
    approvedAt: string;
    completedAt: string;
    clientChangeRequest: string;
  }>
): Promise<schema.ProjectStage> {
  const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.expectedDeliverable !== undefined) patch.expectedDeliverable = data.expectedDeliverable;
  if (data.targetDate !== undefined) patch.targetDate = data.targetDate;
  if (data.approvalRequired !== undefined) patch.approvalRequired = data.approvalRequired ? 1 : 0;
  if (data.revisionAllowance !== undefined) patch.revisionAllowance = data.revisionAllowance;
  if (data.notes !== undefined) patch.notes = data.notes;
  if (data.position !== undefined) patch.position = data.position;
  if (data.status !== undefined) patch.status = data.status;
  if (data.startedAt !== undefined) patch.startedAt = data.startedAt;
  if (data.submittedAt !== undefined) patch.submittedAt = data.submittedAt;
  if (data.approvedAt !== undefined) patch.approvedAt = data.approvedAt;
  if (data.completedAt !== undefined) patch.completedAt = data.completedAt;
  if (data.clientChangeRequest !== undefined) patch.clientChangeRequest = data.clientChangeRequest;
  const rows = await db.update(schema.projectStages).set(patch).where(eq(schema.projectStages.id, stageId)).returning();
  return rows[0];
}

export async function deleteProjectStage(stageId: number): Promise<void> {
  await db.delete(schema.projectStages).where(eq(schema.projectStages.id, stageId));
}

export async function reorderProjectStages(projectId: number, orderedIds: number[]): Promise<void> {
  // Update each stage's position based on array index
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(schema.projectStages)
      .set({ position: i, updatedAt: new Date().toISOString() })
      .where(and(eq(schema.projectStages.id, orderedIds[i]), eq(schema.projectStages.projectId, projectId)));
  }
}

export async function bulkCreateStages(
  projectId: number,
  createdBy: number,
  stages: Array<{ title: string; description?: string; approvalRequired?: boolean; targetDate?: string; expectedDeliverable?: string; revisionAllowance?: string }>
): Promise<schema.ProjectStage[]> {
  if (stages.length > MAX_STAGES) throw new Error(`Maximum of ${MAX_STAGES} stages allowed`);
  const now = new Date().toISOString();
  const values = stages.map((s, i) => ({
    projectId,
    position: i,
    title: s.title,
    description: s.description ?? null,
    expectedDeliverable: s.expectedDeliverable ?? null,
    targetDate: s.targetDate ?? null,
    approvalRequired: s.approvalRequired ? 1 : 0,
    revisionAllowance: s.revisionAllowance ?? "none",
    status: "upcoming" as const,
    createdBy,
    updatedAt: now,
  }));
  return db.insert(schema.projectStages).values(values).returning();
}

// ── Planning status transitions ────────────────────────────────────────────────

export async function setPlanningStatus(projectId: number, status: string, extra?: { planConfirmedAt?: string; planSentToClientAt?: string }): Promise<void> {
  const patch: Record<string, any> = { planningStatus: status } as any;
  if (extra?.planConfirmedAt) (patch as any).planConfirmedAt = extra.planConfirmedAt;
  if (extra?.planSentToClientAt) (patch as any).planSentToClientAt = extra.planSentToClientAt;
  await db.update(schema.projects).set(patch as any).where(eq(schema.projects.id, projectId));
}

// ── Stage status transitions ───────────────────────────────────────────────────

export async function startStage(stageId: number): Promise<schema.ProjectStage> {
  return updateProjectStage(stageId, { status: "in_progress", startedAt: new Date().toISOString() });
}

export async function submitStageForReview(stageId: number): Promise<schema.ProjectStage> {
  return updateProjectStage(stageId, { status: "awaiting_client", submittedAt: new Date().toISOString() });
}

export async function approveStage(stageId: number): Promise<schema.ProjectStage> {
  return updateProjectStage(stageId, { status: "approved", approvedAt: new Date().toISOString() });
}

export async function completeStage(stageId: number): Promise<schema.ProjectStage> {
  return updateProjectStage(stageId, { status: "completed", completedAt: new Date().toISOString() });
}

export async function requestStageChanges(stageId: number, message: string): Promise<schema.ProjectStage> {
  return updateProjectStage(stageId, { status: "changes_requested", clientChangeRequest: message });
}

// ── Progress calculation (dynamic) ────────────────────────────────────────────

export function calcProgress(stages: schema.ProjectStage[]): number {
  if (stages.length === 0) return 0;
  const completed = stages.filter(s => s.status === "completed" || s.status === "approved").length;
  return Math.round((completed / stages.length) * 100);
}

export function getActiveStage(stages: schema.ProjectStage[]): schema.ProjectStage | undefined {
  return stages.find(s => s.status === "in_progress" || s.status === "awaiting_client" || s.status === "changes_requested");
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function logStageEvent(
  projectId: number,
  actorId: number,
  eventType: string,
  note?: string,
  stageId?: number
): Promise<void> {
  await db.insert(schema.projectStageEvents).values({
    projectId,
    stageId: stageId ?? null,
    eventType,
    actorId,
    note: note ?? null,
    createdAt: new Date().toISOString(),
  });
}
