/** UI restriction only; server ownership/cycle/payment checks remain authoritative. */
export function canUploadRetainer(freelancer: boolean, canWork: boolean, taskStatus: string, submissionStatus?: string) {
  return freelancer && canWork && !["complete", "done", "awaiting_client_review"].includes(taskStatus)
    && !["submitted", "approved"].includes(submissionStatus ?? "");
}
