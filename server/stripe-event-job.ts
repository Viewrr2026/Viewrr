import type Stripe from 'stripe';

const REFUND_EVENTS = new Set(['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'application_fee.refunded', 'transfer.reversed']);
type EventRow = { stripe_event_id: string; processing_status: string; raw_payload: string | null; event_type: string };
interface Dependencies {
  query: (sql: string, values: any[]) => Promise<EventRow[]>;
  retrieve: (id: string) => Promise<Stripe.Event>;
  process: (event: Stripe.Event, requestId: string) => Promise<void>;
  mark: (id: string, error?: string) => Promise<void>;
}

/** Explicit refund replay is safe: its handler reconciles current Stripe state under a lock.
 * Other already-processed events remain deduplicated to avoid repeating side effects.
 */
export async function runStripeEventJob(payload: Record<string, unknown>, attempt: number, deps: Dependencies) {
  const id = payload.stripeEventId;
  if (typeof id !== 'string' || !id.startsWith('evt_')) throw new Error('Invalid Stripe event ID');
  const [row] = await deps.query('SELECT stripe_event_id, processing_status, raw_payload, event_type FROM stripe_events WHERE stripe_event_id = $1 LIMIT 1', [id]);
  if (!row) throw new Error('Stripe event not found');
  const refundReplay = payload.replay === true && REFUND_EVENTS.has(row.event_type);
  if (row.processing_status === 'processed' && !refundReplay) return;
  try {
    const event = row.raw_payload ? JSON.parse(row.raw_payload) as Stripe.Event : await deps.retrieve(id);
    if (event.id !== id || event.type !== row.event_type) throw new Error('Stripe event does not match stored event');
    await deps.process(event, `job_${id}_attempt${attempt}`);
    await deps.mark(id);
  } catch (error: any) {
    await deps.mark(id, error.message);
    throw error;
  }
}
