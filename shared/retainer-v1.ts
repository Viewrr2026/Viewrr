import { z } from "zod";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid calendar date");
const identifier = z.string().uuid();
export const customCycleSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(120),
  startDate: dateOnly,
  endDate: dateOnly,
  amountPence: z.number().int().min(50).max(10_000_000),
  revisionAllowance: z.number().int().min(0).max(100),
  paymentDays: z.number().int().min(0).max(365),
  deliverables: z
    .array(
      z.object({
        id: identifier,
        name: z.string().trim().min(1).max(120),
        quantity: z.number().int().min(1).max(200),
        brief: z.string().trim().max(5000).default(""),
        itemBriefs: z.array(z.string().trim().max(5000)).max(200).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export const customRetainerSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    startDate: dateOnly,
    endDate: dateOnly,
    gapsAcknowledged: z.boolean().default(false),
    cycles: z.array(customCycleSchema).min(1).max(52),
  })
  .superRefine((plan, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (plan.endDate < plan.startDate)
      problem("End date must follow the start date");
    const ids = new Set<string>();
    let total = 0;
    plan.cycles.forEach((cycle, i) => {
      if (ids.has(cycle.id)) problem("Cycle identifiers must be unique");
      ids.add(cycle.id);
      if (
        cycle.endDate < cycle.startDate ||
        cycle.startDate < plan.startDate ||
        cycle.endDate > plan.endDate
      ) {
        problem(`Cycle ${i + 1} must fit within the retainer dates`);
      }
      if (i && cycle.startDate <= plan.cycles[i - 1].endDate)
        problem("Cycles must be in order and cannot overlap");
      cycle.deliverables.forEach((d) => {
        if (ids.has(d.id))
          problem("Deliverable group identifiers must be unique");
        ids.add(d.id);
        if (d.itemBriefs && d.itemBriefs.length > d.quantity)
          problem("Remove extra item briefs before reducing the quantity");
        total += d.quantity;
      });
    });
    if (total > 2000)
      problem("A retainer can contain at most 2,000 individual outputs");
    if (scheduleGaps(plan).length && !plan.gapsAcknowledged)
      problem("Resolve or acknowledge the unallocated dates");
  });
export type CustomRetainerPlan = z.infer<typeof customRetainerSchema>;
export type CustomCyclePlan = z.infer<typeof customCycleSchema>;
export function nextDate(date: string, days = 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}
export function scheduleGaps(plan: {
  startDate: string;
  endDate: string;
  cycles: { startDate: string; endDate: string }[];
}): string[] {
  if (!plan.startDate || !plan.endDate) return [];
  let cursor = plan.startDate;
  const gaps: string[] = [];
  for (const cycle of plan.cycles) {
    if (!cycle.startDate || !cycle.endDate) continue;
    if (cycle.startDate > cursor)
      gaps.push(`${cursor} to ${nextDate(cycle.startDate, -1)}`);
    cursor = nextDate(cycle.endDate);
  }
  if (cursor && cursor <= plan.endDate)
    gaps.push(`${cursor} to ${plan.endDate}`);
  return gaps;
}
export type CycleState = {
  id: number;
  cycle_number: number;
  period_start: string;
  period_end: string;
  accepted_at: string | null;
  paid_at: string | null;
  due_at: string | null;
  payment_days: number;
  started_at?: string | null;
};
export function londonDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function cycleAccess(
  cycles: CycleState[],
  cycle: CycleState,
  agreementStatus: string,
  now = new Date(),
) {
  if (cycle.paid_at)
    return {
      canWork: false,
      state: "completed_paid",
      reason: "Completed — paid",
    };
  if (agreementStatus !== "active")
    return {
      canWork: false,
      state: "locked",
      reason: "The agreement is not active",
    };
  const previous = cycles
    .filter((c) => c.cycle_number < cycle.cycle_number)
    .sort((a, b) => a.cycle_number - b.cycle_number);
  const unpaid = previous.filter((c) => !c.paid_at);
  if (
    unpaid.some(
      (c) =>
        c.accepted_at &&
        c.due_at &&
        new Date(c.due_at).getTime() <= now.getTime(),
    )
  ) {
    return {
      canWork: false,
      state: "frozen",
      reason: "An earlier cycle payment is overdue",
    };
  }
  if (
    unpaid.length > 1 ||
    unpaid.some((c) => !c.accepted_at || !c.due_at || c.payment_days === 0)
  ) {
    return {
      canWork: false,
      state: "locked",
      reason: "An earlier cycle must be approved or paid first",
    };
  }
  if (cycle.accepted_at)
    return {
      canWork: false,
      state:
        cycle.due_at && new Date(cycle.due_at) <= now
          ? "overdue"
          : "awaiting_payment",
      reason: "Approved — awaiting payment",
    };
  if (londonDate(now) < cycle.period_start)
    return {
      canWork: false,
      state: "scheduled",
      reason: "The agreed start date has not been reached",
    };
  if (londonDate(now) > cycle.period_end)
    return {
      canWork: false,
      state: "schedule_delay",
      reason: "Agree revised dates before continuing this cycle",
    };
  return { canWork: true, state: "in_progress", reason: "In progress" };
}
export function canAccessOriginal(
  paidAt: string | null,
  paymentStatus: string | null,
): boolean {
  return (
    !!paidAt &&
    ["succeeded", "partially_refunded"].includes(paymentStatus ?? "")
  );
}
