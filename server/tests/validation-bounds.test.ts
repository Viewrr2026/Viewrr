import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { estimateSchema, calculateEstimate } from "../../shared/project-estimate";
import { customCycleSchema, customRetainerSchema } from "../../shared/retainer-v1";

const item = () => ({ id: randomUUID(), name: "Film", quantity: 1, brief: "" });
const cycle = () => ({
  id: randomUUID(), name: "November", startDate: "2026-11-01", endDate: "2026-11-30",
  amountPence: 10000, revisionAllowance: 2, paymentDays: 5, deliverables: [item()],
});
const plan = () => ({
  title: "Monthly production", startDate: "2026-11-01", endDate: "2026-11-30",
  gapsAcknowledged: false, cycles: [cycle()],
});

function oversized() {
  const input = new Array(100_000).fill(null);
  // An oversized collection must be rejected without even reading its first
  // element, not merely return fewer errors after doing all the work.
  Object.defineProperty(input, 0, { get() { throw new Error("visited oversized input"); } });
  return input;
}

test("estimate limits reject oversized input before visiting invalid items", () => {
  const result = estimateSchema.safeParse({ lineItems: oversized() });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, "too_big");
  assert.deepEqual(result.error.issues[0].path, ["lineItems"]);
});

test("retainer limits stop oversized cycles, groups and briefs before element validation", () => {
  const cases = [
    [customRetainerSchema, { ...plan(), cycles: oversized() }, ["cycles"]],
    [customCycleSchema, { ...cycle(), deliverables: oversized() }, ["deliverables"]],
    [customCycleSchema, { ...cycle(), deliverables: [{ ...item(), itemBriefs: oversized() }] }, ["deliverables", 0, "itemBriefs"]],
  ] as const;
  for (const [schema, input, path] of cases) {
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    if (result.success) continue;
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
    assert.deepEqual(result.error.issues[0].path, path);
  }
});

test("many individually bounded brief arrays cannot multiply validation work", () => {
  const briefs = new Array(200).fill(null);
  Object.defineProperty(briefs, 0, { get() { throw new Error("visited multiplied input"); } });
  const input = { ...plan(), cycles: [{ ...cycle(), deliverables:
    Array.from({ length: 11 }, () => ({ ...item(), quantity: 200, itemBriefs: briefs })),
  }] };
  const result = customRetainerSchema.safeParse(input);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.issues.length, 1);
  assert.match(result.error.issues[0].message, /2,000/);
});

test("existing maximum estimate and retainer sizes still validate and retain their values", () => {
  const estimate = calculateEstimate({ lineItems: Array.from({ length: 100 }, (_, i) => ({
    description: `Item ${i + 1}`, quantity: 1, unitPricePence: 100,
  })), vatPercent: 20 });
  assert.equal(estimate.lineItems.length, 100);
  assert.equal(estimate.totalPence, 12000);

  const input = { ...plan(), cycles: [{ ...cycle(), deliverables:
    Array.from({ length: 10 }, () => ({ ...item(), quantity: 200, itemBriefs: new Array(200).fill("  Film brief  ") })),
  }] };
  const parsed = customRetainerSchema.parse(input);
  assert.equal(parsed.cycles[0].deliverables.length, 10);
  assert.deepEqual(parsed.cycles[0].deliverables[0].itemBriefs, new Array(200).fill("Film brief"));
  assert.equal(customCycleSchema.safeParse({ ...cycle(), deliverables: Array.from({ length: 50 }, item) }).success, true);
});

test("52 ordered cycles remain valid and non-arrays or empty required arrays are rejected", () => {
  const cycles = Array.from({ length: 52 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
    return { ...cycle(), startDate: date, endDate: date };
  });
  assert.equal(customRetainerSchema.safeParse({ ...plan(), startDate: cycles[0].startDate,
    endDate: cycles[51].endDate, cycles }).success, true);
  for (const invalid of [null, "items", {}, []]) {
    assert.equal(estimateSchema.safeParse({ lineItems: invalid }).success, false);
    assert.equal(customRetainerSchema.safeParse({ ...plan(), cycles: invalid }).success, false);
  }
  assert.equal(customCycleSchema.safeParse({ ...cycle(), deliverables: [{ ...item(), itemBriefs: [] }] }).success, true);
});
