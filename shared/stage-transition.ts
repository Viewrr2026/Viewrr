export type StageAction = 'start' | 'submit' | 'approve' | 'complete' | 'request-changes';
type Stage = { id: number; position: number; status: string; approvalRequired: number; revisionAllowance: string };
export function stageTransitionError(project: { status: string; planningStatus: string; isRetainer: number; deletedAt?: unknown }, stage: Stage, stages: Stage[], action: StageAction): string | null {
  if (project.deletedAt || project.isRetainer || project.status !== 'active' || project.planningStatus !== 'confirmed') return 'This project is not active with a confirmed stage plan.';
  if (stages.some(s => s.position < stage.position && !['approved', 'completed'].includes(s.status))) return 'Finish the earlier stages first.';
  if (action === 'start') return stage.status === 'upcoming' ? null : 'This stage has already started.';
  if (action === 'submit') return ['in_progress', 'changes_requested'].includes(stage.status) ? null : 'Only work in progress can be submitted.';
  if (action === 'approve' || action === 'request-changes') {
    if (stage.status !== 'awaiting_client') return 'This stage is not awaiting client review.';
    if (action === 'request-changes' && ['', 'none', '0'].includes(stage.revisionAllowance.trim().toLowerCase())) return 'No revisions are included. Message your freelancer to agree changes.';
    return null;
  }
  if (stage.approvalRequired) return 'This stage requires client approval. Submit it for review.';
  return ['in_progress', 'changes_requested'].includes(stage.status) ? null : 'Only work in progress can be completed.';
}
