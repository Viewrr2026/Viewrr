import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { projectInvoiceAvailability, type InvoiceProject } from "../../shared/project-invoice-availability";
import { loadProjectInvoiceAvailability } from "../project-invoice-availability";

const project: InvoiceProject = {
  id: 28, clientId: 8, freelancerId: 42, status: "active",
  planningStatus: "confirmed", currentStage: 0, paymentStatus: "unpaid", isRetainer: 0,
};
const invoice = { status: "sent", totalPence: 100 };
const stages = (final: string, earlier = "approved") => [
  { position: 30, status: final }, { position: 10, status: earlier },
];

test("filming and early previews expose neither an invoice nor checkout, even with an existing invoice", () => {
  for (const bill of [null, invoice]) {
    for (const viewer of [8, 42, 99]) {
      const result = projectInvoiceAvailability(project, stages("upcoming", "in_progress"), bill, viewer);
      assert.equal(result.phase, "before_final");
      assert.equal(result.canIssue, false);
      assert.equal(result.canView, false);
      assert.equal(result.canPay, false);
    }
  }
});

test("freelancer prepares the final invoice; client sees it only after submission", () => {
  assert.equal(projectInvoiceAvailability(project, stages("in_progress"), null, 42).canIssue, true);
  assert.equal(projectInvoiceAvailability(project, stages("in_progress"), invoice, 42).canView, true);
  const client = projectInvoiceAvailability(project, stages("in_progress"), invoice, 8);
  assert.equal(client.canView, false);
  assert.equal(client.canPay, false);
  for (const status of ["awaiting_client", "approved", "completed"]) {
    const submitted = projectInvoiceAvailability(project, stages(status), invoice, 8);
    assert.equal(submitted.canView, true);
    assert.equal(submitted.canPay, true);
    assert.equal(projectInvoiceAvailability(project, stages(status), invoice, 42).canPay, false);
    assert.equal(projectInvoiceAvailability(project, stages(status), invoice, 99).canPay, false);
  }
});

test("submission without an invoice waits for the freelancer; revisions pause payment until resubmission", () => {
  const missing = projectInvoiceAvailability(project, stages("awaiting_client"), null, 8);
  assert.equal(missing.canPay, false);
  assert.match(missing.message!, /Waiting for your freelancer/);
  const revisions = projectInvoiceAvailability(project, stages("changes_requested"), invoice, 8);
  assert.equal(revisions.canView, true);
  assert.equal(revisions.canPay, false);
  assert.equal(projectInvoiceAvailability(project, stages("awaiting_client"), invoice, 8).canPay, true);
});

test("incomplete, empty or unconfirmed plans fail closed; final stage is determined by order", () => {
  for (const plan of [[], stages("awaiting_client", "changes_requested")]) {
    assert.equal(projectInvoiceAvailability(project, plan, invoice, 8).canPay, false);
  }
  for (const planningStatus of ["planning_required", "awaiting_client", "client_changes"]) {
    assert.equal(projectInvoiceAvailability({ ...project, planningStatus }, stages("approved"), invoice, 8).canPay, false);
  }
  assert.equal(projectInvoiceAvailability(project, [{ position: 70, status: "awaiting_client" }], invoice, 8).canPay, true);
});

test("paid and closed invoice history remains visible without enabling payment", () => {
  for (const override of [
    { paymentStatus: "paid" }, { status: "cancelled" }, { status: "deleted" }, { deletedAt: "2026-11-27" },
  ]) {
    const state = projectInvoiceAvailability({ ...project, ...override }, [], invoice, 8);
    assert.equal(state.canView, true);
    assert.equal(state.canPay, false);
    assert.equal(state.canIssue, false);
  }
  for (const bill of [{ ...invoice, status: "paid" }, { ...invoice, status: "cancelled" }, { ...invoice, status: "draft" }, { ...invoice, totalPence: 0 }]) {
    assert.equal(projectInvoiceAvailability(project, stages("approved"), bill, 8).canPay, false);
  }
  assert.equal(projectInvoiceAvailability({ ...project, status: "completed" }, [], invoice, 8).canView, true);
});

test("legacy revisions are not final delivery; retainer cycle billing stays separate", () => {
  const legacy = { ...project, planningStatus: "legacy" };
  assert.equal(projectInvoiceAvailability({ ...legacy, currentStage: 4 }, [], null, 42).canIssue, false);
  assert.equal(projectInvoiceAvailability({ ...legacy, currentStage: 4 }, [], invoice, 8).canPay, false);
  const final = { ...legacy, currentStage: 5, status: "awaiting_payment" };
  assert.equal(projectInvoiceAvailability(final, [], null, 42).canIssue, true);
  assert.equal(projectInvoiceAvailability(final, [], invoice, 8).canPay, true);
  const cycle = projectInvoiceAvailability({ ...project, isRetainer: 1 }, [], invoice, 8);
  assert.equal(cycle.phase, "retainer");
  assert.equal(cycle.canView, true);
});

test("database-backed eligibility follows only this project's current stages and fails on a failed read", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE project_stages(project_id INTEGER, position INTEGER, status TEXT);
      INSERT INTO project_stages VALUES(28,0,'completed'),(28,1,'in_progress'),(99,0,'completed');`);
    const load = () => loadProjectInvoiceAvailability(project, invoice, 8, db as any);
    assert.equal((await load()).canPay, false);
    await db.exec("UPDATE project_stages SET status='awaiting_client' WHERE project_id=28 AND position=1");
    assert.equal((await load()).canPay, true);
    await db.exec("UPDATE project_stages SET status='changes_requested' WHERE project_id=28 AND position=1");
    assert.equal((await load()).canPay, false);
    await db.exec("DROP TABLE project_stages");
    await assert.rejects(load());
  } finally { await db.close(); }
});
