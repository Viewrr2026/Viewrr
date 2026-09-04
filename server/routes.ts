import type { Express, Request, Response, NextFunction } from "express";
import { registerRetainerBuilderRoutes } from "./retainer-builder-routes";
import { Server } from "http";
import { storage, db, sanitiseNotifPrefs } from "./storage";
import {
  getProEntitlement, getFoundingProSpacesRemaining, claimFoundingPro,
  createProCheckout, scheduleProCancellation, getProDashboardStats,
  getCommissionRateBpsForUser, activateProFromWebhook, renewProFromWebhook,
  markProPaymentFailed, expireProEntitlement,
  PRO_FEE_BPS, STANDARD_FEE_BPS, PRO_FEE_PCT, STANDARD_FEE_PCT, FOUNDING_PRO_MAX,
} from "./pro-service";
import * as schema from "../shared/schema";
import { eq, isNull, inArray, and } from "drizzle-orm";
import {
  createPayment,
  initiateRefund,
  claimStripeEvent,
  markEventProcessed,
  handlePaymentIntentSucceeded,
  releaseHeldEarnings,
  syncConnectAccount,
  reconcilePayment,
  auditLog,
  processStripeEvent,
  recoverStaleStripeEvents,
  VIEWRR_FEE_PERCENT as PAYMENT_FEE_PERCENT,
} from "./payment-service";
import { getDashboardData } from "./services/dashboard.service";
// PRD 1 wave 4 (Decisions 14 + 15): native push + structured notification targeting.
import {
  registerPushToken as registerPushTokenRow,
  deletePushTokenForUser,
  getOrCreatePushPreferences,
  updatePushPreferences,
  sanitisePushPrefs,
  dispatchPushAsync,
  deriveTargeting,
  asTargetType,
  PUSH_PREFERENCE_KEYS,
  type NotificationTargetType,
} from "./services/push-service";
import { neon } from "@neondatabase/serverless";
import { requireFinancePermission, deriveFinanceRole, canApproveRefund, REFUND_THRESHOLD_HIGH_VALUE } from "./permission-service";
import { createRetainerPayment, fulfilRetainerCyclePayment } from "./retainer-service";
import { getFreelancerPayoutTimeline, configureAutoDailyPayout, migrateAllAccountsToAutoDailyPayout, configureNewAccountDailyPayout } from "./payout-service";
import { runExceptionScan, generateDailySummary, reconcilePaymentFull } from "./reconciliation-service";
import {
  getProjectStages, getProjectStage, addProjectStage, updateProjectStage, deleteProjectStage,
  reorderProjectStages, bulkCreateStages, setPlanningStatus,
  startStage, submitStageForReview, approveStage, completeStage, requestStageChanges,
  calcProgress, getActiveStage, logStageEvent, STAGE_TEMPLATES,
} from "./stage-service";
import { enqueueJob, startWorker, registerJobHandler } from "./job-queue";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import {
  SESSION_COOKIE_NAME,
  setSessionCookie, clearSessionCookie,
} from "./session";
import {
  requireAuth, requireAdminGuard, requireBrowserOrigin, optionalAuth,
} from "./auth-middleware";
import {
  createWebSession, createMobileSession,
  findSessionByToken, isSessionValid, revokeSession, revokeAllUserSessions,
} from "./auth-sessions";
import {
  verifyPassword, migratePasswordIfLegacy, hashPasswordArgon2id,
} from "./password-service";
import {
  STORAGE_CONFIGURED, generateObjectKey, createPresignedUploadUrl,
  createPresignedDownloadUrl, verifyObjectExists,
  MAX_UPLOAD_BYTES, isAllowedMime,
  type ResourceType,
} from "./object-storage";
import { createVerificationCode, verifyCode, type VerificationPurpose } from "./verification-service";
import { compileUserExport, checkDeletionBlockers, anonymiseUserAccount, getDeletionStatus } from "./services/privacy-service";
import { createReport, resolveReport, suspendUser, unsuspendUser, blockUser, unblockUser, getBlockList,
  isBlockedEitherWay, isBlockedEitherWaySafe, getBlockedUserIds, sharesActiveEngagement, blocksMessaging,
} from "./services/trust-service";
import {
  moderateContent, recordContentFlags, listContentFlags, resolveContentFlag,
  POST_BODY_MAX, COMMENT_BODY_MAX, MEDIA_URL_MAX, TAGS_JSON_MAX, MEDIA_TYPES,
  GUIDELINES_URL,
} from "./services/moderation-service";
import { assertProjectParty, sendProjectAccessError } from "./project-access";

import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import Stripe from "stripe";

// ── Stripe setup ──────────────────────────────────────────────────
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" as any })
  : null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const VIEWRR_FEE_PERCENT = 11; // 11% platform fee
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.viewrr.co.uk";

// PRD-019: hashPassword removed — Argon2id used via password-service.ts.
// Legacy SHA-256 verification is handled inside password-service.verifyPassword().

// ─── P0-02: Safe user DTO ────────────────────────────────────────────────────
// NEVER return the raw DB user row to any client. passwordHash must never appear
// in an API response, log, localStorage value, or analytics event.
function safeUserDto(user: any): Record<string, any> {
  if (!user) return user;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, password_hash, passwordAlgo, password_algo, ...safe } = user as any;
  return safe;
}

// PRD-018 E1: Strip internal accreditation fields from public profile responses
function safePublicProfile(profile: any): Record<string, any> {
  if (!profile) return profile;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accreditationNotes, accreditationApprovedBy, accreditationApprovedByName, ...safe } = profile as any;
  return safe;
}

// Public marketplace/profile identity.
// ALLOW-LIST: adding a new users column can never expose it publicly by default.
function safePublicUser(user: any): Record<string, any> {
  if (!user) return user;
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar ?? null,
    banner: user.banner ?? null,
    headline: user.headline ?? null,
    bio: user.bio ?? null,
    location: user.location ?? null,
    role: user.role,
  };
}

// PRD-019: requireAuth and requireAdminGuard are now imported from auth-middleware.ts.
// The local copies above have been removed. All existing usages in this file
// continue to work via the imports added at the top of the file.

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// PRD-020 WS-E: Verification codes are now DB-backed (see verification-service.ts).
// The in-memory Map has been replaced; codes survive server restarts.
import { insertUserSchema, insertReviewSchema, insertMessageSchema, insertPostSchema, insertPostCommentSchema, insertProjectSchema, insertProjectUpdateSchema, insertBriefSchema, insertBriefInterestSchema, insertAgencySchema, insertAgencyMemberSchema } from "@shared/schema";

// Helper: fire-and-forget notification (never throws)
// ── Email event types that trigger emails ─────────────────────────────────
const EMAIL_NOTIFICATION_TYPES = new Set([
  "interest", "interest_accepted", "interest_declined", "counter_offered",
  "project_started", "stage_submitted", "stage_approved",
  "payment_requested", "payment_received", "project_completed",
  "review_requested", "message",
]);

// Email-readable labels for notification types
const NOTIF_TYPE_LABELS: Record<string, string> = {
  interest: "New interest in your brief",
  interest_accepted: "Your interest was accepted",
  interest_declined: "Interest update",
  counter_offered: "Counter offer received",
  project_started: "Project has started",
  stage_submitted: "Stage submitted for review",
  stage_approved: "Stage approved",
  payment_requested: "Payment requested",
  payment_received: "Payment received",
  project_completed: "Project completed",
  review_requested: "Leave a review",
  message: "New message on Viewrr",
};

// ─── PRD 1: shared verification-email sender ─────────────────────────────────
// Extracted from POST /api/auth/send-verification so the mobile register and
// resend endpoints send exactly the same email through exactly the same path,
// and so the code is generated in one place only.
async function sendVerificationEmail(rawEmail: string): Promise<{ ok: boolean; dev?: boolean }> {
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email) return { ok: false };

  // PRD-020 WS-E: the code is stored hashed; the raw code exists only in
  // memory here, for the duration of this send.
  const code = await createVerificationCode(email, 'email_verification');

  if (!resend) {
    // PRD-018 H4: never log or return a code in production.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[verify][DEV ONLY] RESEND_API_KEY not set — code for ${email}: ${code}`);
      return { ok: true, dev: true };
    }
    return { ok: false };
  }

  try {
    await resend.emails.send({
      from: 'Viewrr <noreply@viewrr.co.uk>',
      to: email,
      subject: 'Your Viewrr verification code',
      html: `
        <div style='font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;'>
          <h1 style='font-size:24px;font-weight:700;color:#111;margin:0 0 8px;'>Your verification code</h1>
          <p style='color:#555;margin:0 0 32px;'>Enter this code in Viewrr to confirm your email address. It expires in 10 minutes.</p>
          <div style='background:#f5f5f5;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px;'>
            <span style='font-size:48px;font-weight:800;letter-spacing:12px;color:#FF5A1F;'>${code}</span>
          </div>
          <p style='color:#999;font-size:13px;'>If you did not request this, you can safely ignore this email — nobody can access your account with it.</p>
        </div>
      `,
    });
    return { ok: true };
  } catch (e: any) {
    console.error('[verify] Resend error:', e?.message, e?.statusCode);
    return { ok: false };
  }
}

// ─── PRD 1 (contract §F): per-viewer block filtering ─────────────────────────
// Removes rows authored by anyone the viewer has blocked, and anyone who has
// blocked the viewer (symmetric invisibility, Decision 2).
//
// Applied in the route layer, never inside a cached/shared query result, so the
// anonymous feed cache can stay shared. Fails OPEN on error: showing content is
// a smaller failure than an empty feed.
async function filterBlockedAuthors<T>(
  viewerUserId: number,
  rows: T[],
  getAuthorId: (row: T) => number | null | undefined,
): Promise<T[]> {
  if (!rows?.length) return rows;
  try {
    const blocked = await getBlockedUserIds(viewerUserId);
    if (!blocked.length) return rows;
    const blockedSet = new Set(blocked);
    return rows.filter((row) => {
      const authorId = getAuthorId(row);
      return !(typeof authorId === "number" && blockedSet.has(authorId));
    });
  } catch (e: any) {
    console.warn("[blocks] filterBlockedAuthors failed, returning unfiltered:", e?.message);
    return rows;
  }
}

// ─── PRD 1 wave 4: has the 0006 targeting column landed yet? ─────────────────
// `notifications.target_type` / `target_id` are created by migration 0006,
// which has NOT been applied to production. This branch may therefore boot
// against a database without them. If the first targeted INSERT fails on the
// missing column we remember that and fall back to the pre-0006 column set for
// the rest of the process, so a notification row is NEVER lost to a schema the
// branch got ahead of. Additive by construction: `link` is written exactly as
// before either way (Decision 14).
let notificationTargetingSupported: boolean | null = null;

function isMissingColumnError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === "42703" || err.code === "42P01") return true;
  return /column .*target_(type|id).* does not exist/i.test(String(err.message ?? ""));
}

async function createNotificationRow(
  data: Parameters<typeof storage.createNotification>[0],
): Promise<{ id: number | null } | null> {
  const { targetType, targetId, ...withoutTargeting } = data as any;
  const hasTargeting = targetType != null || targetId != null;

  if (hasTargeting && notificationTargetingSupported !== false) {
    try {
      const row = await storage.createNotification(data);
      notificationTargetingSupported = true;
      return { id: (row as any)?.id ?? null };
    } catch (e: any) {
      if (!isMissingColumnError(e)) throw e;
      notificationTargetingSupported = false;
      console.warn(
        "[notify] notifications.target_type/target_id absent (migration 0006 not applied) — " +
          "writing notification rows without structured targeting for the rest of this process.",
      );
    }
  }

  const row = await storage.createNotification(withoutTargeting);
  return { id: (row as any)?.id ?? null };
}

/**
 * `data` accepts the two additive Decision 14 fields on top of the existing
 * notification shape. They are OPTIONAL at every call site: when a producer
 * omits them, `deriveTargeting()` reconstructs what it can from `type` + the
 * existing web `link`, so the mobile resolver still gets structure.
 */
async function notify(
  data: Parameters<typeof storage.createNotification>[0] & {
    targetType?: NotificationTargetType | null;
    targetId?: number | null;
  },
) {
  // 0. PRD 1 (contract §F): block enforcement, applied HERE on purpose.
  //    notify() is the single choke point for ten separate notification
  //    producers plus the Resend email path, so one check covers all of them —
  //    a blocked user can no longer reach someone's inbox by triggering any
  //    notification-producing action.
  //
  //    Decision 3 exemption: a block must NEVER break an in-flight project.
  //    blocksMessaging() returns true only when the pair is blocked in either
  //    direction AND they do not share an active engagement, so notifications
  //    about a live project, its stages, its payments and its invoices still
  //    get through. System notifications (no actor, or self-notification) are
  //    never suppressed.
  try {
    const actorId = Number((data as any).actorId ?? 0);
    // Platform notifications ('system') are never suppressed: a user must not
    // be able to hide a moderation decision or an account notice by blocking
    // the admin who issued it.
    const isPlatformNotice = data.type === "system";
    if (!isPlatformNotice && actorId > 0 && actorId !== data.recipientId) {
      if (await blocksMessaging(actorId, data.recipientId)) return;
    }
  } catch (blockErr: any) {
    // Fail OPEN: a trust-service outage must not silently stop all platform
    // notifications. Logged so it is visible rather than invisible.
    console.warn("[notify] block check failed, delivering anyway:", blockErr?.message);
  }

  // 1. Resolve structured targeting (Decision 14 — ADDITIVE).
  //    `link` is passed straight through, byte for byte: the web notification
  //    centre routes off it and nothing here may change it. `targetType` /
  //    `targetId` are new columns alongside it, so a mobile tap can route to
  //    the exact project / brief / conversation / profile without a second
  //    fetch. When a producer already passed targeting we keep it; otherwise we
  //    derive what we can from `type` + `link`.
  const explicitTargetType = asTargetType((data as any).targetType);
  const explicitTargetIdRaw = Number((data as any).targetId);
  const explicitTargetId =
    Number.isInteger(explicitTargetIdRaw) && explicitTargetIdRaw > 0 ? explicitTargetIdRaw : null;

  const derived = deriveTargeting(data.type, data.link, (data as any).actorId);
  const targetType = explicitTargetType ?? derived.targetType;
  const targetId = explicitTargetType ? explicitTargetId : (explicitTargetId ?? derived.targetId);

  // 2. Always create the in-app notification row.
  //    Decision 18: a `type:"message"` row is still written on every DM. Inbox
  //    unread and notification unread are separate counts and are never merged
  //    or summed — this row is the notification-centre entry, not the inbox.
  let notificationId: number | null = null;
  try {
    const created = await createNotificationRow({
      ...data,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
    } as any);
    notificationId = created?.id ?? null;
  } catch { /* non-fatal */ }

  // 3. Native push (Decision 15), fire-and-forget.
  //    `dispatchPushAsync` returns void synchronously and swallows every
  //    failure: no push — missing Expo credentials, an absent `push_tokens`
  //    table before migration 0006, an Expo outage — may ever fail or delay the
  //    request that produced the notification. The push preference gate and the
  //    invalid-token cleanup live inside push-service.
  dispatchPushAsync({
    recipientId: data.recipientId,
    type: data.type,
    message: data.message,
    link: data.link ?? null,
    actorId: (data as any).actorId ?? null,
    actorName: (data as any).actorName ?? null,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    notificationId,
  });

  // 4. Send email if resend is configured + event is email-worthy.
  //    Unchanged: this branch reads the EIGHT `notification_preferences` email
  //    keys. The five push keys above are a separate model and are never
  //    consulted here, nor is this model consulted for push (Decision 15).
  if (!resend) return;
  if (!EMAIL_NOTIFICATION_TYPES.has(data.type)) return;

  try {
    // Get recipient email
    const recipient = await storage.getUser(data.recipientId);
    if (!recipient?.email) return;

    // Check notification preferences
    const prefs = await (storage as any).getNotifPrefs(data.recipientId) as any;
    if (prefs) {
      const prefKey: Record<string, string> = {
        interest: "emailNewOffers",
        interest_accepted: "emailProjectInvitations",
        interest_declined: "emailProjectInvitations",
        counter_offered: "emailCounterOffers",
        project_started: "emailProjectInvitations",
        stage_submitted: "emailStageUpdates",
        stage_approved: "emailStageUpdates",
        payment_requested: "emailPaymentUpdates",
        payment_received: "emailPaymentUpdates",
        project_completed: "emailPaymentUpdates",
        review_requested: "emailReviewRequests",
        message: "emailMessages",
      };
      const key = prefKey[data.type];
      if (key && prefs[key] === false) return; // user opted out
    }

    const subject = NOTIF_TYPE_LABELS[data.type] ?? "You have a notification on Viewrr";
    const linkUrl = data.link ? `https://www.viewrr.co.uk/#${data.link}` : "https://www.viewrr.co.uk";
    const html = `
      <div style="font-family:system-ui,sans-serif;background:#0d0d0d;color:#f5f5f5;padding:40px 20px;">
        <div style="max-width:560px;margin:0 auto;">
          <img src="https://www.viewrr.co.uk/viewrr-logo.png" alt="Viewrr" height="28" style="margin-bottom:32px;" />
          <div style="background:#1a1a1a;border-radius:16px;padding:32px;border:1px solid #2a2a2a;">
            <h2 style="color:#FF5A1F;font-size:20px;font-weight:700;margin:0 0 8px;">${subject}</h2>
            <p style="color:#cccccc;font-size:15px;line-height:1.6;margin:0 0 24px;">${data.message}</p>
            <a href="${linkUrl}" style="display:inline-block;background:linear-gradient(135deg,#FF5A1F,#FF8C42);color:#fff;text-decoration:none;padding:12px 28px;border-radius:9999px;font-weight:600;font-size:14px;">View on Viewrr →</a>
          </div>
          <p style="color:#555;font-size:12px;margin-top:24px;text-align:center;">
            You can manage your email preferences in your <a href="https://www.viewrr.co.uk/#/settings/notifications" style="color:#FF5A1F;">notification settings</a>.
          </p>
        </div>
      </div>`;

    await resend.emails.send({
      from: "Viewrr <notifications@viewrr.co.uk>",
      to: recipient.email,
      subject,
      html,
    });
  } catch (emailErr: any) {
    console.warn("[notify] Email send failed (non-fatal):", emailErr?.message);
  }
}

export async function registerRoutes(httpServer: Server, app: Express) {
  // P0-04: Parse cookies so session tokens are accessible via req.cookies
  app.use(cookieParser());
  // PRD-019: Origin validation defence-in-depth (CSRF mitigation for cookie-auth unsafe methods)
  app.use(requireBrowserOrigin);
  // ─── Version / health ─────────────────────────────────────────────────────
  // ─── P0-07: Rate limiting ──────────────────────────────────────────────────
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts. Please wait 15 minutes before trying again." },
    skipSuccessfulRequests: true,
  });
  const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many password reset requests. Please wait an hour before trying again." },
  });

  // PRD-018 H3: Verification code rate limiter
  const verificationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5, // max 5 verification code requests per 10 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many verification requests. Please wait 10 minutes." },
  });

  // PRD 1: per-ADDRESS verification limiter, layered on top of the per-IP
  // verificationLimiter above. The IP limiter alone does not stop an attacker
  // rotating IPs to bomb one person's inbox with Viewrr-branded email.
  const sendVerificationEmailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 verification emails per address per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many verification emails sent to that address. Please wait an hour." },
    keyGenerator: (req) => String((req.body?.email ?? "").toString().trim().toLowerCase() || req.ip),
  });

  // PRD 1 (contract §G): feed write limiters. Before this there was NO rate
  // limit on posting or commenting at all — a single script could fill the feed.
  // Keyed by user id (falling back to IP) using the same pattern as
  // reportLimiter further down this file.
  const postLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20, // 20 posts/hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "You have posted a lot in the last hour. Please wait before posting again." },
    keyGenerator: (req) => String((req as any).auth?.userId ?? req.ip),
  });
  const commentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60, // 60 comments/hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "You have commented a lot in the last hour. Please wait before commenting again." },
    keyGenerator: (req) => String((req as any).auth?.userId ?? req.ip),
  });
  const likeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60, // 60 likes/minute — generous, but stops like-bombing as a ping
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Slow down a moment." },
    keyGenerator: (req) => String((req as any).auth?.userId ?? req.ip),
  });

  // PRD-018 F2: Upload rate limiter
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 upload calls per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many uploads. Please wait before uploading more files." },
  });

  // PRD-018 E3: Profile view rate limiter
  const profileViewLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // max 20 profile view records per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many profile views recorded. Please slow down." },
  });

  // PRD-018 G4: Brief and interest rate limiters
  const briefLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    message: { error: "Too many briefs submitted. Please wait." },
    standardHeaders: true,
    legacyHeaders: false,
  });
  const interestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: "Too many interest submissions. Please wait." },
    standardHeaders: true,
    legacyHeaders: false,
  });
  // PRD-019 C13: Rate limiter for verify-code (brute-force protection)
  const verifyCodeLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10, // max 10 attempts per 10 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many verification attempts. Please try again later." },
  });
  // PRD-019: Rate limiter for registration (account creation spam prevention)
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many accounts created from this address. Please wait." },
  });

  app.get("/api/version", (_req, res) => res.json({ version: "2026-05-11-agency", features: ["agency", "accountSubtype"] }));

  // ─── Auth ─────────────────────────────────────────────────────────────────
  // PRD-019: Web login — issues DB-backed opaque cookie, never raw token in body.
  // P0-01: Null-password path closed | P0-02: safeUserDto | P0-07: loginLimiter
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password." });

    if (!user.passwordHash) {
      return res.status(401).json({
        error: "This account does not have a password set. Please use 'Forgot password' to create one.",
        code: "NO_PASSWORD_SET",
      });
    }
    if (!password) return res.status(401).json({ error: "Password required." });

    // PRD-019: Verify password (legacy SHA-256 or Argon2id)
    const { valid, wasLegacy } = await verifyPassword(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password." });

    // PRD-019: Opportunistic Argon2id migration (fire-and-forget; never blocks login)
    if (wasLegacy) {
      migratePasswordIfLegacy(user.id, password).catch((e: any) =>
        console.warn("[login] Password migration failed (non-fatal):", e?.message)
      );
    }

    let profile = user.role === "freelancer" ? await storage.getProfileByUserId(user.id) : null;
    if (user.role === "freelancer" && !profile) {
      try {
        await storage.createProfile({
          userId: user.id,
          specialisms: "[]", skills: "[]", availability: "available",
          yearsExperience: 0, portfolioItems: "[]", socialLinks: "{}",
          rating: 0, reviewCount: 0, projectCount: 0, featured: 0, badges: "[]", isPro: 0,
        });
        profile = await storage.getProfileByUserId(user.id) ?? null;
      } catch (e: any) {
        console.warn("[login] Could not auto-create missing profile:", e.message);
      }
    }
    // PRD-019: Issue DB-backed opaque cookie. Raw token NEVER returned in JSON.
    const { rawToken } = await createWebSession(user.id);
    res.cookie(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 8 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({ user: safeUserDto(user), profile });
  });

  // PRD-019: Mobile login — separate endpoint; returns raw Bearer token in body once.
  app.post("/api/auth/mobile/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password." });
    if (!user.passwordHash) {
      return res.status(401).json({
        error: "This account does not have a password set. Please use 'Forgot password' to create one.",
        code: "NO_PASSWORD_SET",
      });
    }
    if (!password) return res.status(401).json({ error: "Password required." });

    const { valid, wasLegacy } = await verifyPassword(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password." });

    if (wasLegacy) {
      migratePasswordIfLegacy(user.id, password).catch((e: any) =>
        console.warn("[mobile/login] Password migration failed (non-fatal):", e?.message)
      );
    }
    // PRD-019: Mobile session — Bearer token in body; NO cookie.
    const { rawToken } = await createMobileSession(user.id);
    res.json({ user: safeUserDto(user), token: rawToken });
  });

  // PRD-019: Registration — Argon2id for new hashes; DB-backed session; registerLimiter.
  app.post("/api/auth/register", registerLimiter, async (req, res) => {
    try {
      const { name, email, role, phone, password } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: "Name, email and role are required" });
      const ALLOWED_ROLES = ["freelancer", "client"];
      if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "Email already registered" });
      const userData: any = { name, email, role, passwordAlgo: "sha256_v1" };
      if (phone) userData.phone = phone;
      if (password) {
        userData.passwordHash = await hashPasswordArgon2id(password);
        userData.passwordAlgo = "argon2id";
      }
      const user = await storage.createUser(userData);

      let profile = null;
      if (role === "freelancer") {
        try {
          profile = await storage.createProfile({
            userId: user.id,
            specialisms: "[]",
            skills: "[]",
            availability: "available",
            yearsExperience: 0,
            portfolioItems: "[]",
            socialLinks: "{}",
            rating: 0,
            reviewCount: 0,
            projectCount: 0,
            featured: 0,
            badges: "[]",
            isPro: 0,
          });
        } catch (profileErr: any) {
          console.warn("[register] Could not auto-create profile:", profileErr.message);
        }
      }

      // PRD-019: DB-backed session cookie on registration
      const { rawToken } = await createWebSession(user.id);
      res.cookie(SESSION_COOKIE_NAME, rawToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      });
      res.json({ user: safeUserDto(user), profile });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── PRD 1: Mobile registration (contract §D) ─────────────────────────────
  //
  // Deliberately a SEPARATE endpoint from POST /api/auth/register. The web
  // endpoint above accepts a missing password (historic behaviour relied on by
  // the web signup flow and asserted by test T19-SEC in
  // server/tests/security.test.ts) and must not be tightened here. Mobile is a
  // new surface with no legacy callers, so it gets the strict rules:
  //   • password REQUIRED, minimum 10 characters
  //   • email lowercased before storage, uniqueness checked case-insensitively
  //   • Argon2id only — never the legacy sha256_v1 path
  //   • roles limited to freelancer | client
  //   • email verification REQUIRED (Decision 4: new accounts only; every
  //     pre-migration account is grandfathered by migration 0006)
  const MOBILE_REGISTER_MIN_PASSWORD = 10;

  // Not a password policy — a floor. The top handful of passwords account for a
  // large share of credential-stuffing hits, and blocking them costs nothing.
  // Deliberately short and dependency-free (Decision 9: no new dependencies).
  const COMMON_PASSWORD_DENYLIST = new Set([
    "password", "password1", "password12", "password123", "password1234",
    "passw0rd123", "1234567890", "12345678901", "123456789012",
    "qwertyuiop", "qwerty12345", "letmein123", "welcome123", "iloveyou123",
    "admin12345", "administrator", "viewrr1234", "viewrr12345", "viewrrviewrr",
    "freelancer1", "changeme123", "secret1234", "trustno1234", "football123",
    "monkey12345", "dragon12345", "baseball123", "sunshine123", "princess123",
    "abc123456789", "aaaaaaaaaa", "1111111111", "0000000000",
  ]);

  const mobileRegisterSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
    password: z.string()
      .min(MOBILE_REGISTER_MIN_PASSWORD, `Password must be at least ${MOBILE_REGISTER_MIN_PASSWORD} characters`)
      .max(200, "Password is too long"),
    role: z.enum(["freelancer", "client"]),
    phone: z.string().trim().max(32).optional(),
  });

  app.post("/api/auth/mobile/register", registerLimiter, async (req, res) => {
    try {
      const parsed = mobileRegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid registration details",
          code: "VALIDATION_ERROR",
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
      }
      const { name, email, password, role, phone } = parsed.data;

      if (COMMON_PASSWORD_DENYLIST.has(password.toLowerCase())) {
        return res.status(400).json({
          error: "That password is too common. Please choose something harder to guess.",
          code: "WEAK_PASSWORD",
        });
      }
      // Cheap structural check: a password that is only the email local part is
      // as guessable as a denylisted one.
      if (password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 5) {
        return res.status(400).json({
          error: "Your password cannot contain your email address.",
          code: "WEAK_PASSWORD",
        });
      }

      // getUserByEmail now compares lowercased on both sides, so this catches
      // historic mixed-case rows too.
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "That email is already registered. Try signing in instead.", code: "EMAIL_IN_USE" });
      }

      const userData: any = {
        name,
        email, // already lowercased by the zod transform
        role,
        passwordHash: await hashPasswordArgon2id(password),
        passwordAlgo: "argon2id",
        emailVerified: false,
      };
      if (phone) userData.phone = phone;

      let user;
      try {
        user = await storage.createUser(userData);
      } catch (createErr: any) {
        // Unique-constraint race between the check above and the insert.
        if (/duplicate key|unique constraint/i.test(createErr?.message ?? "")) {
          return res.status(409).json({ error: "That email is already registered. Try signing in instead.", code: "EMAIL_IN_USE" });
        }
        throw createErr;
      }

      let profile = null;
      if (role === "freelancer") {
        try {
          profile = await storage.createProfile({
            userId: user.id,
            specialisms: "[]", skills: "[]", availability: "available",
            yearsExperience: 0, portfolioItems: "[]", socialLinks: "{}",
            rating: 0, reviewCount: 0, projectCount: 0, featured: 0, badges: "[]", isPro: 0,
          });
        } catch (profileErr: any) {
          console.warn("[mobile/register] Could not auto-create profile:", profileErr?.message);
        }
      }

      // Mobile session — Bearer token in the body once. NO cookie (contract §D).
      const { rawToken } = await createMobileSession(user.id);

      // Fire-and-forget the first verification email. A mail failure must not
      // fail registration — the client can call resend-verification.
      sendVerificationEmail(user.email).catch((e: any) =>
        console.warn("[mobile/register] Verification email failed (non-fatal):", e?.message)
      );

      return res.status(201).json({
        user: safeUserDto(user),
        profile,
        token: rawToken,
        emailVerificationRequired: true,
      });
    } catch (e: any) {
      console.error("[mobile/register] Failed:", e?.message);
      return res.status(400).json({ error: "Could not create your account. Please try again." });
    }
  });

  // PRD 1: resend the verification code for the AUTHENTICATED user only.
  // Unlike /api/auth/send-verification this cannot be pointed at a third
  // party's address, because the address is read from the session.
  app.post("/api/auth/mobile/resend-verification", requireAuth, verificationLimiter, async (req, res) => {
    try {
      const user = await storage.getUser(req.auth!.userId);
      if (!user?.email) return res.status(404).json({ error: "Account not found" });
      if ((user as any).emailVerified) {
        return res.json({ sent: true, alreadyVerified: true });
      }
      const sent = await sendVerificationEmail(user.email);
      if (!sent.ok && !sent.dev) {
        return res.status(503).json({ error: "Email service unavailable. Please try again shortly." });
      }
      return res.json({ sent: true, dev: sent.dev ? true : undefined });
    } catch (e: any) {
      console.error("[mobile/resend-verification] Failed:", e?.message);
      return res.status(500).json({ error: "Could not send verification email" });
    }
  });

  // PRD 1: confirm the emailed code. requireAuth, so the code can only ever
  // verify the session holder's own address.
  app.post("/api/auth/mobile/verify-email", requireAuth, verifyCodeLimiter, async (req, res) => {
    try {
      const parsed = z.object({ code: z.string().trim().min(4).max(12) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Verification code required" });

      const user = await storage.getUser(req.auth!.userId);
      if (!user?.email) return res.status(404).json({ error: "Account not found" });
      if ((user as any).emailVerified) return res.json({ verified: true, alreadyVerified: true });

      const result = await verifyCode(user.email, "email_verification", parsed.data.code);
      if (!result.ok) {
        return res.status(400).json({ error: result.error ?? "Invalid or expired code", code: "INVALID_CODE" });
      }

      const nowIso = new Date().toISOString();
      await db.update(schema.users)
        .set({ emailVerified: true, emailVerifiedAt: new Date(nowIso) } as any)
        .where(eq(schema.users.id, user.id));

      return res.json({ verified: true, emailVerified: true, emailVerifiedAt: nowIso });
    } catch (e: any) {
      console.error("[mobile/verify-email] Failed:", e?.message);
      return res.status(500).json({ error: "Could not verify your email" });
    }
  });

  // PRD 1 / Decision 4: enforce email verification for NEW accounts ONLY.
  //
  // This middleware needs no date check. Migration 0006 backfills
  // email_verified = true for every account that existed before the migration
  // ran, so a false value can only mean "created after verification shipped and
  // has not confirmed yet". Existing users can never be locked out by this.
  //
  // Applied to content-producing endpoints only — never to reading, never to
  // auth, never to account deletion or data export (blocking a GDPR right
  // behind an email click would be indefensible), and never to anything on an
  // in-flight project.
  async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await storage.getUser(req.auth!.userId);
      if (!user) return res.status(401).json({ error: "Authentication required." });
      if ((user as any).emailVerified === false) {
        return res.status(403).json({
          error: "Please confirm your email address before posting. Check your inbox for your code.",
          code: "EMAIL_VERIFICATION_REQUIRED",
        });
      }
      return next();
    } catch (e: any) {
      // Fail OPEN on infrastructure failure: a DB blip must not stop verified
      // users from working. requireAuth has already established identity.
      console.warn("[requireVerifiedEmail] check failed, allowing:", e?.message);
      return next();
    }
  }

  // PRD-019: Revocable logout — D5 rules.
  app.post("/api/auth/logout", async (req, res) => {
    const bearerHeader = req.headers["authorization"];
    const cookieValue  = req.cookies?.[SESSION_COOKIE_NAME];
    const hasBearerHeader = (bearerHeader ?? "").startsWith("Bearer ");

    const bearerSession = hasBearerHeader
      ? await findSessionByToken(bearerHeader!.slice(7))
      : null;
    const cookieSession = cookieValue
      ? await findSessionByToken(cookieValue)
      : null;

    if (bearerSession && cookieSession) {
      if (bearerSession.userId !== cookieSession.userId) {
        return res.status(401).json({ error: "Conflicting authentication credentials.", code: "AUTH_CONFLICT" });
      }
      await revokeSession(bearerSession.sessionId, "logout");
      await revokeSession(cookieSession.sessionId, "logout");
      clearSessionCookie(res);
      return res.json({ ok: true });
    }
    if (bearerSession) {
      if (isSessionValid(bearerSession)) await revokeSession(bearerSession.sessionId, "logout");
      return res.json({ ok: true });
    }
    if (cookieSession) {
      if (isSessionValid(cookieSession)) await revokeSession(cookieSession.sessionId, "logout");
      clearSessionCookie(res);
      return res.json({ ok: true });
    }
    // Legacy HMAC drain: clear cookie; server-side revocation impossible for HMAC tokens
    clearSessionCookie(res);
    return res.json({ ok: true });
  });

  // PRD-019: /api/auth/me
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.auth!.userId);
    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Authentication required." });
    }
    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar ?? null,
        isAdmin: user.isAdmin,
        sessionType: req.auth!.clientType ?? "web",
      },
    });
  });

  // ─── Email Verification ───────────────────────────────────────────────────
  //
  // PRD 1 hardening. This endpoint is UNAUTHENTICATED because the web signup
  // flow needs it before an account exists. As written before, that made it an
  // open relay for Viewrr-branded email: any caller could post any address and
  // Viewrr would send mail to it, and the route also logged the address on
  // every request and echoed the provider error back to the client.
  //
  // Fixed here:
  //   • the address is validated and normalised before use
  //   • a per-address limiter sits alongside the existing per-IP limiter, so
  //     rotating IPs no longer lets you bomb one inbox
  //   • addresses that already belong to a VERIFIED account are refused — an
  //     existing user cannot be spammed through the signup path (they have
  //     /api/auth/mobile/resend-verification, which requires their session)
  //   • the response is identical whether or not the address exists, so this is
  //     not an account-enumeration oracle
  //   • the address is no longer logged, and the provider error is no longer
  //     returned to the caller
  app.post("/api/auth/send-verification", verificationLimiter, sendVerificationEmailLimiter, async (req, res) => {
    const parsed = z.object({
      email: z.string().trim().toLowerCase().email().max(254),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address" });
    const email = parsed.data.email;

    // Same response body in every branch below (except a genuine outage), so
    // timing aside this reveals nothing about who has an account.
    const GENERIC_OK = { ok: true } as const;

    try {
      const existing = await storage.getUserByEmail(email);
      if (existing && (existing as any).emailVerified) {
        // Already verified: send nothing. Returning ok:true keeps this from
        // being an enumeration oracle.
        return res.json(GENERIC_OK);
      }
    } catch (lookupErr: any) {
      console.warn("[verify] Account lookup failed, sending anyway:", lookupErr?.message);
    }

    const sent = await sendVerificationEmail(email);
    if (sent.dev) return res.json({ ok: true, dev: true });
    if (!sent.ok) {
      // Fail closed without revealing whether the provider is misconfigured.
      return res.status(503).json({ error: "Email service unavailable. Please try again later." });
    }
    return res.json(GENERIC_OK);
  });

  // ─── SMS Verification ──────────────────────────────────────────────────────
  // FR-01/PRD-017: SMS_VERIFICATION_ENABLED controls whether phone-based signup is active.
  // Set SMS_VERIFICATION_ENABLED=true in the environment (alongside an SMS provider) to re-enable.
  // While false: route returns 503, no provider is required, implementation is callable code below.
  const SMS_VERIFICATION_ENABLED = process.env.SMS_VERIFICATION_ENABLED === "true";

  app.post("/api/auth/send-sms-verification", async (req, res) => {
    if (!SMS_VERIFICATION_ENABLED) {
      return res.status(503).json({
        error: "SMS verification is not currently available. Please use email verification instead.",
        code: "SMS_DISABLED",
      });
    }

    // SMS implementation — active when SMS_VERIFICATION_ENABLED=true
    const { phone, email } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    // PRD-020 WS-E: code stored in DB (hashed); raw code returned only to caller for emailing
    const code = await createVerificationCode(phone.replace(/\s+/g, ""), "sms_verification");

    if (!resend || !email) {
      // PRD-018 H4: RESEND not configured or no email address.
      // Development only: log code to server console.
      // Production: fail closed — never log or return the code.
      if (process.env.NODE_ENV !== "production") {
        console.log(`[verify-sms][DEV ONLY] RESEND_API_KEY not set or no email — code for ${phone}: ${code}`);
        return res.json({ ok: true, dev: true });
      }
      return res.status(503).json({ error: "SMS verification service unavailable. Please try again later." });
    }
    try {
      await resend.emails.send({
        from: "Viewrr <noreply@viewrr.co.uk>",
        to: email,
        subject: "Your Viewrr verification code",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <div style="margin-bottom:24px;">
              <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="8" fill="#FF5A1F"/>
                <path d="M7 8l7 16h4l7-16h-4l-5 11.5L11 8H7z" fill="white"/>
              </svg>
            </div>
            <h1 style="font-size:24px;font-weight:700;color:#111;margin:0 0 8px;">Your verification code</h1>
            <p style="color:#555;margin:0 0 32px;">Enter this code in the Viewrr signup page. It expires in 10 minutes.</p>
            <div style="background:#f5f5f5;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px;">
              <span style="font-size:48px;font-weight:800;letter-spacing:12px;color:#FF5A1F;">${code}</span>
            </div>
            <p style="color:#999;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[verify-sms] Error:", e.message);
      res.status(500).json({ error: "Failed to send code" });
    }
  });

  // PRD-019 C13: verifyCodeLimiter applied (10/10min/IP — brute-force protection)
  // PRD-020 WS-E: Now DB-backed via verification-service (hashed codes, attempt counting)
  app.post("/api/auth/verify-code", verifyCodeLimiter, async (req, res) => {
    const { email, phone, code } = req.body;
    const key = phone ? phone.replace(/\s+/g, "") : email?.toLowerCase();
    if (!key || !code) return res.status(400).json({ error: "Email or phone and code required" });

    const purpose: VerificationPurpose = phone ? "sms_verification" : "email_verification";
    const result = await verifyCode(key, purpose, String(code).trim());
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  // ─── P0-05: Token-based password reset ─────────────────────────────────────
  // POST /api/auth/forgot-password — issues a secure token, sends email
  // POST /api/auth/reset-password  — validates token + sets new password
  // Security: token = 32 random bytes; only SHA-256 hash stored in DB;
  //           expires 15 min; single-use; generic response hides account existence.
  app.post("/api/auth/forgot-password", resetLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email required." });
      const GENERIC_OK = { ok: true, message: "If an account exists for that email, a reset link has been sent." };
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) return res.json(GENERIC_OK); // generic — do not reveal account existence

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await storage.createPasswordResetToken(user.id, tokenHash, expiresAt);

      const resetUrl = `${APP_BASE_URL}/#/reset-password?token=${rawToken}`;
      if (resend) {
        await resend.emails.send({
          from: "Viewrr <noreply@viewrr.co.uk>",
          to: user.email,
          subject: "Reset your Viewrr password",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
              <div style="margin-bottom:24px;">
                <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="32" height="32" rx="8" fill="#FF5A1F"/>
                  <path d="M7 8l7 16h4l7-16h-4l-5 11.5L11 8H7z" fill="white"/>
                </svg>
              </div>
              <h1 style="font-size:24px;font-weight:700;color:#111;margin:0 0 8px;">Reset your password</h1>
              <p style="color:#555;margin:0 0 32px;">Someone requested a password reset for your Viewrr account. This link expires in 15 minutes.</p>
              <a href="${resetUrl}" style="display:inline-block;background:#FF5A1F;color:white;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;">Reset my password</a>
              <p style="color:#999;font-size:13px;margin-top:32px;">If you didn't request this, you can safely ignore this email. Your password will not change.</p>
            </div>
          `,
        });
      } else {
        // PRD-018 H5: RESEND not configured.
        // NEVER log the raw reset URL or token — it would grant password-reset access to anyone with log access.
        // Development only: surface a dev notice (no token).
        // Production: fail closed.
        if (process.env.NODE_ENV !== "production") {
          console.log("[forgot-password][DEV ONLY] RESEND_API_KEY not set. Reset email NOT sent for " + user.email + ". Token has been stored in DB and will expire in 15 minutes.");
        } else {
          console.error("[forgot-password] RESEND_API_KEY not configured in production. Reset email could not be sent.");
          // Return error in production so user knows the email was not delivered
          return res.status(503).json({ error: "Email service unavailable. Please contact support@viewrr.co.uk to reset your password." });
        }
      }
      res.json(GENERIC_OK);
    } catch (e: any) {
      console.error("[forgot-password] Error:", e.message);
      res.status(500).json({ error: "Failed to send reset email. Please try again." });
    }
  });

  app.post("/api/auth/reset-password", resetLimiter, async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: "Token and new password are required." });
      if (newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

      const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
      // P0-05: Atomic transaction — token consumption and password update committed together.
      // PRD-019: Password reset uses Argon2id; revokes all active DB sessions for that user.
      const newHash = await hashPasswordArgon2id(newPassword);
      const result = await storage.atomicConsumeTokenAndResetPassword(tokenHash, newHash);
      if (!result.ok) {
        const msg = result.reason === "used"
          ? "This reset link has already been used. Please request a new one."
          : "Invalid or expired reset link. Please request a new one.";
        return res.status(400).json({ error: msg });
      }
      // PRD-019: Revoke all active DB-backed sessions after password reset.
      const successResult = result as { ok: true; userId: number };
      await revokeAllUserSessions(successResult.userId, "password_reset");
      res.json({ ok: true, message: "Password updated successfully. You can now sign in." });
    } catch (e: any) {
      console.error("[reset-password] Error:", e.message);
      res.status(500).json({ error: "Failed to reset password. Please try again." });
    }
  });

  // ─── File uploads ──────────────────────────────────────────────────────
  // PRD-018 F3: Max 20 MB per file (reduced from 50 MB), images and videos only
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(os.tmpdir(), "viewrr-uploads");
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 }, // PRD-018 F3: 20 MB (reduced from 50 MB)
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
        cb(null, true);
      } else {
        cb(new Error("Only images and videos are allowed"));
      }
    },
  });

  // Portfolio upload — accepts up to 12 files, returns their server paths/URLs
  // PRD-018 A1: requireAuth; F2: uploadLimiter; F4: path field removed from response
  app.post("/api/upload/portfolio",
    requireAuth,
    uploadLimiter,
    upload.array("files", 12),
    (req: any, res: any) => {
      try {
        const files: Express.Multer.File[] = req.files as Express.Multer.File[];
        if (!files || files.length === 0) return res.status(400).json({ error: "No files received" });
        // PRD-018 F4: do NOT expose server path in response
        const result = files.map(f => ({
          filename: f.filename,
          originalName: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        }));
        res.json({ ok: true, files: result, count: result.length });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // Error handler specifically for multer (file too large, wrong type, etc.)
  app.use("/api/upload", (err: any, _req: any, res: any, next: any) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 20 MB per file." });
    }
    if (err?.message) return res.status(400).json({ error: err.message });
    next(err);
  });

  // ─── WS-D: Durable object storage upload flow ─────────────────────────────────────
  // POST /api/upload/request  — get presigned PUT URL + create pending upload_objects record
  // POST /api/upload/confirm/:objectKey — confirm upload, set status=ready
  // GET  /api/upload/download/:id — get presigned GET URL (auth required, ownership check)

  app.post("/api/upload/request", requireAuth, uploadLimiter, async (req: any, res: any) => {
    try {
      if (!STORAGE_CONFIGURED) {
        return res.status(503).json({ error: "Object storage not configured" });
      }

      const { resourceType, mimeType, fileSizeBytes, originalFilename } = req.body;
      const userId: number = req.auth!.userId;

      // Validate resourceType
      const validResourceTypes: ResourceType[] = ["portfolio", "profile", "project", "deliverable", "message"];
      if (!validResourceTypes.includes(resourceType)) {
        return res.status(400).json({ error: `Invalid resourceType. Must be one of: ${validResourceTypes.join(", ")}` });
      }

      // Validate mimeType
      if (!mimeType || !isAllowedMime(resourceType as ResourceType, mimeType)) {
        return res.status(400).json({ error: `MIME type '${mimeType}' not allowed for resourceType '${resourceType}'` });
      }

      // Validate fileSizeBytes
      const maxBytes = MAX_UPLOAD_BYTES[resourceType as ResourceType];
      if (!fileSizeBytes || fileSizeBytes <= 0) {
        return res.status(400).json({ error: "fileSizeBytes must be a positive integer" });
      }
      if (fileSizeBytes > maxBytes) {
        return res.status(400).json({
          error: `File too large for resourceType '${resourceType}'. Maximum is ${Math.round(maxBytes / 1024 / 1024)} MB`,
        });
      }

      // Extract extension from MIME type or original filename
      let ext: string | undefined;
      if (originalFilename) {
        const dotIdx = originalFilename.lastIndexOf(".");
        if (dotIdx !== -1) ext = originalFilename.slice(dotIdx + 1);
      }
      if (!ext) {
        // Derive from MIME type
        const mimeExt: Record<string, string> = {
          "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
          "image/gif": "gif", "image/avif": "avif",
          "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
          "video/x-msvideo": "avi", "application/pdf": "pdf", "application/zip": "zip",
        };
        ext = mimeExt[mimeType];
      }

      // Generate server-controlled object key (FR-22)
      const objectKey = generateObjectKey(resourceType as ResourceType, userId, ext);

      // Presigned PUT URL (5 min expiry)
      const uploadIntentExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const uploadUrl = await createPresignedUploadUrl({
        objectKey,
        mimeType,
        maxSizeBytes: fileSizeBytes,
        expiresInSeconds: 300,
      });

      // Insert pending upload_objects record
      const sql = neon(process.env.DATABASE_URL!);
      const rows = await sql`
        INSERT INTO upload_objects
          (owner_user_id, object_key, resource_type, mime_type, original_filename,
           status, upload_intent_expires_at, created_at)
        VALUES
          (${userId}, ${objectKey}, ${resourceType}, ${mimeType},
           ${originalFilename ?? null}, 'pending', ${uploadIntentExpiresAt}, ${new Date().toISOString()})
        RETURNING id
      `;

      return res.json({ uploadUrl, objectKey, uploadId: rows[0].id });
    } catch (e: any) {
      console.error("[upload/request] Error:", e.message);
      return res.status(500).json({ error: "Failed to create upload intent", detail: e.message });
    }
  });

  app.post("/api/upload/confirm/*objectKey", requireAuth, async (req: any, res: any) => {
    try {
      if (!STORAGE_CONFIGURED) {
        return res.status(503).json({ error: "Object storage not configured" });
      }

      const raw = req.params.objectKey;
      const objectKey = Array.isArray(raw) ? raw.join("/") : raw;
      const userId: number = req.auth!.userId;

      // Look up upload_objects record, verify ownership
      const sql = neon(process.env.DATABASE_URL!);
      const rows = await sql`
        SELECT id, owner_user_id, status
        FROM upload_objects
        WHERE object_key = ${objectKey}
        LIMIT 1
      `;

      if (!rows.length) return res.status(404).json({ error: "Upload record not found" });
      const record = rows[0];
      if (record.owner_user_id !== userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (record.status === "ready") {
        return res.json({ ok: true, objectId: record.id, alreadyConfirmed: true });
      }

      // FR-24: Verify object actually exists in R2
      const existence = await verifyObjectExists(objectKey);
      if (!existence.exists) {
        return res.status(404).json({ error: "Object not found in storage — upload may not have completed" });
      }

      const now = new Date().toISOString();
      await sql`
        UPDATE upload_objects
        SET status = 'ready',
            confirmed_at = ${now},
            size_bytes = ${existence.size ?? null}
        WHERE id = ${record.id}
      `;

      return res.json({ ok: true, objectId: record.id });
    } catch (e: any) {
      console.error("[upload/confirm] Error:", e.message);
      return res.status(500).json({ error: "Failed to confirm upload", detail: e.message });
    }
  });

  app.get("/api/upload/download/:id", requireAuth, async (req: any, res: any) => {
    try {
      if (!STORAGE_CONFIGURED) {
        return res.status(503).json({ error: "Object storage not configured" });
      }

      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid upload id" });

      const userId: number = req.auth!.userId;
      const sql = neon(process.env.DATABASE_URL!);

      const rows = await sql`
        SELECT id, owner_user_id, object_key, resource_type, resource_id, status
        FROM upload_objects
        WHERE id = ${id}
        LIMIT 1
      `;

      if (!rows.length) return res.status(404).json({ error: "Upload not found" });
      const record = rows[0];

      if (record.status !== "ready") {
        return res.status(404).json({ error: "Upload not ready" });
      }

      // Check ownership OR project membership for project/deliverable resources
      let hasAccess = record.owner_user_id === userId;

      if (!hasAccess && record.resource_id && ["project", "deliverable"].includes(record.resource_type)) {
        // Check if user is a participant in the project
        const projectId = record.resource_type === "deliverable"
          ? await (async () => {
              // deliverable's project_id lives on the resource — use upload resource_id as project_id hint
              const proj = await sql`
                SELECT id FROM projects
                WHERE id = ${record.resource_id}
                  AND (freelancer_id = ${userId} OR client_id = ${userId})
                LIMIT 1
              `;
              return proj.length ? record.resource_id : null;
            })()
          : record.resource_id;

        if (projectId) {
          const projRows = await sql`
            SELECT id FROM projects
            WHERE id = ${projectId}
              AND (freelancer_id = ${userId} OR client_id = ${userId})
            LIMIT 1
          `;
          if (projRows.length) hasAccess = true;
        }
      }

      if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

      // FR-25: 15-min presigned download URL
      const downloadUrl = await createPresignedDownloadUrl(record.object_key, 900);
      return res.json({ downloadUrl });
    } catch (e: any) {
      console.error("[upload/download] Error:", e.message);
      return res.status(500).json({ error: "Failed to generate download URL", detail: e.message });
    }
  });

    // ─── Profiles ──────────────────────────────────────────────────────────────
  app.get("/api/profiles", async (req, res) => {
    const { specialism, availability, search, surface } = req.query as Record<string, string>;
    const profiles = await storage.getProfiles({
      specialism,
      availability,
      search,
      boostPro: surface !== "ios",
    });
    // PRD-018 E5: override stale projectCount with DB-authoritative completed-project count
    const userIds = profiles.map((p: any) => p.profile.userId as number);
    const countMap = await storage.getCompletedProjectCountsBulk(userIds);
    // PRD-018 E2: strip accreditation fields from public list
    res.json(profiles.map((p: any) => ({
      ...p,
      user: safePublicUser(p.user),
      profile: { ...safePublicProfile(p.profile), projectCount: countMap.get(p.profile.userId) ?? 0 },
    })));
  });

  app.get("/api/profiles/featured", async (req, res) => {
    const profiles = await storage.getFeaturedProfiles();
    // PRD-018 E5: override stale projectCount with DB-authoritative count
    const userIds = profiles.map((p: any) => p.profile.userId as number);
    const countMap = await storage.getCompletedProjectCountsBulk(userIds);
    // PRD-1 Stage 1: featured profiles must strip internal accreditation fields
    // too — reuse the same safePublicProfile helper as GET /api/profiles.
    res.json(profiles.map((p: any) => ({
      ...p,
      user: safePublicUser(p.user),
      profile: { ...safePublicProfile(p.profile), projectCount: countMap.get(p.profile.userId) ?? 0 },
    })));
  });

  // ─── Profile Views ───────────────────────────────────────────────────────
  // Called by ProfilePage on load — records one view per viewer per 24h
  // PRD-018 E3: rate limited to prevent view inflation; unauthenticated (public profiles)
  app.post("/api/profile-views/:id", profileViewLimiter, async (req, res) => {
    try {
      const rawId = Number(req.params.id);
      const viewerId: number | null = req.body.viewerId ?? null;
      const viewerIp: string = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0].trim();

      // Resolve to a user ID — the URL may carry either a profile ID or a user ID.
      // Try looking up as a profile ID first; if that gives us a user, use that user's ID.
      // Otherwise treat the raw value as a user ID directly.
      let profileOwnerId = rawId;
      const profileRow = await storage.getProfile(rawId);
      if (profileRow) {
        profileOwnerId = profileRow.user.id;
      } else {
        // Might already be a user ID — verify the user exists
        const userRow = await storage.getUser(rawId);
        if (!userRow) return res.json({ ok: true, notFound: true });
        profileOwnerId = userRow.id;
      }

      // Don't count someone viewing their own profile
      if (viewerId && viewerId === profileOwnerId) return res.json({ ok: true, self: true });

      // Check BEFORE inserting whether this viewer already has a recent view (for notification gating)
      const alreadyNotified = await storage.hasRecentProfileView(profileOwnerId, viewerId, viewerIp);

      // Always record the view (every visit counts)
      await storage.recordProfileView(profileOwnerId, viewerId, viewerIp);

      // Only send a notification once per viewer per 24h
      if (!alreadyNotified && viewerId && viewerId !== profileOwnerId) {
        const viewer = await storage.getUser(viewerId);
        if (viewer) {
          await notify({
            recipientId: profileOwnerId,
            actorId: viewer.id,
            actorName: viewer.name,
            actorAvatar: viewer.avatar ?? "",
            type: "profile_view",
            message: `${viewer.name} viewed your profile`,
            link: `/profile/${rawId}`,
            // Decision 14: the useful destination is the VIEWER's profile, not
            // the recipient's own. The web `link` points at `rawId` (the
            // profile that was viewed, i.e. the recipient) because that is what
            // the web centre has always done and it must not change — so the
            // structured target has to be explicit here rather than derived
            // from the link.
            targetType: "profile",
            targetId: viewer.id,
          });
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Total view count for a freelancer's dashboard
  app.get("/api/profile-views/:userId/count", async (req, res) => {
    try {
      const count = await storage.getProfileViewCount(Number(req.params.userId));
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 30-day history (for the sparkline chart)
  app.get("/api/profile-views/:userId/history", async (req, res) => {
    try {
      const days = Math.min(Number(req.query.days) || 30, 90);
      const history = await storage.getProfileViewHistory(Number(req.params.userId), days);
      res.json(history);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Quick lookup: get or create a profile by user ID (used by ReviewModal)
  app.get("/api/profile-by-user/:userId", async (req, res) => {
    try {
      const profile = await storage.getOrCreateProfileForUser(Number(req.params.userId));
      // PRD-018 E1: strip internal accreditation fields
      res.json(profile ? safePublicProfile(profile) : profile);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/profiles/:id", async (req, res) => {
    const idNum = Number(req.params.id);
    // 1. Try by profile ID first
    let pw = await storage.getProfile(idNum);
    // 2. Fall back to user ID (handles freelancer links from Feed)
    if (!pw) {
      const profileByUser = await storage.getProfileByUserId(idNum);
      if (profileByUser) pw = await storage.getProfile(profileByUser.id);
    }
    // 3. If still nothing — check if it's a valid user (e.g. a client with no profile row)
    if (!pw) {
      const userOnly = await storage.getUser(idNum);
      if (!userOnly) return res.status(404).json({ error: "Profile not found" });
      // Return a synthetic profile stub so the frontend can render a client card
      return res.json({
        isClientStub: true,
        profile: {
          id: null,
          userId: userOnly.id,
          specialisms: "[]",
          skills: "[]",
          hourlyRate: null,
          dayRate: null,
          availability: null,
          yearsExperience: null,
          reelUrl: null,
          portfolioItems: "[]",
          socialLinks: "{}",
          rating: 0,
          reviewCount: 0,
          projectCount: 0,
          featured: 0,
          badges: "[]",
          isPro: 0,
          proSince: null,
        },
        user: safePublicUser(userOnly),
        reviews: [],
      });
    }
    const reviews = await storage.getReviewsByProfile(pw.profile.id);
    // PRD-018 E5 (projectCount): override stale profiles.project_count with a DB-authoritative
    // count of projects WHERE freelancer_id = profile.userId AND status = 'completed'.
    // This column was always 0 (never incremented by routes). Now it reflects real completions.
    const completedProjectCount = await storage.getCompletedProjectCount(pw.profile.userId);
    const safeProfile = { ...safePublicProfile(pw.profile), projectCount: completedProjectCount };
    // PRD-018 E1: strip internal accreditation fields (safePublicProfile already applied above)
    res.json({ ...pw, user: safePublicUser(pw.user), profile: safeProfile, reviews });
  });

  // A0-U2
  app.patch("/api/profiles/:id", requireAuth, async (req, res) => {
    // A0: verify caller owns this profile before mutating
    const profileForAuth = await storage.getProfile(Number(req.params.id));
    if (!profileForAuth) return res.status(404).json({ error: "Profile not found" });
    if (req.auth!.userId !== profileForAuth.profile.userId) return res.status(403).json({ error: "Forbidden." });
    // P0-PRIV: Explicitly whitelist user-editable fields.
    // Privileged fields (accreditationLevel, accreditationApprovedBy, isPro, proSince,
    // featured, rating, reviewCount, projectCount, badges) are NEVER accepted from
    // the request body — they are managed server-side by admin routes only.
    const {
      specialisms, skills, hourlyRate, dayRate, availability,
      yearsExperience, reelUrl, portfolioItems, socialLinks, cardThumbnail,
    } = req.body;
    const patch: Record<string, any> = {};
    if (specialisms  !== undefined) patch.specialisms  = specialisms;
    if (skills       !== undefined) patch.skills       = skills;
    if (hourlyRate   !== undefined) patch.hourlyRate   = hourlyRate;
    if (dayRate      !== undefined) patch.dayRate      = dayRate;
    if (availability !== undefined) patch.availability = availability;
    if (yearsExperience !== undefined) patch.yearsExperience = yearsExperience;
    if (reelUrl      !== undefined) patch.reelUrl      = reelUrl;
    if (portfolioItems !== undefined) patch.portfolioItems = portfolioItems;
    if (socialLinks  !== undefined) patch.socialLinks  = socialLinks;
    if (cardThumbnail !== undefined) patch.cardThumbnail = cardThumbnail;
    const updated = await storage.updateProfile(Number(req.params.id), patch);
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    res.json(updated);
  });

  // ─── Reviews ──────────────────────────────────────────────────────────────
  // PRD-018 C1: Full review authorization
  // Viewrr operates a confirmed RECIPROCAL review system:
  //   - Client reviews the freelancer on a completed project
  //   - Freelancer reviews the client on a completed project
  // "role" in the request body = the REVIEWER's role ("client" or "freelancer")
  app.post("/api/reviews", requireAuth, async (req, res) => {
    try {
      const callerId = req.auth!.userId;

      // C1-1: projectId is mandatory for all reviews
      const projectId = Number(req.body.projectId);
      if (!projectId || isNaN(projectId)) {
        return res.status(400).json({ error: "projectId is required" });
      }

      // C1-2: rating must be an integer 1–5
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "rating must be an integer between 1 and 5" });
      }

      // C1-3: comment required (min 10 chars)
      const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";
      if (comment.length < 10) {
        return res.status(400).json({ error: "comment must be at least 10 characters" });
      }

      // C1-4: role must be "client" or "freelancer" (reviewer's role)
      const role = req.body.role as "client" | "freelancer";
      if (role !== "client" && role !== "freelancer") {
        return res.status(400).json({ error: "role must be 'client' or 'freelancer'" });
      }

      // C1-5: load the project from DB — server-authoritative
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });

      // C1-6: project must be in a completed (review-eligible) state
      if (pw.project.status !== "completed") {
        return res.status(403).json({ error: "Reviews are only accepted on completed projects" });
      }

      // C1-7: caller must be the party matching their declared role
      if (role === "client" && pw.project.clientId !== callerId) {
        return res.status(403).json({ error: "Only the project client can submit a client review" });
      }
      if (role === "freelancer" && pw.project.freelancerId !== callerId) {
        return res.status(403).json({ error: "Only the assigned freelancer can submit a freelancer review" });
      }

      // C1-8: server-derive the reviewee (target profile)
      // Client reviews the freelancer; freelancer reviews the client.
      const revieweeUserId = role === "client" ? pw.project.freelancerId! : pw.project.clientId;
      if (!revieweeUserId) {
        return res.status(400).json({ error: "Project is missing a required participant" });
      }
      // Ensure target profile exists (auto-creates stub for client profiles)
      const revieweeProfile = await storage.getOrCreateProfileForUser(revieweeUserId);
      const targetProfileId = revieweeProfile.id;

      // C1-9: reviewer identity is fully server-derived
      const actor = await storage.getUser(callerId);
      if (!actor) return res.status(404).json({ error: "Authenticated user not found" });

      // C1-10: duplicate-review prevention (application-level)
      // Checks reviewer (clientId) + project combination, regardless of profileId.
      const existingOnProfile = await storage.getReviewsByProfile(targetProfileId);
      const dupe = existingOnProfile.find(r => r.projectId === projectId && r.clientId === callerId);
      if (dupe) return res.status(409).json({ error: "You have already submitted a review for this project" });

      // C1-11: verifiedProjectReview is always server-set; body value is ignored
      const reviewData = {
        profileId: targetProfileId,
        clientId: callerId,
        clientName: actor.name,
        clientAvatar: actor.avatar ?? null,
        rating,
        comment,
        projectType: typeof req.body.projectType === "string" ? req.body.projectType : null,
        projectId,
        verifiedProjectReview: 1, // always 1 — project is completed and relationship verified above
      };

      const review = await storage.createReview(reviewData);

      // Mark review given on the project (tracks reciprocal review state)
      await storage.markReviewGiven(projectId, role);

      // Notify the reviewee
      await storage.createNotification({
        recipientId: revieweeUserId,
        actorId: callerId,
        actorName: actor.name,
        actorAvatar: actor.avatar || null,
        type: "review",
        message: `${actor.name} left you a ${rating}-star review`,
        link: "/dashboard",
        read: 0,
      });

      res.json(review);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Messages ─────────────────────────────────────────────────────────────
  // ─── Interest-scoped messages ─────────────────────────────────────────────
  // PRD-1 prerequisite: this route had NO auth and marked messages read from a
  // client-supplied `?userId=`. It now requires a session and the caller must be
  // a participant on the interest (brief client or freelancer). The mark-read
  // side effect on GET is removed — reads no longer mutate state, and interest
  // threads are excluded from the DM inbox anyway (Decision 17).
  app.get("/api/interest-messages/:interestId", requireAuth, async (req, res) => {
    const interestId = Number(req.params.interestId);
    if (!Number.isFinite(interestId) || interestId <= 0) {
      return res.status(400).json({ error: "Invalid interest id" });
    }
    const interest = await storage.getBriefInterest(interestId);
    if (!interest) return res.status(404).json({ error: "Interest not found" });
    const userId = req.auth!.userId;
    if (interest.briefClientId !== userId && interest.freelancerId !== userId) {
      return res.status(403).json({ error: "Not authorised" });
    }
    const msgs = await storage.getMessagesByInterest(interestId);
    res.set("Cache-Control", "private, no-store");
    res.json(msgs);
  });

  // GET /api/briefs/:id/interest-messages/:interestId (contract D, Decision 17)
  //
  // The Brief/Work-context home for negotiation threads, and the replacement
  // for the flat `/api/interest-messages/:interestId` route above. The brief id
  // is part of the path and is CHECKED against the interest, so an interest id
  // cannot be read through an unrelated brief. Interest threads deliberately do
  // NOT appear in the DM inbox or the DM unread count (Decision 17).
  app.get("/api/briefs/:id/interest-messages/:interestId", requireAuth, async (req, res) => {
    const briefId = Number(req.params.id);
    const interestId = Number(req.params.interestId);
    if (!Number.isFinite(briefId) || briefId <= 0 || !Number.isFinite(interestId) || interestId <= 0) {
      return res.status(400).json({ error: "Invalid brief or interest id" });
    }
    try {
      const interest = await storage.getBriefInterest(interestId);
      if (!interest || interest.briefId !== briefId) {
        return res.status(404).json({ error: "Interest not found" });
      }
      const userId = req.auth!.userId;
      // Participant only: the brief's client or the interested freelancer.
      if (interest.briefClientId !== userId && interest.freelancerId !== userId) {
        return res.status(403).json({ error: "Not authorised" });
      }
      const msgs = await storage.getMessagesByInterest(interestId);
      res.set("Cache-Control", "private, no-store");
      res.json(msgs);
    } catch (e: any) {
      res.status(500).json({ error: "Could not load interest messages" });
    }
  });

  // A0-M4
  app.post("/api/interest-messages", requireAuth, async (req, res) => {
    try {
      const { fromId, toId, content, interestId, briefTitle } = req.body;
      if (!fromId || !toId || !content || !interestId) {
        return res.status(400).json({ error: "Missing fields" });
      }
      // A0: caller must be the sender
      if (req.auth!.userId !== Number(fromId)) return res.status(403).json({ error: "Forbidden." });
      const msg = await storage.createMessage({ fromId, toId, content, interestId });
      // Notify recipient
      const actor = await storage.getUser(fromId);
      if (actor) {
        await notify({
          recipientId: toId,
          actorId: actor.id,
          actorName: actor.name,
          actorAvatar: actor.avatar ?? null,
          type: "message",
          message: `${actor.name} replied on "${briefTitle || "your interest"}"`,
          link: `/dashboard`,
          read: 0,
          // A DM thread is addressed by the counterparty's user id, so from the
          // recipient's point of view the sender IS the conversation id.
          targetType: "conversation",
          targetId: actor.id,
        });
      }
      res.json(msg);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Direct messages (general) ────────────────────────────────────────────
  //
  // PRD-1 wave 3 (Decisions 17, 18). The canonical surface is now:
  //   GET  /api/conversations
  //   GET  /api/conversations/:otherUserId/messages?after=&before=&limit=
  //   POST /api/messages/read
  //   GET  /api/messages/unread-count
  // The two legacy `/api/messages/...` id-in-path routes are kept below as thin
  // aliases so the shipped web product keeps working, but they are frozen: no
  // new behaviour is added to them and the read side effect is GONE.

  const DM_CONTENT_MAX = 4000;
  // Content cap + rate limit on sends (previously unbounded on both axes).
  const dmSendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,                                  // 30 messages / minute / account
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "You're sending messages too quickly. Please slow down." },
    keyGenerator: (req) => String((req as any).auth?.userId ?? req.ip),
  });

  /** Parse a positive integer query param, or undefined when absent/invalid. */
  function optionalPositiveInt(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.trunc(n);
  }

  // GET /api/messages/unread-count — DM unread total (contract D).
  // Decision 18: this is NOT the notification-centre count and the two are
  // never summed. Registered before the `/:userId/...` patterns for clarity.
  app.get("/api/messages/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getDmUnreadCount(req.auth!.userId);
      res.set("Cache-Control", "private, no-store");
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: "Could not load unread count" });
    }
  });

  // POST /api/messages/read — the explicit, idempotent mark-read (contract D).
  // Identity comes from req.auth, NOT from the path: that removes the whole
  // `/:fromId/:toId` "which id is the reader?" ambiguity class.
  app.post("/api/messages/read", requireAuth, async (req, res) => {
    const otherUserId = optionalPositiveInt(req.body?.otherUserId);
    if (!otherUserId) return res.status(400).json({ error: "otherUserId is required" });
    if (otherUserId === req.auth!.userId) {
      return res.status(400).json({ error: "otherUserId cannot be yourself" });
    }
    const upToMessageId = optionalPositiveInt(req.body?.upToMessageId);
    try {
      const markedRead = await storage.markDmMessagesRead(
        req.auth!.userId, otherUserId, upToMessageId
      );
      res.json({ markedRead });
    } catch (e: any) {
      res.status(500).json({ error: "Could not mark messages read" });
    }
  });

  // GET /api/conversations — the DM inbox (contract D).
  // Interest / negotiation rows are excluded in SQL (Decision 17).
  app.get("/api/conversations", requireAuth, async (req, res) => {
    try {
      const rows = await storage.getConversationSummaries(req.auth!.userId);
      res.set("Cache-Control", "private, no-store");
      res.json({
        items: rows,
        unreadTotal: rows.reduce((sum, r) => sum + (r.unread || 0), 0),
      });
    } catch (e: any) {
      res.status(500).json({ error: "Could not load conversations" });
    }
  });

  // GET /api/conversations/:otherUserId/messages — one page of a thread.
  // Cursors are MESSAGE IDS: `messages.created_at` is a text column and is not
  // a reliable order (contract section A).
  app.get("/api/conversations/:otherUserId/messages", requireAuth, async (req, res) => {
    const otherUserId = optionalPositiveInt(req.params.otherUserId);
    if (!otherUserId) return res.status(400).json({ error: "Invalid conversation id" });
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.trunc(rawLimit), 100)
      : 40;
    try {
      const page = await storage.getDmMessagePage(req.auth!.userId, otherUserId, {
        after: optionalPositiveInt(req.query.after),
        before: optionalPositiveInt(req.query.before),
        limit,
      });
      res.set("Cache-Control", "private, no-store");
      res.json({
        // Contract names the text field `body`; the column is `content`.
        items: page.items.map(m => ({
          id: m.id,
          fromId: m.fromId,
          toId: m.toId,
          body: m.content,
          createdAt: m.createdAt,
          read: m.read ?? 0,
        })),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    } catch (e: any) {
      res.status(500).json({ error: "Could not load messages" });
    }
  });

  // LEGACY ALIAS (A0-M1) — same data as GET /api/conversations, legacy shape.
  app.get("/api/messages/:userId/conversations", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    const convs = await storage.getConversations(req.auth!.userId);
    res.json(convs);
  });

  // LEGACY ALIAS (A0-M2) — full thread, legacy row shape.
  //
  // PRD-1 wave 3: the `markMessagesRead(fromId, toId)` side effect that used to
  // live here is REMOVED. It was wrong twice over: a GET mutated state, and the
  // direction it marked depended on which path id the caller happened to put
  // first, so a client could mark the OTHER party's messages read. Clearing
  // unread is now an explicit POST /api/messages/read, and the web callers
  // (Dashboard.tsx, QuickMessageModal.tsx) were updated in the same change set.
  app.get("/api/messages/:fromId/:toId", requireAuth, async (req, res) => {
    const fromId = Number(req.params.fromId);
    const toId = Number(req.params.toId);
    // Caller must be one of the two parties
    if (req.auth!.userId !== fromId && req.auth!.userId !== toId) return res.status(403).json({ error: "Forbidden." });
    const msgs = await storage.getMessagesBetween(fromId, toId);
    res.set("Cache-Control", "private, no-store");
    res.json(msgs);
  });

  // A0-M3 — send a DM. Body tightened: only toId/content/interestId are read,
  // fromId is forced from the session, and content is length-capped.
  app.post("/api/messages", requireAuth, dmSendLimiter, async (req, res) => {
    try {
      const fromId = req.auth!.userId;
      const toId = optionalPositiveInt(req.body?.toId);
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
      const interestId = optionalPositiveInt(req.body?.interestId) ?? null;
      if (!toId) return res.status(400).json({ error: "toId is required" });
      if (toId === fromId) return res.status(400).json({ error: "You cannot message yourself" });
      if (!content) return res.status(400).json({ error: "Message content is required" });
      if (content.length > DM_CONTENT_MAX) {
        return res.status(400).json({ error: `Message is too long (max ${DM_CONTENT_MAX} characters).` });
      }
      // A0: caller must be the sender. `fromId` in the body is ignored, but a
      // mismatched one is still rejected so a confused client fails loudly.
      if (req.body?.fromId !== undefined && Number(req.body.fromId) !== fromId) {
        return res.status(403).json({ error: "Forbidden." });
      }
      const recipient = await storage.getUser(toId);
      if (!recipient) return res.status(404).json({ error: "Recipient not found" });

      const msg = await storage.createMessage({ fromId, toId, content, interestId, read: 0 });
      // Notify recipient of new message.
      // Decision 18: this notification row STAYS. Inbox unread and the
      // notification centre are different things and are never merged/summed.
      const actor = await storage.getUser(fromId);
      if (actor) {
        await notify({
          recipientId: toId,
          actorId: actor.id,
          actorName: actor.name,
          actorAvatar: actor.avatar ?? null,
          type: "message",
          message: `${actor.name} sent you a message`,
          link: `/dashboard`,
          read: 0,
          // Decision 18: this row stays and is NOT merged with inbox unread.
          // Decision 14: `/dashboard` carries no id, which is exactly why the
          // structured target exists.
          targetType: "conversation",
          targetId: actor.id,
        });
      }
      res.json(msg);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Saved ────────────────────────────────────────────────────────────────
  app.get("/api/saved/:clientId", async (req, res) => {
    res.json(await storage.getSaved(Number(req.params.clientId)));
  });

  // PRD-018 A4: requireAuth + derive clientId from session
  app.post("/api/saved/toggle", requireAuth, async (req, res) => {
    const { profileId } = req.body;
    const clientId = req.auth!.userId;
    const saved = await storage.toggleSaved(clientId, Number(profileId));
    res.json({ saved });
  });

  app.get("/api/saved/:clientId/:profileId", async (req, res) => {
    const saved = await storage.isSaved(Number(req.params.clientId), Number(req.params.profileId));
    res.json({ saved });
  });

  // ─── AI Search ────────────────────────────────────────────────────────────
  // PRD-018 A5: requireAuth gates the AI search endpoint
  app.post("/api/ai-search", requireAuth, async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query required" });

    // Smart keyword extraction + scoring (no external AI needed for demo)
    const q = query.toLowerCase();
    const specialismMap: Record<string, string> = {
      "film": "Videographer", "video": "Videographer", "shoot": "Videographer", "camera": "Videographer",
      "cinemat": "Videographer", "record": "Videographer", "footage": "Videographer",
      "edit": "Video Editor", "post": "Video Editor", "colour": "Video Editor", "color": "Video Editor",
      "grade": "Video Editor", "cut": "Video Editor", "final cut": "Video Editor",
      "market": "Marketer", "social": "Marketer", "content": "Marketer", "campaign": "Marketer",
      "brand": "Marketer", "tiktok": "Marketer", "instagram": "Marketer", "paid": "Marketer",
      "photo": "Photographer", "image": "Photographer", "portrait": "Photographer",
      "product photo": "Photographer", "lookbook": "Photographer",
      "drone": "Videographer", "aerial": "Videographer",
      "animation": "Video Editor", "motion": "Video Editor",
    };

    let detectedSpecialism = "";
    for (const [key, val] of Object.entries(specialismMap)) {
      if (q.includes(key)) { detectedSpecialism = val; break; }
    }

    const budgetMatch = q.match(/£(\d+)/);
    const budget = budgetMatch ? Number(budgetMatch[1]) : null;

    const profiles = await storage.getProfiles({
      specialism: detectedSpecialism || undefined,
      search: query
    });

    // If no exact matches, return all sorted by rating
    const results = profiles.length > 0 ? profiles : await storage.getProfiles({});

    const summary = detectedSpecialism
      ? `Found ${results.length} ${detectedSpecialism.toLowerCase()}${results.length !== 1 ? "s" : ""} matching your brief.`
      : `Found ${results.length} creative professionals that might suit your needs.`;

    res.json({
      summary,
      detectedSpecialism,
      budget,
      results: results.slice(0, 6),
    });
  });

  // ─── Users ────────────────────────────────────────────────────────────────
  // Search users for recipient picker — filtered to server-side connections
  app.get("/api/users/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    const excludeId = Number(req.query.excludeId) || 0;
    if (q.length < 2) return res.json([]);
    // Always use server-side connection list (DB-backed, accurate)
    let allowedIds: number[] | undefined;
    if (excludeId > 0) {
      allowedIds = await storage.getConnectionUserIds(excludeId);
      // If no connections, return empty (only search your connections)
    }
    const results = await storage.searchUsers(q, excludeId, allowedIds);
    res.json(results);
  });

  app.get("/api/users/:id", requireAuth, async (req, res) => {
    const userId = Number(req.params.id);
    if (req.auth!.userId !== userId) {
      return res.status(403).json({ error: "Forbidden." });
    }
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(safeUserDto(user)); // authenticated self-account response
  });

  // A0-U1
  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.id)) return res.status(403).json({ error: "Forbidden." });
    try {
      const { name, email, bio, avatar, banner, headline, location } = req.body;
      const updated = await storage.updateUser(Number(req.params.id), {
        ...(name     !== undefined && { name }),
        ...(email    !== undefined && { email }),
        ...(bio      !== undefined && { bio }),
        ...(avatar   !== undefined && { avatar }),
        ...(banner   !== undefined && { banner }),
        ...(headline !== undefined && { headline }),
        ...(location !== undefined && { location }),
      });
      res.json(safeUserDto(updated)); // P0-02
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Feed cache (2-min TTL) ────────────────────────────────────────────────
  // PRD-1 feed hardening:
  //  * Only ANONYMOUS responses are cached. Authenticated responses are
  //    viewer-specific (the `liked` flag) and are sent `private, no-store`,
  //    so caching them server-side would only risk serving stale viewer state.
  //  * The map is bounded to FEED_CACHE_MAX_ENTRIES with oldest-first eviction
  //    so an attacker cannot grow it without limit by varying limit/offset.
  const FEED_CACHE_MAX_ENTRIES = 200;
  const FEED_CACHE_TTL_MS = 120_000;
  const feedCache = new Map<string, { data: any; etag: string; expiresAt: number }>();
  function bustFeedCache() { feedCache.clear(); }
  function feedCacheSet(key: string, value: { data: any; etag: string; expiresAt: number }) {
    // Drop expired entries first, then evict oldest insertions if still full.
    const now = Date.now();
    const expired: string[] = [];
    feedCache.forEach((v, k) => { if (v.expiresAt <= now) expired.push(k); });
    expired.forEach(k => feedCache.delete(k));
    while (feedCache.size >= FEED_CACHE_MAX_ENTRIES) {
      const oldest = feedCache.keys().next();
      if (oldest.done) break;
      feedCache.delete(oldest.value);
    }
    feedCache.set(key, value);
  }

  // Feed pagination bounds (PRD-1 feed hardening)
  const FEED_LIMIT_DEFAULT = 20;
  const FEED_LIMIT_MAX = 50;
  function clampFeedLimit(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return FEED_LIMIT_DEFAULT;
    return Math.min(Math.floor(n), FEED_LIMIT_MAX);
  }

  // Feed — publicly readable with OPTIONAL auth (Decision 1).
  // The viewer is derived from the session only; the old ?viewerUserId= path is
  // gone (it let anyone read another user's like state).
  app.get("/api/feed", optionalAuth, async (req, res) => {
    const limit = clampFeedLimit(req.query.limit);
    const rawOffset = Number(req.query.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    const viewerUserId = req.auth?.userId;
    const now = Date.now();

    if (viewerUserId) {
      // Authenticated: never cacheable, never shared.
      const data = await storage.getFeedPosts(limit, offset, viewerUserId);
      // PRD 1 (contract §F): symmetric invisibility. Filtered per-viewer here
      // rather than in the query so the anonymous cached path stays shared and
      // cacheable — a per-user filter must never leak into the anon cache.
      const filtered = await filterBlockedAuthors(viewerUserId, data as any[], (row) => row?.user?.id ?? row?.post?.userId);
      res.set("Cache-Control", "private, no-store");
      return res.json(filtered);
    }

    // Anonymous: cacheable. The payload contains only PublicAuthor fields.
    const cacheKey = `anon|${offset}|${limit}`;
    const cached = feedCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      // ETag support — if client already has this version, return 304
      if (req.headers["if-none-match"] === cached.etag) {
        res.set("ETag", cached.etag);
        res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
        return res.status(304).end();
      }
      res.set("ETag", cached.etag);
      res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
      return res.json(cached.data);
    }

    const data = await storage.getFeedPosts(limit, offset, undefined);
    const etag = `"feed-${cacheKey}-${now}"`;
    feedCacheSet(cacheKey, { data, etag, expiresAt: now + FEED_CACHE_TTL_MS });
    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
    res.json(data);
  });

  // PRD-018 A6: requireAuth + session-derived userId
  // PRD 1 (contract §G): moderation, length caps, mediaType enum, mediaUrl
  // scheme/host validation, rate limit, and email verification for new accounts.
  //
  // Before this, POST /api/feed accepted any caption of any length, any
  // mediaUrl including javascript: and data: URIs, any mediaType string, and
  // had no rate limit at all — while /api/admin/feed/:id already told users
  // their post "violated our community guidelines" that did not exist.
  app.post("/api/feed", requireAuth, requireVerifiedEmail, postLimiter, async (req, res) => {
    try {
      const caption = typeof req.body?.caption === "string" ? req.body.caption : "";
      const mediaUrl = req.body?.mediaUrl ?? null;
      const mediaType = req.body?.mediaType ?? null;
      const tags = typeof req.body?.tags === "string" ? req.body.tags : "[]";

      if (tags.length > TAGS_JSON_MAX) {
        return res.status(400).json({ error: `Too many tags (limit ${TAGS_JSON_MAX} characters).` });
      }
      if (typeof mediaUrl === "string" && mediaUrl.length > MEDIA_URL_MAX) {
        return res.status(400).json({ error: "That media URL is too long." });
      }

      // Tier 1 = hard reject with 422 CONTENT_REJECTED. Tier 2 = publish + flag.
      const verdict = moderateContent({ kind: "post", body: caption, mediaUrl, mediaType });
      if (verdict.outcome === "reject") {
        console.warn(`[moderation] post rejected for user ${req.auth!.userId}: ${verdict.rule}`);
        return res.status(422).json({
          error: verdict.message,
          code: verdict.code,
          guidelinesUrl: GUIDELINES_URL,
        });
      }

      const data = insertPostSchema.parse({ ...req.body, userId: req.auth!.userId });
      const post = await storage.createPost(data);
      const pw = await storage.getPost(post.id);
      bustFeedCache();

      // Never throws; a flag-write failure must not fail an accepted post.
      await recordContentFlags({
        subjectType: "post",
        subjectId: post.id,
        authorUserId: req.auth!.userId,
        reasons: verdict.flags,
        body: caption,
      });

      res.json(pw);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // PRD-018 A6: requireAuth + session-derived userId
  app.patch("/api/feed/:id", requireAuth, async (req, res) => {
    const { caption, tags } = req.body;
    const userId = req.auth!.userId;
    const post = await storage.updatePost(Number(req.params.id), userId, caption ?? "", tags ?? "[]");
    if (!post) return res.status(403).json({ error: "Not allowed" });
    const pw = await storage.getPost(post.id);
    res.json(pw);
  });

  // PRD-018 A6: requireAuth + session-derived userId
  app.delete("/api/feed/:id", requireAuth, async (req, res) => {
    const userId = req.auth!.userId;
    const ok = await storage.deletePost(Number(req.params.id), userId);
    if (!ok) return res.status(403).json({ error: "Not allowed" });
    bustFeedCache();
    res.json({ success: true });
  });

  // Admin-only: remove any post + notify the owner
  // P0-04: requireAdminGuard
  app.delete("/api/admin/feed/:id", requireAdminGuard, async (req, res) => {
    const admin = req.auth!.adminUser!;
    const ownerId = await storage.adminDeletePost(Number(req.params.id), admin.id);
    if (ownerId === null) return res.status(404).json({ error: "Post not found" });
    bustFeedCache();
    // Notify the post owner
    await notify({
      recipientId: ownerId,
      actorId: admin.id,
      actorName: "Viewrr",
      actorAvatar: null,
      type: "system",
      // The guidelines this refers to now exist: docs/COMMUNITY_GUIDELINES.md,
      // published at GUIDELINES_URL. Before PRD 1 this message cited a document
      // that had never been written.
      message: `Your post was removed by Viewrr for breaching the Community Guidelines. Read them here: ${GUIDELINES_URL}`,
      link: "/feed",
      read: 0,
    });
    res.json({ success: true });
  });

  // Admin: fetch deletion history log
  // P0-04: requireAdminGuard
  app.get("/api/admin/deleted-posts", requireAdminGuard, async (req, res) => {
    const admin = req.auth!.adminUser!;
    const log = await storage.getDeletedPosts();
    res.json(log);
  });

  // PRD-018 A6: requireAuth + session-derived userId
  app.post("/api/feed/:id/like", requireAuth, likeLimiter, async (req, res) => {
    const userId = req.auth!.userId;
    // PRD 1 (contract §F): blocks apply to likes. Checked BEFORE the toggle so a
    // blocked user cannot even register-then-unregister a like as a ping.
    const likeTarget = await storage.getPost(Number(req.params.id));
    if (likeTarget && likeTarget.post.userId !== userId) {
      if (await blocksMessaging(userId, likeTarget.post.userId)) {
        return res.status(403).json({ error: "You cannot interact with this post.", code: "BLOCKED" });
      }
    }
    const liked = await storage.toggleLike(Number(req.params.id), userId);
    const post = await storage.getPost(Number(req.params.id));
    // Notify post owner when someone likes (not when unliking, not self-like)
    if (liked && post && post.post.userId !== userId) {
      const actor = await storage.getUser(userId);
      if (actor) {
        await notify({
          recipientId: post.post.userId,
          actorId: actor.id,
          actorName: actor.name,
          actorAvatar: actor.avatar ?? null,
          type: "like",
          message: `${actor.name} liked your post`,
          link: `/feed/${post.post.id}`,
          read: 0,
          targetType: "post",
          targetId: post.post.id,
        });
      }
    }
    res.json({ liked, likeCount: post?.post.likeCount ?? 0 });
  });

  // Publicly readable with optional auth (Decision 1). Comment authors are
  // PublicAuthor projections (storage.getComments).
  app.get("/api/feed/:id/comments", optionalAuth, async (req, res) => {
    res.set("Cache-Control", req.auth ? "private, no-store" : "public, max-age=30");
    const comments = await storage.getComments(Number(req.params.id));
    // PRD 1 (contract §F): hide comments by blocked users from the blocker and
    // vice versa. Anonymous readers see the thread unfiltered.
    if (!req.auth) return res.json(comments);
    const visible = await filterBlockedAuthors(
      req.auth.userId,
      comments as any[],
      (row) => row?.user?.id ?? row?.comment?.userId ?? row?.userId,
    );
    return res.json(visible);
  });

  // PRD-018 A6: requireAuth + session-derived userId
  // PRD 1 (contract §G): moderation + length cap + rate limit.
  // PRD 1 (contract §F): a blocked user cannot comment on the blocker's post.
  //   Exempt per Decision 3 when the two share an active engagement, so a block
  //   never interferes with an in-flight project.
  app.post("/api/feed/:id/comments", requireAuth, requireVerifiedEmail, commentLimiter, async (req, res) => {
    try {
      const content = typeof req.body?.content === "string" ? req.body.content : "";

      const verdict = moderateContent({ kind: "comment", body: content });
      if (verdict.outcome === "reject") {
        console.warn(`[moderation] comment rejected for user ${req.auth!.userId}: ${verdict.rule}`);
        return res.status(422).json({
          error: verdict.message,
          code: verdict.code,
          guidelinesUrl: GUIDELINES_URL,
        });
      }

      const targetPost = await storage.getPost(Number(req.params.id));
      if (targetPost && targetPost.post.userId !== req.auth!.userId) {
        if (await blocksMessaging(req.auth!.userId, targetPost.post.userId)) {
          // Same wording in both directions — do not reveal who blocked whom.
          return res.status(403).json({ error: "You cannot comment on this post.", code: "BLOCKED" });
        }
      }

      const data = insertPostCommentSchema.parse({ ...req.body, userId: req.auth!.userId, postId: Number(req.params.id) });
      const comment = await storage.createComment(data);

      await recordContentFlags({
        subjectType: "comment",
        subjectId: comment.comment.id,
        authorUserId: req.auth!.userId,
        reasons: verdict.flags,
        body: content,
      });
      // Notify post owner of new comment (not self-comment)
      const post = await storage.getPost(Number(req.params.id));
      if (post && post.post.userId !== data.userId) {
        const actor = await storage.getUser(data.userId);
        if (actor) {
          await notify({
            recipientId: post.post.userId,
            actorId: actor.id,
            actorName: actor.name,
            actorAvatar: actor.avatar ?? null,
            type: "comment",
            message: `${actor.name} commented on your post`,
            link: `/feed/${data.postId}`,
            read: 0,
            targetType: "post",
            targetId: data.postId,
          });
        }
      }
      res.json(comment);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── PRD-013: Pro Viewrr Subscription (server-authoritative) ────────────────

  // GET /api/pro/status/:userId — entitlement (replaces old isPro boolean)
  app.get("/api/pro/status/:userId", async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const entitlement = await getProEntitlement(userId);
      const spacesRemaining = await getFoundingProSpacesRemaining();
      res.json({ ...entitlement, foundingProSpacesRemaining: spacesRemaining });
    } catch (e: any) {
      res.status(500).json({ error: "Unable to load Pro status." });
    }
  });

  // GET /api/pro/founding-spaces — how many Founding Pro places remain
  app.get("/api/pro/founding-spaces", async (_req, res) => {
    try {
      const remaining = await getFoundingProSpacesRemaining();
      res.json({ remaining, max: FOUNDING_PRO_MAX });
    } catch { res.json({ remaining: 0, max: FOUNDING_PRO_MAX }); }
  });

  // POST /api/pro/checkout — create Stripe Checkout session (paid subscription)
  // FR-01/02: price controlled server-side; never from client input
  // A0-P3
  app.post("/api/pro/checkout", requireAuth, async (req, res) => {
    try {
      // A0: identity from session
      const user = await storage.getUser(req.auth!.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "freelancer") return res.status(403).json({ error: "Pro Viewrr is for freelancer accounts only" });

      // Already has active entitlement?
      const entitlement = await getProEntitlement(req.auth!.userId);
      if (entitlement.entitlementActive) {
        return res.json({ alreadyPro: true, status: entitlement.status });
      }

      const { checkoutUrl, sessionId } = await createProCheckout(
        req.auth!.userId,
        user.email,
        APP_BASE_URL,
      );
      res.json({ checkoutUrl, sessionId });
    } catch (e: any) {
      console.error("[pro/checkout]", e.message);
      res.status(500).json({ error: "Unable to start checkout. Please try again." });
    }
  });

  // POST /api/pro/claim-founding — claim a Founding Pro place
  // FR-06: atomic server-side, max 10
  // A0-P4
  app.post("/api/pro/claim-founding", requireAuth, async (req, res) => {
    try {
      // A0: identity from session
      const user = await storage.getUser(req.auth!.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "freelancer") return res.status(403).json({ error: "Founding Pro is for freelancer accounts only" });

      const result = await claimFoundingPro(req.auth!.userId);
      if (!result.success) {
        if (result.reason === "already_claimed") {
          return res.json({ alreadyFounder: true, message: "You already have a Founding Pro membership." });
        }
        if (result.reason === "full") {
          return res.status(409).json({ code: "FOUNDING_FULL", error: "All 10 Founding Pro places have been claimed. You can subscribe at £49.99/month." });
        }
      }
      res.json({ success: true, allocationNumber: (result as any).allocationNumber });
    } catch (e: any) {
      console.error("[pro/claim-founding]", e.message);
      res.status(500).json({ error: "Unable to claim Founding Pro. Please try again." });
    }
  });

  // POST /api/pro/cancel — cancel at period end
  // FR-15: entitlement remains active until end of paid period
  // A0-P1
  app.post("/api/pro/cancel", requireAuth, async (req, res) => {
    try {
      // A0: identity from session
      const entitlement = await getProEntitlement(req.auth!.userId);
      if (!entitlement.entitlementActive || entitlement.membershipType !== "paid") {
        return res.status(400).json({ error: "No active paid subscription to cancel." });
      }
      if (!entitlement.subscriptionId) {
        return res.status(400).json({ error: "No Stripe subscription ID found." });
      }
      const { currentPeriodEnd } = await scheduleProCancellation(req.auth!.userId, entitlement.subscriptionId);
      res.json({ success: true, currentPeriodEnd, message: `Your Pro membership will remain active until ${new Date(currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.` });
    } catch (e: any) {
      console.error("[pro/cancel]", e.message);
      res.status(500).json({ error: "Unable to cancel. Please try again or contact support." });
    }
  });

  // GET /api/pro/manage-billing — Stripe billing portal
  // A0-P2
  app.get("/api/pro/manage-billing/:userId", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    try {
      const userId = Number(req.params.userId);
      const { proSubscriptions: proSubsTable } = await import("../shared/schema");
      const subs = await db.select().from(proSubsTable).where(eq(proSubsTable.userId, userId));
      const sub = subs[0];
      if (!sub?.stripeCustomerId) return res.status(404).json({ error: "No subscription found." });

      const stripeClient = new (await import("stripe")).default(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2025-02-24.acacia" as any,
      });
      const portal = await stripeClient.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${APP_BASE_URL}/#/pro`,
      });
      res.json({ url: portal.url });
    } catch (e: any) {
      res.status(500).json({ error: "Unable to open billing portal." });
    }
  });

  // GET /api/founder/pro-dashboard — P0-04+P0-06: requireAdminGuard (previously zero auth)
  app.get("/api/founder/pro-dashboard", requireAdminGuard, async (req, res) => {
    try {
      const stats = await getProDashboardStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Legacy subscribe (no-op — returns instruction to use /checkout)
  // PRD-018 A7: requireAuth (deprecated stub — adding auth is harmless)
  app.post("/api/pro/subscribe", requireAuth, async (req, res) => {
    res.status(410).json({ error: "This endpoint is deprecated. Use POST /api/pro/checkout." });
  });

  // ─── Projects / Your Work ────────────────────────────────────────────
  // PRD-1 read-path auth: identity comes from the session only. The old
  // `?userId=` parameter is ignored — it allowed reading anyone's project list.
  app.get("/api/projects", requireAuth, async (req, res) => {
    const userId = req.auth!.userId;
    try {
      const projects = await storage.getProjectsForUser(userId);
      res.json(projects);
    } catch (e: any) {
      console.error("[projects] Error fetching projects for user", userId, e.message);
      res.status(500).json({ error: "Could not load projects", projects: [] });
    }
  });

  // PRD-1 read-path auth: requireAuth + party check (was fully unauthenticated).
  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      await assertProjectParty(Number(req.params.id), req.auth!.userId);
      const pw = await storage.getProject(Number(req.params.id));
      if (!pw) return res.status(404).json({ error: "Project not found" });
      res.json(pw);
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Could not load project" });
    }
  });

  // PRD-018 A8: requireAuth + verify caller is a party on the project being created
  //
  // PRD-1 wave 3 write-path hardening. This route used to do a bare
  // `insertProjectSchema.parse(req.body)`, which accepts EVERY insertable
  // column. A caller who was a party could therefore create a project that was
  // already `status:"completed"`, already `paymentStatus:"paid"` (which would
  // have unlocked the Decision 10 deliverable gate from birth), carried an
  // arbitrary `agreedAmountPence`, claimed `isRetainer`, or was born with
  // `completedAt` / `completedBy` / `deletedAt` / `deletionReason` set.
  //
  // The payload is now an explicit WHITELIST. Everything with financial,
  // lifecycle or access-control meaning is server-set:
  //   status        -> "active"
  //   paymentStatus -> "unpaid"
  //   currentStage  -> 0
  //   isRetainer    -> 0        (retainers are out of mobile V1, Decision 12;
  //                             retainer projects are created by the
  //                             invitation / retainer-builder flows)
  //   client/freelancer display names -> read from the user rows, not the body
  //   completedAt / completedBy / deletedAt / deletedBy / deletionReason,
  //   agreedAmountPence, planning* , cycle fields -> not accepted at all
  const createProjectSchema = insertProjectSchema.pick({
    clientId: true,
    freelancerId: true,
    title: true,
    description: true,
    briefId: true,
    interestId: true,
    briefCategory: true,
    agencyId: true,
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const data = createProjectSchema.parse(req.body);
      // A8: caller must be either the clientId or freelancerId in the submitted data
      if (data.clientId !== req.auth!.userId && data.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "You must be the client or freelancer on the project" });
      }
      if (data.clientId === data.freelancerId) {
        return res.status(400).json({ error: "A project needs two distinct parties" });
      }
      const [clientUser, freelancerUser] = await Promise.all([
        storage.getUser(data.clientId),
        storage.getUser(data.freelancerId),
      ]);
      if (!clientUser || !freelancerUser) {
        return res.status(400).json({ error: "Both parties must be existing users" });
      }
      const project = await storage.createProject({
        clientId: data.clientId,
        freelancerId: data.freelancerId,
        title: data.title,
        description: data.description ?? "",
        briefId: data.briefId ?? null,
        interestId: data.interestId ?? null,
        briefCategory: data.briefCategory ?? null,
        agencyId: data.agencyId ?? null,
        // Server-set — never accepted from the request body.
        status: "active",
        paymentStatus: "unpaid",
        currentStage: 0,
        isRetainer: 0,
        clientName: clientUser.name,
        freelancerName: freelancerUser.name,
      });
      const full = await storage.getProject(project.id);
      res.json(full);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Confirm final payment → marks project completed ──────────────────────
  // A0-F5
  app.post("/api/projects/:id/confirm-payment", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      // A0: identity from session, not body — attacker cannot spoof clientId
      if (pw.project.clientId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the client can confirm payment" });
      }
      // Mark project completed + paid
      await storage.updateProjectStatus(projectId, "completed", "paid");
      // Notify freelancer
      await notify({
        recipientId: pw.project.freelancerId,
        actorId:     pw.project.clientId,
        actorName:   pw.client.name,
        actorAvatar: pw.client.avatar ?? null,
        type:        "payment_confirmed",
        message:     `${pw.client.name} has confirmed final payment for "${pw.project.title}" — your work is now fully released.`,
        link:        "/your-work",
        read:        0,
        // `/your-work` dropped the project id entirely; this is the fix.
        targetType:  "project",
        targetId:    projectId,
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PRD-018 A9: requireAuth + session-derived callerId
  app.post("/api/projects/:id/advance", requireAuth, async (req, res) => {
    try {
      const { note } = req.body;
      const callerId = req.auth!.userId;
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      // Only the assigned freelancer can advance stages
      if (pw.project.freelancerId !== callerId) {
        return res.status(403).json({ error: "Only the project freelancer can advance stages" });
      }
      // Guard against overflow
      if ((pw.project.currentStage ?? 0) >= 5) {
        return res.status(400).json({ error: "Project is already at the final stage" });
      }
      // Guard against advancing a completed project
      if (pw.project.status === "completed") {
        return res.status(400).json({ error: "Cannot advance a completed project" });
      }
      const updated = await storage.advanceProjectStage(projectId, note || "", callerId);
      if (!updated) return res.status(404).json({ error: "Project not found" });
      // Notify the client
      const stageName = ["Brief & Kick-off", "Pre-production", "Production", "First Delivery", "Revisions", "Final Delivery"][updated.currentStage ?? 0] ?? "Next stage";
      await notify({
        recipientId: pw.project.clientId,
        actorId: callerId,
        actorName: pw.freelancer?.name ?? "Freelancer",
        actorAvatar: pw.freelancer?.avatar ?? null,
        type: "stage_advanced",
        message: `"${pw.project.title}" has moved to ${stageName}`,
        link: "/your-work",
        read: 0,
        // `stage_advanced` is the most-emitted project event and its web link is
        // a bare "/your-work" with no id — the single biggest win in Decision 14.
        targetType: "project",
        targetId: projectId,
      });
      res.json(await storage.getProject(updated.id));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Temporary onboarding helpers ───────────────────────────────────────────────────
  // POST /api/projects/:id/actions/complete
  // Idempotent atomic force-complete (freelancer only).
  // FR-01: uses injected db from storage module.
  // FR-04: core transition + audit in one update; notification fires after commit (FR-05/17).
  // FR-08: writes completedAt + completedBy; idempotent — already-completed returns 200.
  // PRD-018 A10: requireAuth + session-derived callerId
  app.post("/api/projects/:id/actions/complete", requireAuth, async (req, res) => {
    try {
      const callerId = req.auth!.userId;
      const projectId = Number(req.params.id);

      // FR-03: load with ownership check
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.freelancerId !== callerId) {
        return res.status(403).json({ error: "Only the assigned freelancer can complete this project" });
      }

      // FR-08: idempotent — already completed returns success, not 400
      if (pw.project.status === "completed") {
        return res.json({
          projectId,
          status: "completed",
          completedAt: (pw.project as any).completedAt ?? null,
          alreadyCompleted: true,
        });
      }

      // FR-11: block if soft-deleted
      if ((pw.project as any).deletedAt) {
        return res.status(409).json({ code: "PROJECT_DELETED", error: "This project has been removed and cannot be completed" });
      }

      const now = new Date().toISOString();

      // FR-04: atomic state transition + audit fields in one update
      await db
        .update(schema.projects)
        .set({
          status: "completed",
          currentStage: 5,
          completedAt: now,
          completedBy: callerId,
        } as any)
        .where(eq(schema.projects.id, projectId));

      // FR-05/17: respond with success BEFORE notification — notification failure must not cause 5xx
      res.json({ projectId, status: "completed", completedAt: now });

      // Fire-and-forget notification (async, does not affect response)
      notify({
        recipientId: pw.project.clientId,
        actorId: callerId,
        actorName: pw.freelancer?.name ?? "Freelancer",
        actorAvatar: pw.freelancer?.avatar ?? null,
        type: "stage_advanced",
        message: `"${pw.project.title}" has been marked as complete`,
        link: "/your-work",
        read: 0,
        targetType: "project",
        targetId: projectId,
      }).catch(() => { /* notification failure is non-fatal */ });

    } catch (e: any) {
      // FR-15: never expose raw db/stack details
      console.error("[force-complete]", e.message);
      res.status(500).json({ error: "Unable to complete project. Please try again." });
    }
  });

  // POST /api/projects/:id/actions/delete
  // Soft-delete with financial lock check (freelancer only).
  // FR-09: writes deletedAt + deletedBy; default queries exclude deleted rows.
  // FR-10: does NOT cascade — payments/audit/messages untouched.
  // FR-11: blocks if financial activity exists.
  // PRD-018 A11: requireAuth + session-derived callerId
  app.post("/api/projects/:id/actions/delete", requireAuth, async (req, res) => {
    try {
      const callerId = req.auth!.userId;
      const projectId = Number(req.params.id);

      // FR-03: ownership check
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.freelancerId !== callerId) {
        return res.status(403).json({ error: "Only the assigned freelancer can remove this project" });
      }

      // FR-09: idempotent — already deleted returns success
      if ((pw.project as any).deletedAt) {
        return res.json({ projectId, status: "deleted", deletedAt: (pw.project as any).deletedAt, alreadyDeleted: true });
      }

      // FR-11: financial lock — block if any payment exists for this project
      const neonClient = neon(process.env.DATABASE_URL!);
      const paymentRows = await neonClient`
        SELECT id FROM payments WHERE project_id = ${projectId} LIMIT 1
      `;
      if (paymentRows.length > 0) {
        return res.status(409).json({
          code: "PROJECT_DELETE_LOCKED",
          reason: "open_payment_or_dispute",
          error: "This project has payment activity and cannot be removed. Contact support if you need help.",
        });
      }

      const now = new Date().toISOString();

      // FR-04/FR-09: atomic soft-delete — sets deletedAt/deletedBy, does NOT hard-delete
      await db
        .update(schema.projects)
        .set({
          deletedAt: now,
          deletedBy: callerId,
          deletionReason: "onboarding_cleanup",
        } as any)
        .where(eq(schema.projects.id, projectId));

      res.json({ projectId, status: "deleted", deletedAt: now });

    } catch (e: any) {
      console.error("[soft-delete]", e.message);
      res.status(500).json({ error: "Unable to remove project. Please try again." });
    }
  });
  // ────────────────────────────────────────────────────────────────────────────

  // PRD-018 A12: requireAuth + verify caller is on the project + pass session userId as author
  app.post("/api/projects/:id/updates", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId && pw.project.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "Not authorised" });
      }
      const data = insertProjectUpdateSchema.parse({ ...req.body, authorId: req.auth!.userId, projectId });
      const update = await storage.addProjectUpdate(data);
      res.json(update);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // PRD-1 read-path auth: requireAuth + party check (was unauthenticated).
  app.get("/api/projects/:id/updates", requireAuth, async (req, res) => {
    try {
      await assertProjectParty(Number(req.params.id), req.auth!.userId);
      res.json(await storage.getProjectUpdates(Number(req.params.id)));
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to load project updates" });
    }
  });

  // GET /api/projects/:id/activity (contract D) — PRD-1 wave 3.
  //
  // `project_stage_events` had no reader anywhere in the codebase; every stage
  // action wrote a row nobody could ever see. This merges those rows with
  // `project_updates` into one newest-first timeline for the Activity screen.
  //
  // The actor is hydrated through the six-field PublicAuthor allow-list in
  // storage.ts — never a raw user row, so no email/phone/hash can leak into a
  // timeline. Guarded with requireAuth + assertProjectParty (no admin bypass).
  app.get("/api/projects/:id/activity", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      await assertProjectParty(projectId, req.auth!.userId);
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.trunc(rawLimit), 200)
        : 100;
      const items = await storage.getProjectActivity(projectId, limit);
      res.set("Cache-Control", "private, no-store");
      res.json(items);
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to load project activity" });
    }
  });

  // ─── Meetings ──────────────────────────────────────────────────────────────────
  // GET all meetings for a project
  // PRD-1 read-path auth: requireAuth + party check (was unauthenticated).
  app.get("/api/projects/:id/meetings", requireAuth, async (req, res) => {
    try {
      await assertProjectParty(Number(req.params.id), req.auth!.userId);
      const meetings = await storage.getMeetingsForProject(Number(req.params.id));
      res.json(meetings);
    } catch (e) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to fetch meetings" });
    }
  });

  // POST create a meeting (instant or scheduled)
  // PRD-018 A13: requireAuth + verify caller is on the project
  app.post("/api/projects/:id/meetings", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId && pw.project.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "Not authorised" });
      }
      const { title, scheduledAt, isInstant } = req.body;

      // Generate a unique Google Meet link using a random room code
      const roomId = `viewrr-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
      const meetLink = `https://meet.google.com/${roomId}`;

      const meeting = await storage.createMeeting({
        projectId,
        createdBy: req.auth!.userId,
        title: title || (isInstant ? "Instant call" : "Project call"),
        meetLink,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        isInstant: Boolean(isInstant),
        status: "scheduled",
      });
      res.json(meeting);
    } catch (e) {
      console.error("Create meeting error:", e);
      res.status(500).json({ error: "Failed to create meeting" });
    }
  });

  // PATCH cancel a meeting
  // PRD-018 A14: requireAuth + verify caller is on the meeting's project
  app.patch("/api/meetings/:id/cancel", requireAuth, async (req, res) => {
    try {
      const meeting = await storage.getMeeting(Number(req.params.id));
      if (!meeting) return res.status(404).json({ error: "Meeting not found" });
      const pw = await storage.getProject(meeting.projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId && pw.project.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "Not authorised" });
      }
      await storage.cancelMeeting(Number(req.params.id));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to cancel meeting" });
    }
  });

  // ─── Project Invitations ────────────────────────────────────────────────────

  // Create invitation
  // A0-I3
  app.post("/api/invitations", requireAuth, async (req, res) => {
    try {
      const { recipientId, title, description, category, budget, timeline, startStage,
              isRetainer, billingCycle, deliverablesPerCycle, totalCycles } = req.body;
      if (!recipientId || !title) return res.status(400).json({ error: "Missing fields" });
      // A0: senderId is always the authenticated caller
      const inv = await storage.createInvitation({
        senderId: req.auth!.userId, recipientId: Number(recipientId),
        title,
        description: description || undefined,
        category: category || undefined,
        budget: budget || undefined,
        timeline: timeline || undefined,
        startStage: startStage !== undefined ? Number(startStage) : 0,
        isRetainer: isRetainer ? 1 : 0,
        billingCycle: billingCycle || undefined,
        deliverablesPerCycle: deliverablesPerCycle || undefined,
        totalCycles: totalCycles ? Number(totalCycles) : undefined,
      });
      // Notify recipient
      const sender = await storage.getUser(req.auth!.userId);
      await notify({
        recipientId: Number(recipientId),
        actorId: req.auth!.userId,
        actorName: sender?.name ?? "Someone",
        actorAvatar: sender?.avatar ?? null,
        type: "project_invitation",
        message: `${sender?.name ?? "Someone"} has invited you to collaborate on a private project: "${title}"`,
        link: "/your-work",
        read: 0,
      });
      res.json(inv);
    } catch (e: unknown) {
      console.error("[POST /api/invitations]", e);
      res.status(500).json({ error: "Failed to create invitation", detail: String(e) });
    }
  });

  // Get invitations for the authenticated user.
  // PRD-1 read-path auth: identity from the session; `?userId=` is ignored.
  app.get("/api/invitations", requireAuth, async (req, res) => {
    const userId = req.auth!.userId;
    const invitations = await storage.getInvitationsForUser(userId);
    // Enrich with sender/recipient names
    const enriched = await Promise.all(invitations.map(async inv => {
      const sender = await storage.getUser(inv.senderId);
      const recipient = await storage.getUser(inv.recipientId);
      return { ...inv, senderName: sender?.name, senderAvatar: sender?.avatar, recipientName: recipient?.name, recipientAvatar: recipient?.avatar };
    }));
    res.json(enriched);
  });

  // Accept invitation — creates a real project
  // A0-I1
  app.patch("/api/invitations/:id/accept", requireAuth, async (req, res) => {
    // A0: load before mutating to verify caller is the recipient
    const existing = await db.select().from(schema.projectInvitations).where(eq(schema.projectInvitations.id, Number(req.params.id))).limit(1);
    if (!existing.length) return res.status(404).json({ error: "Not found" });
    if (req.auth!.userId !== existing[0].recipientId) return res.status(403).json({ error: "Forbidden." });
    const inv = await storage.updateInvitationStatus(Number(req.params.id), "accepted");
    if (!inv) return res.status(404).json({ error: "Not found" });
    const sender = await storage.getUser(inv.senderId);
    const recipient = await storage.getUser(inv.recipientId);
    // Determine client/freelancer based on roles
    const senderRole = sender?.role;
    const clientId   = senderRole === "client" ? inv.senderId : inv.recipientId;
    const freelancerId = senderRole === "freelancer" ? inv.senderId : inv.recipientId;
    const clientUser = await storage.getUser(clientId);
    const freelancerUser = await storage.getUser(freelancerId);
    // Carry retainer fields from invitation if present
    const invAny = inv as any;
    const isRetainer = invAny.isRetainer === 1 || invAny.isRetainer === true ? 1 : 0;
    const project = await storage.createProject({
      clientId, freelancerId,
      title: inv.title,
      description: inv.description ?? "",
      status: "active",
      currentStage: invAny.startStage ?? 0,
      clientName: clientUser?.name ?? "",
      freelancerName: freelancerUser?.name ?? "",
      briefCategory: inv.category ?? "",
      isRetainer,
      billingCycle: isRetainer ? (invAny.billingCycle ?? null) : null,
      deliverablesPerCycle: isRetainer ? (invAny.deliverablesPerCycle ?? null) : null,
      totalCycles: isRetainer ? (invAny.totalCycles ?? null) : null,
      currentCycleNumber: 1,
    });
    // Auto-create cycle 1 for retainer projects
    if (isRetainer) {
      await storage.createRetainerCycle({
        projectId: project.id,
        cycleNumber: 1,
        status: "active",
        startDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "unpaid",
      });
    }
    // Notify sender that it was accepted
    await notify({
      recipientId: inv.senderId,
      actorId: inv.recipientId,
      actorName: recipient?.name ?? "Someone",
      actorAvatar: recipient?.avatar ?? null,
      type: "project_accepted",
      message: `${recipient?.name ?? "Someone"} accepted your project invitation: "${inv.title}"`,
      link: "/your-work",
      read: 0,
      // `project` is only created on the accept path for a non-retainer
      // invitation; a null id still lands the recipient on the Work tab via the
      // mobile resolver's "structured type, no id" branch.
      targetType: "project",
      targetId: project?.id ?? null,
    });
    res.json({ invitation: inv, project });
  });

  // Decline invitation
  // A0-I2
  app.patch("/api/invitations/:id/decline", requireAuth, async (req, res) => {
    // A0: load before mutating to verify caller is the recipient
    const existingDecline = await db.select().from(schema.projectInvitations).where(eq(schema.projectInvitations.id, Number(req.params.id))).limit(1);
    if (!existingDecline.length) return res.status(404).json({ error: "Not found" });
    if (req.auth!.userId !== existingDecline[0].recipientId) return res.status(403).json({ error: "Forbidden." });
    const inv = await storage.updateInvitationStatus(Number(req.params.id), "declined");
    if (!inv) return res.status(404).json({ error: "Not found" });
    const recipient = await storage.getUser(inv.recipientId);
    await notify({
      recipientId: inv.senderId,
      actorId: inv.recipientId,
      actorName: recipient?.name ?? "Someone",
      actorAvatar: recipient?.avatar ?? null,
      type: "system",
      message: `${recipient?.name ?? "Someone"} declined your project invitation: "${inv.title}"`,
      link: "/your-work",
      read: 0,
    });
    res.json(inv);
  });

  // ─── Retainer Cycle Routes ────────────────────────────────────────────────

  // GET cycles for a project
  // PRD-1 read-path auth: requireAuth + party check (was unauthenticated).
  app.get("/api/projects/:id/retainer/cycles", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      await assertProjectParty(projectId, req.auth!.userId);
      const cycles = await storage.getRetainerCycles(projectId);
      res.json(cycles);
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to load retainer cycles" });
    }
  });

  // PRD-1 wave 3 — cross-project IDOR fix for the retainer cycle routes.
  //
  // These three routes took `cycleId` from the BODY and only checked the
  // caller's role on `:id`. Because `updateRetainerCycle` looks a cycle up by
  // its own primary key, a client on project A could sign off (or a freelancer
  // submit) a cycle belonging to project B — someone else's contract — simply
  // by pairing their own project id with a foreign cycle id.
  //
  // This helper ties the cycle to `:id` by loading the project's own cycles and
  // refusing anything not in that set.
  async function resolveCycleForProject(projectId: number, rawCycleId: unknown) {
    const cycleId = Number(rawCycleId);
    if (!Number.isFinite(cycleId) || cycleId <= 0) return { error: "cycleId required" as const };
    const cycles = await storage.getRetainerCycles(projectId);
    const cycle = cycles.find(c => c.id === cycleId);
    if (!cycle) return { error: "Cycle does not belong to this project" as const };
    return { cycle };
  }

  // POST freelancer submits current cycle (active → awaiting_signoff)
  // PRD-018 A15: requireAuth + verify caller is the freelancer on the project
  app.post("/api/projects/:id/retainer/submit-cycle", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the freelancer can submit a cycle" });
      }
      const { cycleId, note } = req.body;
      const resolved = await resolveCycleForProject(projectId, cycleId);
      if ("error" in resolved) return res.status(400).json({ error: resolved.error });
      const cycle = await storage.updateRetainerCycle(resolved.cycle.id, {
        status: "awaiting_signoff",
        freelancerNote: note || null,
      });
      // Update project status to reflect awaiting sign-off
      await storage.updateProjectStatus(projectId, "awaiting_signoff");
      res.json({ cycle });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST client signs off cycle (awaiting_signoff → awaiting_payment)
  // PRD-018 A16: requireAuth + verify caller is the client on the project
  app.post("/api/projects/:id/retainer/signoff-cycle", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the client can sign off a cycle" });
      }
      const { cycleId } = req.body;
      // PRD-1 wave 3: cycle must belong to :id (was a cross-project IDOR).
      const resolved = await resolveCycleForProject(projectId, cycleId);
      if ("error" in resolved) return res.status(400).json({ error: resolved.error });
      const cycle = await storage.updateRetainerCycle(resolved.cycle.id, {
        status: "awaiting_payment",
        endDate: new Date().toISOString().slice(0, 10),
      });
      await storage.updateProjectStatus(projectId, "awaiting_payment");
      res.json({ cycle });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST confirm payment for cycle — marks paid, auto-starts next cycle
  // POST /api/projects/:id/retainer/pay-cycle — DEPRECATED (PRD-008)
  // Replaced by server-authoritative POST /api/retainer-cycles/:cyclePublicId/payments
  // Kept for backward-compat; redirects to new endpoint using cycle's public_id
  // A0-F4
  app.post("/api/projects/:id/retainer/pay-cycle", requireAuth, async (req, res) => {
    try {
      const { cycleId } = req.body;
      if (!cycleId) {
        return res.status(400).json({ error: "cycleId required" });
      }
      // Look up cycle public_id
      const db = neon(process.env.DATABASE_URL!);
      const cycles = await db`SELECT public_id, project_id FROM retainer_cycles WHERE id = ${Number(cycleId)} LIMIT 1`;
      if (!cycles.length || !cycles[0].public_id) {
        return res.status(404).json({ error: "Retainer cycle not found or missing public_id" });
      }
      // PRD-1 wave 3: the cycle must belong to the project in the path. The
      // ownership check below already resolved the project FROM the cycle, so
      // this closes the remaining mismatch where `:id` was simply ignored.
      if (Number(cycles[0].project_id) !== Number(req.params.id)) {
        return res.status(400).json({ error: "Cycle does not belong to this project" });
      }
      // A0: verify caller is the client on the project
      const cycleProject = await storage.getProject(Number(cycles[0].project_id));
      if (!cycleProject || cycleProject.project.clientId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the client can pay a retainer cycle" });
      }
      const cyclePublicId = cycles[0].public_id;
      const result = await createRetainerPayment(cyclePublicId, req.auth!.userId);
      return res.json(result);
    } catch (e: any) {
      const status = (e as any).status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // POST pause retainer
  // PRD-018 A17: requireAuth + verify caller is on the project (either role)
  app.post("/api/projects/:id/retainer/pause", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId && pw.project.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "Not authorised" });
      }
      const { cycleId } = req.body;
      // PRD-1 wave 3: cycle must belong to :id (same IDOR class).
      const resolved = await resolveCycleForProject(projectId, cycleId);
      if ("error" in resolved) return res.status(400).json({ error: resolved.error });
      await storage.updateRetainerCycle(resolved.cycle.id, { status: "paused" });
      await storage.updateProjectStatus(projectId, "paused");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST resume retainer
  // PRD-018 A18: requireAuth + verify caller is on the project
  app.post("/api/projects/:id/retainer/resume", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId && pw.project.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "Not authorised" });
      }
      const { cycleId } = req.body;
      // PRD-1 wave 3: cycle must belong to :id (same IDOR class).
      const resolved = await resolveCycleForProject(projectId, cycleId);
      if ("error" in resolved) return res.status(400).json({ error: resolved.error });
      await storage.updateRetainerCycle(resolved.cycle.id, { status: "active" });
      await storage.updateProjectStatus(projectId, "active");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-014: Dynamic Project Stages ─────────────────────────────────────

  // GET /api/projects/:id/stages — list all custom stages
  // PRD-1 read-path auth: requireAuth + party check (contract section D).
  app.get("/api/projects/:id/stages", requireAuth, async (req, res) => {
    try {
      await assertProjectParty(Number(req.params.id), req.auth!.userId);
      const stages = await getProjectStages(Number(req.params.id));
      res.json(stages);
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to load project stages" });
    }
  });

  // GET /api/stage-templates — return available templates for the builder
  app.get("/api/stage-templates", (_req, res) => {
    res.json(STAGE_TEMPLATES);
  });

  // POST /api/projects/:id/stages — add a single stage
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.post("/api/projects/:id/stages", requireAuth, async (req, res) => {
    try {
      const { title, description, expectedDeliverable, targetDate, approvalRequired, revisionAllowance, notes } = req.body;
      if (!title) return res.status(400).json({ error: "title required" });
      const freelancerId = req.auth!.userId;
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Only the freelancer can manage stages" });
      const stage = await addProjectStage(projectId, freelancerId, { title, description, expectedDeliverable, targetDate, approvalRequired: !!approvalRequired, revisionAllowance, notes });
      // Auto-set planning status to draft if still at planning_required
      if ((pw.project as any).planningStatus === "planning_required") {
        await setPlanningStatus(projectId, "plan_draft");
      }
      await logStageEvent(projectId, freelancerId, "stage_added", `Added stage: ${title}`, stage.id);
      res.json(stage);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/projects/:id/stages/bulk — replace all stages (template apply)
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.post("/api/projects/:id/stages/bulk", requireAuth, async (req, res) => {
    try {
      const { stages } = req.body;
      if (!Array.isArray(stages)) return res.status(400).json({ error: "stages[] required" });
      const freelancerId = req.auth!.userId;
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Only the freelancer can manage stages" });
      // Delete existing draft stages (only if all are still upcoming — protect started work)
      const existing = await getProjectStages(projectId);
      const hasStarted = existing.some(s => s.status !== "upcoming");
      if (hasStarted) return res.status(409).json({ error: "Cannot bulk replace stages after work has started" });
      for (const s of existing) await deleteProjectStage(s.id);
      const created = await bulkCreateStages(projectId, freelancerId, stages);
      await setPlanningStatus(projectId, "plan_draft");
      await logStageEvent(projectId, freelancerId, "stages_bulk_set", `Applied ${stages.length} stages`);
      res.json(created);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/stages/:id — edit a stage
  // PRD-018 A19: requireAuth + session-derived callerId
  app.patch("/api/stages/:id", requireAuth, async (req, res) => {
    try {
      const { ...data } = req.body;
      const stageId = Number(req.params.id);
      const stage = await getProjectStage(stageId);
      if (!stage) return res.status(404).json({ error: "Stage not found" });
      const pw = await storage.getProject(stage.projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      const callerId = req.auth!.userId;
      if (pw.project.freelancerId !== callerId && pw.project.clientId !== callerId) {
        return res.status(403).json({ error: "Not authorised" });
      }
      const updated = await updateProjectStage(stageId, data);
      // Log if project already confirmed (post-start edit)
      if ((pw.project as any).planningStatus === "confirmed") {
        await logStageEvent(stage.projectId, callerId, "stage_edited_post_start", `Stage updated: ${updated.title}`, stageId);
        // Notify other party
        const isFreelancer = pw.project.freelancerId === callerId;
        const recipientId = isFreelancer ? pw.project.clientId : pw.project.freelancerId;
        await notify({ recipientId, actorId: callerId, actorName: isFreelancer ? (pw.freelancer?.name ?? "") : (pw.client?.name ?? ""), actorAvatar: null,
          type: "stage_advanced", message: `The project plan for "${pw.project.title}" has been updated`, link: "/your-work", read: 0,
          targetType: "project", targetId: stage.projectId });
      }
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/stages/:id — delete a stage
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.delete("/api/stages/:id", requireAuth, async (req, res) => {
    try {
      const freelancerId = req.auth!.userId;
      const stageId = Number(req.params.id);
      const stage = await getProjectStage(stageId);
      if (!stage) return res.status(404).json({ error: "Stage not found" });
      if (stage.status !== "upcoming") return res.status(409).json({ error: "Cannot delete a stage that has already started" });
      const pw = await storage.getProject(stage.projectId);
      if (!pw || pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Not authorised" });
      await logStageEvent(stage.projectId, freelancerId, "stage_deleted", `Deleted: ${stage.title}`, stageId);
      await deleteProjectStage(stageId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/projects/:id/stages/reorder — reorder stages
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.post("/api/projects/:id/stages/reorder", requireAuth, async (req, res) => {
    try {
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds[] required" });
      const freelancerId = req.auth!.userId;
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw || pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Not authorised" });
      // Protect completed stages from reordering
      const stages = await getProjectStages(projectId);
      const completedIds = stages.filter(s => s.status === "completed" || s.status === "approved").map(s => s.id);
      const reorderedCompleted = orderedIds.some((id: number, idx: number) => {
        const orig = stages.find(s => s.id === id);
        return orig && completedIds.includes(id) && orig.position !== idx;
      });
      if (reorderedCompleted) return res.status(409).json({ error: "Completed stages cannot be reordered" });
      await reorderProjectStages(projectId, orderedIds);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/projects/:id/plan/confirm — freelancer confirms plan, optionally sends to client
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.post("/api/projects/:id/plan/confirm", requireAuth, async (req, res) => {
    try {
      const { requireClientApproval } = req.body;
      const freelancerId = req.auth!.userId;
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw || pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Not authorised" });
      const stages = await getProjectStages(projectId);
      if (stages.length === 0) return res.status(400).json({ error: "Add at least one stage before confirming" });
      const now = new Date().toISOString();
      if (requireClientApproval) {
        await setPlanningStatus(projectId, "awaiting_client", { planSentToClientAt: now });
        await notify({ recipientId: pw.project.clientId, actorId: freelancerId,
          actorName: pw.freelancer?.name ?? "Freelancer", actorAvatar: pw.freelancer?.avatar ?? null,
          type: "stage_advanced",
          message: `${pw.freelancer?.name ?? "Your freelancer"} has shared the project plan for "${pw.project.title}" — review and approve to get started.`,
          link: "/your-work", read: 0,
          targetType: "project", targetId: projectId });
        await logStageEvent(projectId, freelancerId, "plan_sent_to_client");
        res.json({ status: "awaiting_client" });
      } else {
        // Freelancer starts immediately — activate first stage
        await setPlanningStatus(projectId, "confirmed", { planConfirmedAt: now });
        if (stages.length > 0) await startStage(stages[0].id);
        await logStageEvent(projectId, freelancerId, "plan_confirmed");
        res.json({ status: "confirmed" });
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/projects/:id/plan/approve — client approves plan
  // PRD-018 A19: requireAuth + session-derived clientId
  app.post("/api/projects/:id/plan/approve", requireAuth, async (req, res) => {
    try {
      const clientId = req.auth!.userId;
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw || pw.project.clientId !== clientId) return res.status(403).json({ error: "Not authorised" });
      const now = new Date().toISOString();
      await setPlanningStatus(projectId, "confirmed", { planConfirmedAt: now });
      const stages = await getProjectStages(projectId);
      if (stages.length > 0) await startStage(stages[0].id);
      await logStageEvent(projectId, clientId, "plan_approved_by_client");
      await notify({ recipientId: pw.project.freelancerId, actorId: clientId,
        actorName: pw.client?.name ?? "Client", actorAvatar: null,
        type: "stage_advanced",
        message: `${pw.client?.name ?? "Your client"} approved the project plan for "${pw.project.title}" — you're ready to begin!`,
        link: "/your-work", read: 0,
        targetType: "project", targetId: projectId });
      res.json({ status: "confirmed" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/projects/:id/plan/request-change — client requests changes
  // PRD-018 A19: requireAuth + session-derived clientId
  app.post("/api/projects/:id/plan/request-change", requireAuth, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "message required" });
      const clientId = req.auth!.userId;
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw || pw.project.clientId !== clientId) return res.status(403).json({ error: "Not authorised" });
      await setPlanningStatus(projectId, "client_changes");
      await logStageEvent(projectId, clientId, "plan_change_requested", message);
      await notify({ recipientId: pw.project.freelancerId, actorId: clientId,
        actorName: pw.client?.name ?? "Client", actorAvatar: null,
        type: "stage_advanced",
        message: `${pw.client?.name ?? "Your client"} requested a change to the project plan for "${pw.project.title}".`,
        link: "/your-work", read: 0,
        targetType: "project", targetId: projectId });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/stages/:id/start — mark stage in_progress
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.post("/api/stages/:id/start", requireAuth, async (req, res) => {
    try {
      const freelancerId = req.auth!.userId;
      const stage = await getProjectStage(Number(req.params.id));
      if (!stage) return res.status(404).json({ error: "Stage not found" });
      const pw = await storage.getProject(stage.projectId);
      if (!pw || pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Not authorised" });
      const updated = await startStage(stage.id);
      await logStageEvent(stage.projectId, freelancerId, "stage_started", undefined, stage.id);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/stages/:id/submit — freelancer submits for client review
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.post("/api/stages/:id/submit", requireAuth, async (req, res) => {
    try {
      const freelancerId = req.auth!.userId;
      const stage = await getProjectStage(Number(req.params.id));
      if (!stage) return res.status(404).json({ error: "Stage not found" });
      const pw = await storage.getProject(stage.projectId);
      if (!pw || pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Not authorised" });
      const updated = await submitStageForReview(stage.id);
      await logStageEvent(stage.projectId, freelancerId, "stage_submitted", undefined, stage.id);
      await notify({ recipientId: pw.project.clientId, actorId: freelancerId,
        actorName: pw.freelancer?.name ?? "Freelancer", actorAvatar: pw.freelancer?.avatar ?? null,
        type: "stage_advanced",
        message: `"${stage.title}" is ready for your review on "${pw.project.title}".`,
        link: "/your-work", read: 0,
        targetType: "project", targetId: stage.projectId });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/stages/:id/approve — client approves a stage
  // PRD-018 A19: requireAuth + session-derived clientId
  app.post("/api/stages/:id/approve", requireAuth, async (req, res) => {
    try {
      const clientId = req.auth!.userId;
      const stage = await getProjectStage(Number(req.params.id));
      if (!stage) return res.status(404).json({ error: "Stage not found" });
      const pw = await storage.getProject(stage.projectId);
      if (!pw || pw.project.clientId !== clientId) return res.status(403).json({ error: "Not authorised" });
      const updated = await approveStage(stage.id);
      await logStageEvent(stage.projectId, clientId, "stage_approved", undefined, stage.id);
      // Auto-start next upcoming stage
      const stages = await getProjectStages(stage.projectId);
      const next = stages.find(s => s.status === "upcoming" && s.position > stage.position);
      if (next) await startStage(next.id);
      await notify({ recipientId: pw.project.freelancerId, actorId: clientId,
        actorName: pw.client?.name ?? "Client", actorAvatar: null,
        type: "stage_advanced",
        message: `${pw.client?.name ?? "Your client"} approved "${stage.title}" on "${pw.project.title}".`,
        link: "/your-work", read: 0,
        targetType: "project", targetId: stage.projectId });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/stages/:id/complete — freelancer completes stage (no approval needed)
  // PRD-018 A19: requireAuth + session-derived freelancerId
  app.post("/api/stages/:id/complete", requireAuth, async (req, res) => {
    try {
      const freelancerId = req.auth!.userId;
      const stage = await getProjectStage(Number(req.params.id));
      if (!stage) return res.status(404).json({ error: "Stage not found" });
      const pw = await storage.getProject(stage.projectId);
      if (!pw || pw.project.freelancerId !== freelancerId) return res.status(403).json({ error: "Not authorised" });
      const updated = await completeStage(stage.id);
      await logStageEvent(stage.projectId, freelancerId, "stage_completed", undefined, stage.id);
      // Auto-start next upcoming stage
      const stages = await getProjectStages(stage.projectId);
      const next = stages.find(s => s.status === "upcoming" && s.position > stage.position);
      if (next) await startStage(next.id);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/stages/:id/request-changes — client requests changes on a stage
  // PRD-018 A19: requireAuth + session-derived clientId
  app.post("/api/stages/:id/request-changes", requireAuth, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "message required" });
      const clientId = req.auth!.userId;
      const stage = await getProjectStage(Number(req.params.id));
      if (!stage) return res.status(404).json({ error: "Stage not found" });
      const pw = await storage.getProject(stage.projectId);
      if (!pw || pw.project.clientId !== clientId) return res.status(403).json({ error: "Not authorised" });
      const updated = await requestStageChanges(stage.id, message);
      await logStageEvent(stage.projectId, clientId, "stage_changes_requested", message, stage.id);
      await notify({ recipientId: pw.project.freelancerId, actorId: clientId,
        actorName: pw.client?.name ?? "Client", actorAvatar: null,
        type: "stage_advanced",
        message: `${pw.client?.name ?? "Your client"} requested changes on "${stage.title}".`,
        link: "/your-work", read: 0,
        targetType: "project", targetId: stage.projectId });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/projects/:id/plan-summary — for plan review screen
  // PRD-1 read-path auth: requireAuth + party check (was unauthenticated).
  app.get("/api/projects/:id/plan-summary", requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      await assertProjectParty(projectId, req.auth!.userId);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      const stages = await getProjectStages(projectId);
      const active = getActiveStage(stages);
      const progress = calcProgress(stages);
      res.json({
        planningStatus: (pw.project as any).planningStatus ?? "legacy",
        planConfirmedAt: (pw.project as any).planConfirmedAt,
        planSentToClientAt: (pw.project as any).planSentToClientAt,
        stages,
        activeStage: active ?? null,
        progress,
        stageCount: stages.length,
      });
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to load plan summary" });
    }
  });

  // ─── Deliverables ──────────────────────────────────────────────────────────
  // PRD-1 Decision 10 — THE REAL PAYMENT GATE.
  //
  // Until now the only thing between an unpaid client and the freelancer's work
  // was one CSS condition in client/src/components/DeliverablesSection.tsx (a
  // watermark overlay). That is not security: the URL was in the JSON payload,
  // so DevTools, curl, or the React Query cache handed over the asset
  // regardless of payment.
  //
  // `deliverables` rows are third-party links (`url`, `embed_url`, both NOT
  // NULL — contract section A). There is no object key and no per-row access
  // column, so the enforceable gate is a PROJECTION gate: when locked, `url`
  // and `embedUrl` are never serialised at all.
  //
  // GATE CONDITION (contract D):
  //   locked = (viewer is the CLIENT party) AND (project.paymentStatus !== "paid")
  // The freelancer party always receives URLs — it is their own work. Admins
  // always receive URLs; note that `assertProjectParty` has no admin bypass, so
  // an admin who is not a party is rejected before the gate is even evaluated
  // and must use a requireAdminGuard route.
  app.get("/api/projects/:id/deliverables", requireAuth, async (req, res) => {
    try {
      const { project, role } = await assertProjectParty(Number(req.params.id), req.auth!.userId);
      const list = await storage.getDeliverables(Number(req.params.id));

      const isAdmin = (req.auth as any)?.role === "admin" || (req.auth as any)?.isAdmin === true;
      const locked = role === "client" && project.paymentStatus !== "paid" && !isAdmin;

      res.set("Cache-Control", "private, no-store");
      res.json(list.map(d => ({
        id: d.id,
        label: d.label,
        platform: d.platform,
        locked,
        // ADDITIVE beyond the contract's minimum shape (mobile ignores extra
        // fields): the web list needs `createdBy` for the freelancer's delete
        // control and `createdAt` for its timestamp. Neither is sensitive — an
        // actor id and a timestamp, both already visible to both parties — and
        // neither can be used to reach the asset.
        createdBy: d.createdBy,
        createdAt: d.createdAt,
        // OMITTED, not blanked, when locked. Nothing client-side can
        // reconstruct them.
        ...(locked
          ? { lockReason: "awaiting_payment" as const }
          : { url: d.url, embedUrl: d.embedUrl }),
      })));
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to load deliverables" });
    }
  });

  // PRD-018 A20: requireAuth + session-derived createdBy
  // PRD-1 wave 3: added the missing PARTY CHECK — any authenticated user could
  // previously attach a deliverable to ANY project id.
  app.post("/api/projects/:id/deliverables", requireAuth, async (req, res) => {
    try {
      await assertProjectParty(Number(req.params.id), req.auth!.userId);
    } catch (e: any) {
      if (sendProjectAccessError(res, e)) return;
      return res.status(500).json({ error: "Failed to add deliverable" });
    }
    const { url, label, platform, embedUrl } = req.body;
    if (!url || !label || !platform || !embedUrl) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const d = await storage.addDeliverable({
      projectId: Number(req.params.id),
      url: String(url), label: String(label),
      platform: String(platform), embedUrl: String(embedUrl),
      createdBy: req.auth!.userId,
    });
    res.json(d);
  });

  // PRD-018 A20: requireAuth + session-derived userId
  app.delete("/api/deliverables/:id", requireAuth, async (req, res) => {
    const ok = await storage.deleteDeliverable(Number(req.params.id), req.auth!.userId);
    if (!ok) return res.status(403).json({ error: "Not allowed" });
    res.json({ success: true });
  });

  // ─── Time Entries ───────────────────────────────────────────────────────

  // GET /api/projects/:id/time-entries — list all entries for a project
  // PRD-1 read-path auth: requireAuth + party check (was unauthenticated).
  app.get("/api/projects/:id/time-entries", requireAuth, async (req, res) => {
    try {
      await assertProjectParty(Number(req.params.id), req.auth!.userId);
      const entries = await storage.getTimeEntriesByProject(Number(req.params.id));
      res.json(entries);
    } catch (e) {
      if (sendProjectAccessError(res, e)) return;
      res.status(500).json({ error: "Failed to load time entries" });
    }
  });

  // POST /api/projects/:id/time-entries — log a new time entry
  // PRD-018 A21: requireAuth + session-derived userId
  app.post("/api/projects/:id/time-entries", requireAuth, async (req, res) => {
    try {
      const { agencyId, description, minutes, billable, loggedAt } = req.body;
      if (!minutes || !loggedAt) {
        return res.status(400).json({ error: "minutes and loggedAt are required" });
      }
      const entry = await storage.createTimeEntry({
        projectId: Number(req.params.id),
        userId: req.auth!.userId,
        agencyId: agencyId ? Number(agencyId) : null,
        description: description || "",
        minutes: Number(minutes),
        billable: billable !== false,
        loggedAt: String(loggedAt),
      });
      res.json(entry);
    } catch (e) {
      res.status(500).json({ error: "Failed to log time entry" });
    }
  });

  // PATCH /api/time-entries/:id — update a time entry (owner only)
  // PRD-018 A21: requireAuth + session-derived userId
  app.patch("/api/time-entries/:id", requireAuth, async (req, res) => {
    try {
      const { ...data } = req.body;
      const updated = await storage.updateTimeEntry(Number(req.params.id), req.auth!.userId, data);
      if (!updated) return res.status(403).json({ error: "Not found or not allowed" });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: "Failed to update time entry" });
    }
  });

  // DELETE /api/time-entries/:id — delete a time entry (owner only)
  // PRD-018 A21: requireAuth + session-derived userId
  app.delete("/api/time-entries/:id", requireAuth, async (req, res) => {
    try {
      const ok = await storage.deleteTimeEntry(Number(req.params.id), req.auth!.userId);
      if (!ok) return res.status(403).json({ error: "Not found or not allowed" });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to delete time entry" });
    }
  });

  // GET /api/users/:id/time-entries — all entries for a user (agency reports)
  app.get("/api/users/:id/time-entries", async (req, res) => {
    try {
      const entries = await storage.getTimeEntriesByUser(Number(req.params.id));
      res.json(entries);
    } catch (e) {
      res.status(500).json({ error: "Failed to load time entries" });
    }
  });

  // GET /api/agencies/:id/time-entries — all entries for an agency (agency reports)
  app.get("/api/agencies/:id/time-entries", async (req, res) => {
    try {
      const entries = await storage.getTimeEntriesByAgency(Number(req.params.id));
      res.json(entries);
    } catch (e) {
      res.status(500).json({ error: "Failed to load time entries" });
    }
  });

  // ─── Briefs ────────────────────────────────────────────────────────────────
  app.get("/api/briefs", async (req, res) => {
    const { category, location, clientId } = req.query;
    // WS-E: pagination support (default limit 50, offset 0 — backwards-compatible)
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    let briefs = await storage.getBriefs(limit, offset);
    if (category && category !== "All") briefs = briefs.filter(b => b.category === category);
    if (location) briefs = briefs.filter(b => b.location.toLowerCase().includes(String(location).toLowerCase()));
    if (clientId) briefs = briefs.filter(b => b.clientId === Number(clientId));
    res.json(briefs);
  });

  app.get("/api/briefs/:id", async (req, res) => {
    const brief = await storage.getBrief(Number(req.params.id));
    if (!brief) return res.status(404).json({ error: "Brief not found" });
    res.json(brief);
  });

  // PRD-1 wave 3: `clientId` (and the denormalised client display fields) are
  // now taken from the SESSION, not the body. Previously any authenticated user
  // could post a brief in another user's name — the brief would appear in that
  // client's dashboard and every interest notification would be routed to them.
  app.post("/api/briefs", requireAuth, briefLimiter, async (req, res) => {
    try {
      const me = await storage.getUser(req.auth!.userId);
      if (!me) return res.status(401).json({ error: "Not authenticated" });
      const data = insertBriefSchema.parse({
        ...req.body,
        clientId: me.id,
        clientName: me.name,
        clientAvatar: me.avatar ?? null,
        // Lifecycle counters are server-owned.
        status: "open",
        isActive: true,
      });
      const brief = await storage.createBrief(data);
      res.json(brief);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Brief Interests ───────────────────────────────────────────────────────
  // Freelancer expresses interest in a brief
  // PRD-1 wave 3: `freelancerId` comes from the SESSION, and the brief-side
  // fields (`briefClientId`, `briefTitle`, `briefClientName`) are read from the
  // brief row rather than trusted from the body. Before this, a caller could
  // apply as somebody else and — worse — set `briefClientId` freely, which is
  // the field `notify()` uses as the recipient, making this route an arbitrary
  // notification sender.
  app.post("/api/interests", requireAuth, interestLimiter, async (req, res) => {
    try {
      const me = await storage.getUser(req.auth!.userId);
      if (!me) return res.status(401).json({ error: "Not authenticated" });
      const briefId = Number(req.body?.briefId);
      const brief = Number.isFinite(briefId) ? await storage.getBrief(briefId) : undefined;
      if (!brief) return res.status(404).json({ error: "Brief not found" });
      if (brief.clientId === me.id) {
        return res.status(400).json({ error: "You cannot express interest in your own brief" });
      }
      const data = insertBriefInterestSchema.parse({
        ...req.body,
        briefId: brief.id,
        briefTitle: brief.title,
        briefClientId: brief.clientId,
        briefClientName: brief.clientName,
        freelancerId: me.id,
        freelancerName: me.name,
        freelancerAvatar: me.avatar ?? null,
        status: "pending",
        counterOfferPence: null,
        respondedAt: null,
      });
      const interest = await storage.createBriefInterest(data);
      // Notify the client that a freelancer expressed interest in their brief
      await notify({
        recipientId: data.briefClientId,
        actorId: data.freelancerId,
        actorName: data.freelancerName,
        actorAvatar: data.freelancerAvatar ?? null,
        type: "interest",
        message: `${data.freelancerName} expressed interest in your brief "${data.briefTitle}"`,
        link: `/dashboard`,
        read: 0,
        // Decision 17: interest threads live in Brief context, never the DM
        // inbox — so the target is the brief.
        targetType: "brief",
        targetId: data.briefId ?? null,
      });
      res.json(interest);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Get interests expressed BY a freelancer (their own applications)
  app.get("/api/interests/freelancer/:id", async (req, res) => {
    try {
      const interests = await storage.getBriefInterestsForFreelancer(Number(req.params.id));
      res.json(interests);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get interests received BY a client (applicants to their briefs)
  app.get("/api/interests/client/:id", async (req, res) => {
    try {
      const interests = await storage.getBriefInterestsForClient(Number(req.params.id));
      res.json(interests);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Counter-offer on a brief interest
  app.patch("/api/interests/:id/counter", requireAuth, async (req, res) => {
    try {
      const { counterOfferPence, clientName, clientAvatar } = req.body;
      if (!counterOfferPence || counterOfferPence < 50)
        return res.status(400).json({ error: "Invalid counter-offer amount" });
      const interest = await storage.getBriefInterest(Number(req.params.id));
      if (!interest) return res.status(404).json({ error: "Not found" });
      await storage.updateBriefInterestPricing(Number(req.params.id), { counterOfferPence, status: "counter_offered" });
      const client = await storage.getUser(interest.briefClientId);
      await notify({
        recipientId: interest.freelancerId, actorId: interest.briefClientId,
        actorName: clientName ?? interest.briefClientName,
        actorAvatar: clientAvatar ?? (client?.avatar ?? null),
        type: "interest",
        message: `${clientName ?? interest.briefClientName} made a counter-offer of £${(counterOfferPence / 100).toFixed(2)} on "${interest.briefTitle}"`,
        link: "/dashboard", read: 0,
        targetType: "brief", targetId: interest.briefId ?? null,
      });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Freelancer accepts a counter-offer
  // A0-N1
  app.patch("/api/interests/:id/accept-counter", requireAuth, async (req, res) => {
    try {
      const interest = await storage.getBriefInterest(Number(req.params.id));
      if (!interest) return res.status(404).json({ error: "Not found" });
      // A0: only the freelancer on this interest can accept a counter-offer
      if (req.auth!.userId !== interest.freelancerId) return res.status(403).json({ error: "Forbidden." });
      if (!(interest as any).counterOfferPence) return res.status(400).json({ error: "No counter-offer" });
      await storage.updateBriefInterestStatus(Number(req.params.id), "accepted");
      const existing = await storage.getProjectByInterestId(interest.id);
      if (!existing) {
        let briefDesc = "", briefCategory = "";
        try { const brief = await storage.getBrief(interest.briefId); if (brief) { briefDesc = brief.description ?? ""; briefCategory = brief.category ?? ""; } } catch {}
        // PRD 1 wave 4: the created project is now captured so the notification
        // can carry its id (Decision 14). The call itself is unchanged.
        const createdProject: { id?: number } | undefined = await storage.createProject({
          clientId: interest.briefClientId, freelancerId: interest.freelancerId,
          title: interest.briefTitle, description: briefDesc, status: "active", currentStage: 0,
          briefId: interest.briefId ?? undefined, interestId: interest.id,
          freelancerName: interest.freelancerName, clientName: interest.briefClientName, briefCategory,
          agreedAmountPence: (interest as any).counterOfferPence,
          planningStatus: "planning_required",
        } as any);
        if (interest.briefId) try { await storage.deactivateBrief(interest.briefId); } catch {}
        await notify({
          recipientId: interest.briefClientId, actorId: interest.freelancerId,
          actorName: interest.freelancerName, actorAvatar: interest.freelancerAvatar ?? null,
          type: "interest_accepted",
          message: `${interest.freelancerName} accepted your counter-offer on "${interest.briefTitle}" — project is live!`,
          link: "/your-work", read: 0,
          // The notification says "project is live", so the project is the right
          // destination when we have its id; the brief is the honest fallback.
          ...(createdProject?.id
            ? { targetType: "project" as const, targetId: createdProject.id }
            : { targetType: "brief" as const, targetId: interest.briefId ?? null }),
        });
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Client updates status of an interest (viewed / accepted / declined)
  // A0-N2
  app.patch("/api/interests/:id/status", requireAuth, async (req, res) => {
    try {
      const { status, clientName, clientAvatar } = req.body;
      if (!["pending", "viewed", "accepted", "declined"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const interest = await storage.getBriefInterest(Number(req.params.id));
      if (!interest) return res.status(404).json({ error: "Interest not found" });
      // A0: only the brief owner (client) can change status to accepted/declined
      if (["accepted", "declined"].includes(status) && interest.briefClientId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the client can accept or decline this interest" });
      }
      await storage.updateBriefInterestStatus(Number(req.params.id), status);

      if (interest && status === "accepted") {
        // ── Auto-create a live project from the accepted interest ──
        const existing = await storage.getProjectByInterestId(interest.id);
        if (!existing) {
          let briefDesc = "";
          let briefCategory = "";
          try {
            const brief = await storage.getBrief(interest.briefId);
            if (brief) { briefDesc = brief.description ?? ""; briefCategory = brief.category ?? ""; }
          } catch {}
          const project = await storage.createProject({
            clientId:       interest.briefClientId,
            freelancerId:   interest.freelancerId,
            title:          interest.briefTitle,
            description:    briefDesc,
            status:         "active",
            currentStage:   0,
            briefId:        interest.briefId ?? undefined,
            interestId:     interest.id,
            freelancerName: interest.freelancerName,
            clientName:     interest.briefClientName,
            briefCategory,
            agreedAmountPence: (interest as any).proposedPricePence ?? undefined,
            planningStatus: "planning_required",
          } as any);
          // ── Agency member sourcing: tag project with agencyId ──────────────────────
          try {
            const agencyMembership = await storage.getAgencyMemberByUserId(interest.freelancerId);
            if (agencyMembership) {
              await db.update(schema.projects)
                .set({ agencyId: agencyMembership.agencyId })
                .where(eq(schema.projects.id, project.id));
              // Log to agency activity feed
              const briefForActivity = interest.briefId ? await storage.getBrief(interest.briefId).catch(() => null) : null;
              await storage.createAgencyActivity({
                agencyId: agencyMembership.agencyId,
                type: 'brief_won',
                title: `${interest.freelancerName || 'Team member'} landed a project`,
                body: `Brief: ${briefForActivity?.title || interest.briefTitle || 'Untitled'} — accepted by client`,
                entityType: 'project',
                entityId: project.id,
                actorId: interest.freelancerId,
                actorName: interest.freelancerName || undefined,
              });
            }
          } catch (e) { console.error('agency tagging error', e); }
          // Remove brief from the public board
          if (interest.briefId) {
            try { await storage.deactivateBrief(interest.briefId); } catch {}
          }
        }
        // Notify freelancer
        const client = await storage.getUser(interest.briefClientId);
        await notify({
          recipientId: interest.freelancerId,
          actorId:     interest.briefClientId,
          actorName:   clientName ?? interest.briefClientName,
          actorAvatar: clientAvatar ?? (client?.avatar ?? null),
          type:        "interest_accepted",
          message:     `${clientName ?? interest.briefClientName} accepted your interest in "${interest.briefTitle}" — project is now live!`,
          link:        `/dashboard`,
          read:        0,
          targetType:  "brief",
          targetId:    interest.briefId ?? null,
        });
      } else if (interest && status === "declined" && clientName) {
        const client = await storage.getUser(interest.briefClientId);
        await notify({
          recipientId: interest.freelancerId,
          actorId:     interest.briefClientId,
          actorName:   clientName,
          actorAvatar: clientAvatar ?? (client?.avatar ?? null),
          type:        "interest_declined",
          message:     `${clientName} declined your interest in "${interest.briefTitle}"`,
          link:        `/dashboard`,
          read:        0,
          targetType:  "brief",
          targetId:    interest.briefId ?? null,
        });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Notifications ───────────────────────────────────────────────────
  // Get all notifications for a user
  // A0-NT1
  app.get("/api/notifications/:userId", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    try {
      // PRD-1 wave 3: paging. This route previously returned EVERY notification
      // row a user had ever received on every poll. limit defaults to 30 and is
      // clamped to 100 in storage; ordering is by id desc (`created_at` is a
      // text column — contract section A — and is not a reliable sort key).
      const limit = optionalPositiveInt(req.query.limit) ?? 30;
      const offset = optionalPositiveInt(req.query.offset) ?? 0;
      const notifs = await storage.getNotifications(req.auth!.userId, limit, offset);
      res.set("Cache-Control", "private, no-store");
      res.json(notifs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get unread count only (for polling)
  // A0-NT2
  app.get("/api/notifications/:userId/unread-count", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    try {
      const count = await storage.getUnreadNotificationCount(req.auth!.userId);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark a single notification as read
  // PRD-018 A22: requireAuth — only authenticated users can mark notifications read
  //
  // PRD-1 wave 3 OWNERSHIP FIX: requireAuth alone only proved the caller was
  // *someone*. `markNotificationRead(id)` updated by primary key with no
  // recipient predicate, so any logged-in user could walk the id space and mark
  // other people's notifications read — silently suppressing another user's
  // unread badge. The recipient is now part of the WHERE clause and a row that
  // is not yours is indistinguishable from one that does not exist (404).
  app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid notification id" });
      const ok = await storage.markNotificationRead(id, req.auth!.userId);
      if (!ok) return res.status(404).json({ error: "Notification not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark ALL notifications as read for a user
  // A0-NT3
  app.patch("/api/notifications/user/:userId/read-all", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    try {
      await storage.markAllNotificationsRead(req.auth!.userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Workspace: Tasks ────────────────────────────────────────────────────
  app.get("/api/workspace/tasks/:userId", async (req, res) => {
    try {
      res.json(await storage.getTasks(Number(req.params.userId)));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PRD-018 A23: requireAuth + session-derived userId
  app.post("/api/workspace/tasks", requireAuth, async (req, res) => {
    try {
      const { userId: _ignored, ...rest } = req.body;
      const task = await storage.createTask({ ...rest, userId: req.auth!.userId });
      res.json(task);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // PRD-018 A23: requireAuth + session-derived userId
  app.patch("/api/workspace/tasks/:id", requireAuth, async (req, res) => {
    try {
      const { userId: _ignored, ...data } = req.body;
      const task = await storage.updateTask(Number(req.params.id), req.auth!.userId, data);
      if (!task) return res.status(404).json({ error: "Not found" });
      res.json(task);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // PRD-018 A23: requireAuth + session-derived userId
  app.delete("/api/workspace/tasks/:id", requireAuth, async (req, res) => {
    try {
      const ok = await storage.deleteTask(Number(req.params.id), req.auth!.userId);
      if (!ok) return res.status(403).json({ error: "Not allowed" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Workspace: Calendar Events ─────────────────────────────────────────
  app.get("/api/workspace/events/:userId", async (req, res) => {
    try {
      const month = String(req.query.month || new Date().toISOString().slice(0, 7));
      res.json(await storage.getCalendarEvents(Number(req.params.userId), month));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PRD-018 A24: requireAuth + session-derived userId
  app.post("/api/workspace/events", requireAuth, async (req, res) => {
    try {
      const { userId: _ignored, ...rest } = req.body;
      const event = await storage.createCalendarEvent({ ...rest, userId: req.auth!.userId });
      res.json(event);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // PRD-018 A24: requireAuth + session-derived userId
  app.patch("/api/workspace/events/:id", requireAuth, async (req, res) => {
    try {
      const { userId: _ignored, ...data } = req.body;
      const event = await storage.updateCalendarEvent(Number(req.params.id), req.auth!.userId, data);
      if (!event) return res.status(404).json({ error: "Not found" });
      res.json(event);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // PRD-018 A24: requireAuth + session-derived userId
  app.delete("/api/workspace/events/:id", requireAuth, async (req, res) => {
    try {
      const ok = await storage.deleteCalendarEvent(Number(req.params.id), req.auth!.userId);
      if (!ok) return res.status(403).json({ error: "Not allowed" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Connection Requests (LinkedIn-style) ───────────────────────────────────

  // Send a connection request
  // PRD-018 A25: requireAuth + session-derived senderId
  app.post("/api/connections/request", requireAuth, async (req, res) => {
    try {
      const senderId = req.auth!.userId;
      const { recipientId } = req.body;
      if (!recipientId) return res.status(400).json({ error: "Missing fields" });
      if (senderId === Number(recipientId)) return res.status(400).json({ error: "Cannot connect with yourself" });
      // Check if already accepted
      const already = await storage.isConnected(senderId, Number(recipientId));
      if (already) return res.status(409).json({ error: "Already connected" });
      const connReq = await storage.sendConnectionRequest(senderId, Number(recipientId));
      // Notify recipient
      const sender = await storage.getUser(senderId);
      if (sender) {
        await notify({
          recipientId: Number(recipientId),
          actorId: senderId,
          actorName: sender.name,
          actorAvatar: sender.avatar ?? null,
          type: "connection_request",
          message: `${sender.name} sent you a connection request`,
          link: "/dashboard",
          read: 0,
          targetType: "profile",
          targetId: senderId,
        });
      }
      res.json(connReq);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Accept / decline a connection request
  // PRD-018 A25: requireAuth + session-derived responderId
  app.patch("/api/connections/request/:id", requireAuth, async (req, res) => {
    try {
      const { status } = req.body; // 'accepted' | 'declined'
      if (!['accepted','declined'].includes(status)) return res.status(400).json({ error: "Invalid status" });
      await storage.respondToConnectionRequest(Number(req.params.id), status);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Better accept/decline route with proper notification
  // PRD-018 A25: requireAuth + session-derived responderId
  app.post("/api/connections/respond", requireAuth, async (req, res) => {
    try {
      const responderId = req.auth!.userId;
      const { requestId, senderId, status } = req.body;
      if (!requestId || !['accepted','declined'].includes(status)) {
        return res.status(400).json({ error: "Missing or invalid fields" });
      }
      await storage.respondToConnectionRequest(Number(requestId), status);
      if (status === 'accepted') {
        const responder = await storage.getUser(responderId);
        if (responder && senderId) {
          await notify({
            recipientId: Number(senderId),
            actorId: responderId,
            actorName: responder.name,
            actorAvatar: responder.avatar ?? null,
            type: "connection_accepted",
            message: `${responder.name} accepted your connection request`,
            link: "/dashboard",
            read: 0,
            targetType: "profile",
            targetId: responderId,
          });
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get pending connection requests for a user
  app.get("/api/connections/pending", async (req, res) => {
    try {
      const userId = Number(req.query.userId);
      if (!userId) return res.status(400).json({ error: "userId required" });
      const pending = await storage.getPendingConnectionRequests(userId);
      res.json(pending);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get all accepted connections for a user
  app.get("/api/connections", async (req, res) => {
    try {
      const userId = Number(req.query.userId);
      if (!userId) return res.status(400).json({ error: "userId required" });
      const conns = await storage.getConnections(userId);
      res.json(conns);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get connection status between two users
  app.get("/api/connections/status", async (req, res) => {
    try {
      const userA = Number(req.query.userA);
      const userB = Number(req.query.userB);
      if (!userA || !userB) return res.status(400).json({ error: "userA and userB required" });
      const connStatus = await storage.getConnectionRequestBetween(userA, userB);
      res.json({ status: connStatus?.status ?? 'none', requestId: connStatus?.id ?? null, senderId: connStatus?.senderId ?? null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Remove a connection
  // PRD-018 A25: requireAuth + session-derived userA
  app.delete("/api/connections", requireAuth, async (req, res) => {
    try {
      const userA = req.auth!.userId;
      const { userB } = req.body;
      if (!userB) return res.status(400).json({ error: "Missing fields" });
      await storage.removeConnection(userA, Number(userB));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ── STRIPE CONNECT ROUTES ────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────

  // 1. Create (or retrieve) a Stripe Express account for a freelancer

  // ─── PRD-007: Hardened Stripe Payment Routes ─────────────────────────────────

  // FR-14: Explicit freelancer Connect account creation (must be initiated by freelancer)
  // ─── PRD-009: Dedicated Viewrr payment terms acceptance (FR-03, FR-04) ──────────
  // POST /api/stripe/accept-terms
  // Records Viewrr payment terms acceptance server-side. Never trust a frontend boolean.
  // A0-L1
  app.post("/api/stripe/accept-terms", requireAuth, async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      // A0: body userId is IGNORED; terms are always recorded for the authenticated caller
      const user = await storage.getUser(req.auth!.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "freelancer") return res.status(403).json({ error: "Only freelancers need payment terms" });

      const PAYMENT_TERMS_VERSION = "v1.0";
      const PAYMENT_TERMS_DOCUMENT = "stripe_connect_disclosure";

      // Ensure terms version record exists
      await db`
        INSERT INTO terms_versions (document, version, effective_date, content_hash)
        VALUES (
          ${PAYMENT_TERMS_DOCUMENT},
          ${PAYMENT_TERMS_VERSION},
          '2026-01-01',
          'prd009_v1_sha256_placeholder'
        )
        ON CONFLICT (document, version) DO NOTHING
      `;

      const tv = await db`
        SELECT id FROM terms_versions
        WHERE document = ${PAYMENT_TERMS_DOCUMENT} AND version = ${PAYMENT_TERMS_VERSION}
        LIMIT 1
      `;

      const ip = req.headers["x-forwarded-for"]?.toString() ?? req.socket?.remoteAddress ?? "";
      const ua = (req.headers["user-agent"] ?? "").slice(0, 500);

      await db`
        INSERT INTO terms_acceptances (user_id, terms_version_id, document, version, context, ip_address, user_agent)
        VALUES (
          ${req.auth!.userId}, ${tv[0].id},
          ${PAYMENT_TERMS_DOCUMENT}, ${PAYMENT_TERMS_VERSION},
          'stripe_connect_onboarding', ${ip}, ${ua}
        )
        ON CONFLICT (user_id, terms_version_id) DO UPDATE
          SET accepted_at = NOW()::TEXT
      `;

      await auditLog({
        actorType: "user",
        actorId: req.auth!.userId,
        action: "payment_terms_accepted",
        afterState: JSON.stringify({ document: PAYMENT_TERMS_DOCUMENT, version: PAYMENT_TERMS_VERSION }),
      });

      res.json({ accepted: true, document: PAYMENT_TERMS_DOCUMENT, version: PAYMENT_TERMS_VERSION });
    } catch (e: any) {
      console.error("[stripe/accept-terms]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-009: GET terms acceptance status ──────────────────────────────────────
  // A0-S6
  app.get("/api/stripe/terms-status/:userId", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    try {
      const db = neon(process.env.DATABASE_URL!);
      const userId = Number(req.params.userId);
      const PAYMENT_TERMS_DOCUMENT = "stripe_connect_disclosure";

      const acceptance = await db`
        SELECT ta.accepted_at, ta.version, tv.effective_date
        FROM terms_acceptances ta
        JOIN terms_versions tv ON tv.id = ta.terms_version_id
        WHERE ta.user_id = ${userId} AND ta.document = ${PAYMENT_TERMS_DOCUMENT}
        ORDER BY ta.accepted_at DESC
        LIMIT 1
      `;

      res.json({
        accepted: acceptance.length > 0,
        acceptedAt: acceptance[0]?.accepted_at ?? null,
        version: acceptance[0]?.version ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-009: Connect account — correct FR-02 flow order ───────────────────────
  // Flow: Authenticate → Detect existing → Sync Stripe → Check Viewrr terms →
  //        If needed return VIEWRR_PAYMENT_TERMS_REQUIRED → Create only if none exists
  // NEVER creates a second account for the same user (FR-08).
  // A0-S1
  app.post("/api/stripe/connect-account", requireAuth, async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      // A0: identity from session; body userId ignored for caller auth
      const user = await storage.getUser(req.auth!.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "freelancer") return res.status(403).json({ error: "Only freelancers can connect Stripe" });

      const db = neon(process.env.DATABASE_URL!);
      const PAYMENT_TERMS_DOCUMENT = "stripe_connect_disclosure";

      // ─ STEP 1: Check for existing Stripe account FIRST (FR-01, FR-08) ───────────
      if (user.stripeAccountId) {
        // Sync current readiness state from Stripe
        const connectState = await syncConnectAccount(user.id, user.stripeAccountId).catch(() => null);

        // Check Viewrr payment terms separately (FR-03)
        const termsAcceptance = await db`
          SELECT ta.accepted_at FROM terms_acceptances ta
          JOIN terms_versions tv ON tv.id = ta.terms_version_id
          WHERE ta.user_id = ${user.id} AND ta.document = ${PAYMENT_TERMS_DOCUMENT}
          ORDER BY ta.accepted_at DESC LIMIT 1
        `;

        const viewrrTermsAccepted = termsAcceptance.length > 0;

        if (!viewrrTermsAccepted) {
          // FR-07: Structured response — Stripe already connected, only Viewrr terms needed
          return res.status(200).json({
            code: "VIEWRR_PAYMENT_TERMS_REQUIRED",
            accountExists: true,
            stripeConnected: true,
            accountId: user.stripeAccountId,
            readinessState: connectState?.readinessState ?? "verification_pending",
            chargesEnabled: connectState?.chargesEnabled === 1,
            payoutsEnabled: connectState?.payoutsEnabled === 1,
            message: "Your Stripe account is already connected. Please accept the Viewrr payment terms to continue.",
          });
        }

        // Existing account with terms accepted — return state so frontend can decide next step
        return res.json({
          accountId: user.stripeAccountId,
          readinessState: connectState?.readinessState ?? "verification_pending",
          chargesEnabled: connectState?.chargesEnabled === 1,
          payoutsEnabled: connectState?.payoutsEnabled === 1,
          alreadyExists: true,
          viewrrTermsAccepted: true,
          // FR-02: If not fully verified, frontend should request an onboarding link
          needsOnboarding: !(connectState?.chargesEnabled === 1 && connectState?.payoutsEnabled === 1),
        });
      }

      // ─ STEP 2: No existing account — check Viewrr terms before creating ────────
      const termsAcceptance = await db`
        SELECT ta.accepted_at FROM terms_acceptances ta
        JOIN terms_versions tv ON tv.id = ta.terms_version_id
        WHERE ta.user_id = ${user.id} AND ta.document = ${PAYMENT_TERMS_DOCUMENT}
        ORDER BY ta.accepted_at DESC LIMIT 1
      `;

      // Also accept the legacy termsAccepted boolean in body for backward-compat,
      // but immediately persist it server-side — never just trust the boolean alone.
      const legacyTermsFlag = req.body?.termsAccepted === true;
      const viewrrTermsAccepted = termsAcceptance.length > 0;

      if (!viewrrTermsAccepted && !legacyTermsFlag) {
        // FR-07: structured error
        return res.status(200).json({
          code: "VIEWRR_PAYMENT_TERMS_REQUIRED",
          accountExists: false,
          stripeConnected: false,
          message: "Please accept the Viewrr payment terms to set up your Stripe account.",
        });
      }

      // Persist terms acceptance if passed via legacy flag (idempotent)
      if (legacyTermsFlag && !viewrrTermsAccepted) {
        await db`
          INSERT INTO terms_versions (document, version, effective_date, content_hash)
          VALUES ('stripe_connect_disclosure', 'v1.0', '2026-01-01', 'prd009_v1_sha256_placeholder')
          ON CONFLICT (document, version) DO NOTHING
        `;
        const tv = await db`SELECT id FROM terms_versions WHERE document = 'stripe_connect_disclosure' AND version = 'v1.0' LIMIT 1`;
        const ip = req.headers["x-forwarded-for"]?.toString() ?? req.socket?.remoteAddress ?? "";
        const ua = (req.headers["user-agent"] ?? "").slice(0, 500);
        await db`
          INSERT INTO terms_acceptances (user_id, terms_version_id, document, version, context, ip_address, user_agent)
          VALUES (${user.id}, ${tv[0].id}, 'stripe_connect_disclosure', 'v1.0', 'stripe_connect_onboarding', ${ip}, ${ua})
          ON CONFLICT (user_id, terms_version_id) DO NOTHING
        `;
      }

      // ─ STEP 3: Create new Stripe account ───────────────────────────────
      const idempotencyKey = `connect_account:${req.auth!.userId}:v1`;
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        email: user.email,
        business_type: "individual",
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { product_description: "Freelance creative services via Viewrr" },
        metadata: { viewrr_user_id: String(req.auth!.userId) },
      }, { idempotencyKey });

      await storage.updateStripeAccount(user.id, { stripeAccountId: account.id, stripeOnboarded: 0 });
      await syncConnectAccount(user.id, account.id);

      // FR-01 (PRD-010): set daily payout schedule immediately on creation
      await configureNewAccountDailyPayout(account.id);

      await auditLog({
        actorType: "user",
        actorId: user.id,
        action: "stripe_account_created",
        afterState: JSON.stringify({ stripeAccountId: account.id, payoutSchedule: "daily" }),
      });

      res.json({
        accountId: account.id,
        readinessState: "onboarding_required",
        alreadyExists: false,
        viewrrTermsAccepted: true,
      });
    } catch (e: any) {
      console.error("[stripe/connect-account]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // FR-14: Onboarding link — FR-02: no userId in path/body (use body for now, validated against DB)
  // A0-S2
  app.post("/api/stripe/onboarding-link", requireAuth, async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      // A0: identity from session
      const user = await storage.getUser(req.auth!.userId);
      if (!user || !user.stripeAccountId)
        return res.status(404).json({ error: "No Stripe account found. Connect Stripe first." });
      if (user.role !== "freelancer")
        return res.status(403).json({ error: "Only freelancers can access onboarding links" });

      const link = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: `${APP_BASE_URL}/#/payouts?stripe=refresh`,
        return_url: `${APP_BASE_URL}/#/payouts?stripe=complete`,
        type: "account_onboarding",
      });

      // FR-21: record onboarding link request
      await neon(process.env.DATABASE_URL!)`
        UPDATE stripe_connect_accounts
        SET last_onboarding_link_at = ${new Date().toISOString()}, last_onboarding_link_error = NULL
        WHERE user_id = ${user.id}
      `.catch(() => {});

      res.json({ url: link.url });
    } catch (e: any) {
      console.error("[stripe/onboarding-link]", e.message);
      // FR-21: record failure — use req.auth!.userId since body userId is no longer available
      await neon(process.env.DATABASE_URL!)`
        UPDATE stripe_connect_accounts SET last_onboarding_link_error = ${e.message} WHERE user_id = ${req.auth!.userId}
      `.catch(() => {});
      res.status(500).json({ error: e.message });
    }
  });

  // PRD-015 FR-09: Express Dashboard link — opens Stripe Express dashboard for freelancer
  // A0-S3
  app.post("/api/stripe/dashboard-link", requireAuth, async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      // A0: identity from session
      const user = await storage.getUser(req.auth!.userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "freelancer") return res.status(403).json({ error: "Only freelancers can access dashboard links" });
      if (!user.stripeAccountId) return res.status(400).json({ error: "No Stripe account connected" });

      // FR-22: Security — derive account from DB, never trust body account ID
      const link = await stripe.accounts.createLoginLink(user.stripeAccountId);

      // FR-21: record dashboard link access
      await neon(process.env.DATABASE_URL!)`UPDATE stripe_connect_accounts SET last_stripe_sync = ${new Date().toISOString()} WHERE user_id = ${user.id}`.catch(() => {});

      res.json({ url: link.url });
    } catch (e: any) {
      console.error("[stripe/dashboard-link]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // PRD-015 FR-11/12: Payment breakdown for earnings view
  // Returns commission rate actually used (from commission_rate_bps column, or inferred)
  // PRD-018 B1: requireAuth + session-derived uid
  app.get("/api/stripe/payment-breakdown/:publicId", requireAuth, async (req, res) => {
    try {
      const uid = req.auth!.userId;

      const db = neon(process.env.DATABASE_URL!);
      const rows = await db`
        SELECT p.*, pr.title AS project_title, pr.id AS project_id_val
        FROM payments p
        LEFT JOIN projects pr ON pr.id = p.project_id
        WHERE p.public_id = ${req.params.publicId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Payment not found" });
      const p = rows[0];

      // FR-22: security — only client or freelancer
      if (uid !== p.client_id && uid !== p.freelancer_id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const gross = Number(p.gross_pence ?? 0);
      const fee = Number(p.platform_fee_pence ?? 0);
      const freelancerEarnings = Number(p.freelancer_pence ?? gross - fee);

      // FR-12: use stored commission_rate_bps if available; otherwise infer
      let commissionRateBps: number | null = p.commission_rate_bps ? Number(p.commission_rate_bps) : null;
      if (!commissionRateBps && gross > 0) {
        commissionRateBps = Math.round((fee / gross) * 10000);
      }
      const isPro = commissionRateBps !== null && commissionRateBps <= 900; // 8% or lower = Pro

      const savedPence = isPro && gross > 0 ? Math.round(gross * (1100 - (commissionRateBps ?? 1100)) / 10000) : 0;

      res.json({
        publicId: p.public_id,
        projectTitle: p.project_title ?? "Project",
        grossPence: gross,
        platformFeePence: fee,
        freelancerPence: freelancerEarnings,
        commissionRateBps,
        isPro,
        savedPence,
        status: p.status,
        currency: p.currency ?? "gbp",
        succeededAt: p.succeeded_at,
        createdAt: p.created_at,
        stripeFeePence: p.stripe_fee_pence ? Number(p.stripe_fee_pence) : null,
        paymentKind: p.payment_kind ?? "project",
      });
    } catch (e: any) {
      console.error("[stripe/payment-breakdown]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // PRD-015 FR-17: Expired Stripe Account Link — refresh URL handler
  // When Stripe sends user to refresh_url, they GET /#/payouts?stripe=refresh
  // The frontend handles this URL param and auto-calls onboarding-link again.
  // (No server endpoint needed — the frontend re-calls /api/stripe/onboarding-link)

  // FR-13: Full Connect readiness status (richer than before)
  // PRD-009 FR-09: auto-sync on page open — always syncs Stripe on every GET
  // PRD-018 B4: requireAuth + verify caller matches param
  app.get("/api/stripe/status/:userId", requireAuth, async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const userId = Number(req.params.userId);
      if (req.auth!.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const db = neon(process.env.DATABASE_URL!);
      const PAYMENT_TERMS_DOCUMENT = "stripe_connect_disclosure";

      // FR-09: check Viewrr terms acceptance
      const termsRows = await db`
        SELECT ta.accepted_at, ta.version FROM terms_acceptances ta
        JOIN terms_versions tv ON tv.id = ta.terms_version_id
        WHERE ta.user_id = ${userId} AND ta.document = ${PAYMENT_TERMS_DOCUMENT}
        ORDER BY ta.accepted_at DESC LIMIT 1
      `;
      const viewrrTermsAccepted = termsRows.length > 0;
      const viewrrTermsAcceptedAt = termsRows[0]?.accepted_at ?? null;

      if (!user.stripeAccountId) {
        return res.json({
          connected: false,
          readinessState: "not_created",
          chargesEnabled: false,
          payoutsEnabled: false,
          transfersReady: false,
          pendingRequirements: [],
          viewrrTermsAccepted,
          viewrrTermsAcceptedAt,
          identityVerified: false,
        });
      }

      // FR-09: Always sync from Stripe when page opens
      const connectState = await syncConnectAccount(userId, user.stripeAccountId);

      // FR-21: update last sync timestamp
      await db`UPDATE stripe_connect_accounts SET last_stripe_sync = ${new Date().toISOString()} WHERE user_id = ${userId}`.catch(() => {});

      const currentlyDue = JSON.parse(connectState.currentlyDue ?? "[]");
      const pastDue = JSON.parse(connectState.pastDue ?? "[]");
      const pendingVerification = JSON.parse((connectState as any).pendingVerification ?? "[]");

      // FR-06/07: derive actionable readiness state
      let actionableState: string = connectState.readinessState;
      if (pendingVerification.length > 0 && currentlyDue.length === 0 && !connectState.chargesEnabled) {
        actionableState = "stripe_reviewing";
      }

      res.json({
        connected: true,
        stripeAccountId: user.stripeAccountId,
        readinessState: actionableState,
        detailsSubmitted: connectState.detailsSubmitted === 1,
        chargesEnabled: connectState.chargesEnabled === 1,
        payoutsEnabled: connectState.payoutsEnabled === 1,
        transfersReady: connectState.readinessState === "transfers_ready" || connectState.readinessState === "payouts_ready",
        identityVerified: connectState.detailsSubmitted === 1 && connectState.chargesEnabled === 1,
        automaticPayoutsEnabled: connectState.readinessState === "payouts_ready",
        viewrrTermsAccepted,
        viewrrTermsAcceptedAt,
        currentlyDue,
        pastDue,
        pendingVerification,
        disabledReason: connectState.disabledReason,
        payoutSchedule: connectState.payoutSchedule ? JSON.parse(connectState.payoutSchedule) : null,
      });
    } catch (e: any) {
      console.error("[stripe/status]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // FR-01, FR-02, FR-04, FR-07: Server-authoritative payment creation
  // Browser submits ONLY projectId + invoiceId — no amount, no userId authority
  // A0-F2
  app.post("/api/projects/:projectId/payments", requireAuth, async (req, res) => {
    try {
      const { invoiceId } = req.body;
      const projectId = Number(req.params.projectId);
      if (!invoiceId) return res.status(400).json({ error: "invoiceId required" });
      // A0: verify caller is the client on this project
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the project client can initiate payment" });
      }
      const result = await createPayment(projectId, Number(invoiceId), req.auth!.userId);
      res.json(result);
    } catch (e: any) {
      const status = (e as any).status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // Payment status endpoint (FR-03: browser polls this after stripe.confirmPayment)
  // PRD-018 B2: requireAuth + session-derived uid
  app.get("/api/payments/:publicId", requireAuth, async (req, res) => {
    try {
      // Load payment — returning only what the requesting party can see
      const neonClient = neon(process.env.DATABASE_URL!);
      const rows = await neonClient(
        "SELECT * FROM payments WHERE public_id = $1 LIMIT 1",
        [req.params.publicId]
      );
      if (!rows.length) return res.status(404).json({ error: "Payment not found" });
      const p = rows[0];
      // Only client or freelancer on the project can view
      const uid = req.auth!.userId;
      if (uid !== p.client_id && uid !== p.freelancer_id) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json({
        publicId: p.public_id,
        status: p.status,
        grossPence: p.gross_pence,
        currency: p.currency,
        succeededAt: p.succeeded_at,
        failedAt: p.failed_at,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Legacy endpoint kept for backward compat with old frontend — delegates to new service
  // A0-F1
  app.post("/api/stripe/create-payment-intent", requireAuth, async (req, res) => {
    try {
      const { projectId, amountPence: _ignore } = req.body;
      if (!projectId)
        return res.status(400).json({ error: "projectId required" });

      // A0: verify caller is the client on this project
      const pw = await storage.getProject(Number(projectId));
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the project client can initiate payment" });
      }

      // Find or create the invoice for this project
      const inv = await storage.getInvoiceByProject(Number(projectId));
      if (!inv) return res.status(400).json({ error: "No invoice found for this project. Please create an invoice first." });

      const result = await createPayment(Number(projectId), inv.id, req.auth!.userId);
      res.json({
        clientSecret: result.clientSecret,
        paymentIntentId: result.publicId,
        amountPence: result.amountPence,
        publishableKey: result.publishableKey,
      });
    } catch (e: any) {
      const status = (e as any).status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // FR-03: Browser notification only — fulfilment is handled by webhook
  // This endpoint records that the client-side confirmed, but does NOT mark project paid
  // PRD-018 A27: requireAuth
  app.post("/api/stripe/confirm-intent", requireAuth, async (req, res) => {
    try {
      const { paymentIntentId, projectId } = req.body;
      if (!paymentIntentId || !projectId) return res.status(400).json({ error: "paymentIntentId and projectId required" });

      // Just verify the intent status with Stripe and return — webhook handles fulfilment
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId as string);

      if (intent.status !== "succeeded") {
        return res.status(200).json({ ok: false, status: intent.status, message: "Payment still processing — project will update automatically" });
      }

      // Payment succeeded client-side — return status. Webhook will fulfil.
      res.json({ ok: true, status: "processing", message: "Payment confirmed. Project will update within moments." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-007: Hardened Stripe Webhook ─────────────────────────────────────────
  // MUST be before any JSON body parser — raw body required for signature verification
  app.post("/api/stripe/webhook",
    async (req, res) => {
      // rawBody is populated by the global express.json verify callback in index.ts
      const correlationId = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
        const sig = req.headers["stripe-signature"] as string;
        if (!sig || !STRIPE_WEBHOOK_SECRET) {
          return res.status(400).json({ error: "Missing signature or webhook secret" });
        }

        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent((req as any).rawBody, sig, STRIPE_WEBHOOK_SECRET);
        } catch (err: any) {
          console.error("[webhook] Signature failed:", err.message);
          return res.status(400).json({ error: "Invalid signature" });
        }

        // FR-09: Idempotent event store — claim before processing
        const shouldProcess = await claimStripeEvent(
          event.id,
          event.type,
          event.livemode,
          event.api_version ?? ""
        );
        if (!shouldProcess) {
          return res.json({ received: true, duplicate: true });
        }

        // Acknowledge receipt to Stripe immediately — must be within 30s.
        // All processing runs in setImmediate so the response is never blocked.
        res.json({ received: true });

        setImmediate(async () => {
        try {
          // FR-04: Delegate to canonical processor (WS-A extraction)
          await processStripeEvent(event, correlationId);
          await markEventProcessed(event.id);
          console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event: "stripe_event_processed", requestId: correlationId, stripeEventId: event.id, eventType: event.type }));
        } catch (processingError: any) {
          console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "stripe_event_failed", requestId: correlationId, stripeEventId: event.id, eventType: event.type, error: processingError.message.slice(0, 500) }));
          await markEventProcessed(event.id, processingError.message);
        }
        }); // end setImmediate

      } catch (e: any) {
        console.error("[stripe/webhook] Fatal error:", e.message);
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ─── PRD-007: Admin Refund & Reconciliation Routes ────────────────────────────

  // FR-05: Admin-only refund endpoint
  // P0-04: requireAdminGuard — refunds are a high-value irreversible action
  app.post("/api/admin/payments/:paymentPublicId/refunds", requireAdminGuard, async (req, res) => {
    try {
      const { amountPence, reasonCode, internalNote, notifyParties } = req.body;
      const admin = req.auth!.adminUser!;

      const refund = await initiateRefund({
        paymentPublicId: String(req.params.paymentPublicId),
        amountPence: Number(amountPence),
        reasonCode,
        internalNote,
        requestedBy: admin.id,
        notifyParties: notifyParties !== false,
      });

      res.json(refund);
    } catch (e: any) {
      const status = (e as any).status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // FR-07, FR-18: Admin reconciliation
  // P0-04: requireAdminGuard
  app.post("/api/admin/payments/:paymentId/reconcile", requireAdminGuard, async (req, res) => {
    try {
      const admin = req.auth!.adminUser!;

      const result = await reconcilePayment(Number(req.params.paymentId));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin ledger view
  // P0-04: requireAdminGuard
  app.get("/api/admin/payments", requireAdminGuard, async (req, res) => {
    try {
      const admin = req.auth!.adminUser!;

      const sqlClient = neon(process.env.DATABASE_URL!);
      const rows = await sqlClient(
        "SELECT p.*, pt.stripe_transfer_id, pt.status as transfer_status, pt.reversed_pence FROM payments p LEFT JOIN payment_transfers pt ON pt.payment_id = p.id ORDER BY p.created_at DESC LIMIT 100"
      );
      res.json({ payments: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // P0-04: requireAdminGuard
  app.get("/api/admin/payments/:paymentPublicId", requireAdminGuard, async (req, res) => {
    try {
      const admin = req.auth!.adminUser!;

      const sqlClient = neon(process.env.DATABASE_URL!);
      const [payment] = await sqlClient(
        "SELECT * FROM payments WHERE public_id=$1 LIMIT 1",
        [req.params.paymentPublicId]
      );
      if (!payment) return res.status(404).json({ error: "Payment not found" });

      const transfers = await sqlClient("SELECT * FROM payment_transfers WHERE payment_id=$1", [payment.id]);
      const refunds = await sqlClient("SELECT * FROM payment_refunds WHERE payment_id=$1", [payment.id]);
      const audit = await sqlClient("SELECT * FROM payment_audit_log WHERE payment_id=$1 ORDER BY created_at ASC", [payment.id]);

      res.json({ payment, transfers, refunds, audit });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Agency Routes ────────────────────────────────────────────────────────────────

  // POST /api/agencies — create a new agency (owner must be a freelancer with no existing agency)
  // PRD-018 A26: requireAuth + session-derived ownerUserId
  app.post("/api/agencies", requireAuth, async (req, res) => {
    try {
      const { name, bio, specialisms, reelUrl, location, website } = req.body;
      const ownerUserId = req.auth!.userId;
      if (!name) return res.status(400).json({ error: "name is required" });

      const owner = await storage.getUser(ownerUserId);
      if (!owner) return res.status(404).json({ error: "User not found" });
      if (owner.role !== "freelancer") return res.status(403).json({ error: "Only freelancers can create agencies" });

      // Check they don't already own one
      const existing = await storage.getAgencyByOwner(ownerUserId);
      if (existing) return res.status(409).json({ error: "You already have an agency" });

      // Generate slug from name
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 6);
      // Generate unique invite code
      const inviteCode = crypto.randomBytes(12).toString("hex");

      const agency = await storage.createAgency({
        ownerUserId,
        name,
        slug,
        bio: bio ?? "",
        specialisms: specialisms ? JSON.stringify(specialisms) : "[]",
        reelUrl: reelUrl ?? null,
        location: location ?? null,
        website: website ?? null,
        inviteCode,
      });

      // Update owner's accountSubtype and agencyId
      await storage.updateUserAgencyFields(ownerUserId, { accountSubtype: "agency_owner", agencyId: agency.id });

      res.json(agency);
    } catch (e: any) {
      console.error("[POST /api/agencies]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agencies/mine — get the agency owned by the current user
  app.get("/api/agencies/mine/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const agency = await storage.getAgencyByOwner(userId);
      if (!agency) return res.status(404).json({ error: "No agency found" });
      res.json(agency);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agencies/slug/:slug — public profile data
  app.get("/api/agencies/slug/:slug", async (req, res) => {
    try {
      const agency = await storage.getAgencyBySlug(req.params.slug);
      if (!agency) return res.status(404).json({ error: "Agency not found" });
      const members = await storage.getAgencyMembers(agency.id);
      // PRD-018 E5: override stale projectCount on member profiles with DB-authoritative count
      const memberUserIds = members
        .map((m: any) => m.profile?.userId)
        .filter((id: any): id is number => typeof id === "number");
      const countMap = await storage.getCompletedProjectCountsBulk(memberUserIds);
      const membersWithCount = members.map((m: any) => ({
        ...m,
        profile: m.profile
          ? { ...m.profile, projectCount: countMap.get(m.profile.userId) ?? 0 }
          : m.profile,
      }));
      res.json({ agency, members: membersWithCount });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agencies/join/:code — look up agency by invite code (no auth needed)
  app.get("/api/agencies/join/:code", async (req, res) => {
    try {
      const agency = await storage.getAgencyByInviteCode(req.params.code);
      if (!agency) return res.status(404).json({ error: "Invalid invite link" });
      const owner = await storage.getUser(agency.ownerUserId);
      res.json({ agency, ownerName: owner?.name ?? "Unknown" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agencies/:id/join — freelancer joins via invite (creates pending member record)
  // PRD-018 A26: requireAuth + session-derived userId
  app.post("/api/agencies/:id/join", requireAuth, async (req, res) => {
    try {
      const agencyId = parseInt(String(req.params.id));
      const userId = req.auth!.userId;

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.role !== "freelancer") return res.status(403).json({ error: "Only freelancers can join agencies" });

      // Check already a member somewhere
      const existingMembership = await storage.getAgencyMemberByUser(userId);
      if (existingMembership) return res.status(409).json({ error: "You are already part of an agency" });

      const agency = await storage.getAgency(agencyId);
      if (!agency) return res.status(404).json({ error: "Agency not found" });
      if (agency.ownerUserId === userId) return res.status(400).json({ error: "You own this agency" });

      const member = await storage.addAgencyMember({ agencyId, userId, status: "pending" });

      // Notify the owner
      await notify({
        recipientId: agency.ownerUserId,
        actorId: userId,
        actorName: user.name,
        actorAvatar: user.avatar ?? null,
        type: "agency_join_request",
        message: `${user.name} wants to join your agency "${agency.name}".`,
        link: "/dashboard",
        read: 0,
      });

      res.json(member);
    } catch (e: any) {
      console.error("[POST /api/agencies/:id/join]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agencies/members/:memberId/approve — owner approves a pending member
  // A0-AG1
  app.post("/api/agencies/members/:memberId/approve", requireAuth, async (req, res) => {
    try {
      const memberId = parseInt(String(req.params.memberId));
      // A0: load member to find agencyId, then verify caller is the agency owner
      const memberRows = await db.select().from(schema.agencyMembers).where(eq(schema.agencyMembers.id, memberId)).limit(1);
      if (!memberRows.length) return res.status(404).json({ error: "Member not found" });
      const memberRecord = memberRows[0];
      const agency = await storage.getAgency(memberRecord.agencyId);
      if (!agency) return res.status(404).json({ error: "Agency not found" });
      if (req.auth!.userId !== agency.ownerUserId) return res.status(403).json({ error: "Only the agency owner can approve members" });

      // body userId is the member being approved (not the caller)
      const { userId } = req.body;
      await storage.approveAgencyMember(memberId);

      if (userId) {
        const mr = await storage.getAgencyMemberByUser(userId);
        if (mr) {
          await storage.updateUserAgencyFields(userId, { accountSubtype: "agency_member", agencyId: mr.agencyId });
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/agencies/:agencyId/members/:userId — owner removes a member
  // A0-AG2
  app.delete("/api/agencies/:agencyId/members/:userId", requireAuth, async (req, res) => {
    try {
      const agencyId = parseInt(String(req.params.agencyId));
      const userId = parseInt(String(req.params.userId));
      // A0: verify caller is the agency owner
      const agency = await storage.getAgency(agencyId);
      if (!agency) return res.status(404).json({ error: "Agency not found" });
      if (req.auth!.userId !== agency.ownerUserId) return res.status(403).json({ error: "Only the agency owner can remove members" });
      await storage.removeAgencyMember(agencyId, userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agencies/:id/dashboard — owner dashboard data
  app.get("/api/agencies/:id/dashboard", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.id);
      const dashboard = await storage.getAgencyDashboard(agencyId);
      // PRD-018 E5: override stale projectCount on member profiles with DB-authoritative count
      const memberUserIds = (dashboard.members as any[])
        .map((m: any) => m.profile?.userId)
        .filter((id: any): id is number => typeof id === "number");
      const countMap = await storage.getCompletedProjectCountsBulk(memberUserIds);
      const membersWithCount = (dashboard.members as any[]).map((m: any) => ({
        ...m,
        profile: m.profile
          ? { ...m.profile, projectCount: countMap.get(m.profile.userId) ?? 0 }
          : m.profile,
      }));
      res.json({ ...dashboard, members: membersWithCount });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agencies/:id/members — get all members for an agency
  app.get("/api/agencies/:id/members", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.id);
      const members = await storage.getAgencyMembers(agencyId);
      res.json(members);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agencies/membership/:userId — get a freelancer's agency membership
  app.get("/api/agencies/membership/:userId", async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const member = await storage.getAgencyMemberByUser(userId);
      if (!member) return res.json(null);
      const agency = await storage.getAgency(member.agencyId);
      res.json({ member, agency });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/agencies/:agencyId/members/:memberId/rate — owner sets member rate card
  // PRD-018 A26: requireAuth + verify caller is agency owner
  app.patch("/api/agencies/:agencyId/members/:memberId/rate", requireAuth, async (req, res) => {
    try {
      const agencyId = parseInt(String(req.params.agencyId));
      const memberId = parseInt(String(req.params.memberId));
      const agency = await storage.getAgency(agencyId);
      if (!agency) return res.status(404).json({ error: "Agency not found" });
      if (agency.ownerUserId !== req.auth!.userId) return res.status(403).json({ error: "Only the agency owner can update member rates" });
      const { role, dayRatePence, hourlyRatePence } = req.body;
      const updated = await storage.updateAgencyMemberRate(memberId, agencyId, {
        role: role ?? undefined,
        dayRatePence: dayRatePence !== undefined ? (dayRatePence === null ? null : Number(dayRatePence)) : undefined,
        hourlyRatePence: hourlyRatePence !== undefined ? (hourlyRatePence === null ? null : Number(hourlyRatePence)) : undefined,
      });
      if (!updated) return res.status(404).json({ error: "Member not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/agencies/:id — owner updates agency profile (featuredWork, testimonials, bio, etc.)
  // A0-AG3
  app.patch("/api/agencies/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      // A0: verify caller is the agency owner
      const agencyForAuth = await storage.getAgency(id);
      if (!agencyForAuth) return res.status(404).json({ error: "Agency not found" });
      if (req.auth!.userId !== agencyForAuth.ownerUserId) return res.status(403).json({ error: "Only the agency owner can update agency details" });
      const { name, bio, location, website, specialisms, reelUrl, logo, banner, featuredWork, testimonials } = req.body;
      const patch: Record<string, any> = {};
      if (name !== undefined) patch.name = name;
      if (bio !== undefined) patch.bio = bio;
      if (location !== undefined) patch.location = location;
      if (website !== undefined) patch.website = website;
      if (specialisms !== undefined) patch.specialisms = specialisms;
      if (reelUrl !== undefined) patch.reelUrl = reelUrl;
      if (logo !== undefined) patch.logo = logo;
      if (banner !== undefined) patch.banner = banner;
      if (featuredWork !== undefined) patch.featuredWork = featuredWork;
      if (testimonials !== undefined) patch.testimonials = testimonials;
      const updated = await storage.updateAgency(id, patch);
      if (!updated) return res.status(404).json({ error: "Agency not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Agency Brief Pipeline Routes
  // ─────────────────────────────────────────────────────────────

  // GET  /api/agencies/:id/briefs          — agency owner fetches all their briefs
  app.get("/api/agencies/:id/briefs", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.id);
      const briefs = await storage.getAgencyBriefs(agencyId);
      // Enrich each brief with its proposal (if any)
      const enriched = await Promise.all(
        briefs.map(async (b) => {
          const proposal = await storage.getAgencyProposal(b.id);
          return { ...b, proposal: proposal || null };
        })
      );
      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agencies/my-proposals — proposals sent TO the logged-in client
  app.get("/api/agencies/my-proposals", async (req, res) => {
    try {
      const clientId = Number(req.query.clientId);
      if (!clientId) return res.status(400).json({ error: "clientId query param required" });
      // Find all agency_briefs where client_id = clientId that have a proposal
      const briefs = await db
        .select()
        .from(schema.agencyBriefs)
        .where(and(
          eq(schema.agencyBriefs.clientId, clientId),
          inArray(schema.agencyBriefs.status, ['proposal_sent', 'won', 'lost'])
        ));
      const result = await Promise.all(briefs.map(async (brief) => {
        const proposal = await db
          .select()
          .from(schema.agencyProposals)
          .where(eq(schema.agencyProposals.agencyBriefId, brief.id))
          .then(r => r[0] || null);
        const agency = brief.agencyId ? await storage.getAgency(brief.agencyId) : null;
        return { ...brief, proposal, agency };
      }));
      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: 'Failed to fetch proposals' });
    }
  });

  // POST /api/agencies/:id/briefs          — client submits a brief to this agency
  // PRD-018 A26: requireAuth + session-derived clientId
  app.post("/api/agencies/:id/briefs", requireAuth, async (req, res) => {
    try {
      const agencyId = parseInt(String(req.params.id));
      const clientId = req.auth!.userId;
      const { clientName, clientAvatar, title, description, category, budgetMin, budgetMax, startDate, duration, requirements } = req.body;
      if (!title || !description) return res.status(400).json({ error: "title and description are required" });
      const brief = await storage.createAgencyBrief({
        agencyId,
        clientId,
        clientName: clientName || "Client",
        clientAvatar: clientAvatar || null,
        title,
        description,
        category: category || "",
        budgetMin: budgetMin ? parseInt(budgetMin) : null,
        budgetMax: budgetMax ? parseInt(budgetMax) : null,
        startDate: startDate || null,
        duration: duration || null,
        requirements: requirements || "",
        status: "incoming",
      });
      // Log activity
      await storage.createAgencyActivity({
        agencyId,
        type: "brief_received",
        title: `New brief received: ${title}`,
        body: `From ${clientName || "a client"}.`,
        entityType: "brief",
        entityId: brief.id,
        actorId: clientId,
        actorName: clientName || null,
      });
      res.status(201).json(brief);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/agencies/briefs/:briefId/status  — update brief status
  // PRD-018 A26: requireAuth
  app.patch("/api/agencies/briefs/:briefId/status", requireAuth, async (req, res) => {
    try {
      const briefId = parseInt(String(req.params.briefId));
      const { status } = req.body;
      const valid = ["incoming", "viewed", "proposal_sent", "won", "lost", "declined"];
      if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });
      const brief = await storage.updateAgencyBriefStatus(briefId, status);
      if (!brief) return res.status(404).json({ error: "Brief not found" });
      res.json(brief);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Agency Proposal Routes
  // ─────────────────────────────────────────────────────────────

  // POST /api/agencies/briefs/:briefId/proposal  — agency sends a proposal
  // PRD-018 A26: requireAuth
  app.post("/api/agencies/briefs/:briefId/proposal", requireAuth, async (req, res) => {
    try {
      const briefId = parseInt(String(req.params.briefId));
      const brief = await storage.getAgencyBrief(briefId);
      if (!brief) return res.status(404).json({ error: "Brief not found" });
      const existing = await storage.getAgencyProposal(briefId);
      if (existing) return res.status(409).json({ error: "Proposal already exists for this brief" });
      const { quotedAmountPence, coverNote, timeline, teamMemberIds, breakdown } = req.body;
      if (!quotedAmountPence) return res.status(400).json({ error: "quotedAmountPence is required" });
      const proposal = await storage.createAgencyProposal({
        agencyBriefId: briefId,
        agencyId: brief.agencyId,
        quotedAmountPence: parseInt(quotedAmountPence),
        coverNote: coverNote || "",
        timeline: timeline || "",
        teamMemberIds: teamMemberIds ? JSON.stringify(teamMemberIds) : "[]",
        breakdown: breakdown || "",
        status: "sent",
        sentAt: new Date().toISOString(),
        respondedAt: null,
      });
      // Mark brief as proposal_sent
      await storage.updateAgencyBriefStatus(briefId, "proposal_sent");
      // Log activity
      await storage.createAgencyActivity({
        agencyId: brief.agencyId,
        type: "proposal_sent",
        title: `Proposal sent: ${brief.title}`,
        body: `Quoted £${(parseInt(quotedAmountPence) / 100).toFixed(2)} to ${brief.clientName}.`,
        entityType: "proposal",
        entityId: proposal.id,
        actorId: null,
        actorName: null,
      });
      // Notify the client
      try {
        const briefForNotif = await storage.getAgencyBrief(briefId);
        if (briefForNotif) {
          const agencyForNotif = await storage.getAgency(briefForNotif.agencyId);
          await storage.createNotification({
            recipientId: briefForNotif.clientId,
            actorId: briefForNotif.agencyId,
            actorName: agencyForNotif?.name || 'Agency',
            actorAvatar: null,
            type: 'agency_proposal',
            message: `You have received a proposal for your brief: ${briefForNotif.title}`,
            link: '/dashboard',
            read: 0,
          });
        }
      } catch (e) { /* best effort */ }
      res.status(201).json(proposal);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/agencies/proposals/:proposalId/status  — client responds (accept/decline)
  // PRD-018 A26: requireAuth
  app.patch("/api/agencies/proposals/:proposalId/status", requireAuth, async (req, res) => {
    try {
      const proposalId = parseInt(String(req.params.proposalId));
      const { status, agencyId, briefTitle, clientName } = req.body;
      const valid = ["accepted", "declined"];
      if (!valid.includes(status)) return res.status(400).json({ error: "Status must be accepted or declined" });
      const proposal = await storage.updateAgencyProposalStatus(proposalId, status);
      if (!proposal) return res.status(404).json({ error: "Proposal not found" });
      // Update the brief status accordingly
      await storage.updateAgencyBriefStatus(proposal.agencyBriefId, status === "accepted" ? "won" : "lost");
      // Log activity
      if (agencyId) {
        await storage.createAgencyActivity({
          agencyId: parseInt(agencyId),
          type: status === "accepted" ? "proposal_accepted" : "proposal_declined",
          title: status === "accepted" ? `Proposal accepted! 🎉` : `Proposal declined`,
          body: status === "accepted"
            ? `${clientName || "Client"} accepted your proposal for “${briefTitle || "project"}”.`
            : `${clientName || "Client"} declined your proposal for “${briefTitle || "project"}”.`,
          entityType: "proposal",
          entityId: proposalId,
          actorId: null,
          actorName: clientName || null,
        });
      }
      // Auto-create a project when agency proposal is accepted
      try {
        const agencyBriefForProject = await storage.getAgencyBrief(proposal.agencyBriefId);
        if (agencyBriefForProject && status === 'accepted') {
          const agencyForProject = await storage.getAgency(proposal.agencyId);
          const freelancerPlaceholderId = agencyForProject?.ownerUserId ?? agencyBriefForProject.clientId;
          await storage.createProject({
            clientId: agencyBriefForProject.clientId,
            freelancerId: freelancerPlaceholderId,
            title: agencyBriefForProject.title,
            description: agencyBriefForProject.description || '',
            status: 'active',
            currentStage: 0,
            briefId: null,
            interestId: null,
            freelancerName: agencyForProject?.name || 'Agency',
            clientName: agencyBriefForProject.clientName,
            briefCategory: agencyBriefForProject.category || '',
            agencyId: proposal.agencyId,
            agencyBriefId: proposal.agencyBriefId,
            agreedAmountPence: proposal.quotedAmountPence,
            planningStatus: "planning_required",
          } as any);
        }
      } catch (e) { console.error('proposal project creation error', e); }
      res.json(proposal);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Agency Activity Feed Route
  // ─────────────────────────────────────────────────────────────

  app.get("/api/agencies/:id/activity", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.id);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const feed = await storage.getAgencyActivity(agencyId, limit);
      res.json(feed);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Invoice Template ─────────────────────────────────────────────────────────────────

  // GET /api/invoice-template — get the logged-in freelancer's template
  // PRD-018 B6: requireAuth + session-derived userId
  app.get('/api/invoice-template', requireAuth, async (req, res) => {
    const userId = req.auth!.userId;
    const template = await storage.getInvoiceTemplate(userId);
    res.json(template || null);
  });

  // POST /api/invoice-template — create or update template
  // PRD-018 B7: requireAuth + session-derived userId
  app.post('/api/invoice-template', requireAuth, async (req, res) => {
    try {
      const { userId: _ignored, ...rest } = req.body;
      const template = await storage.upsertInvoiceTemplate(req.auth!.userId, rest);
      res.json(template);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Invoices ──────────────────────────────────────────────────────────────────

  // GET /api/projects/:id/invoice — get the invoice for a project
  // PRD-018 B8: requireAuth + verify caller is client or freelancer
  app.get('/api/projects/:id/invoice', requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: 'Project not found' });
      if (pw.project.clientId !== req.auth!.userId && pw.project.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: 'Not authorised' });
      }
      const invoice = await storage.getInvoiceByProject(projectId);
      if (!invoice) return res.status(404).json({ error: 'No invoice found' });
      // Also attach the freelancer's template for rendering
      const template = await storage.getInvoiceTemplate(invoice.freelancerId);
      res.json({ invoice, template: template || null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/projects/:id/invoice — freelancer sends invoice
  // PRD-018 B9: requireAuth + session-derived freelancerId
  app.post('/api/projects/:id/invoice', requireAuth, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const freelancerId = req.auth!.userId;
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: 'Project not found' });
      if (pw.project.freelancerId !== freelancerId) {
        return res.status(403).json({ error: 'Only the freelancer can send an invoice' });
      }
      const { clientName, clientEmail, projectTitle, lineItems, notes, vatPercent } = req.body;
      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ error: 'lineItems required' });
      }
      const resolvedClientId = pw.project.clientId;

      // FR-03 (PRD-010): Stripe readiness gate — must be connected, verified, transfers + payouts enabled
      if (stripe) {
        const freelancerUser = await storage.getUser(freelancerId);
        if (!freelancerUser?.stripeAccountId) {
          return res.status(402).json({
            error: "stripe_not_connected",
            message: "You must connect your Stripe account before issuing an invoice.",
          });
        }
        try {
          const acct = await stripe.accounts.retrieve(freelancerUser.stripeAccountId);
          const transfersOk = (acct.capabilities as any)?.transfers === "active";
          const payoutsOk = acct.payouts_enabled === true;
          const chargesOk = acct.charges_enabled === true;
          if (!chargesOk || !transfersOk || !payoutsOk) {
            return res.status(402).json({
              error: "stripe_not_ready",
              message: "Your Stripe account must have charges, transfers and payouts enabled before you can issue an invoice.",
              details: { chargesOk, transfersOk, payoutsOk },
            });
          }
        } catch (e: any) {
          console.warn("[invoice gate] Could not verify Stripe readiness:", e.message);
          // Non-fatal — allow invoice creation if Stripe is unreachable
        }
      }
      // Calculate totals
      const subtotalPence = lineItems.reduce((sum: number, item: any) => sum + (item.totalPence || 0), 0);
      const vatPence = vatPercent ? Math.round(subtotalPence * vatPercent / 100) : 0;
      const totalPence = subtotalPence + vatPence;
      // Get next invoice number
      const invoiceNumber = await storage.getNextInvoiceNumber(freelancerId);
      const invoice = await storage.createInvoice({
        invoiceNumber,
        projectId,
        freelancerId,
        clientId: resolvedClientId,
        clientName: clientName || '',
        clientEmail: clientEmail || '',
        projectTitle: projectTitle || pw.project.title || '',
        lineItems: JSON.stringify(lineItems),
        subtotalPence,
        vatPence,
        totalPence,
        notes: notes || '',
        status: 'sent',
        issuedAt: new Date().toISOString(),
      });
      // Notify client that invoice has been sent
      try {
        const freelancerUser = await storage.getUser(freelancerId);
        await notify({
          recipientId: resolvedClientId,
          actorId: freelancerId,
          actorName: freelancerUser?.name ?? "Freelancer",
          actorAvatar: freelancerUser?.avatar ?? null,
          type: "invoice_sent",
          message: `Your invoice for "${projectTitle || pw.project.title || 'your project'}" is ready to view`,
          link: `/invoice/${projectId}`,
          read: 0,
          targetType: "project",
          targetId: projectId,
        });
      } catch {}
      res.json(invoice);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/invoices/:id/paid — mark invoice paid (only client on the project)
  // PRD-018 B10: requireAuth + verify caller is client on project
  app.patch('/api/invoices/:id/paid', requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoiceById(Number(req.params.id));
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      if (invoice.clientId !== req.auth!.userId) return res.status(403).json({ error: 'Only the client can mark an invoice paid' });
      await storage.markInvoicePaid(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Founder Dashboard API ────────────────────────────────────────────────────
  // P0-04: requireAdminGuard
  app.get('/api/admin/dashboard', requireAdminGuard, async (req, res) => {
    try {
      const data = await getDashboardData();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // P0-04: requireAdminGuard; P0-02: map safeUserDto
  app.get('/api/admin/users', requireAdminGuard, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map(safeUserDto));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PRD-017: Founder User Directories ─────────────────────────────────────
  // GET /api/admin/users/creatives — paginated creative directory with search + filters
  // Security: requireAdminGuard — only admin/founder can access. safeUserDto strips sensitive fields.
  app.get('/api/admin/users/creatives', requireAdminGuard, async (req, res) => {
    try {
      const { search = '', status, accreditation, pro, limit = '100', offset = '0' } = req.query as Record<string, string>;
      const allUsers = await storage.getAllUsers(); // already stripped via safeUser in storage
      const allProfiles = await db.select().from(schema.profiles);
      const profileByUser = new Map(allProfiles.map(p => [p.userId, p]));

      // PRD-018 E5: Count COMPLETED projects per freelancer (DB-authoritative)
      const allProjects = await db.select({ id: schema.projects.id, freelancerId: schema.projects.freelancerId, status: schema.projects.status }).from(schema.projects);
      const projectCountMap = new Map<number, number>();
      for (const proj of allProjects) {
        if (proj.freelancerId && proj.status === "completed") {
          projectCountMap.set(proj.freelancerId, (projectCountMap.get(proj.freelancerId) ?? 0) + 1);
        }
      }

      let creatives = allUsers.filter((u: any) => u.role === 'freelancer');

      // Search: name or email
      if (search.trim()) {
        const q = search.toLowerCase();
        creatives = creatives.filter((u: any) =>
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q)
        );
      }

      // Filter: accreditation level
      if (accreditation && accreditation !== 'all') {
        creatives = creatives.filter((u: any) => {
          const profile = profileByUser.get(u.id);
          if (accreditation === 'none') return !profile?.accreditationLevel;
          return profile?.accreditationLevel === accreditation;
        });
      }

      // Filter: pro status
      if (pro && pro !== 'all') {
        creatives = creatives.filter((u: any) => {
          const profile = profileByUser.get(u.id);
          return pro === 'pro' ? !!profile?.isPro : !profile?.isPro;
        });
      }

      const total = creatives.length;
      const paginated = creatives.slice(Number(offset), Number(offset) + Number(limit));

      const result = paginated.map((u: any) => {
        const profile = profileByUser.get(u.id);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          avatar: u.avatar ?? null,
          createdAt: u.createdAt,
          isAdmin: u.isAdmin,
          accreditationLevel: profile?.accreditationLevel ?? null,
          isPro: !!(profile?.isPro),
          projectCount: projectCountMap.get(u.id) ?? (profile?.projectCount ?? 0),
          specialisms: profile?.specialisms ?? '[]',
        };
      });

      res.json({ total, offset: Number(offset), limit: Number(limit), users: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/users/clients — paginated client directory with search + filters
  // Security: requireAdminGuard — only admin/founder can access.
  app.get('/api/admin/users/clients', requireAdminGuard, async (req, res) => {
    try {
      const { search = '', hasProjects, limit = '100', offset = '0' } = req.query as Record<string, string>;
      const allUsers = await storage.getAllUsers();

      const allProjects = await db.select({
        id: schema.projects.id,
        clientId: schema.projects.clientId,
        status: schema.projects.status,
      }).from(schema.projects);
      const projectsByClient = new Map<number, typeof allProjects>();
      for (const proj of allProjects) {
        if (!projectsByClient.has(proj.clientId)) projectsByClient.set(proj.clientId, []);
        projectsByClient.get(proj.clientId)!.push(proj);
      }

      let clients = allUsers.filter((u: any) => u.role === 'client');

      // Search: name or email
      if (search.trim()) {
        const q = search.toLowerCase();
        clients = clients.filter((u: any) =>
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q) ||
          (u.company ?? '').toLowerCase().includes(q)
        );
      }

      // Filter: has at least one project
      if (hasProjects === 'true') {
        clients = clients.filter((u: any) => (projectsByClient.get(u.id)?.length ?? 0) > 0);
      } else if (hasProjects === 'false') {
        clients = clients.filter((u: any) => (projectsByClient.get(u.id)?.length ?? 0) === 0);
      }

      const total = clients.length;
      const paginated = clients.slice(Number(offset), Number(offset) + Number(limit));

      const result = paginated.map((u: any) => {
        const projects = projectsByClient.get(u.id) ?? [];
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          company: u.company ?? null,
          avatar: u.avatar ?? null,
          createdAt: u.createdAt,
          totalProjects: projects.length,
          activeProjects: projects.filter(p => p.status === 'active' || p.status === 'in_progress').length,
          completedProjects: projects.filter(p => p.status === 'completed').length,
        };
      });

      res.json({ total, offset: Number(offset), limit: Number(limit), users: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/admin/users/:userId — founder inspection of a single user (creative or client)
  // Security: requireAdminGuard. Never returns passwordHash, session tokens or Stripe secrets.
  app.get('/api/admin/users/:userId', requireAdminGuard, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const safe = safeUserDto(user);

      const projects = await db.select({
        id: schema.projects.id,
        title: schema.projects.title,
        status: schema.projects.status,
        createdAt: schema.projects.createdAt,
      }).from(schema.projects).where(
        user.role === 'freelancer'
          ? eq(schema.projects.freelancerId, userId)
          : eq(schema.projects.clientId, userId)
      );

      const profile = user.role === 'freelancer'
        ? await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1).then(r => r[0] ?? null)
        : null;

      res.json({
        user: safe,
        profile: profile ? {
          accreditationLevel: profile.accreditationLevel,
          isPro: !!(profile.isPro),
          projectCount: profile.projectCount,
          specialisms: profile.specialisms,
          availability: profile.availability,
          yearsExperience: profile.yearsExperience,
        } : null,
        projects,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // P0-04: requireAdminGuard
  app.get('/api/admin/projects', requireAdminGuard, async (req, res) => {
    const requester = req.auth!.adminUser!;
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Accreditation API ────────────────────────────────────────────────────────

  /** GET /api/admin/accreditation — all freelancer profiles with accreditation data */
  // P0-04: requireAdminGuard
  app.get('/api/admin/accreditation', requireAdminGuard, async (req, res) => {
    const requester = req.auth!.adminUser!;
    try {
      const profiles = await storage.getFreelancerProfilesWithAccreditation();
      // PRD-018 E5: add DB-authoritative completedProjectCount to each profile
      const userIds = profiles.map((p: any) => p.userId as number);
      const countMap = await storage.getCompletedProjectCountsBulk(userIds);
      const result = profiles.map((p: any) => ({
        ...p,
        completedProjectCount: countMap.get(p.userId) ?? 0,
      }));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/admin/accreditation/history — recent audit log */
  // P0-04: requireAdminGuard
  app.get('/api/admin/accreditation/history', requireAdminGuard, async (req, res) => {
    const requester = req.auth!.adminUser!;
    try {
      const history = await storage.getAllAccreditationHistory(100);
      res.json(history);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/admin/accreditation/history/:freelancerUserId — history for one freelancer */
  // P0-04: requireAdminGuard
  app.get('/api/admin/accreditation/history/:freelancerUserId', requireAdminGuard, async (req, res) => {
    const requester = req.auth!.adminUser!;
    try {
      const history = await storage.getAccreditationHistory(Number(req.params.freelancerUserId));
      res.json(history);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/admin/accreditation/update
   * Body: { userId (requester), freelancerUserId, profileId, newLevel (or null), action, reason, internalNotes }
   * action: "granted" | "promoted" | "demoted" | "removed" | "rejected" | "changes_requested"
   * Only Founder (isAdmin) may call this — never purchasable.
   */
  // P0-04: requireAdminGuard — accreditation changes require authenticated Founder/admin
  app.post('/api/admin/accreditation/update', requireAdminGuard, async (req, res) => {
    const { freelancerUserId, profileId, newLevel, action, reason, internalNotes } = req.body;
    const requester = req.auth!.adminUser!;

    // Validate level if provided
    const VALID_LEVELS = ['verified', 'approved', 'elite', null];
    if (newLevel !== null && newLevel !== undefined && !VALID_LEVELS.includes(newLevel)) {
      return res.status(400).json({ error: `Invalid accreditation level: ${newLevel}` });
    }

    const VALID_ACTIONS = ['granted', 'promoted', 'demoted', 'removed', 'rejected', 'changes_requested'];
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Invalid action: ${action}` });
    }

    try {
      // Get current profile state
      const profile = await storage.getProfileByUserId(Number(freelancerUserId));
      if (!profile) return res.status(404).json({ error: 'Freelancer profile not found' });

      const previousLevel = profile.accreditationLevel ?? null;
      const now = new Date().toISOString();

      // Update profile accreditation
      const updated = await storage.updateAccreditation(Number(profileId), {
        accreditationLevel: newLevel ?? null,
        accreditationApprovedBy: newLevel ? requester.id : null,
        accreditationApprovedByName: newLevel ? requester.name : null,
        accreditationApprovedDate: newLevel ? now : null,
        accreditationNotes: internalNotes ?? profile.accreditationNotes ?? null,
        accreditationLastReviewed: now,
      });

      // Write audit log
      await storage.createAccreditationHistory({
        freelancerUserId: Number(freelancerUserId),
        actionDate: now,
        founderUserId: requester.id,
        founderName: requester.name,
        previousLevel,
        newLevel: newLevel ?? null,
        action,
        reason: reason ?? '',
        internalNotes: internalNotes ?? '',
      });

      // Notify freelancer (if accreditation granted/promoted)
      if (['granted', 'promoted'].includes(action) && newLevel) {
        const freelancerUser = await storage.getUserById(Number(freelancerUserId));
        if (freelancerUser) {
          const levelLabels: Record<string, string> = {
            verified: 'Verified',
            approved: 'Viewrr Approved',
            elite: 'Viewrr Elite',
          };
          const levelDescriptions: Record<string, string> = {
            verified: 'Your identity has been confirmed and your professional profile is now verified.',
            approved: 'Your portfolio has been personally reviewed and professionally approved by the Viewrr team. This means Viewrr would confidently recommend you to clients.',
            elite: 'You have been recognised by Viewrr for consistently delivering exceptional work and earning outstanding client trust.',
          };
          const label = levelLabels[newLevel] ?? newLevel;
          const description = levelDescriptions[newLevel] ?? '';
          await storage.createNotification({
            recipientId: freelancerUser.id,
            actorId: requester.id,
            actorName: 'Viewrr',
            actorAvatar: null,
            type: 'accreditation',
            message: `Congratulations — you have been awarded ${label}. ${description}`,
            link: '/dashboard',
            read: 0,
          });
        }
      }

      res.json({ success: true, profile: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PATCH /api/admin/accreditation/notes
   * Body: { userId (requester), profileId, internalNotes }
   * Updates internal notes only — not visible to freelancer.
   */
  // P0-04: requireAdminGuard
  app.patch('/api/admin/accreditation/notes', requireAdminGuard, async (req, res) => {
    const { profileId, internalNotes } = req.body;
    const requester = req.auth!.adminUser!;
    try {
      await storage.updateAccreditationNotes(Number(profileId), internalNotes ?? '');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-006: Notification Preferences (inlined inside registerRoutes) ────
  // A0-NT4
  app.get("/api/notifications/preferences/:userId", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    try {
      const prefs = await (storage as any).getNotifPrefs(req.auth!.userId);
      if (!prefs) {
        return res.json({
          emailProjectInvitations: true, emailNewOffers: true,
          emailCounterOffers: true, emailMessages: true,
          emailStageUpdates: true, emailPaymentUpdates: true,
          emailReviewRequests: true, emailProductUpdates: false,
        });
      }
      res.json(prefs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // A0-NT5
  app.patch("/api/notifications/preferences/:userId", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    try {
      // PRD 1 security fix: MASS ASSIGNMENT.
      // req.body used to be spread straight into a Drizzle .set()/.values() in
      // storage.upsertNotifPrefs, so a caller could write ANY column on
      // notification_preferences — including `id` and `user_id`, which let them
      // re-point their preferences row at another user's id. The whitelist now
      // lives in storage.sanitiseNotifPrefs and is applied here as well so the
      // guarantee is visible at the route.
      const prefs = await (storage as any).upsertNotifPrefs(
        req.auth!.userId,
        sanitiseNotifPrefs(req.body),
      );
      res.json(prefs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ═══ PRD 1 wave 4 — native push (Decision 15, contract §D) ═════════════════
  //
  // Four endpoints, matched EXACTLY to the shipped mobile client in
  // `mobile/src/api/push.ts` (which is frozen and was not modified):
  //
  //   POST   /api/me/push-tokens        { token, platform, deviceId?, appVersion? }
  //   DELETE /api/me/push-tokens        { token }   ← body, not path
  //   GET    /api/me/push-preferences   → the five push keys
  //   PATCH  /api/me/push-preferences   → the five push keys
  //
  // The identity always comes from `req.auth.userId`. There is no `:userId`
  // path parameter anywhere in this block, so there is no ownership check to
  // get wrong — unlike the email-preference routes above, which need an
  // explicit 403 because they are addressed by id.
  //
  // THESE ARE NOT THE EMAIL PREFERENCES. `notification_preferences` (eight
  // `email*` keys) gates email; `push_preferences` (five `push*` keys) gates
  // device push. This block never touches the email model, and a user who
  // turned off marketing email has not turned off a message push.
  //
  // Degraded mode: `push_tokens` / `push_preferences` are created by migration
  // 0006, which has not been applied. Every handler below returns a valid
  // response when the tables are absent (push-service reports `degraded`) —
  // none of them 500s the caller, because M5's provider surfaces a failure here
  // as a permanent "push could not be set up" error the user cannot act on.

  app.post("/api/me/push-tokens", requireAuth, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const token = String(body.token ?? "").trim();
      const platform = String(body.platform ?? "").trim().toLowerCase();

      if (!token) return res.status(400).json({ error: "token is required." });
      if (token.length > 512) return res.status(400).json({ error: "token is not a push token." });
      if (platform !== "ios" && platform !== "android") {
        return res.status(400).json({ error: 'platform must be "ios" or "android".' });
      }

      const { record, degraded, prunedForeign } = await registerPushTokenRow(req.auth!.userId, {
        token,
        platform,
        deviceId: body.deviceId == null ? null : String(body.deviceId),
        appVersion: body.appVersion == null ? null : String(body.appVersion),
      });

      // `registered` is the field the mobile client reads. The record is
      // returned alongside it so the caller can confirm what was stored
      // (platform/device/app version), which is what the brief asks for; the
      // client ignores the extra fields.
      res.json({
        registered: true,
        token: record.token,
        platform: record.platform,
        deviceId: record.deviceId,
        appVersion: record.appVersion,
        // Visible so a device reassignment is observable rather than silent.
        prunedOtherAccounts: prunedForeign,
        ...(degraded ? { persisted: false } : {}),
      });
    } catch (e: any) {
      if (String(e?.message) === "INVALID_PUSH_TOKEN_INPUT") {
        return res.status(400).json({ error: "Invalid push token payload." });
      }
      console.warn("[push] register failed:", e?.message);
      // Still not a 500: a failed registration must not look like an outage to
      // the client, and the token can be re-registered on the next foreground.
      res.status(503).json({ registered: false, error: "Push registration is unavailable." });
    }
  });

  // DELETE with a body on purpose (contract §D): an Expo token
  // ("ExponentPushToken[…]") is not safe as a path segment. Scoped to
  // `req.auth.userId`, so a caller can only delete its OWN rows — possession of
  // a token string is never authority over someone else's device.
  app.delete("/api/me/push-tokens", requireAuth, async (req, res) => {
    try {
      const token = String(((req.body ?? {}) as any).token ?? "").trim();
      if (!token) return res.status(400).json({ error: "token is required in the body." });

      const { deleted } = await deletePushTokenForUser(req.auth!.userId, token);
      // Idempotent: deleting an already-absent token is `ok`, not 404. A 404
      // here would also confirm whether a token exists, which is not the
      // caller's business.
      res.json({ ok: true, deleted });
    } catch (e: any) {
      console.warn("[push] deregister failed:", e?.message);
      res.status(503).json({ ok: false, error: "Push deregistration is unavailable." });
    }
  });

  // Creates the defaults row on first read (four on, `pushSocial` off).
  app.get("/api/me/push-preferences", requireAuth, async (req, res) => {
    try {
      const { prefs } = await getOrCreatePushPreferences(req.auth!.userId);
      res.set("Cache-Control", "private, no-store");
      res.json(prefs);
    } catch (e: any) {
      console.warn("[push] preference read failed:", e?.message);
      res.status(500).json({ error: "Unable to load push preferences." });
    }
  });

  app.patch("/api/me/push-preferences", requireAuth, async (req, res) => {
    try {
      // MASS ASSIGNMENT: explicit five-key whitelist, the same hole B2 closed on
      // the email endpoint above. `sanitisePushPrefs` accepts ONLY the five
      // `push*` booleans — never `id`, never `userId` (which would let a caller
      // re-point their row at another user), and never an email key.
      const clean = sanitisePushPrefs(req.body);
      const unknownKeys = Object.keys((req.body ?? {}) as Record<string, unknown>).filter(
        (k) => !(PUSH_PREFERENCE_KEYS as readonly string[]).includes(k),
      );
      if (unknownKeys.length) {
        // Rejected loudly rather than ignored: a client sending `emailMessages`
        // here has confused the two models, and silently returning 200 would
        // hide that.
        return res.status(400).json({
          error: "Unknown push preference key(s).",
          unknownKeys,
          allowed: PUSH_PREFERENCE_KEYS,
        });
      }

      const { prefs } = await updatePushPreferences(req.auth!.userId, clean);
      res.set("Cache-Control", "private, no-store");
      res.json(prefs);
    } catch (e: any) {
      console.warn("[push] preference write failed:", e?.message);
      res.status(500).json({ error: "Unable to save push preferences." });
    }
  });

  // ─── PRD-008: Server-authoritative retainer payment ───────────────────────
  // POST /api/retainer-cycles/:cyclePublicId/payments
  // Body: { clientUserId } — NO amountPence allowed from client
  // A0-F3
  app.post("/api/retainer-cycles/:cyclePublicId/payments", requireAuth, async (req, res) => {
    try {
      const cyclePublicId = String(req.params.cyclePublicId);
      // A0: verify caller is the client on the project linked to this cycle
      const dbConn = neon(process.env.DATABASE_URL!);
      const cycleRows = await dbConn`SELECT project_id FROM retainer_cycles WHERE public_id = ${cyclePublicId} LIMIT 1`;
      if (!cycleRows.length) return res.status(404).json({ error: "Retainer cycle not found" });
      const cycleProject = await storage.getProject(Number(cycleRows[0].project_id));
      if (!cycleProject || cycleProject.project.clientId !== req.auth!.userId) {
        return res.status(403).json({ error: "Only the project client can pay a retainer cycle" });
      }
      const result = await createRetainerPayment(cyclePublicId, req.auth!.userId);
      res.json(result);
    } catch (e: any) {
      const status = (e as any).status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // GET /api/retainer-cycles/:cyclePublicId/payment — get current payment status
  app.get("/api/retainer-cycles/:cyclePublicId/payment", async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const { cyclePublicId } = req.params;
      const cycles = await db`SELECT * FROM retainer_cycles WHERE public_id = ${cyclePublicId} LIMIT 1`;
      if (!cycles.length) return res.status(404).json({ error: "Cycle not found" });
      const cycle = cycles[0];
      if (!cycle.payment_id) return res.json({ status: "not_started" });
      const payments = await db`SELECT * FROM payments WHERE id = ${cycle.payment_id} LIMIT 1`;
      res.json(payments[0] ?? { status: "not_found" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-008: Payment money timeline ─────────────────────────────────────
  // FR-05 (PRD-010): GET /api/founder/finance/payments/:id/timeline — full Stripe ID timeline
  app.get("/api/founder/finance/payments/:paymentPublicId/timeline", requireFinancePermission("finance.payment.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const { paymentPublicId } = req.params;

      const paymentRows = await db`SELECT * FROM payments WHERE public_id = ${paymentPublicId} LIMIT 1`;
      if (!paymentRows.length) return res.status(404).json({ error: "Payment not found" });
      const payment = paymentRows[0];

      const events = await db`
        SELECT * FROM payment_timeline_events WHERE payment_id = ${payment.id} ORDER BY occurred_at ASC
      `;
      const transfers = await db`
        SELECT * FROM payment_transfers WHERE payment_id = ${payment.id} ORDER BY created_at ASC
      `;
      const auditLogs = await db`
        SELECT action, actor_type, after_state, created_at FROM payment_audit_log
        WHERE payment_id = ${payment.id} ORDER BY created_at ASC
      `;

      res.json({ paymentPublicId, payment, events, transfers, auditLogs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/payments/:paymentPublicId/timeline
  // PRD-018 B3: requireAuth + session-derived uid
  app.get("/api/payments/:paymentPublicId/timeline", requireAuth, async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const { paymentPublicId } = req.params;

      const paymentRows = await db`SELECT * FROM payments WHERE public_id = ${paymentPublicId} LIMIT 1`;
      if (!paymentRows.length) return res.status(404).json({ error: "Payment not found" });
      const payment = paymentRows[0];

      // Determine visibility filter based on requester
      let visibility = "both";
      const uid = req.auth!.userId;
      if (uid === payment.client_id) visibility = "client";
      else if (uid === payment.freelancer_id) visibility = "freelancer";

      const events = await db`
        SELECT * FROM payment_timeline_events
        WHERE payment_id = ${payment.id}
          AND (visibility = 'both' OR visibility = ${visibility} OR visibility = 'admin')
        ORDER BY occurred_at ASC
      `;
      res.json({ paymentPublicId, events });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/stripe/earnings/:userId — FR-07 (PRD-010): freelancer earnings dashboard data
  // A0-S4
  app.get("/api/stripe/earnings/:userId", requireAuth, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!userId) return res.status(400).json({ error: "userId required" });
      // A0: caller may only access their own earnings
      if (req.auth!.userId !== userId) return res.status(403).json({ error: "Forbidden." });
      const db = neon(process.env.DATABASE_URL!);

      const [totals] = await db`
        SELECT
          COALESCE(SUM(CASE WHEN status='succeeded' THEN freelancer_pence ELSE 0 END),0) AS lifetime_earned,
          COALESCE(SUM(CASE WHEN status='succeeded' THEN gross_pence ELSE 0 END),0) AS lifetime_volume
        FROM payments WHERE freelancer_id = ${userId}
      `;
      const lifetimeEarned = Number(totals?.lifetime_earned ?? 0);
      const lifetimeVolume = Number(totals?.lifetime_volume ?? 0);

      const recentPayments = await db`
        SELECT p.public_id, p.gross_pence, p.freelancer_pence, p.platform_fee_pence,
               p.status, p.succeeded_at, p.created_at,
               pr.title AS project_title,
               pt.stripe_transfer_id, pt.status AS transfer_status
        FROM payments p
        LEFT JOIN projects pr ON pr.id = p.project_id
        LEFT JOIN payment_transfers pt ON pt.payment_id = p.id AND pt.status = 'transferred'
        WHERE p.freelancer_id = ${userId}
        ORDER BY p.created_at DESC
        LIMIT 20
      `;

      let availablePence = 0, pendingPence = 0, payouts: any[] = [], nextPayout: any = null;
      if (stripe) {
        const connectRow = await db`
          SELECT stripe_account_id, payout_schedule FROM stripe_connect_accounts WHERE user_id = ${userId} LIMIT 1
        `;
        if (connectRow.length && connectRow[0].stripe_account_id) {
          const acctId = connectRow[0].stripe_account_id;
          try {
            const [balance, payoutList] = await Promise.all([
              stripe.balance.retrieve({}, { stripeAccount: acctId }),
              stripe.payouts.list({ limit: 10 }, { stripeAccount: acctId }),
            ]);
            const avail = balance.available.find((b: any) => b.currency === "gbp");
            const pend = balance.pending.find((b: any) => b.currency === "gbp");
            availablePence = avail?.amount ?? 0;
            pendingPence = pend?.amount ?? 0;
            payouts = payoutList.data.map((p: any) => ({
              id: p.id, amount: p.amount, status: p.status,
              arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString().slice(0, 10) : null,
              created: new Date(p.created * 1000).toISOString(),
              automatic: p.automatic,
            }));
            const nextInTransit = payoutList.data.find((p: any) => p.status === "in_transit" || p.status === "pending");
            if (nextInTransit) nextPayout = {
              id: nextInTransit.id, amount: nextInTransit.amount,
              arrivalDate: nextInTransit.arrival_date ? new Date(nextInTransit.arrival_date * 1000).toISOString().slice(0, 10) : null,
            };
          } catch (e: any) { console.warn("[earnings] Stripe balance fetch failed:", e.message); }
        }
      }

      res.json({ lifetimeEarnedPence: lifetimeEarned, lifetimeVolumePence: lifetimeVolume,
        availableBalancePence: availablePence, pendingBalancePence: pendingPence,
        nextPayout, payouts, recentPayments });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── PRD-008: Freelancer payout timeline ─────────────────────────────────
  // A0-S5
  app.get("/api/me/payouts", requireAuth, async (req, res) => {
    try {
      // A0: identity from session only
      const userId = req.auth!.userId;
      const timeline = await getFreelancerPayoutTimeline(userId);
      res.json(timeline);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-008: Terms API ───────────────────────────────────────────────────
  // GET /api/legal/terms/current — get current terms versions
  app.get("/api/legal/terms/current", async (_req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      // Return the latest version for each document type
      const terms = await db`
        SELECT DISTINCT ON (document) document, version, effective_date, content_hash, created_at
        FROM terms_versions
        ORDER BY document, effective_date DESC
      `;
      res.json({ terms });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/legal/terms/accept — record terms acceptance
  // A0-L2
  app.post("/api/legal/terms/accept", requireAuth, async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      // A0: body userId is IGNORED; terms are always recorded for the authenticated caller
      const { document, version, context } = req.body;
      if (!document || !version) {
        return res.status(400).json({ error: "document and version required" });
      }
      const tv = await db`SELECT id FROM terms_versions WHERE document = ${document} AND version = ${version} LIMIT 1`;
      if (!tv.length) return res.status(404).json({ error: "Terms version not found" });
      const ip = req.headers["x-forwarded-for"]?.toString() ?? req.socket.remoteAddress;
      const ua = req.headers["user-agent"] ?? "";
      // WS-A: Append-only — never overwrite accepted_at (original timestamp preserved)
      await db`
        INSERT INTO terms_acceptances (user_id, terms_version_id, document, version, context, ip_address, user_agent)
        VALUES (${req.auth!.userId}, ${tv[0].id}, ${document}, ${version}, ${context ?? "manual"}, ${ip}, ${ua})
        ON CONFLICT (user_id, terms_version_id) DO NOTHING
      `;
      res.json({ accepted: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/me/legal-acceptances
  // PRD-018 B5: requireAuth + session-derived userId
  app.get("/api/me/legal-acceptances", requireAuth, async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const userId = req.auth!.userId;
      const acceptances = await db`
        SELECT ta.*, tv.effective_date FROM terms_acceptances ta
        JOIN terms_versions tv ON tv.id = ta.terms_version_id
        WHERE ta.user_id = ${userId}
        ORDER BY ta.accepted_at DESC
      `;
      res.json({ acceptances });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/me/terms-status — PRD-021 WS-A
  // Returns: for each document type, the currently effective version and whether the caller has accepted it.
  // Supports v1→v2 version checks without overwriting either acceptance record.
  app.get("/api/me/terms-status", requireAuth, async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const userId = req.auth!.userId;
      // Current effective version per document (highest effective_date)
      const current = await db`
        SELECT DISTINCT ON (document) id, document, version, effective_date
        FROM terms_versions
        ORDER BY document, effective_date DESC
      `;
      // All acceptances for this user (preserves both v1 and v2 rows)
      const accepted = await db`
        SELECT ta.document, ta.version, ta.terms_version_id, ta.accepted_at
        FROM terms_acceptances ta
        WHERE ta.user_id = ${userId}
      `;
      const acceptedMap = new Map(accepted.map((a: any) => [a.terms_version_id, a]));
      const status = current.map((tv: any) => ({
        document: tv.document,
        currentVersion: tv.version,
        effectiveDate: tv.effective_date,
        accepted: acceptedMap.has(tv.id),
        acceptedAt: acceptedMap.get(tv.id)?.accepted_at ?? null,
      }));
      res.json({ status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-008: Founder Finance & Operations APIs ───────────────────────────
  // All require finance permission (userId in query/body)

  // GET /api/founder/finance/overview
  app.get("/api/founder/finance/overview", requireFinancePermission("finance.dashboard.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const period = (req.query.period as string) ?? "today";
      const now = new Date();
      let since: string;
      if (period === "today") since = now.toISOString().slice(0, 10) + "T00:00:00.000Z";
      else if (period === "7d") since = new Date(now.getTime() - 7 * 86400_000).toISOString();
      else if (period === "30d") since = new Date(now.getTime() - 30 * 86400_000).toISOString();
      else since = (req.query.since as string) ?? now.toISOString().slice(0, 10) + "T00:00:00.000Z";

      const [volumeRow] = await db`
        SELECT
          COALESCE(SUM(gross_pence),0) AS gross_volume,
          COALESCE(SUM(platform_fee_pence),0) AS platform_fee,
          COALESCE(SUM(COALESCE(stripe_fee_pence,0)),0) AS stripe_fee,
          COALESCE(SUM(COALESCE(net_platform_revenue_pence, platform_fee_pence)),0) AS net_revenue,
          COALESCE(SUM(freelancer_pence),0) AS freelancer_earnings,
          COUNT(*) FILTER (WHERE status='failed') AS failed_count,
          COUNT(*) AS total_payments
        FROM payments WHERE succeeded_at >= ${since}
      `;
      const [refundRow] = await db`
        SELECT COALESCE(SUM(amount_pence),0) AS refunds_total
        FROM payment_refunds WHERE created_at >= ${since} AND status='succeeded'
      `;
      const [pendingTransfers] = await db`
        SELECT COALESCE(SUM(p.freelancer_pence),0) AS pending
        FROM payments p
        WHERE p.status='succeeded'
          AND NOT EXISTS (SELECT 1 FROM payment_transfers pt WHERE pt.payment_id=p.id AND pt.status='transferred')
      `;
      const openExceptions = (await db`SELECT COUNT(*) AS c FROM finance_exceptions WHERE status='open'`)[0]?.c ?? 0;
      const failedJobs = (await db`SELECT COUNT(*) AS c FROM background_jobs WHERE status='dead_letter'`)[0]?.c ?? 0;

      // FR-06: connected account and payout summary metrics
      const connectRows = await db`
        SELECT payout_schedule, readiness_state, payouts_enabled
        FROM stripe_connect_accounts WHERE stripe_account_id IS NOT NULL
      `;
      let manualPayoutCount = 0, automaticPayoutCount = 0;
      for (const row of connectRows) {
        try {
          const s = JSON.parse(row.payout_schedule ?? "{}");
          if (s.interval === "daily") automaticPayoutCount++;
          else manualPayoutCount++;
        } catch { manualPayoutCount++; }
      }
      const disputeCount = (await db`
        SELECT COUNT(*) AS c FROM payment_refunds WHERE reason_code='fraud' AND created_at >= ${since}
      `)[0]?.c ?? 0;
      const webhookFailures = (await db`
        SELECT COUNT(*) AS c FROM stripe_events WHERE processing_status='failed'
      `)[0]?.c ?? 0;

      res.json({
        period, since,
        grossVolumePence: Number(volumeRow.gross_volume),
        grossCommissionPence: Number(volumeRow.platform_fee),
        stripeFeesPence: Number(volumeRow.stripe_fee),
        netRevenuePence: Number(volumeRow.net_revenue),
        freelancerEarningsPence: Number(volumeRow.freelancer_earnings),
        pendingTransfersPence: Number(pendingTransfers.pending),
        refundsTotalPence: Number(refundRow.refunds_total),
        failedPaymentCount: Number(volumeRow.failed_count),
        openExceptions: Number(openExceptions),
        failedWebhookJobs: Number(failedJobs),
        totalPayments: Number(volumeRow.total_payments),
        // FR-06 additions
        connectedAccountCount: connectRows.length,
        automaticPayoutCount,
        manualPayoutCount,
        disputeCount: Number(disputeCount),
        webhookFailureCount: Number(webhookFailures),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/payments
  app.get("/api/founder/finance/payments", requireFinancePermission("finance.payment.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = Number(req.query.offset ?? 0);
      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;

      const payments = await db`
        SELECT p.*,
          pr.title AS project_title,
          cu.email AS client_email,
          fu.email AS freelancer_email,
          (SELECT COUNT(*) FROM payment_refunds pr2 WHERE pr2.payment_id = p.id AND pr2.status='succeeded') AS refund_count,
          (SELECT COUNT(*) FROM payment_transfers pt WHERE pt.payment_id = p.id) AS transfer_count
        FROM payments p
        LEFT JOIN projects pr ON pr.id = p.project_id
        LEFT JOIN users cu ON cu.id = p.client_id
        LEFT JOIN users fu ON fu.id = p.freelancer_id
        WHERE
          (${status ?? null}::TEXT IS NULL OR p.status = ${status ?? ""})
          AND (
            ${search ?? null}::TEXT IS NULL OR
            p.public_id ILIKE ${'%' + (search ?? '') + '%'} OR
            cu.email ILIKE ${'%' + (search ?? '') + '%'} OR
            fu.email ILIKE ${'%' + (search ?? '') + '%'}
          )
        ORDER BY p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const [total] = await db`SELECT COUNT(*) AS c FROM payments`;
      res.json({ payments, total: Number(total.c), limit, offset });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/payments/:paymentPublicId
  app.get("/api/founder/finance/payments/:paymentPublicId", requireFinancePermission("finance.payment.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const { paymentPublicId } = req.params;
      const [payment] = await db`SELECT p.*, pr.title AS project_title FROM payments p LEFT JOIN projects pr ON pr.id=p.project_id WHERE p.public_id=${paymentPublicId}`;
      if (!payment) return res.status(404).json({ error: "Payment not found" });
      const transfers = await db`SELECT * FROM payment_transfers WHERE payment_id = ${payment.id}`;
      const refunds = await db`SELECT * FROM payment_refunds WHERE payment_id = ${payment.id}`;
      const auditEntries = await db`SELECT * FROM payment_audit_log WHERE payment_id = ${payment.id} ORDER BY created_at DESC LIMIT 50`;
      const timeline = await db`SELECT * FROM payment_timeline_events WHERE payment_id = ${payment.id} ORDER BY occurred_at ASC`;
      const exceptions = await db`SELECT * FROM finance_exceptions WHERE payment_id = ${payment.id} ORDER BY detected_at DESC`;
      const jobs = await db`SELECT * FROM background_jobs WHERE payload->>'paymentId' = ${String(payment.id)} ORDER BY created_at DESC LIMIT 20`;
      res.json({ payment, transfers, refunds, auditLog: auditEntries, timeline, exceptions, jobs });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/exceptions
  app.get("/api/founder/finance/exceptions", requireFinancePermission("finance.dashboard.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const status = (req.query.status as string) ?? "open";
      const exceptions = await db`
        SELECT fe.*, p.public_id AS payment_public_id
        FROM finance_exceptions fe
        LEFT JOIN payments p ON p.id = fe.payment_id
        WHERE fe.status = ${status}
        ORDER BY fe.detected_at DESC
        LIMIT 100
      `;
      res.json({ exceptions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/founder/finance/exceptions/:publicId/resolve
  app.post("/api/founder/finance/exceptions/:publicId/resolve", requireFinancePermission("finance.reconcile.run"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const { publicId } = req.params;
      const { resolutionNote, status } = req.body;
      const validStatuses = ["resolved", "ignored_with_reason", "investigating", "action_required"];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });
      await db`
        UPDATE finance_exceptions
        SET status = ${status},
            resolution_note = ${resolutionNote ?? null},
            resolved_at = ${status === "resolved" || status === "ignored_with_reason" ? new Date().toISOString() : null}
        WHERE public_id = ${publicId}
      `;
      res.json({ updated: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/founder/finance/exceptions/:publicId/assign
  app.post("/api/founder/finance/exceptions/:publicId/assign", requireFinancePermission("finance.reconcile.run"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const { publicId } = req.params;
      const { assignToUserId } = req.body;
      await db`UPDATE finance_exceptions SET assigned_to = ${assignToUserId}, status = 'investigating' WHERE public_id = ${publicId}`;
      res.json({ updated: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/founder/finance/payments/:paymentPublicId/reconcile
  app.post("/api/founder/finance/payments/:paymentPublicId/reconcile", requireFinancePermission("finance.reconcile.run"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const [payment] = await db`SELECT id FROM payments WHERE public_id = ${req.params.paymentPublicId}`;
      if (!payment) return res.status(404).json({ error: "Payment not found" });
      const result = await reconcilePaymentFull(payment.id);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/founder/finance/stripe-events/:eventId/replay
  app.post("/api/founder/finance/stripe-events/:eventId/replay", requireFinancePermission("finance.webhook.replay"), async (req, res) => {
    try {
      const jobId = await enqueueJob(
        "process_stripe_event",
        { stripeEventId: req.params.eventId, replay: true },
        `replay:${req.params.eventId}:${Date.now()}`
      );
      res.json({ queued: true, jobId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/payouts
  app.get("/api/founder/finance/payouts", requireFinancePermission("finance.payment.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = Number(req.query.offset ?? 0);
      const payouts = await db`
        SELECT pp.*, p.public_id AS payment_public_id, u.email AS freelancer_email
        FROM payment_payouts pp
        LEFT JOIN payments p ON p.id = pp.payment_id
        LEFT JOIN users u ON u.id = pp.user_id
        ORDER BY pp.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      res.json({ payouts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/refunds
  app.get("/api/founder/finance/refunds", requireFinancePermission("finance.payment.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = Number(req.query.offset ?? 0);
      const refunds = await db`
        SELECT pr.*, p.public_id AS payment_public_id, p.gross_pence, p.project_id,
          cu.email AS client_email, fu.email AS freelancer_email
        FROM payment_refunds pr
        JOIN payments p ON p.id = pr.payment_id
        LEFT JOIN users cu ON cu.id = p.client_id
        LEFT JOIN users fu ON fu.id = p.freelancer_id
        ORDER BY pr.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      res.json({ refunds });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/disputes
  app.get("/api/founder/finance/disputes", requireFinancePermission("finance.dispute.manage"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const exceptions = await db`
        SELECT fe.*, p.public_id AS payment_public_id, p.gross_pence
        FROM finance_exceptions fe
        LEFT JOIN payments p ON p.id = fe.payment_id
        WHERE fe.type LIKE '%dispute%' OR fe.summary ILIKE '%dispute%'
        ORDER BY fe.detected_at DESC LIMIT 100
      `;
      res.json({ disputes: exceptions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/reports/export (CSV stub)
  app.get("/api/founder/finance/reports/export", requireFinancePermission("finance.export"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const since = (req.query.since as string) ?? new Date(Date.now() - 30 * 86400_000).toISOString();
      const payments = await db`
        SELECT p.public_id, p.created_at, p.gross_pence, p.platform_fee_pence, p.stripe_fee_pence,
          p.freelancer_pence, p.status, p.payment_kind,
          cu.email AS client_email, fu.email AS freelancer_email,
          pr.title AS project_title
        FROM payments p
        LEFT JOIN users cu ON cu.id = p.client_id
        LEFT JOIN users fu ON fu.id = p.freelancer_id
        LEFT JOIN projects pr ON pr.id = p.project_id
        WHERE p.succeeded_at >= ${since}
        ORDER BY p.created_at DESC
        LIMIT 1000
      `;

      // Build CSV
      const headers = ["Payment ID","Date","Project","Client","Freelancer","Gross (£)","Viewrr Fee (£)","Stripe Fee (£)","Freelancer Amount (£)","Status","Type"];
      const rows = payments.map(p => [
        p.public_id, p.created_at?.slice(0,10) ?? "",
        (p.project_title ?? "").replace(/,/g, ""),
        (p.client_email ?? "").replace(/,/g, ""),
        (p.freelancer_email ?? "").replace(/,/g, ""),
        ((p.gross_pence ?? 0)/100).toFixed(2),
        ((p.platform_fee_pence ?? 0)/100).toFixed(2),
        ((p.stripe_fee_pence ?? 0)/100).toFixed(2),
        ((p.freelancer_pence ?? 0)/100).toFixed(2),
        p.status, p.payment_kind,
      ]);
      const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=viewrr_payments_${since.slice(0,10)}.csv`);
      res.send(csv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/connected-accounts — PRD-015 FR-21 Founder Diagnostics
  app.get("/api/founder/finance/connected-accounts", requireFinancePermission("finance.connected_account.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const accounts = await db`
        SELECT sca.user_id, sca.stripe_account_id, sca.readiness_state,
               sca.charges_enabled, sca.payouts_enabled, sca.transfers_enabled,
               sca.currently_due, sca.past_due, sca.pending_verification, sca.disabled_reason,
               sca.payout_schedule, sca.last_stripe_sync, sca.last_onboarding_link_at,
               sca.last_onboarding_link_error, sca.created_at,
               u.email, u.name,
               (SELECT COUNT(*) FROM payments p WHERE p.freelancer_id = sca.user_id) AS payment_count,
               (SELECT COUNT(*) FROM payments p WHERE p.freelancer_id = sca.user_id AND p.status = 'succeeded') AS succeeded_count
        FROM stripe_connect_accounts sca
        JOIN users u ON u.id = sca.user_id
        ORDER BY sca.created_at DESC
      `;
      const enriched = accounts.map((a: any) => ({
        freelancer: { id: a.user_id, email: a.email, name: a.name },
        stripe: {
          accountId: a.stripe_account_id,
          readinessState: a.readiness_state,
          chargesEnabled: !!a.charges_enabled,
          transfersEnabled: !!a.transfers_enabled,
          payoutsEnabled: !!a.payouts_enabled,
          disabledReason: a.disabled_reason,
        },
        requirements: {
          currentlyDue: (() => { try { return JSON.parse(a.currently_due ?? "[]"); } catch { return []; } })(),
          pastDue: (() => { try { return JSON.parse(a.past_due ?? "[]"); } catch { return []; } })(),
          pendingVerification: (() => { try { return JSON.parse(a.pending_verification ?? "[]"); } catch { return []; } })(),
        },
        payoutSchedule: (() => { try { return JSON.parse(a.payout_schedule ?? "{}"); } catch { return null; } })(),
        diagnostics: {
          lastStripeSync: a.last_stripe_sync,
          lastOnboardingLinkAt: a.last_onboarding_link_at,
          lastOnboardingLinkError: a.last_onboarding_link_error,
          paymentCount: Number(a.payment_count ?? 0),
          succeededCount: Number(a.succeeded_count ?? 0),
          connectedAt: a.created_at,
        },
      }));
      res.json({ total: enriched.length, accounts: enriched });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/verification-diagnostics — quick per-freelancer verification status
  app.get("/api/founder/finance/verification-diagnostics", requireFinancePermission("finance.connected_account.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const rows = await db`
        SELECT sca.user_id, sca.stripe_account_id, sca.readiness_state,
               sca.charges_enabled, sca.payouts_enabled, sca.currently_due, sca.pending_verification,
               sca.past_due, sca.disabled_reason, sca.last_stripe_sync,
               sca.last_onboarding_link_at, sca.last_onboarding_link_error,
               u.email
        FROM stripe_connect_accounts sca
        JOIN users u ON u.id = sca.user_id
        WHERE sca.charges_enabled = 0 OR sca.payouts_enabled = 0
        ORDER BY sca.created_at DESC
      `;
      res.json({
        count: rows.length,
        freelancers: rows.map((r: any) => ({
          userId: r.user_id,
          email: r.email,
          stripeAccountId: r.stripe_account_id,
          readinessState: r.readiness_state,
          chargesEnabled: !!r.charges_enabled,
          payoutsEnabled: !!r.payouts_enabled,
          requirementsCount: (() => { try { return JSON.parse(r.currently_due ?? "[]").length; } catch { return 0; } })(),
          pastDueCount: (() => { try { return JSON.parse(r.past_due ?? "[]").length; } catch { return 0; } })(),
          pendingVerification: (() => { try { return JSON.parse(r.pending_verification ?? "[]"); } catch { return []; } })(),
          disabledReason: r.disabled_reason,
          lastStripeSync: r.last_stripe_sync,
          lastOnboardingLinkAt: r.last_onboarding_link_at,
          lastOnboardingLinkError: r.last_onboarding_link_error,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/manual-accounts — FR-09 (PRD-010): alert for manual payout accounts
  app.get("/api/founder/finance/manual-accounts", requireFinancePermission("finance.dashboard.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const accounts = await db`
        SELECT sca.user_id, sca.stripe_account_id, sca.readiness_state,
               sca.payout_schedule, sca.charges_enabled, sca.payouts_enabled,
               u.email
        FROM stripe_connect_accounts sca
        LEFT JOIN users u ON u.id = sca.user_id
        WHERE sca.stripe_account_id IS NOT NULL
      `;
      const manualAccounts = accounts.filter((a: any) => {
        try {
          const s = JSON.parse(a.payout_schedule ?? "{}");
          return s.interval !== "daily";
        } catch { return true; }
      });
      res.json({
        totalConnected: accounts.length,
        manualCount: manualAccounts.length,
        hasManual: manualAccounts.length > 0,
        accounts: manualAccounts.map((a: any) => ({
          userId: a.user_id,
          stripeAccountId: a.stripe_account_id,
          email: a.email,
          readinessState: a.readiness_state,
          payoutSchedule: (() => { try { return JSON.parse(a.payout_schedule ?? "{}"); } catch { return null; } })(),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // FR-10 (PRD-010): GET /api/founder/finance/migration-status — verification of migration state
  app.get("/api/founder/finance/migration-status", requireFinancePermission("finance.dashboard.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const accounts = await db`
        SELECT sca.stripe_account_id, sca.payout_schedule, sca.readiness_state, u.email
        FROM stripe_connect_accounts sca
        LEFT JOIN users u ON u.id = sca.user_id
        WHERE sca.stripe_account_id IS NOT NULL
      `;
      let daily = 0, manual = 0, unknown = 0;
      const breakdown: any[] = [];
      for (const a of accounts) {
        let interval = "unknown";
        try { interval = JSON.parse(a.payout_schedule ?? "{}").interval ?? "unknown"; } catch {}
        if (interval === "daily") daily++;
        else if (interval === "manual") manual++;
        else unknown++;
        breakdown.push({ email: a.email, stripeAccountId: a.stripe_account_id, interval, readinessState: a.readiness_state });
      }
      res.json({ total: accounts.length, daily, manual, unknown, breakdown });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/founder/finance/repair-account — FR-09 single-account repair
  app.post("/api/founder/finance/repair-account", requireFinancePermission("finance.settings.payout"), async (req, res) => {
    try {
      const { stripeAccountId } = req.body;
      if (!stripeAccountId) return res.status(400).json({ error: "stripeAccountId required" });

      const db = neon(process.env.DATABASE_URL!);
      // Find the user for this account (check both tables)
      const rows = await db`
        SELECT COALESCE(sca.user_id, u.id) AS user_id
        FROM users u
        LEFT JOIN stripe_connect_accounts sca ON sca.user_id = u.id
        WHERE sca.stripe_account_id = ${stripeAccountId}
           OR u.stripe_account_id = ${stripeAccountId}
        LIMIT 1
      `;
      if (!rows.length) return res.status(404).json({ error: "Account not found in DB" });
      const userId = rows[0].user_id;

      const result = await configureAutoDailyPayout(userId, stripeAccountId);

      // Ensure account is in stripe_connect_accounts (sync if needed)
      await syncConnectAccount(userId, stripeAccountId);

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/founder/finance/payout-migration — trigger the daily payout migration
  app.post("/api/founder/finance/payout-migration", requireFinancePermission("finance.settings.payout"), async (req, res) => {
    try {
      const result = await migrateAllAccountsToAutoDailyPayout();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/founder/finance/run-exception-scan
  app.post("/api/founder/finance/run-exception-scan", requireFinancePermission("finance.reconcile.run"), async (req, res) => {
    try {
      const result = await runExceptionScan();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/founder/finance/daily-summaries
  app.get("/api/founder/finance/daily-summaries", requireFinancePermission("finance.dashboard.view"), async (req, res) => {
    try {
      const db = neon(process.env.DATABASE_URL!);
      const summaries = await db`
        SELECT * FROM finance_daily_summaries
        ORDER BY date DESC LIMIT 30
      `;
      res.json({ summaries });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-008: Start background job worker on server init ─────────────────
  // Register handlers for key job types
  registerJobHandler("reconcile_payment", async (payload) => {
    const paymentId = Number(payload.paymentId);
    await reconcilePaymentFull(paymentId);
  });

  registerJobHandler("generate_finance_summary", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    await generateDailySummary(today);
    await generateDailySummary(yesterday);
    await runExceptionScan();
  });

  registerJobHandler("sync_connect_account", async (payload) => {
    const userId = Number(payload.userId);
    const stripeAccountId = payload.stripeAccountId as string;
    await syncConnectAccount(userId, stripeAccountId);
    await configureAutoDailyPayout(userId, stripeAccountId);
  });

  // WS-A: process_stripe_event job handler — used by replay endpoint and recovery
  registerJobHandler("process_stripe_event", async (payload, attemptCount) => {
    const { stripeEventId } = payload as { stripeEventId: string };
    if (!stripeEventId) return; // nothing to do

    // Fetch the event record from DB to verify it exists and isn't already processed
    const sqlClient = neon(process.env.DATABASE_URL!);
    const rows = await sqlClient(
      "SELECT stripe_event_id, processing_status, raw_payload FROM stripe_events WHERE stripe_event_id = $1 LIMIT 1",
      [stripeEventId]
    ) as Array<{ stripe_event_id: string; processing_status: string; raw_payload: string | null }>;

    if (!rows.length) {
      console.warn(`[process_stripe_event] Event not found in DB: ${stripeEventId}`);
      return; // idempotent no-op
    }

    const row = rows[0];
    if (row.processing_status === "processed") {
      console.log(`[process_stripe_event] Already processed, skipping: ${stripeEventId}`);
      return; // idempotent no-op
    }

    // Reconstruct event from raw_payload if available, else fetch from Stripe
    let event: Stripe.Event;
    if (row.raw_payload) {
      event = JSON.parse(row.raw_payload) as Stripe.Event;
    } else if (stripe) {
      event = await stripe.events.retrieve(stripeEventId);
    } else {
      console.error(`[process_stripe_event] No raw_payload and Stripe not configured: ${stripeEventId}`);
      return;
    }

    const requestId = `job_${stripeEventId}_attempt${attemptCount ?? 1}`;
    try {
      await processStripeEvent(event, requestId);
      await markEventProcessed(stripeEventId);
    } catch (e: any) {
      await markEventProcessed(stripeEventId, e.message);
      throw e; // re-throw so job-queue can apply retry/backoff
    }
  });

  // Account deletion executor.
  //
  // Only password-confirmed requests ever reach state='scheduled'.
  // The scanner is deliberately separate from queue retry/backoff:
  // contractual/financial blockers can last days or weeks, whereas retries
  // are reserved for real processing failures.
  registerJobHandler("process_account_deletion", async (payload, attemptCount) => {
    const userId = Number(payload.userId);
    const requestId = Number(payload.requestId);

    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(requestId) || requestId <= 0) {
      throw new Error("Invalid account deletion job payload");
    }

    const sqlClient = neon(process.env.DATABASE_URL!);

    const rows = await sqlClient`
      SELECT id, user_id, state, status, scheduled_for
      FROM account_deletion_requests
      WHERE id = ${requestId} AND user_id = ${userId}
      LIMIT 1
    `;

    if (!rows.length) return;

    const currentState = String(rows[0].state ?? rows[0].status ?? "");

    // A retry after partial anonymisation may find that the request itself was
    // already marked anonymised before another cleanup step failed. The
    // anonymisation service is idempotent, so allow that SAME durable job to
    // retry and finish the remaining cleanup.
    const recoveringPartial =
      currentState === "anonymised" && attemptCount > 1;

    if (
      currentState !== "scheduled" &&
      currentState !== "processing" &&
      !recoveringPartial
    ) {
      return;
    }

    // scheduled -> processing is an atomic claim. A request already in
    // processing is treated as recovery from an interrupted worker run.
    if (currentState === "scheduled") {
      const claimed = await sqlClient`
        UPDATE account_deletion_requests
        SET state = 'processing', status = 'processing'
        WHERE id = ${requestId}
          AND user_id = ${userId}
          AND state = 'scheduled'
        RETURNING id
      `;

      if (!claimed.length) return;
    }

    try {
      if (!recoveringPartial) {
        // Re-check obligations AFTER claiming and immediately before the
        // irreversible anonymisation step.
        const assessment = await checkDeletionBlockers(userId);

        if (assessment.state === "scheduled") {
          await sqlClient`
            UPDATE account_deletion_requests
            SET state = 'scheduled', status = 'scheduled'
            WHERE id = ${requestId} AND user_id = ${userId}
          `;

          const scheduledAt = rows[0].scheduled_for
            ? new Date(rows[0].scheduled_for).getTime()
            : null;

          if (
            scheduledAt !== null &&
            Number.isFinite(scheduledAt) &&
            scheduledAt <= Date.now()
          ) {
            console.warn(
              `[account-deletion] Request ${requestId} for user ${userId} is past scheduled_for but blockers remain; founder review required`,
            );
          }

          return;
        }
      }

      const report = await anonymiseUserAccount(userId);

      if (report.skippedSteps.length) {
        console.warn(
          `[account-deletion] user ${userId}: skipped anonymisation steps`,
          report.skippedSteps,
        );
      }

      console.log(
        `[account-deletion] Completed scheduled deletion request ${requestId} for user ${userId}`,
      );
    } catch (e: any) {
      // Put the request back into a recoverable state. The anonymisation
      // routine is intentionally idempotent, so both queue retry/backoff and
      // a later hourly scan can safely finish a partial run.
      try {
        await sqlClient`
          UPDATE account_deletion_requests
          SET state = 'scheduled', status = 'scheduled'
          WHERE id = ${requestId} AND user_id = ${userId}
        `;
      } catch (resetErr: any) {
        console.error(
          `[account-deletion] Could not restore request ${requestId} to scheduled after failure:`,
          resetErr?.message,
        );
      }

      throw e;
    }
  });

  const scanScheduledAccountDeletions = async () => {
    const sqlClient = neon(process.env.DATABASE_URL!);

    try {
      // Include 'processing' so an interrupted Render process cannot strand a
      // confirmed deletion permanently. Pending/unconfirmed requests are never
      // selected.
      const requests = await sqlClient`
        SELECT DISTINCT ON (user_id)
          id, user_id, state, requested_at
        FROM account_deletion_requests
        WHERE state IN ('scheduled', 'processing')
        ORDER BY user_id, requested_at DESC, id DESC
      `;

      const hourBucket = new Date().toISOString().slice(0, 13);

      for (const request of requests) {
        const userId = Number(request.user_id);
        const requestId = Number(request.id);

        if (
          !Number.isInteger(userId) ||
          userId <= 0 ||
          !Number.isInteger(requestId) ||
          requestId <= 0
        ) {
          continue;
        }

        try {
          // requestId is part of the dedupe key so separate deletion requests
          // for the same account can never collide.
          await enqueueJob(
            "process_account_deletion",
            { userId, requestId },
            `account-deletion:${requestId}:${hourBucket}`,
          );
        } catch (e: any) {
          console.error(
            `[account-deletion] Scanner failed for request ${requestId}:`,
            e?.message,
          );
        }
      }
    } catch (e: any) {
      console.error(
        "[account-deletion] Scheduled deletion scan failed:",
        e?.message,
      );
    }
  };

  // Start the worker (non-blocking)
  startWorker();

  // Check confirmed scheduled deletions on startup and then hourly.
  // An hour is sufficiently responsive for account deletion while avoiding
  // unnecessary production DB traffic.
  setImmediate(() => {
    void scanScheduledAccountDeletions();
  });

  setInterval(() => {
    void scanScheduledAccountDeletions();
  }, 60 * 60 * 1000);

  // WS-A: Recover stale stripe events on startup (async, non-blocking)
  setImmediate(async () => {
    try {
      const recovered = await recoverStaleStripeEvents();
      if (recovered > 0) console.log(`[stripe-recovery] Recovered ${recovered} stale events on startup`);
    } catch (e: any) { console.error('[stripe-recovery] Startup recovery error:', e.message); }
  });
  // Also run periodic recovery every 5 minutes
  setInterval(async () => {
    try { await recoverStaleStripeEvents(); } catch {}
  }, 5 * 60 * 1000);

  // ─── PRD-021 WS-B: Data export ────────────────────────────────────────────
  // GET /api/me/export — compile and return user's personal data
  app.get("/api/me/export", requireAuth, async (req: any, res: any) => {
    try {

      const userId = req.auth!.userId;
      const exportData = await compileUserExport(userId);
      res.setHeader("Content-Disposition", `attachment; filename="viewrr-data-export-${userId}-${Date.now()}.json"`);
      res.setHeader("Content-Type", "application/json");
      res.json(exportData);
    } catch (e: any) {
      res.status(500).json({ error: "Export failed. Please try again later." });
    }
  });

  // ─── PRD 1 (Decision 6): Account deletion ──────────────────────────────────
  //
  // GET /api/me/deletion-status — contract §D. Read-only, never 409s, and shows
  // the user the real retention schedule rather than a reassuring summary.
  app.get("/api/me/deletion-status", requireAuth, async (req: any, res: any) => {
    try {
      const status = await getDeletionStatus(req.auth!.userId);
      res.set("Cache-Control", "private, no-store");
      return res.json(status);
    } catch (e: any) {
      console.error("[deletion-status] Failed:", e?.message);
      return res.status(500).json({ error: "Could not load your deletion status. Please try again." });
    }
  });

  // POST /api/me/request-deletion
  //
  // DECISION 6 — this no longer returns 409. The old behaviour refused the
  // request outright and indefinitely whenever any blocker existed, with no
  // path to erasure: an active project or an unpaid invoice meant "no, forever".
  // That is not a lawful answer to an erasure request. Now:
  //   • no blockers   -> request recorded as 'pending', user may confirm now
  //   • blockers      -> request recorded as 'scheduled' with a real date, and
  //                      the blockers are returned so the user can clear them
  //                      sooner. Never a refusal.
  //
  // The copy is also fixed. It previously said "within 30 days" here while
  // confirm-deletion below anonymises instantly — two contradictory promises
  // about the same operation.
  app.post("/api/me/request-deletion", requireAuth, async (req: any, res: any) => {
    try {
      const userId = req.auth!.userId;
      const assessment = await checkDeletionBlockers(userId);
      const sql = neon(process.env.DATABASE_URL!);
      const now = new Date().toISOString();

      // Requesting deletion and CONFIRMING deletion are deliberately separate.
      // A row remains pending until password re-authentication succeeds.
      const state = "pending";
      const scheduledFor = assessment.scheduledFor;
      const deferredReason = assessment.blockers.length
        ? assessment.blockers.map((b) => b.code).join(",")
        : null;

      // `state`, `scheduled_for` and `deferred_reason` arrive with migration
      // 0006. Fall back to the pre-migration column set so this endpoint keeps
      // working if the migration has not been applied yet.
      try {
        await sql`
          INSERT INTO account_deletion_requests
            (user_id, status, requested_at, state, scheduled_for, deferred_reason)
          VALUES
            (${userId}, ${state}, ${now}, ${state}, NULL, ${deferredReason})
        `;
      } catch (insertErr: any) {
        console.warn("[request-deletion] Falling back to pre-0006 columns:", insertErr?.message);
        await sql`
          INSERT INTO account_deletion_requests (user_id, status, requested_at, blocker_reason)
          VALUES (${userId}, ${state}, ${now}, ${deferredReason})
        `;
      }

      if (assessment.state === "scheduled") {
        return res.json({
          ok: true,
          state: "pending",
          scheduledFor,
          blockers: assessment.blockers.map((b) => ({
            code: b.code, label: b.label, detail: b.detail, clearsAutomatically: b.clearsAutomatically,
          })),
          message: `Your deletion request is recorded but is not confirmed yet. Enter your password to confirm it. Because ${assessment.blockers.length} outstanding item${assessment.blockers.length === 1 ? "" : "s"} currently remains, confirmed deletion will be scheduled for ${new Date(scheduledFor!).toLocaleDateString("en-GB")} unless those obligations clear sooner.`,
        });
      }

      return res.json({
        ok: true,
        state: "pending",
        scheduledFor: null,
        blockers: [],
        message: "Your deletion request is recorded. Nothing is blocking it — confirm with your password and your account is anonymised straight away. Some financial and legal records are kept for up to 6 years; see the retention schedule for exactly what and why.",
      });
    } catch (e: any) {
      console.error("[request-deletion] Failed:", e?.message);
      res.status(500).json({ error: "Could not record your deletion request. Please try again." });
    }
  });

  // POST /api/me/confirm-deletion — actually anonymise (requires re-auth: password confirmation)
  // Separated from request to prevent accidental/automated deletion
  app.post("/api/me/confirm-deletion", requireAuth, async (req: any, res: any) => {
    try {

      const userId = req.auth!.userId;

      // Require password re-confirmation
      const { password } = req.body;
      if (!password) return res.status(400).json({ error: "Password confirmation required" });

      const user = await storage.getUserByEmail(
        (await storage.getUser(userId))?.email ?? ""
      );
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!user.passwordHash) return res.status(400).json({ error: "No password set — contact support" });

      const { valid } = await verifyPassword(password, user.passwordHash);
      if (!valid) return res.status(403).json({ error: "Incorrect password" });

      // Final blocker check. Decision 6: still NOT a refusal — immediate
      // erasure is deferred, and the request is recorded as scheduled so it
      // completes automatically once the blockers clear. Status is 202
      // (Accepted, not yet acted on), never 409.
      const assessment = await checkDeletionBlockers(userId);
      const sql = neon(process.env.DATABASE_URL!);
      if (assessment.state === "scheduled") {
        try {
          await sql`
            UPDATE account_deletion_requests
            SET state = 'scheduled',
                status = 'scheduled',
                scheduled_for = ${assessment.scheduledFor},
                deferred_reason = ${assessment.blockers.map((b) => b.code).join(",")}
            WHERE user_id = ${userId} AND COALESCE(state, status) IN ('pending', 'scheduled', 'processing')
          `;
        } catch (updErr: any) {
          console.warn("[confirm-deletion] Could not record deferral (pre-0006?):", updErr?.message);
        }
        return res.status(202).json({
          ok: true,
          state: "scheduled",
          scheduledFor: assessment.scheduledFor,
          blockers: assessment.blockers.map((b) => ({
            code: b.code, label: b.label, detail: b.detail, clearsAutomatically: b.clearsAutomatically,
          })),
          message: "We have accepted your deletion. It cannot complete right now because of the outstanding items below, so it is scheduled — you do not need to ask again.",
        });
      }

      // Mark in-progress, then anonymise.
      await sql`
        UPDATE account_deletion_requests
        SET status = 'processing'
        WHERE user_id = ${userId} AND status IN ('pending', 'scheduled')
      `;

      // NOTE: this is the call that has been FAILING IN PRODUCTION. It wrote
      // NULL to users.password_algo, which is text NOT NULL, so every
      // confirm-deletion threw a not-null violation and no account could be
      // deleted. privacy-service now writes a sentinel instead. The function is
      // idempotent, so a retry after a partial failure is safe.
      const report = await anonymiseUserAccount(userId);
      if (report.skippedSteps.length) {
        console.warn(`[confirm-deletion] user ${userId}: skipped steps`, report.skippedSteps);
      }

      // Clear session cookie
      clearSessionCookie(res);
      res.json({
        ok: true,
        state: "anonymised",
        message: "Your account has been anonymised. Financial and legal records we are required to keep (invoices, payments, terms acceptances) are retained for up to 6 years and no longer identify you. We are sorry to see you go.",
      });
    } catch (e: any) {
      // A partial anonymisation must be loud, not silent — the user believes
      // their data is gone. anonymiseUserAccount sets e.partial and e.report.
      if (e?.partial) {
        console.error(`[confirm-deletion] PARTIAL anonymisation for user ${req.auth!.userId}:`, e.report?.failedSteps);
        return res.status(500).json({
          error: "Your account was partly anonymised but some records could not be updated. Our team has been alerted and will complete it. Please contact support if you do not hear back.",
          code: "PARTIAL_ANONYMISATION",
        });
      }
      console.error("[confirm-deletion] Failed:", e?.message);
      res.status(500).json({ error: "Deletion failed. Nothing has been changed. Please try again or contact support." });
    }
  });

  // Admin: GET /api/admin/deletion-requests — view pending deletion requests
  app.get("/api/admin/deletion-requests", requireAdminGuard, async (req: any, res: any) => {
    try {
      const sql = neon(process.env.DATABASE_URL!);
      const requests = await sql`
        SELECT adr.*, u.email, u.name FROM account_deletion_requests adr
        LEFT JOIN users u ON u.id = adr.user_id
        ORDER BY adr.requested_at DESC
        LIMIT 100
      `;
      res.json({ requests });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-021 WS-F: Reports ─────────────────────────────────────────────────
  const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many reports submitted. Please wait before reporting again." },
    keyGenerator: (req) => String((req as any).auth?.userId ?? req.ip),
  });

  // POST /api/reports — submit a moderation report
  app.post("/api/reports", requireAuth, reportLimiter, async (req: any, res: any) => {
    try {

      const { subjectType, subjectId, reason, description } = req.body;
      if (!subjectType || !subjectId || !reason) {
        return res.status(400).json({ error: "subjectType, subjectId, and reason are required" });
      }
      const reportId = await createReport({
        reporterUserId: req.auth!.userId,
        subjectType,
        subjectId: Number(subjectId),
        reason,
        description,
      });
      res.status(201).json({ ok: true, reportId });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // GET /api/admin/reports — list reports (admin only)
  app.get("/api/admin/reports", requireAdminGuard, async (req: any, res: any) => {
    try {
      const sql = neon(process.env.DATABASE_URL!);
      const status = (req.query.status as string) ?? "open";
      const limit = Math.min(Number(req.query.limit ?? 50), 100);
      const offset = Number(req.query.offset ?? 0);
      // PRD 1: hydrate the REPORTED SUBJECT.
      // The queue previously showed only the reporter and a bare
      // (subject_type, subject_id) pair, so the founder had to run SQL by hand
      // to find out what had actually been reported — which meant reports went
      // unactioned. subject_type is 'user' | 'post' | 'comment' | 'project'
      // (server/services/trust-service.ts), resolved here per type.
      const reports = await sql`
        SELECT ur.*,
               u.name  AS reporter_name,
               u.email AS reporter_email,
               CASE ur.subject_type
                 WHEN 'user'    THEN (SELECT su.name    FROM users su         WHERE su.id = ur.subject_id)
                 WHEN 'post'    THEN (SELECT au.name    FROM posts p JOIN users au ON au.id = p.user_id WHERE p.id = ur.subject_id)
                 WHEN 'comment' THEN (SELECT au.name    FROM post_comments c JOIN users au ON au.id = c.user_id WHERE c.id = ur.subject_id)
                 WHEN 'project' THEN (SELECT pr.title   FROM projects pr      WHERE pr.id = ur.subject_id)
                 ELSE NULL
               END AS subject_label,
               CASE ur.subject_type
                 WHEN 'user'    THEN ur.subject_id
                 WHEN 'post'    THEN (SELECT p.user_id FROM posts p         WHERE p.id = ur.subject_id)
                 WHEN 'comment' THEN (SELECT c.user_id FROM post_comments c WHERE c.id = ur.subject_id)
                 ELSE NULL
               END AS subject_user_id,
               CASE ur.subject_type
                 WHEN 'post'    THEN (SELECT p.caption FROM posts p         WHERE p.id = ur.subject_id)
                 WHEN 'comment' THEN (SELECT c.content FROM post_comments c WHERE c.id = ur.subject_id)
                 ELSE NULL
               END AS subject_body,
               CASE ur.subject_type
                 WHEN 'user'    THEN (SELECT su.account_status FROM users su WHERE su.id = ur.subject_id)
                 ELSE NULL
               END AS subject_account_status,
               (SELECT COUNT(*)::int FROM user_reports prior
                  WHERE prior.subject_type = ur.subject_type
                    AND prior.subject_id   = ur.subject_id
                    AND prior.id <> ur.id) AS prior_reports_against_subject
        FROM user_reports ur
        LEFT JOIN users u ON u.id = ur.reporter_user_id
        WHERE ur.status = ${status}
        ORDER BY ur.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const [{ count }] = await sql`SELECT COUNT(*) FROM user_reports WHERE status = ${status}`;
      res.json({ reports, total: Number(count), limit, offset });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/admin/reports/:id/resolve — resolve a report
  app.patch("/api/admin/reports/:id/resolve", requireAdminGuard, async (req: any, res: any) => {
    try {

      const { resolution, note } = req.body;
      if (!resolution) return res.status(400).json({ error: "resolution required" });
      await resolveReport({
        reportId: Number(req.params.id),
        adminUserId: req.auth!.userId,
        resolution,
        note,
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── PRD-021 WS-F: Suspension ──────────────────────────────────────────────
  // POST /api/admin/users/:id/suspend
  app.post("/api/admin/users/:id/suspend", requireAdminGuard, async (req: any, res: any) => {
    try {

      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: "reason required" });
      const targetId = Number(req.params.id);
      if (targetId === req.auth!.userId) return res.status(400).json({ error: "Cannot suspend yourself" });
      await suspendUser(targetId, req.auth!.userId, reason);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/users/:id/unsuspend
  app.post("/api/admin/users/:id/unsuspend", requireAdminGuard, async (req: any, res: any) => {
    try {

      const { note } = req.body;
      await unsuspendUser(Number(req.params.id), req.auth!.userId, note ?? "");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-021 WS-F: Blocking ────────────────────────────────────────────────
  // POST /api/me/block/:userId
  app.post("/api/me/block/:userId", requireAuth, async (req: any, res: any) => {
    try {

      await blockUser(req.auth!.userId, Number(req.params.userId));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // DELETE /api/me/block/:userId — unblock
  app.delete("/api/me/block/:userId", requireAuth, async (req: any, res: any) => {
    try {

      await unblockUser(req.auth!.userId, Number(req.params.userId));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/me/blocks — list who I have blocked
  //
  // PRD 1: hydrated. This returned bare ids, so the mobile and web block lists
  // had nothing to render and no second request could fetch the names (the
  // profile endpoints correctly hide blocked users). `blockedIds` is still
  // returned for backwards compatibility with existing clients.
  app.get("/api/me/blocks", requireAuth, async (req: any, res: any) => {
    try {
      const blockedIds = await getBlockList(req.auth!.userId);
      if (!blockedIds.length) return res.json({ blocks: [], blockedIds: [] });

      const sql = neon(process.env.DATABASE_URL!);
      const rows = await sql`
        SELECT ub.blocked_user_id AS user_id,
               ub.created_at      AS blocked_at,
               u.name, u.avatar, u.headline, u.account_status
        FROM user_blocks ub
        LEFT JOIN users u ON u.id = ub.blocked_user_id
        WHERE ub.blocker_user_id = ${req.auth!.userId}
        ORDER BY ub.created_at DESC
      `;
      const blocks = rows.map((r: any) => ({
        userId: Number(r.user_id),
        name: r.name ?? "Deleted user",
        avatar: r.avatar ?? null,
        headline: r.headline ?? null,
        blockedAt: r.blocked_at,
      }));
      res.json({ blocks, blockedIds });
    } catch (e: any) {
      console.error("[me/blocks] Failed:", e?.message);
      res.status(500).json({ error: "Could not load your blocked list." });
    }
  });

  // ─── PRD 1 (Decision 8, contract §G): content flag review queue ───────────
  //
  // Tier-2 moderation is worthless without somewhere to review it. These two
  // endpoints are the founder/admin queue. There is deliberately NO external
  // moderation provider and no new paid dependency (Decision 9) — the SLA in
  // docs/COMMUNITY_GUIDELINES.md is written around one person working this
  // queue by hand.
  app.get("/api/admin/content-flags", requireAdminGuard, async (req: any, res: any) => {
    try {
      const state = typeof req.query.state === "string" ? req.query.state : "pending";
      if (!["pending", "cleared", "removed"].includes(state)) {
        return res.status(400).json({ error: "state must be pending, cleared or removed" });
      }
      const result = await listContentFlags({
        state,
        limit: Number(req.query.limit ?? 50),
        offset: Number(req.query.offset ?? 0),
      });
      res.set("Cache-Control", "private, no-store");
      res.json({ ...result, state });
    } catch (e: any) {
      console.error("[admin/content-flags] Failed:", e?.message);
      res.status(500).json({ error: "Could not load the moderation queue." });
    }
  });

  // PATCH /api/admin/content-flags/:id — resolve one flag.
  //   action 'cleared' -> content stays up, flag closed
  //   action 'removed' -> flag closed AND the post/comment is deleted, with the
  //                       author notified (the same copy the admin feed
  //                       deletion path uses, which now points at guidelines
  //                       that actually exist).
  app.patch("/api/admin/content-flags/:id", requireAdminGuard, async (req: any, res: any) => {
    try {
      const admin = req.auth!.adminUser!;
      const action = req.body?.action;
      if (action !== "cleared" && action !== "removed") {
        return res.status(400).json({ error: "action must be 'cleared' or 'removed'" });
      }
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : undefined;

      const resolved = await resolveContentFlag({
        flagId: Number(req.params.id),
        adminUserId: admin.id,
        action,
        note,
      });
      if (!resolved) return res.status(404).json({ error: "Flag not found or already resolved" });

      if (action === "removed") {
        const sql = neon(process.env.DATABASE_URL!);
        if (resolved.subjectType === "post") {
          await storage.adminDeletePost(resolved.subjectId, admin.id);
          bustFeedCache();
        } else if (resolved.subjectType === "comment") {
          await sql`DELETE FROM post_comments WHERE id = ${resolved.subjectId}`;
        }
        await notify({
          recipientId: resolved.authorUserId,
          actorId: admin.id,
          actorName: "Viewrr",
          actorAvatar: null,
          type: "system",
          message: `Your ${resolved.subjectType} was removed for breaching the Viewrr Community Guidelines. Read them here: ${GUIDELINES_URL}`,
          link: "/feed",
          read: 0,
        });
      }

      res.json({ ok: true, action, subject: resolved });
    } catch (e: any) {
      console.error("[admin/content-flags/resolve] Failed:", e?.message);
      res.status(500).json({ error: "Could not resolve that flag." });
    }
  });

  // PRD-012: Retainer builder + workspace routes
  registerRetainerBuilderRoutes(app);
}

