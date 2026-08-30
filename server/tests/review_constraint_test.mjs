/**
 * PRD-018 Runtime Test — Reciprocal Review Uniqueness Constraint
 * Uses better-sqlite3 (in-memory) — completely isolated, no production data touched.
 * 
 * Tests both layers:
 *   1. Application-level duplicate guard (C1-10 in POST /api/reviews)
 *   2. DB unique index constraint (defence-in-depth backstop)
 */

import Database from 'better-sqlite3';

const db = new Database(':memory:');

// ── Schema setup (minimal — mirrors production reviews table) ────────────────
db.exec(`
  CREATE TABLE projects (
    id         INTEGER PRIMARY KEY,
    client_id  INTEGER NOT NULL,
    freelancer_id INTEGER NOT NULL,
    status     TEXT NOT NULL
  );

  CREATE TABLE profiles (
    id      INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE
  );

  CREATE TABLE reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  INTEGER NOT NULL,
    client_id   INTEGER NOT NULL,  -- REVIEWER user_id (despite the name)
    project_id  INTEGER,
    rating      INTEGER NOT NULL,
    comment     TEXT NOT NULL
  );

  -- Stage 5 uniqueness constraint (partial index equivalent in SQLite via UNIQUE constraint)
  -- SQLite partial indexes: CREATE UNIQUE INDEX ... WHERE ... is supported
  CREATE UNIQUE INDEX reviews_project_reviewer_uniq
    ON reviews(project_id, client_id)
    WHERE project_id IS NOT NULL;
`);

// ── Seed data ────────────────────────────────────────────────────────────────
// Project 5: client=10 (Alice), freelancer=20 (Bob), completed
db.prepare(`INSERT INTO projects VALUES (5, 10, 20, 'completed')`).run();
// Profile for Bob (freelancer) — reviewed when client reviews
db.prepare(`INSERT INTO profiles VALUES (100, 20)`).run();
// Profile for Alice (client) — reviewed when freelancer reviews
db.prepare(`INSERT INTO profiles VALUES (200, 10)`).run();

// ── Application-level duplicate guard (mirrors C1-10) ────────────────────────
function hasExistingReview(projectId, reviewerUserId) {
  // Mirrors: existingOnProfile.find(r => r.projectId === projectId && r.clientId === callerId)
  const row = db.prepare(
    `SELECT id FROM reviews WHERE project_id = ? AND client_id = ? LIMIT 1`
  ).get(projectId, reviewerUserId);
  return !!row;
}

function submitReview({ callerId, role, projectId, rating, comment }) {
  // Load project (C1-5)
  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
  if (!project) return { status: 404, error: 'Project not found' };

  // C1-6: project must be completed
  if (project.status !== 'completed') return { status: 403, error: 'Reviews only on completed projects' };

  // C1-7: caller must match role
  if (role === 'client' && project.client_id !== callerId)
    return { status: 403, error: 'Only the project client can submit a client review' };
  if (role === 'freelancer' && project.freelancer_id !== callerId)
    return { status: 403, error: 'Only the assigned freelancer can submit a freelancer review' };

  // C1-8: reviewee is the other party
  const revieweeUserId = role === 'client' ? project.freelancer_id : project.client_id;
  const revieweeProfile = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(revieweeUserId);
  if (!revieweeProfile) return { status: 400, error: 'Reviewee profile not found' };

  // C1-10: application-level duplicate check
  if (hasExistingReview(projectId, callerId))
    return { status: 409, error: 'You have already submitted a review for this project' };

  // Insert — DB constraint is backstop
  try {
    const row = db.prepare(
      `INSERT INTO reviews (profile_id, client_id, project_id, rating, comment)
       VALUES (?, ?, ?, ?, ?) RETURNING id`
    ).get(revieweeProfile.id, callerId, projectId, rating, comment);
    return { status: 201, review: row };
  } catch (e) {
    if (e.message.includes('UNIQUE constraint failed')) {
      return { status: 409, error: 'DB uniqueness constraint violated (backstop)' };
    }
    throw e;
  }
}

// ── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function expect(label, actual, expectedStatus) {
  if (actual.status === expectedStatus) {
    console.log(`  PASS  ${label} → ${actual.status}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label} → got ${actual.status}, expected ${expectedStatus}${actual.error ? ` (${actual.error})` : ''}`);
    failed++;
  }
}

console.log('\n=== PRD-018 Reciprocal Review Runtime Tests (SQLite in-memory) ===\n');

// ── APPLICATION-LEVEL TESTS ──────────────────────────────────────────────────
console.log('── Application-layer (C1-10 duplicate guard) ──');

// T1: Client first review → 201
expect(
  'T1  Client (id=10) first review of project 5',
  submitReview({ callerId: 10, role: 'client', projectId: 5, rating: 5, comment: 'Excellent work done' }),
  201
);

// T2: Same client reviews again → 409
expect(
  'T2  Client (id=10) second review of same project',
  submitReview({ callerId: 10, role: 'client', projectId: 5, rating: 5, comment: 'Trying again, should fail' }),
  409
);

// T3: Freelancer reciprocal review → 201 (different client_id key)
expect(
  'T3  Freelancer (id=20) reciprocal review of project 5',
  submitReview({ callerId: 20, role: 'freelancer', projectId: 5, rating: 4, comment: 'Great client to work with' }),
  201
);

// T4: Same freelancer reviews again → 409
expect(
  'T4  Freelancer (id=20) second review of same project',
  submitReview({ callerId: 20, role: 'freelancer', projectId: 5, rating: 4, comment: 'Trying again, should fail' }),
  409
);

// ── DB CONSTRAINT BACKSTOP TEST ──────────────────────────────────────────────
console.log('\n── DB unique index backstop (bypassing application layer) ──');

// Direct insert bypassing application guard — should fail on DB constraint
function directInsert(projectId, callerId) {
  try {
    db.prepare(
      `INSERT INTO reviews (profile_id, client_id, project_id, rating, comment)
       VALUES (999, ?, ?, 5, 'bypass attempt')`
    ).run(callerId, projectId);
    return { blocked: false };
  } catch (e) {
    if (e.message.includes('UNIQUE constraint failed')) {
      return { blocked: true, reason: 'DB unique index' };
    }
    throw e;
  }
}

// T5: Direct insert duplicate for client row (project=5, client_id=10)
const t5 = directInsert(5, 10);
if (t5.blocked) {
  console.log(`  PASS  T5  Direct bypass attempt for (project=5, reviewer=10) → BLOCKED by DB index`);
  passed++;
} else {
  console.log(`  FAIL  T5  Direct bypass attempt was NOT blocked by DB index`);
  failed++;
}

// T6: Direct insert duplicate for freelancer row (project=5, client_id=20)
const t6 = directInsert(5, 20);
if (t6.blocked) {
  console.log(`  PASS  T6  Direct bypass attempt for (project=5, reviewer=20) → BLOCKED by DB index`);
  passed++;
} else {
  console.log(`  FAIL  T6  Direct bypass attempt was NOT blocked by DB index`);
  failed++;
}

// T7: Direct insert with NULL project_id is NOT blocked (partial index only covers project_id IS NOT NULL)
try {
  db.prepare(
    `INSERT INTO reviews (profile_id, client_id, project_id, rating, comment)
     VALUES (999, 10, NULL, 5, 'no-project review — should be allowed')`
  ).run();
  console.log(`  PASS  T7  NULL project_id row allowed (partial index correctly scoped)`);
  passed++;
} catch (e) {
  console.log(`  FAIL  T7  NULL project_id row was incorrectly blocked: ${e.message}`);
  failed++;
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n── Results ──`);
console.log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
db.close();
process.exit(failed > 0 ? 1 : 0);
