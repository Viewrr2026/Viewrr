/**
 * First-class Express request augmentation for Viewrr authentication context.
 *
 * Populated by server-side middleware only — never from request body/query.
 *
 * req.auth      — set by requireAuth (A0) and requireAdminGuard (P0)
 *   .userId     — HMAC-verified caller identity from vr_sess cookie
 *   .adminUser  — full DB User record (only present after requireAdminGuard)
 *
 * Phase 1 (Batch A) will extend this with .sessionId and .isNative.
 */

import type { User } from "../shared/schema";

declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by requireAuth or requireAdminGuard after successful
       * HMAC session-cookie verification. Never present on unauthenticated routes.
       */
      auth?: {
        /** DB user id extracted from the HMAC-verified vr_sess token. */
        userId: number;
        /**
         * Full DB User row — only present when requireAdminGuard ran.
         * Undefined on ordinary authenticated routes (requireAuth).
         */
        adminUser?: User;
      };
    }
  }
}
