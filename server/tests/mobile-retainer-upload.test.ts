import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { canUploadRetainer } = createRequire(import.meta.url)("../../mobile/src/components/work/retainerUploadPolicy.ts");
test("only freelancers with a workable cycle can upload", () => {
  assert.equal(canUploadRetainer(true, true, "pending"), true);
  assert.equal(canUploadRetainer(false, true, "pending"), false);
  assert.equal(canUploadRetainer(true, false, "pending"), false);
});
test("submitted and approved work cannot be replaced before feedback", () => {
  for (const status of ["submitted", "approved"]) assert.equal(canUploadRetainer(true, true, "pending", status), false);
  for (const status of ["complete", "done", "awaiting_client_review"]) assert.equal(canUploadRetainer(true, true, status), false);
  assert.equal(canUploadRetainer(true, true, "changes_requested", "changes_requested"), true);
});
