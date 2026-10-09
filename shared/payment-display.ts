/** Only settled payments contribute earned income. Refund adjustments use Stripe's ledger. */
export function hasSettledPayment(status: string): boolean {
  return ['succeeded', 'partially_refunded', 'refunded'].includes(status);
}
export function paymentStatusLabel(status?: string | null): string {
  if (!status) return 'Unknown';
  const labels: Record<string, string> = {
    succeeded: 'Paid', partially_refunded: 'Partially refunded', refunded: 'Refunded',
    canceled: 'Cancelled', cancelled: 'Cancelled', failed: 'Failed',
    requires_payment_method: 'Awaiting payment', requires_action: 'Action required',
    processing: 'Processing', pending: 'Pending', authorised: 'Authorised',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}
