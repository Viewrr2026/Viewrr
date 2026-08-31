/**
 * First-class Express request augmentation for Viewrr authentication context.
 *
 * Populated by server-side middleware only — never from request body/query.
 *
 * req.auth      — set by requireAuth (A0) and requireAdminGuard (P0)
 *   .userId     — verified caller identity from session cookie or Bearer token
 *   .sessionId  — public DB session UUID (undefined for legacy HMAC drain sessions)
 *   .clientType — 'web' | 'mobile' (undefined for legacy HMAC drain sessions)
 *   .adminUser  — full DB User record (only present after requireAdminGuard)
 *
 * PRD-019: Extended with sessionId and clientType for DB-backed sessions.
 * Legacy HMAC drain sessions omit sessionId and clientType.
 */

import type { User } from "../shared/schema";

declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by requireAuth or requireAdminGuard after successful
       * session verification. Never present on unauthenticated routes.
       */
      auth?: {
        /** Verified caller user ID. */
        userId: number;
        /**
         * Public session UUID from auth_sessions.session_id.
         * Undefined only for legacy HMAC drain-period sessions (no DB record).
         */
        sessionId?: string;
        /**
         * 'web' (cookie) or 'mobile' (Bearer).
         * Undefined only for legacy HMAC drain-period sessions.
         */
        clientType?: "web" | "mobile";
        /**
         * Full DB User row — only present when requireAdminGuard ran.
         * Undefined on ordinary authenticated routes (requireAuth).
         */
        adminUser?: User;
      };
      /**
       * FR-35 (WS-F): Correlation / request ID assigned by the request-ID middleware.
       * Either echoed from a trusted inbound X-Request-ID header or a fresh UUID.
       * Always present after the middleware runs; undefined only on very early errors.
       */
      requestId?: string;
    }
  }
}
