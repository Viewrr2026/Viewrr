import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setRetainerTestDatabase } from "../retainer-v1-db";
import {
  createCustomRetainer,
  reviewProposal,
  proposeCustomRetainer,
  customWorkspace,
  submitCustomWork,
  reviewCustomWork,
} from "../retainer-v1-service";
import {
  createCustomCyclePayment,
  setRetainerStripeForTesting,
  fulfilCustomCyclePayment,
  validateCycleIntent,
} from "../retainer-v1-payments";
import { customMediaAccess } from "../retainer-v1-media";
import { scanRetainerDeadlines } from "../retainer-v1-worker";
import {
  londonDate,
  nextDate,
  type CustomRetainerPlan,
} from "../../shared/retainer-v1";
process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "";
const db = new PGlite();
before(async () => {
  await db.exec(
    await readFile(
      new URL("./fixtures/retainer-base.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const file of [
    "0003_prd007_payment_ledger.sql",
    "0004_prd008_operations.sql",
    "0005_prd012_retainer_reimagined.sql",
    "0010_retainer_cycle_work_items.sql",
    "0011_retainer_work_item_submissions.sql",
    "0012_retainer_stage_updates.sql",
    "0013_custom_retainer_cycles.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../../migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  setRetainerTestDatabase({
    query: async (text, values) => (await db.query(text, values)) as any,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async (text, values) => (await tx.query(text, values)) as any,
        }),
      ),
  });
  await db.exec(
    "INSERT INTO users(id,name,email,role) VALUES(1,'Client','client@example.test','client'),(2,'Freelancer','freelancer@example.test','freelancer'),(3,'Stranger','stranger@example.test','client')",
  );
});
after(async () => {
  setRetainerTestDatabase(undefined);
  setRetainerStripeForTesting(undefined);
  await db.close();
});
const today = londonDate(new Date());
function plan(): CustomRetainerPlan {
  return {
    title: "Custom media retainer",
    startDate: today,
    endDate: nextDate(today, 83),
    gapsAcknowledged: false,
    cycles: Array.from({ length: 3 }, (_, i) => ({
      id: randomUUID(),
      name: `Cycle ${i + 1}`,
      startDate: nextDate(today, i * 28),
      endDate: nextDate(today, i * 28 + 27),
      amountPence: 200000,
      revisionAllowance: 2,
      paymentDays: 5,
      deliverables: [
        {
          id: randomUUID(),
          name: "TikTok",
          quantity: 2,
          brief: "A bespoke video for our social channels",
        },
        {
          id: randomUUID(),
          name: "LinkedIn promo",
          quantity: 1,
          brief: "Launch announcement",
        },
      ],
    })),
  };
}
async function readyMedia(taskId: number) {
  const mediaId = randomUUID();
  await db.query(
    "INSERT INTO retainer_media(id,task_id,uploaded_by,original_key,preview_key,filename,mime_type,size_bytes,status) VALUES($1,$2,2,$3,$4,'video.mp4','video/mp4',100,'ready')",
    [mediaId, taskId, `original/${mediaId}`, `preview/${mediaId}`],
  );
  return mediaId;
}
async function approveFirstCycle(publicId: string) {
  let w = await customWorkspace(publicId, 1);
  const first = w.cycles[0];
  for (const task of w.tasks.filter(
    (t: any) => t.retainer_cycle_id === first.id,
  )) {
    await submitCustomWork(
      publicId,
      2,
      task.public_id,
      await readyMedia(task.id),
      "Please review",
    );
    w = await customWorkspace(publicId, 1);
    const s = w.submissions.find(
      (s: any) => s.retainer_cycle_task_id === task.id,
    );
    await reviewCustomWork(publicId, 1, s.id, "approve", "");
  }
  return (await customWorkspace(publicId, 1)).cycles[0];
}

test("both creator roles; one proposal on retries; version acceptance and role checks", async () => {
  const p = plan();
  const { agreementPublicId: publicId } = await createCustomRetainer(1, 2, p);
  const duplicate = await createCustomRetainer(1, 2, p);
  assert.equal(duplicate.agreementPublicId, publicId);
  await assert.rejects(() => customWorkspace(publicId, 3));
  await assert.rejects(() => reviewProposal(publicId, 1, 1, "accept", ""));
  await reviewProposal(
    publicId,
    2,
    1,
    "request_changes",
    "Please revise the scope",
  );
  await assert.rejects(() => reviewProposal(publicId, 2, 1, "accept", ""));
  await proposeCustomRetainer(publicId, 1, 1, { ...p, title: "Revised scope" });
  await assert.rejects(() => reviewProposal(publicId, 2, 1, "accept", ""));
  await reviewProposal(publicId, 2, 2, "accept", "");
  const w = await customWorkspace(publicId, 1);
  assert.equal(w.status, "active");
  assert.equal(w.tasks.length, 9);
  assert.equal(new Set(w.tasks.map((t: any) => t.public_id)).size, 9);
  const freelancerProposal = await createCustomRetainer(2, 1, plan());
  await reviewProposal(
    freelancerProposal.agreementPublicId,
    1,
    1,
    "accept",
    "",
  );
});

test("submission versioning, revision, all-item acceptance and exactly one invoice", async () => {
  const { agreementPublicId: publicId } = await createCustomRetainer(
    2,
    1,
    plan(),
  );
  await reviewProposal(publicId, 1, 1, "accept", "");
  let w = await customWorkspace(publicId, 1);
  const task = w.tasks[0];
  await assert.rejects(() =>
    submitCustomWork(publicId, 1, task.public_id, randomUUID(), "invalid role"),
  );
  await submitCustomWork(
    publicId,
    2,
    task.public_id,
    await readyMedia(task.id),
    "First edit",
  );
  w = await customWorkspace(publicId, 1);
  const original = w.submissions[0];
  assert.equal(w.cycles[0].accepted_at, null);
  await reviewCustomWork(
    publicId,
    1,
    original.id,
    "request_changes",
    "Adjust the title",
  );
  await submitCustomWork(
    publicId,
    2,
    task.public_id,
    await readyMedia(task.id),
    "Revised edit",
  );
  await assert.rejects(() =>
    reviewCustomWork(publicId, 1, original.id, "approve", ""),
  );
  w = await customWorkspace(publicId, 1);
  assert.equal(w.submissions[0].version, 2);
  await reviewCustomWork(publicId, 1, w.submissions[0].id, "approve", "");
  // Replacing a previously approved item invalidates that version before cycle acceptance.
  await submitCustomWork(
    publicId,
    2,
    task.public_id,
    await readyMedia(task.id),
    "Replacement edit",
  );
  w = await customWorkspace(publicId, 1);
  assert.equal(w.tasks[0].status, "awaiting_client_review");
  const first = await approveFirstCycle(publicId);
  assert.ok(first.accepted_at);
  assert.ok(first.due_at);
  assert.equal(first.paid_at, null);
  assert.equal(first.state, "awaiting_payment");
  w = await customWorkspace(publicId, 1);
  const s = w.submissions.find((s: any) => s.status === "approved");
  await reviewCustomWork(publicId, 1, s.id, "approve", "");
  const again = (await customWorkspace(publicId, 1)).cycles[0];
  assert.equal(again.accepted_at, first.accepted_at);
  assert.equal(again.due_at, first.due_at);
  const invoices = await db.query<any>("SELECT * FROM invoices WHERE id=$1", [
    first.invoice_id,
  ]);
  assert.equal(invoices.rows.length, 1);
  assert.equal(invoices.rows[0].total_pence, 200000);
  assert.equal(JSON.stringify(w).includes("original/"), false);
});

test("deadline freeze is enforced on mutation; reminders deduplicate", async () => {
  const { agreementPublicId: publicId } = await createCustomRetainer(
    1,
    2,
    plan(),
  );
  await reviewProposal(publicId, 2, 1, "accept", "");
  const first = await approveFirstCycle(publicId);
  let w = await customWorkspace(publicId, 1);
  const second = w.cycles[1],
    task = w.tasks.find((t: any) => t.retainer_cycle_id === second.id);
  // Simulate the second planned start having arrived without changing wall-clock time.
  await db.query("UPDATE retainer_cycles SET period_start=$2 WHERE id=$1", [
    second.id,
    today,
  ]);
  await submitCustomWork(
    publicId,
    2,
    task.public_id,
    await readyMedia(task.id),
    "Within terms",
  );
  await db.query("UPDATE retainer_cycles SET due_at=$2 WHERE id=$1", [
    first.id,
    new Date(Date.now() - 1000).toISOString(),
  ]);
  w = await customWorkspace(publicId, 1);
  assert.equal(w.cycles[1].state, "frozen");
  await assert.rejects(() =>
    reviewCustomWork(
      publicId,
      1,
      w.submissions.find((s: any) => s.retainer_cycle_task_id === task.id).id,
      "approve",
      "",
    ),
  );
  await scanRetainerDeadlines();
  const count = (
    await db.query<any>("SELECT COUNT(*)::int AS n FROM notifications")
  ).rows[0].n;
  await scanRetainerDeadlines();
  assert.equal(
    (await db.query<any>("SELECT COUNT(*)::int AS n FROM notifications"))
      .rows[0].n,
    count,
  );
});

test("verified webhook completes only its cycle and is safe to replay", async () => {
  const { agreementPublicId: publicId } = await createCustomRetainer(
    2,
    1,
    plan(),
  );
  await reviewProposal(publicId, 1, 1, "accept", "");
  const c = await approveFirstCycle(publicId);
  const a = (
    await db.query<any>(
      "SELECT * FROM retainer_agreements WHERE public_id=$1",
      [publicId],
    )
  ).rows[0];
  const paymentId = `pay_${randomUUID()}`,
    intentId = `pi_${randomUUID()}`;
  const p = (
    await db.query<any>(
      `INSERT INTO payments(public_id,project_id,invoice_id,retainer_cycle_id,client_id,freelancer_id,gross_pence,platform_fee_pence,freelancer_pence,stripe_payment_intent_id,payment_kind) VALUES($1,$2,$3,$4,1,2,200000,22000,178000,$5,'retainer_cycle') RETURNING *`,
      [paymentId, a.project_id, c.invoice_id, c.id, intentId],
    )
  ).rows[0];
  await db.query("UPDATE retainer_cycles SET payment_id=$2 WHERE id=$1", [
    c.id,
    p.id,
  ]);
  const intent: any = {
    id: intentId,
    status: "succeeded",
    amount: 200000,
    amount_received: 200000,
    currency: "gbp",
    latest_charge: "ch_test",
    metadata: {
      viewrr_payment_id: paymentId,
      cyclePublicId: c.public_id,
      clientUserId: "1",
    },
  };
  assert.throws(() =>
    validateCycleIntent(
      p,
      { ...c, payment_id: p.id },
      { ...intent, amount_received: 100 },
    ),
  );
  await assert.rejects(() =>
    fulfilCustomCyclePayment({ ...intent, currency: "usd" }),
  );
  assert.equal(await fulfilCustomCyclePayment(intent), true);
  await fulfilCustomCyclePayment(intent);
  const w = await customWorkspace(publicId, 1);
  assert.ok(w.cycles[0].paid_at);
  assert.equal(w.cycles[1].paid_at, null);
  assert.equal(w.cycles[2].paid_at, null);
  const events = await db.query<any>(
    "SELECT * FROM retainer_events WHERE event_key=$1",
    [`payment:${p.id}`],
  );
  assert.equal(events.rows.length, 1);
  await assert.rejects(() =>
    proposeCustomRetainer(publicId, 1, 1, {
      ...w.plan,
      cycles: w.plan.cycles.map((c: any, i: number) =>
        i === 0 ? { ...c, amountPence: 1 } : c,
      ),
    }),
  );
});

test("calendar-day deadlines preserve London local time over DST", async () => {
  for (const [from, expected] of [
    ["2026-03-28T12:00:00Z", "2026-03-29T11:00:00.000Z"],
    ["2026-10-24T11:00:00Z", "2026-10-25T12:00:00.000Z"],
  ]) {
    const r = await db.query<any>(
      "SELECT (($1::timestamptz AT TIME ZONE 'Europe/London')+INTERVAL '1 day') AT TIME ZONE 'Europe/London' AS due",
      [from],
    );
    assert.equal(new Date(r.rows[0].due).toISOString(), expected);
  }
});

test("interrupted checkout, concurrent retries, declined cards and cancellation reuse canonical amounts", async () => {
  const intents = new Map<string, any>(),
    byKey = new Map<string, any>();
  let created = 0,
    interrupt = true;
  setRetainerStripeForTesting({
    accounts: {
      retrieve: async () => ({
        charges_enabled: true,
        capabilities: { transfers: "active" },
      }),
    },
    paymentIntents: {
      retrieve: async (intentId: string) => {
        if (!intents.has(intentId)) throw new Error("Unknown intent");
        return intents.get(intentId);
      },
      create: async (params: any, { idempotencyKey }: any) => {
        let intent = byKey.get(idempotencyKey);
        if (!intent) {
          created++;
          intent = {
            ...params,
            id: `pi_fake_${randomUUID()}`,
            status: "requires_payment_method",
            amount_received: 0,
            client_secret: "test_secret",
          };
          byKey.set(idempotencyKey, intent);
          intents.set(intent.id, intent);
        }
        if (interrupt) {
          interrupt = false;
          throw new Error("Simulated connection loss after provider creation");
        }
        return intent;
      },
    },
  } as any);
  await db.query("UPDATE users SET stripe_account_id='acct_test' WHERE id=2");
  const { agreementPublicId: publicId } = await createCustomRetainer(
    2,
    1,
    plan(),
  );
  await reviewProposal(publicId, 1, 1, "accept", "");
  let w = await customWorkspace(publicId, 1);
  await assert.rejects(() =>
    createCustomCyclePayment(w.cycles[0].public_id, 1),
  );
  const c = await approveFirstCycle(publicId);
  await assert.rejects(() => createCustomCyclePayment(c.public_id, 2));
  await assert.rejects(() => createCustomCyclePayment(c.public_id, 1));
  assert.equal(created, 1);
  const results = await Promise.all([
    createCustomCyclePayment(c.public_id, 1),
    createCustomCyclePayment(c.public_id, 1),
  ]);
  assert.equal(created, 1);
  assert.equal(results[0].paymentIntentId, results[1].paymentIntentId);
  assert.equal(results[0].amountPence, 200000);
  const intent = intents.get(results[0].paymentIntentId);
  assert.equal(intent.application_fee_amount, 22000);
  assert.equal(intent.transfer_data.destination, "acct_test");
  intent.status = "requires_action";
  assert.equal(
    (await createCustomCyclePayment(c.public_id, 1)).paymentIntentId,
    intent.id,
  );
  intent.status = "requires_payment_method";
  assert.equal(
    (await createCustomCyclePayment(c.public_id, 1)).paymentIntentId,
    intent.id,
  );
  intent.status = "processing";
  await assert.rejects(() => createCustomCyclePayment(c.public_id, 1));
  assert.equal(created, 1);
  intent.status = "canceled";
  const retry = await createCustomCyclePayment(c.public_id, 1);
  assert.notEqual(retry.paymentIntentId, intent.id);
  assert.equal(created, 2);
  const paidIntent = intents.get(retry.paymentIntentId);
  paidIntent.status = "succeeded";
  paidIntent.amount_received = paidIntent.amount;
  await assert.rejects(() => createCustomCyclePayment(c.public_id, 1));
  assert.equal(created, 2);
  assert.equal(await fulfilCustomCyclePayment(paidIntent), true);
  await assert.rejects(() => createCustomCyclePayment(c.public_id, 1));
  assert.equal(created, 2);
  setRetainerStripeForTesting(undefined);
});

test("media authorization rejects unpaid originals, other participants and wrong-cycle payment", async () => {
  const { agreementPublicId: publicId } = await createCustomRetainer(
    2,
    1,
    plan(),
  );
  await reviewProposal(publicId, 1, 1, "accept", "");
  const w = await customWorkspace(publicId, 1),
    task = w.tasks[0],
    media = await readyMedia(task.id);
  await submitCustomWork(publicId, 2, task.public_id, media, "Review");
  await assert.rejects(
    () => customMediaAccess(publicId, 3, media, false),
    (e: any) => e.status === 403,
  );
  await assert.rejects(
    () => customMediaAccess(publicId, 1, media, true),
    (e: any) => e.status === 403,
  );
  const other = await createCustomRetainer(2, 1, plan());
  await assert.rejects(
    () => customMediaAccess(other.agreementPublicId, 1, media, true),
    (e: any) => e.status === 404,
  );
});

test("amendments preserve started work and the accepted agreement until both parties accept", async () => {
  const { agreementPublicId: publicId } = await createCustomRetainer(
    2,
    1,
    plan(),
  );
  await reviewProposal(publicId, 1, 1, "accept", "");
  let w = await customWorkspace(publicId, 1),
    task = w.tasks[0];
  await submitCustomWork(
    publicId,
    2,
    task.public_id,
    await readyMedia(task.id),
    "Started work",
  );
  const candidate = structuredClone(w.plan);
  candidate.cycles[1].amountPence = 230000;
  await proposeCustomRetainer(publicId, 2, 1, candidate);
  w = await customWorkspace(publicId, 1);
  assert.equal(w.plan.cycles[1].amountPence, 200000);
  assert.equal(w.pending.plan.cycles[1].amountPence, 230000);
  await reviewProposal(publicId, 1, 2, "accept", "");
  w = await customWorkspace(publicId, 1);
  assert.equal(w.plan.cycles[1].amountPence, 230000);
  assert.equal(w.tasks[0].public_id, task.public_id);
  assert.equal(w.submissions.length, 1);
  const invalid = structuredClone(w.plan);
  invalid.cycles[0].deliverables[0].quantity = 5;
  await assert.rejects(() => proposeCustomRetainer(publicId, 2, 2, invalid));
});
