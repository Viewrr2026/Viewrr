-- PRD-018 P0 Security — Safe Staged Migration
-- Author: PRD-018 implementation
-- Safe to run against a populated production table.

-- Stage 1: Add column as nullable first (avoids any risk from NOT NULL + DEFAULT on large tables
-- in older Postgres; Neon runs Postgres 16 which handles this atomically, but staged approach is safer).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS verified_project_review INTEGER DEFAULT 0;

-- Stage 2: Set 0 for any NULLs introduced by earlier schema mismatch (defensive, should be zero rows)
UPDATE reviews SET verified_project_review = 0 WHERE verified_project_review IS NULL;

-- Stage 3: Add NOT NULL constraint now that all rows are populated
-- (IF NOT EXISTS is not valid on constraints, but ALTER TABLE ... SET NOT NULL is idempotent
-- in the sense that it will no-op if the constraint is already enforced.)
ALTER TABLE reviews ALTER COLUMN verified_project_review SET NOT NULL;
ALTER TABLE reviews ALTER COLUMN verified_project_review SET DEFAULT 0;

-- Stage 4: Historical review reconciliation.
-- Only mark a review as verified if authoritative DB data can prove ALL of:
--   (a) the review has a non-null project_id
--   (b) a project row exists with that id
--   (c) the project's client_id matches the review's client_id (reviewer WAS the client)
--   (d) the project's freelancer_id resolves to the profile being reviewed
--       (i.e. the target profile's user_id = project.freelancer_id)
-- Anything that cannot be proven remains verified_project_review = 0.
UPDATE reviews r
SET verified_project_review = 1
FROM projects p
JOIN profiles prof ON prof.user_id = p.freelancer_id
WHERE r.project_id = p.id
  AND r.client_id  = p.client_id      -- reviewer was the actual client on this project
  AND r.profile_id = prof.id          -- target profile belongs to the actual freelancer
  AND r.verified_project_review = 0; -- only update rows not already marked

-- Note: freelancer-reviews-of-clients (reciprocal reviews where the freelancer is the reviewer)
-- are NOT marked verified by this migration. They remain verified_project_review = 0 until
-- the new review route (which always sets 1 on submission) handles future reviews.
-- This is intentionally conservative: it is better to under-report verified reviews than to
-- incorrectly label a review as verified.

-- Stage 5: Uniqueness constraint — one review per reviewer per project.
--
-- The reviews.client_id column stores the REVIEWER's user id regardless of their role.
-- (When a freelancer reviews a client, client_id = the freelancer's user id.)
-- Therefore UNIQUE(project_id, client_id) WHERE project_id IS NOT NULL prevents:
--   (a) the same client submitting two client→freelancer reviews on the same project
--   (b) the same freelancer submitting two freelancer→client reviews on the same project
-- It does NOT prevent a client AND a freelancer each reviewing on the same project —
-- those produce (project_id=X, client_id=clientUserId) and (project_id=X, client_id=freelancerUserId)
-- which are distinct rows and correctly permitted.
--
-- Idempotent: DO block checks for existing index before creating.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'reviews'
      AND indexname = 'reviews_project_reviewer_uniq'
  ) THEN
    CREATE UNIQUE INDEX reviews_project_reviewer_uniq
      ON reviews(project_id, client_id)
      WHERE project_id IS NOT NULL;
  END IF;
END $$;
