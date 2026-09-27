import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  customRetainerSchema,
  cycleAccess,
  canAccessOriginal,
  nextDate,
  scheduleGaps,
  type CycleState,
} from "../../shared/retainer-v1";
const c = (n: number, patch: Partial<CycleState> = {}): CycleState => ({
  id: n,
  cycle_number: n,
  period_start: "2026-09-01",
  period_end: "2026-12-31",
  accepted_at: null,
  paid_at: null,
  due_at: null,
  payment_days: 5,
  ...patch,
});
const now = new Date("2026-09-26T12:00:00Z");
const pending = c(1, {
  accepted_at: "2026-09-25T12:00:00Z",
  due_at: "2026-09-30T12:00:00Z",
});
test("one subsequent cycle within terms; no third-cycle credit", () => {
  const second = c(2),
    third = c(3);
  assert.equal(
    cycleAccess([pending, second, third], second, "active", now).canWork,
    true,
  );
  assert.equal(
    cycleAccess(
      [
        pending,
        c(2, {
          accepted_at: now.toISOString(),
          due_at: "2026-10-01T12:00:00Z",
        }),
        third,
      ],
      third,
      "active",
      now,
    ).canWork,
    false,
  );
});
test("due-time boundary freezes without a scheduler; zero-day terms never grant credit", () => {
  const second = c(2);
  assert.equal(
    cycleAccess([pending, second], second, "active", new Date(pending.due_at!))
      .state,
    "frozen",
  );
  assert.equal(
    cycleAccess(
      [{ ...pending, payment_days: 0 }, second],
      second,
      "active",
      now,
    ).canWork,
    false,
  );
  assert.equal(
    cycleAccess([c(1), second], second, "active", now).canWork,
    false,
  );
});
test("payment clears only financial restrictions and cannot silently extend schedule", () => {
  const first = c(1, { paid_at: now.toISOString() }),
    second = c(2);
  assert.equal(
    cycleAccess([first, second], second, "paused", now).canWork,
    false,
  );
  assert.equal(
    cycleAccess(
      [first, { ...second, period_end: "2026-09-25" }],
      { ...second, period_end: "2026-09-25" },
      "active",
      now,
    ).state,
    "schedule_delay",
  );
  assert.equal(
    cycleAccess([first, second], second, "active", now).canWork,
    true,
  );
});
test("accepted is not completed, and original access requires a verified payment state", () => {
  assert.equal(
    cycleAccess([pending], pending, "active", now).state,
    "awaiting_payment",
  );
  assert.equal(canAccessOriginal(null, "succeeded"), false);
  assert.equal(canAccessOriginal(now.toISOString(), "pending"), false);
  assert.equal(canAccessOriginal(now.toISOString(), "refunded"), false);
  assert.equal(canAccessOriginal(now.toISOString(), "succeeded"), true);
});
test("calendar dates, overlaps, gaps and duplicate identifiers are validated", () => {
  const plan = {
    title: "Social production",
    startDate: "2028-02-01",
    endDate: "2028-02-29",
    gapsAcknowledged: false,
    cycles: [
      {
        id: randomUUID(),
        name: "February",
        startDate: "2028-02-01",
        endDate: "2028-02-29",
        amountPence: 200000,
        revisionAllowance: 2,
        paymentDays: 5,
        deliverables: [
          { id: randomUUID(), name: "TikTok", quantity: 12, brief: "" },
        ],
      },
    ],
  };
  assert.equal(nextDate("2028-02-28"), "2028-02-29");
  assert.equal(customRetainerSchema.safeParse(plan).success, true);
  assert.equal(
    customRetainerSchema.safeParse({ ...plan, endDate: "2026-02-29" }).success,
    false,
  );
  const gap = {
    ...plan,
    cycles: [{ ...plan.cycles[0], endDate: "2028-02-20" }],
  };
  assert.equal(scheduleGaps(gap).length, 1);
  assert.equal(customRetainerSchema.safeParse(gap).success, false);
  assert.equal(
    customRetainerSchema.safeParse({ ...gap, gapsAcknowledged: true }).success,
    true,
  );
  assert.equal(
    customRetainerSchema.safeParse({
      ...plan,
      cycles: [...plan.cycles, ...plan.cycles],
    }).success,
    false,
  );
});
