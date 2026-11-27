export type InvoiceProject = {
  id: number;
  clientId: number;
  freelancerId: number;
  status: string;
  planningStatus: string;
  currentStage: number;
  isRetainer?: number | null;
  paymentStatus?: string | null;
  deletedAt?: string | null;
};
export type InvoiceStage = { position: number; status: string };
export type ProjectInvoice = { status: string; totalPence: number };
export type InvoiceAvailability = {
  phase: "before_final" | "final" | "submitted" | "changes_requested" | "closed" | "retainer";
  canIssue: boolean;
  canView: boolean;
  canPay: boolean;
  message: string | null;
};

/** An agreed price or an early preview is not a final submission. */
export function projectInvoiceAvailability(
  project: InvoiceProject,
  stages: readonly InvoiceStage[],
  invoice: ProjectInvoice | null | undefined,
  viewerId: number,
): InvoiceAvailability {
  const client = viewerId === project.clientId;
  const freelancer = viewerId === project.freelancerId;
  const paid = project.paymentStatus === "paid" || invoice?.status === "paid";
  const closed = !!project.deletedAt || ["cancelled", "deleted"].includes(project.status);
  let phase: InvoiceAvailability["phase"] = "before_final";

  if (closed) phase = "closed";
  else if (project.isRetainer === 1) phase = "retainer"; // Cycle acceptance has its own rules.
  else if (project.status === "completed") phase = "submitted";
  else if (project.planningStatus === "legacy") {
    // Original timeline: 0–4 are production/revisions; 5 is Final Delivery.
    if (project.currentStage >= 5) phase = project.status === "awaiting_payment" ? "submitted" : "final";
  } else if (project.planningStatus === "confirmed" && stages.length) {
    const ordered = [...stages].sort((a, b) => a.position - b.position);
    const final = ordered[ordered.length - 1]!;
    const earlierComplete = ordered.slice(0, -1).every(s => ["approved", "completed"].includes(s.status));
    if (earlierComplete) {
      if (["awaiting_client", "approved", "completed"].includes(final.status)) phase = "submitted";
      else if (final.status === "changes_requested") phase = "changes_requested";
      else if (final.status === "in_progress") phase = "final";
    }
  }

  const invoiceWindow = ["final", "submitted", "changes_requested", "retainer"].includes(phase);
  const canView = !!invoice && (client || freelancer) &&
    (paid || closed || phase === "retainer" || phase === "submitted" || phase === "changes_requested" || (freelancer && phase === "final"));
  const canIssue = freelancer && !closed && !paid && !invoice && invoiceWindow;
  const canPay = client && !closed && !paid && (phase === "submitted" || phase === "retainer") &&
    invoice?.status === "sent" && invoice.totalPence > 0;
  let message: string | null = null;
  if (closed) message = "This project is closed. Its invoice history remains available.";
  else if (paid) message = "Payment has been confirmed.";
  else if (phase === "before_final" || (phase === "final" && client)) message = "Your invoice will be available when the final work is submitted.";
  else if (phase === "changes_requested") message = "Changes have been requested. Payment will be available when the final work is resubmitted.";
  else if (phase === "final" && freelancer) message = invoice
    ? "Submit the final work to make this invoice available to your client."
    : "Create the invoice for your final submission.";
  else if (phase === "submitted" && !invoice) message = freelancer
    ? "Create the invoice for your final submission."
    : "Final work has been submitted. Waiting for your freelancer’s invoice.";
  else if (invoice?.status === "cancelled") message = "This invoice has been cancelled.";
  return { phase, canIssue, canView, canPay, message };
}
