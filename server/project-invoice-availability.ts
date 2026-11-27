import { projectInvoiceAvailability, type InvoiceProject, type ProjectInvoice } from "../shared/project-invoice-availability";
import { retainerPool, type RetainerDb } from "./retainer-v1-db";

/** Read current server-owned stages; callers authorize project membership first. */
export async function loadProjectInvoiceAvailability(
  project: InvoiceProject,
  invoice: ProjectInvoice | null | undefined,
  viewerId: number,
  db: RetainerDb = retainerPool(),
) {
  const stages = project.planningStatus === "confirmed" && !project.isRetainer
    ? (await db.query('SELECT position, status FROM project_stages WHERE project_id=$1 ORDER BY position', [project.id])).rows
    : [];
  return projectInvoiceAvailability(project, stages as { position: number; status: string }[], invoice, viewerId);
}
