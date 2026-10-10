import { test } from "node:test";
import assert from "node:assert/strict";
import { retainerProgress } from "../../shared/retainer-progress";

test("whole-retainer progress includes future work and counts paid approvals", () => {
  const data = {
    cycles: [
      { id: 1, amount_pence: 100000, accepted_at: "2026-10-09T17:00:00Z", paid_at: "2026-10-09T20:00:00Z", period_end: "2026-10-16" },
      { id: 2, amount_pence: 100000, period_end: "2026-12-04" },
    ],
    tasks: Array.from({length: 8}, (_, i) => ({ status: i < 4 ? "complete" : "pending" })),
    refundHistory: [{ status: "succeeded", amount_pence: 400 }, {status:"failed",amount_pence:500}],
  };
  const p = retainerProgress(data, new Date("2026-10-09T20:30:00Z"));
  assert.equal(p.completedCycles, 1);
  assert.equal(p.totalCycles, 2);
  assert.equal(p.progress, 50);
  assert.equal(p.onTimeRate, 100);
  assert.equal(p.measuredCycles, 1);
  assert.equal(p.paid, 100000);
  assert.equal(p.refunded, 400);
  assert.equal(p.nextCycle.id, 2);
  assert.equal(p.satisfaction, null);
});

test("overdue unapproved cycles count against timeliness; payment is not approval", () => {
  const p = retainerProgress({ cycles: [
    {amount_pence:100,period_end:"2026-10-01",accepted_at:null},
    {amount_pence:100,period_end:"2026-10-01",accepted_at:"2026-10-02T10:00:00Z"},
    {amount_pence:100,period_end:"2026-10-20",paid_at:"2026-10-02T10:00:00Z"},
  ] }, new Date("2026-10-09T12:00:00Z"));
  assert.equal(p.onTimeRate, 0);
  assert.equal(p.measuredCycles, 2);
  assert.equal(p.completedCycles, 0);
  assert.equal(p.awaitingPayment, 1);
});

test("timeliness respects London midnight and no-data metrics remain unavailable", () => {
  assert.equal(retainerProgress({}).onTimeRate, null);
  const p = retainerProgress({ cycles: [
    {amount_pence:100,period_end:"2026-10-09",accepted_at:"2026-10-09T23:30:00Z"},
  ], satisfaction:[{score:4},{score:5}] }, new Date("2026-10-10T12:00:00Z"));
  assert.equal(p.onTimeRate, 0);
  assert.equal(p.satisfaction, 4.5);
});
