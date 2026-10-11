import { stageTransitionError, type StageAction } from '../shared/stage-transition';
import type { RetainerDb } from './retainer-v1-db';
const camel = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
/** Caller owns the transaction. Lock project first to serialize timeline actions. */
export async function applyStageTransition(db: RetainerDb, stageId: number, action: StageAction, message = '') {
  const { rows: [initial] } = await db.query('SELECT project_id FROM project_stages WHERE id=$1', [stageId]);
  if (!initial) throw new Error('Stage not found');
  const { rows: [rawProject] } = await db.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [initial.project_id]);
  if (!rawProject) throw new Error('Project not found');
  const { rows } = await db.query('SELECT * FROM project_stages WHERE project_id=$1 ORDER BY position', [initial.project_id]);
  const stages = rows.map(camel), stage = stages.find(s => s.id === stageId);
  if (!stage) throw new Error('Stage not found');
  const error = stageTransitionError(camel(rawProject) as any, stage as any, stages as any, action);
  if (error) throw new Error(error);
  const states = { start: 'in_progress', submit: 'awaiting_client', approve: 'approved', complete: 'completed', 'request-changes': 'changes_requested' };
  const timestamps = { start: 'started_at', submit: 'submitted_at', approve: 'approved_at', complete: 'completed_at', 'request-changes': 'updated_at' };
  const now = new Date().toISOString(), timestamp = timestamps[action];
  const extra = action === 'submit' ? ', client_change_request=NULL' : action === 'request-changes' ? ', client_change_request=$4' : '';
  const args: unknown[] = [stageId, states[action], now];
  if (action === 'request-changes') { if (!message.trim()) throw new Error('Describe the changes required'); args.push(message.trim()); }
  const { rows: [updated] } = await db.query(`UPDATE project_stages SET status=$2, updated_at=$3${timestamp === 'updated_at' ? '' : `, ${timestamp}=$3`}${extra} WHERE id=$1 RETURNING *`, args);
  return camel(updated);
}
export async function confirmStagePlan(db: RetainerDb, projectId: number, freelancerId: number) {
  const { rows: [project] } = await db.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
  if (!project || project.freelancer_id !== freelancerId) throw new Error('Not authorised');
  if (project.deleted_at || project.is_retainer || !['active', 'planning'].includes(project.status)) throw new Error('This project cannot be started');
  if (project.planning_status === 'confirmed') return { status: 'confirmed' };
  const { rows: stages } = await db.query('SELECT * FROM project_stages WHERE project_id=$1 ORDER BY position', [projectId]);
  if (!stages.length) throw new Error('Add at least one stage before confirming');
  if (stages.some(s => s.status !== 'upcoming')) throw new Error('This timeline has already started');
  const { rows: [estimate] } = await db.query('SELECT status FROM project_estimate_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [projectId]);
  if (estimate && estimate.status !== 'accepted') throw new Error('Agree the latest estimate before progressing work.');
  const now = new Date().toISOString();
  await db.query("UPDATE projects SET planning_status='confirmed', status='active', plan_confirmed_at=$2 WHERE id=$1", [projectId, now]);
  await applyStageTransition(db, stages[0].id, 'start');
  await db.query("INSERT INTO project_stage_events(project_id,actor_id,event_type,created_at) VALUES($1,$2,'plan_confirmed',$3)", [projectId, freelancerId, now]);
  return { status: 'confirmed' };
}
