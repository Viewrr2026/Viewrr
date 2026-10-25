import type { RetainerDb } from './retainer-v1-db';
import { retainerError } from './retainer-v1-db';
import { assertProjectParty } from './project-access';
import { lockAgreement, requireWork, event } from './retainer-v1-service';
import { requirePrivateMedia } from './retainer-v1-media';

export async function authorizeMediaUpload(db: RetainerDb, scope: string, context: any, userId: number): Promise<number | null> {
  if (['profile', 'portfolio', 'feed'].includes(scope)) return null;
  requirePrivateMedia();
  if (scope === 'delivery') {
    if (!Number.isSafeInteger(context.projectId) || context.projectId < 1) retainerError('Choose a project.', 400);
    const { project, role } = await assertProjectParty(context.projectId, userId);
    if (project.isRetainer === 1) retainerError('Upload retainer work from its cycle workspace.', 400);
    if (role !== 'freelancer' || ['completed', 'cancelled'].includes(project.status)) retainerError('This project is not open for freelancer uploads.', 403);
    return project.id;
  }
  if (scope === 'cycle') {
    const task = (await db.query(`SELECT t.id,t.status,c.status AS cycle_status,a.freelancer_id,a.workflow_version FROM retainer_cycle_tasks t JOIN retainer_cycles c ON c.id=t.retainer_cycle_id JOIN retainer_agreements a ON a.id=c.retainer_agreement_id WHERE a.public_id=$1 AND t.public_id=$2`, [context.retainerId, context.taskId])).rows[0];
    if (!task || task.freelancer_id !== userId || task.workflow_version === 1 || task.status === 'complete' || !['active', 'due', 'awaiting_payment'].includes(task.cycle_status)) retainerError('This work item is not open for uploads.', 403);
    return task.id;
  }
  const a = await lockAgreement(db, context.retainerId, userId);
  if (userId !== a.freelancer_id) retainerError('Only the freelancer can upload work.', 403);
  const task = (await db.query(`SELECT t.* FROM retainer_cycle_tasks t JOIN retainer_cycles c ON c.id=t.retainer_cycle_id WHERE t.public_id=$1 AND c.retainer_agreement_id=$2`, [context.taskId, a.id])).rows[0];
  if (!task) retainerError('Work item not found.', 404);
  const latest = (await db.query('SELECT status FROM retainer_work_item_submissions WHERE retainer_cycle_task_id=$1 ORDER BY version DESC LIMIT 1', [task.id])).rows[0];
  if (task.status === 'complete' || ['submitted', 'approved'].includes(latest?.status)) retainerError('Wait for client feedback before uploading another version.');
  await requireWork(db, a, task.retainer_cycle_id);
  await db.query('UPDATE retainer_cycles SET started_at=COALESCE(started_at,$2) WHERE id=$1', [task.retainer_cycle_id, new Date().toISOString()]);
  return task.id;
}
export async function publishCustomUpload(db: RetainerDb, row: any) {
  const { mediaId, retainerId } = row.upload_context;
  await db.query(`INSERT INTO retainer_media(id,task_id,uploaded_by,original_key,filename,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [mediaId, row.resource_id, row.owner_user_id, row.object_key, row.original_filename, row.mime_type, row.size_bytes]);
  const a = await lockAgreement(db, retainerId, row.owner_user_id);
  await event(db, a, row.owner_user_id, `upload:${mediaId}`, 'media_uploaded', { taskId: row.resource_id, mediaId });
}
