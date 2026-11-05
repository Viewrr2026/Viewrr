import { uuid } from "expo-modules-core";
import type { RetainerPlan, RetainerCycle } from "@/api/retainerProposals";
import { gbpToPence, isCalendarDate } from "@/lib/workInputs";

export type DraftGroup = {
  id: string;
  name: string;
  quantity: string;
  brief: string;
  itemBriefs: string;
};
export type DraftCycle = Omit<
  RetainerCycle,
  "amountPence" | "revisionAllowance" | "paymentDays" | "deliverables"
> & {
  price: string;
  revisions: string;
  days: string;
  deliverables: DraftGroup[];
};
export type RetainerDraft = Omit<RetainerPlan, "cycles"> & {
  cycles: DraftCycle[];
};
export const newGroup = (): DraftGroup => ({
  id: uuid.v4(),
  name: "",
  quantity: "1",
  brief: "",
  itemBriefs: "",
});
export const newCycle = (): DraftCycle => ({
  id: uuid.v4(),
  name: "",
  startDate: "",
  endDate: "",
  price: "",
  revisions: "2",
  days: "5",
  deliverables: [newGroup()],
});
export function draftFrom(plan?: RetainerPlan): RetainerDraft {
  if (!plan)
    return {
      title: "",
      startDate: "",
      endDate: "",
      gapsAcknowledged: false,
      cycles: [newCycle()],
    };
  return {
    ...plan,
    cycles: plan.cycles.map(
      ({
        amountPence,
        revisionAllowance,
        paymentDays,
        deliverables,
        ...cycle
      }) => ({
        ...cycle,
        price: (amountPence / 100).toFixed(2),
        revisions: String(revisionAllowance),
        days: String(paymentDays),
        deliverables: deliverables.map((group) => ({
          ...group,
          quantity: String(group.quantity),
          itemBriefs: group.itemBriefs?.join("\n") ?? "",
        })),
      }),
    ),
  };
}
function integer(value: string, min: number, max: number, label: string) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return Number(value);
}
export function nextDate(date: string, days = 1) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return Number.isFinite(value.getTime())
    ? value.toISOString().slice(0, 10)
    : "";
}
export function scheduleGaps(
  plan: Pick<RetainerPlan, "startDate" | "endDate"> & {
    cycles: Pick<RetainerCycle, "startDate" | "endDate">[];
  },
) {
  let cursor = plan.startDate;
  const gaps: string[] = [];
  if (!isCalendarDate(cursor) || !isCalendarDate(plan.endDate)) return gaps;
  for (const cycle of plan.cycles) {
    if (!isCalendarDate(cycle.startDate) || !isCalendarDate(cycle.endDate))
      continue;
    if (cycle.startDate > cursor)
      gaps.push(`${cursor} to ${nextDate(cycle.startDate, -1)}`);
    cursor = nextDate(cycle.endDate);
  }
  if (cursor && cursor <= plan.endDate)
    gaps.push(`${cursor} to ${plan.endDate}`);
  return gaps;
}
export function planFrom(draft: RetainerDraft): RetainerPlan {
  if (!draft.title.trim() || draft.title.trim().length > 160)
    throw new Error("Enter a retainer title of up to 160 characters.");
  if (
    !isCalendarDate(draft.startDate) ||
    !isCalendarDate(draft.endDate) ||
    draft.endDate < draft.startDate
  )
    throw new Error("Enter valid retainer dates in order, using YYYY-MM-DD.");
  let outputs = 0;
  const cycles = draft.cycles.map((cycle, index): RetainerCycle => {
    if (!cycle.name.trim() || cycle.name.trim().length > 120)
      throw new Error(
        `Add a name of up to 120 characters for cycle ${index + 1}.`,
      );
    if (
      !isCalendarDate(cycle.startDate) ||
      !isCalendarDate(cycle.endDate) ||
      cycle.startDate < draft.startDate ||
      cycle.endDate > draft.endDate ||
      cycle.endDate < cycle.startDate
    ) {
      throw new Error(
        `Cycle ${index + 1} must have valid dates within the retainer.`,
      );
    }
    if (
      index &&
      cycle.startDate <= draft.cycles[index - 1]!.endDate &&
      !cycle.earlyStart
    )
      throw new Error("Cycles must be in order without overlapping.");
    const amountPence = gbpToPence(cycle.price);
    if (amountPence < 50 || amountPence > 10_000_000)
      throw new Error("Each cycle must cost between £0.50 and £100,000.");
    const deliverables = cycle.deliverables.map((group) => {
      if (!group.name.trim() || group.name.trim().length > 120)
        throw new Error(
          "Each deliverable needs a name of up to 120 characters.",
        );
      const quantity = integer(group.quantity, 1, 200, "Quantity");
      const itemBriefs = group.itemBriefs
        ? group.itemBriefs.split("\n").map((line) => line.trim())
        : undefined;
      if (itemBriefs && itemBriefs.length > quantity)
        throw new Error(
          "Remove extra item briefs before reducing the quantity.",
        );
      if (
        group.brief.length > 5000 ||
        itemBriefs?.some((line) => line.length > 5000)
      )
        throw new Error("Each brief must be at most 5,000 characters.");
      outputs += quantity;
      return {
        id: group.id,
        name: group.name.trim(),
        quantity,
        brief: group.brief.trim(),
        ...(itemBriefs ? { itemBriefs } : {}),
      };
    });
    if (!deliverables.length || deliverables.length > 50)
      throw new Error("Each cycle needs between 1 and 50 deliverable groups.");
    return {
      id: cycle.id,
      name: cycle.name.trim(),
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      amountPence,
      revisionAllowance: integer(cycle.revisions, 0, 100, "Revisions"),
      paymentDays: integer(cycle.days, 0, 365, "Payment days"),
      ...(cycle.earlyStart !== undefined
        ? { earlyStart: cycle.earlyStart }
        : {}),
      deliverables,
    };
  });
  if (!cycles.length || cycles.length > 52)
    throw new Error("A retainer needs between 1 and 52 cycles.");
  if (outputs > 2000)
    throw new Error("A retainer can contain at most 2,000 individual outputs.");
  const plan = {
    title: draft.title.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate,
    gapsAcknowledged: draft.gapsAcknowledged,
    cycles,
  };
  if (scheduleGaps(plan).length && !plan.gapsAcknowledged)
    throw new Error("Resolve or acknowledge the unallocated dates.");
  return plan;
}
