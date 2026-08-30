import type { Express, Request, Response, NextFunction } from "express";
import { registerRetainerBuilderRoutes } from "./retainer-builder-routes";
import { Server } from "http";
import { storage, db } from "./storage";
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
  VIEWRR_FEE_PERCENT as PAYMENT_FEE_PERCENT,
} from "./payment-service";
import { getDashboardData } from "./services/dashboard.service";
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
  SESSION_COOKIE_NAME, SESSION_TTL_MS,
  getSessionSecret, issueSessionToken, verifySessionToken,
  setSessionCookie, clearSessionCookie,
} from "./session";

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

// Simple password hashing using SHA-256 + salt (no bcrypt needed for this use case)
// NOTE(PRD-016A Phase 1): Replace with Argon2id before mobile launch.
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "viewrr_salt_2026").digest("hex");
}

// ─── P0-02: Safe user DTO ────────────────────────────────────────────────────
// NEVER return the raw DB user row to any client. passwordHash must never appear
// in an API response, log, localStorage value, or analytics event.
function safeUserDto(user: any): Record<string, any> {
  if (!user) return user;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, password_hash, ...safe } = user as any;
  return safe;
}

// PRD-018 E1: Strip internal accreditation fields from public profile responses
function safePublicProfile(profile: any): Record<string, any> {
  if (!profile) return profile;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accreditationNotes, accreditationApprovedBy, accreditationApprovedByName, ...safe } = profile as any;
  return safe;
}

// ─── P0-04: Admin Guard — session-cookie authenticated (Phase 0) ─────────────
// Caller identity is derived ENTIRELY from the HMAC-verified session cookie.
// req.body.userId and req.query.userId are IGNORED for admin authorisation.
// Attack surface: attacker knowing userId=22 gets 401 (no valid cookie).
// Ordinary logged-in user gets 403 (cookie valid, but isAdmin=false in DB).
// SESSION_SECRET-signed tokens provide caller authentication — no separate guard secret needed.
// Phase 1 adds DB token revocation for forced logout.
async function requireAdminGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Step 1: Must present a valid, unexpired HMAC session cookie.
  const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawCookie) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  let secret: string;
  try { secret = getSessionSecret(); } catch {
    res.status(503).json({ error: "Admin routes unavailable — server misconfigured." });
    return;
  }
  const session = verifySessionToken(rawCookie);
  if (!session) {
    clearSessionCookie(res); // clear stale/forged cookie
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  // Step 2: DB lookup by userId from VERIFIED token — client cannot forge this.
  const user = await storage.getUser(session.userId).catch(() => undefined);
  if (!user) { res.status(401).json({ error: "Authentication required." }); return; }
  if (!user.isAdmin) { res.status(403).json({ error: "Forbidden." }); return; }
  req.auth = { userId: session.userId, adminUser: user };
  next();
}

// ─── A0: Caller-Identity Guard ────────────────────────────────────────────────
// Reuses Phase 0 HMAC session cookie (vr_sess) exclusively.
// Sets req.auth!.userId from the VERIFIED token — body/query identity values
// for the CALLER are IGNORED for authentication on all A0-guarded routes.
// Phase 1 (Batch A) replaces this with a DB-backed verifySessionV2 + revocation.
async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawCookie) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const session = verifySessionToken(rawCookie);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  req.auth = { userId: session.userId };
  next();
}

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// In-memory store for verification codes (email -> { code, expires })
const verificationCodes = new Map<string, { code: string; expires: number }>();
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

async function notify(data: Parameters<typeof storage.createNotification>[0]) {
  // 1. Always create in-app notification
  try { await storage.createNotification(data); } catch { /* non-fatal */ }

  // 2. Send email if resend is configured + event is email-worthy
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
  // P0-04: Parse cookies so HMAC session tokens are accessible via req.cookies
  app.use(cookieParser());
  // ─── Version / health ─────────────────────────────────────────────────────
  // ─── P0-07: Rate limiting (Phase 0 emergency) ─────────────────────────────
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

  app.get("/api/version", (_req, res) => res.json({ version: "2026-05-11-agency", features: ["agency", "accountSubtype"] }));

  // ─── Auth (simple demo auth by email) ─────────────────────────────────────
  // P0-01: Null-password path closed | P0-02: safeUserDto | P0-07: loginLimiter
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password." });

    // P0-01: Accounts with no password hash must never authenticate silently.
    if (!user.passwordHash) {
      return res.status(401).json({
        error: "This account does not have a password set. Please use 'Forgot password' to create one.",
        code: "NO_PASSWORD_SET",
      });
    }
    if (!password) return res.status(401).json({ error: "Password required." });
    const hash = hashPassword(password);
    if (hash !== user.passwordHash) return res.status(401).json({ error: "Invalid email or password." });

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
    // P0-02: Strip passwordHash before response. Never return raw DB row.
    // P0-04: Issue HttpOnly HMAC session cookie — caller identity is now server-authoritative.
    setSessionCookie(res, user.id);
    res.json({ user: safeUserDto(user), profile });
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { name, email, role, phone, password } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: "Name, email and role are required" });
      // P0-PRIV: Only permitted public roles. Prevents role=admin/payments_manager injection.
      const ALLOWED_ROLES = ["freelancer", "client"];
      if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "Email already registered" });
      // P0-PRIV: Never set isAdmin from request — always defaults to false in DB.
      const userData: any = { name, email, role };
      if (phone) userData.phone = phone;
      if (password) userData.passwordHash = hashPassword(password);
      const user = await storage.createUser(userData);

      // Auto-create a profile row for freelancers so their dashboard loads correctly
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
          // Non-fatal — user is still created
          console.warn("[register] Could not auto-create profile:", profileErr.message);
        }
      }

      // P0-04: Issue session cookie on registration
      setSessionCookie(res, user.id);
      res.json({ user: safeUserDto(user), profile }); // P0-02
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── P0-04: Logout ────────────────────────────────────────────────────────
  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ─── Email Verification ───────────────────────────────────────────────────
  // PRD-018 H3: verificationLimiter applied
  app.post("/api/auth/send-verification", verificationLimiter, async (req, res) => {
    const { email } = req.body;
    console.log(`[verify] Request received for: ${email}`);
    if (!email) return res.status(400).json({ error: "Email required" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    verificationCodes.set(email.toLowerCase(), { code, expires: Date.now() + 10 * 60 * 1000 }); // 10 min expiry

    if (!resend) {
      // PRD-018 H4: RESEND not configured.
      // NEVER log or return the verification code in production.
      // Development only: log to server console to allow manual testing.
      if (process.env.NODE_ENV !== "production") {
        console.log(`[verify][DEV ONLY] RESEND_API_KEY not set — code for ${email}: ${code}`);
        return res.json({ ok: true, dev: true });
      }
      // Production: fail closed — do not reveal whether Resend is misconfigured
      return res.status(503).json({ error: "Email service unavailable. Please try again later." });
    }

    console.log(`[verify] Sending email via Resend to: ${email}`);
    try {
      await resend.emails.send({
        from: "Viewrr <noreply@viewrr.co.uk>",
        to: email,
        subject: "Your Viewrr verification code",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <div style="margin-bottom:24px;">
              <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      console.error("[verify] Resend error:", e.message, e.statusCode, JSON.stringify(e));
      res.status(500).json({ error: "Failed to send email", detail: e.message });
    }
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

    const code = String(Math.floor(100000 + Math.random() * 900000));
    verificationCodes.set(phone.replace(/\s+/g, ""), { code, expires: Date.now() + 10 * 60 * 1000 });

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

  app.post("/api/auth/verify-code", async (req, res) => {
    const { email, phone, code } = req.body;
    const key = phone ? phone.replace(/\s+/g, "") : email?.toLowerCase();
    if (!key || !code) return res.status(400).json({ error: "Email or phone and code required" });

    const stored = verificationCodes.get(key);
    if (!stored) return res.status(400).json({ error: "No code found — please request a new one" });
    if (Date.now() > stored.expires) {
      verificationCodes.delete(key);
      return res.status(400).json({ error: "Code expired — please request a new one" });
    }
    if (stored.code !== String(code).trim()) {
      return res.status(400).json({ error: "Incorrect code" });
    }

    verificationCodes.delete(key);
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
      // SELECT...FOR UPDATE row lock: concurrent attempts race; only the first wins.
      const result = await storage.atomicConsumeTokenAndResetPassword(tokenHash, hashPassword(newPassword));
      if (!result.ok) {
        const msg = result.reason === "used"
          ? "This reset link has already been used. Please request a new one."
          : "Invalid or expired reset link. Please request a new one.";
        return res.status(400).json({ error: msg });
      }
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

    // ─── Profiles ──────────────────────────────────────────────────────────────
  app.get("/api/profiles", async (req, res) => {
    const { specialism, availability, search } = req.query as Record<string, string>;
    const profiles = await storage.getProfiles({ specialism, availability, search });
    // PRD-018 E5: override stale projectCount with DB-authoritative completed-project count
    const userIds = profiles.map((p: any) => p.profile.userId as number);
    const countMap = await storage.getCompletedProjectCountsBulk(userIds);
    // PRD-018 E2: strip accreditation fields from public list
    res.json(profiles.map((p: any) => ({
      ...p,
      profile: { ...safePublicProfile(p.profile), projectCount: countMap.get(p.profile.userId) ?? 0 },
    })));
  });

  app.get("/api/profiles/featured", async (req, res) => {
    const profiles = await storage.getFeaturedProfiles();
    // PRD-018 E5: override stale projectCount with DB-authoritative count
    const userIds = profiles.map((p: any) => p.profile.userId as number);
    const countMap = await storage.getCompletedProjectCountsBulk(userIds);
    res.json(profiles.map((p: any) => ({
      ...p,
      profile: { ...p.profile, projectCount: countMap.get(p.profile.userId) ?? 0 },
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
        user: userOnly,
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
    res.json({ ...pw, profile: safeProfile, reviews });
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
  app.get("/api/interest-messages/:interestId", async (req, res) => {
    const interestId = Number(req.params.interestId);
    const userId = Number(req.query.userId);
    const msgs = await storage.getMessagesByInterest(interestId);
    if (userId) await storage.markInterestMessagesRead(interestId, userId);
    res.json(msgs);
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
        });
      }
      res.json(msg);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Direct messages (general) ────────────────────────────────────────────
  // A0-M1
  app.get("/api/messages/:userId/conversations", requireAuth, async (req, res) => {
    if (req.auth!.userId !== Number(req.params.userId)) return res.status(403).json({ error: "Forbidden." });
    const convs = await storage.getConversations(req.auth!.userId);
    res.json(convs);
  });

  // A0-M2
  app.get("/api/messages/:fromId/:toId", requireAuth, async (req, res) => {
    const fromId = Number(req.params.fromId);
    const toId = Number(req.params.toId);
    // Caller must be one of the two parties
    if (req.auth!.userId !== fromId && req.auth!.userId !== toId) return res.status(403).json({ error: "Forbidden." });
    const msgs = await storage.getMessagesBetween(fromId, toId);
    await storage.markMessagesRead(fromId, toId);
    res.json(msgs);
  });

  // A0-M3
  app.post("/api/messages", requireAuth, async (req, res) => {
    try {
      const data = insertMessageSchema.parse(req.body);
      // A0: caller must be the sender
      if (req.auth!.userId !== Number(data.fromId)) return res.status(403).json({ error: "Forbidden." });
      const msg = await storage.createMessage(data);
      // Notify recipient of new message
      const actor = await storage.getUser(data.fromId);
      if (actor) {
        await notify({
          recipientId: data.toId,
          actorId: actor.id,
          actorName: actor.name,
          actorAvatar: actor.avatar ?? null,
          type: "message",
          message: `${actor.name} sent you a message`,
          link: `/dashboard`,
          read: 0,
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

  app.get("/api/users/:id", async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(safeUserDto(user)); // P0-02
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

  // ── Feed cache (2-min TTL, keyed by viewerUserId|offset|limit) ─────────────
  const feedCache = new Map<string, { data: any; etag: string; expiresAt: number }>();
  function bustFeedCache() { feedCache.clear(); }

  // Feed
  app.get("/api/feed", async (req, res) => {
    const limit = Number(req.query.limit) || 10;
    const offset = Number(req.query.offset) || 0;
    const viewerUserId = req.query.viewerUserId ? Number(req.query.viewerUserId) : undefined;
    const cacheKey = `${viewerUserId ?? "anon"}|${offset}|${limit}`;
    const cached = feedCache.get(cacheKey);
    const now = Date.now();

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

    const data = await storage.getFeedPosts(limit, offset, viewerUserId);
    const etag = `"feed-${cacheKey}-${now}"`;
    feedCache.set(cacheKey, { data, etag, expiresAt: now + 120_000 });
    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
    res.json(data);
  });

  // PRD-018 A6: requireAuth + session-derived userId
  app.post("/api/feed", requireAuth, async (req, res) => {
    try {
      const data = insertPostSchema.parse({ ...req.body, userId: req.auth!.userId });
      const post = await storage.createPost(data);
      const pw = await storage.getPost(post.id);
      bustFeedCache();
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
      message: "Your post was removed by Viewrr for violating our community guidelines.",
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
  app.post("/api/feed/:id/like", requireAuth, async (req, res) => {
    const userId = req.auth!.userId;
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
        });
      }
    }
    res.json({ liked, likeCount: post?.post.likeCount ?? 0 });
  });

  app.get("/api/feed/:id/comments", async (req, res) => {
    res.json(await storage.getComments(Number(req.params.id)));
  });

  // PRD-018 A6: requireAuth + session-derived userId
  app.post("/api/feed/:id/comments", requireAuth, async (req, res) => {
    try {
      const data = insertPostCommentSchema.parse({ ...req.body, userId: req.auth!.userId, postId: Number(req.params.id) });
      const comment = await storage.createComment(data);
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
  app.get("/api/projects", async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });
    try {
      const projects = await storage.getProjectsForUser(Number(userId));
      res.json(projects);
    } catch (e: any) {
      console.error("[projects] Error fetching projects for user", userId, e.message);
      res.status(500).json({ error: "Could not load projects", projects: [] });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    const pw = await storage.getProject(Number(req.params.id));
    if (!pw) return res.status(404).json({ error: "Project not found" });
    res.json(pw);
  });

  // PRD-018 A8: requireAuth + verify caller is a party on the project being created
  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const data = insertProjectSchema.parse(req.body);
      // A8: caller must be either the clientId or freelancerId in the submitted data
      if (data.clientId !== req.auth!.userId && data.freelancerId !== req.auth!.userId) {
        return res.status(403).json({ error: "You must be the client or freelancer on the project" });
      }
      const project = await storage.createProject(data);
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

  app.get("/api/projects/:id/updates", async (req, res) => {
    res.json(await storage.getProjectUpdates(Number(req.params.id)));
  });

  // ─── Meetings ──────────────────────────────────────────────────────────────────
  // GET all meetings for a project
  app.get("/api/projects/:id/meetings", async (req, res) => {
    try {
      const meetings = await storage.getMeetingsForProject(Number(req.params.id));
      res.json(meetings);
    } catch (e) {
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

  // Get invitations for user
  app.get("/api/invitations", async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });
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
  app.get("/api/projects/:id/retainer/cycles", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const cycles = await storage.getRetainerCycles(projectId);
      res.json(cycles);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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
      const cycle = await storage.updateRetainerCycle(Number(cycleId), {
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
      const cycle = await storage.updateRetainerCycle(Number(cycleId), {
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
      await storage.updateRetainerCycle(Number(cycleId), { status: "paused" });
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
      await storage.updateRetainerCycle(Number(cycleId), { status: "active" });
      await storage.updateProjectStatus(projectId, "active");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-014: Dynamic Project Stages ─────────────────────────────────────

  // GET /api/projects/:id/stages — list all custom stages
  app.get("/api/projects/:id/stages", async (req, res) => {
    try {
      const stages = await getProjectStages(Number(req.params.id));
      res.json(stages);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
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
          type: "stage_advanced", message: `The project plan for "${pw.project.title}" has been updated`, link: "/your-work", read: 0 });
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
          link: "/your-work", read: 0 });
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
        link: "/your-work", read: 0 });
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
        link: "/your-work", read: 0 });
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
        link: "/your-work", read: 0 });
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
        link: "/your-work", read: 0 });
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
        link: "/your-work", read: 0 });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/projects/:id/plan-summary — for plan review screen
  app.get("/api/projects/:id/plan-summary", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
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
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Deliverables ──────────────────────────────────────────────────────────
  app.get("/api/projects/:id/deliverables", async (req, res) => {
    const list = await storage.getDeliverables(Number(req.params.id));
    res.json(list);
  });

  // PRD-018 A20: requireAuth + session-derived createdBy
  app.post("/api/projects/:id/deliverables", requireAuth, async (req, res) => {
    const { url, label, platform, embedUrl } = req.body;
    if (!url || !label || !platform || !embedUrl) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const d = await storage.addDeliverable({
      projectId: Number(req.params.id),
      url, label, platform, embedUrl,
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
  app.get("/api/projects/:id/time-entries", async (req, res) => {
    try {
      const entries = await storage.getTimeEntriesByProject(Number(req.params.id));
      res.json(entries);
    } catch (e) {
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
    let briefs = await storage.getBriefs();
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

  app.post("/api/briefs", requireAuth, briefLimiter, async (req, res) => {
    try {
      const data = insertBriefSchema.parse(req.body);
      const brief = await storage.createBrief(data);
      res.json(brief);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Brief Interests ───────────────────────────────────────────────────────
  // Freelancer expresses interest in a brief
  app.post("/api/interests", requireAuth, interestLimiter, async (req, res) => {
    try {
      const data = insertBriefInterestSchema.parse(req.body);
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
        await storage.createProject({
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
      const notifs = await storage.getNotifications(req.auth!.userId);
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
  app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      await storage.markNotificationRead(Number(req.params.id));
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
          ON CONFLICT (user_id, terms_version_id) DO UPDATE SET accepted_at = NOW()::TEXT
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
          // FR-10: P0 event handlers
          switch (event.type) {

            case "payment_intent.succeeded": {
              const intent = event.data.object as Stripe.PaymentIntent;
              await handlePaymentIntentSucceeded(intent, correlationId);
              break;
            }

            case "payment_intent.payment_failed": {
              const intent = event.data.object as Stripe.PaymentIntent;
              const viewrrPaymentId = intent.metadata?.viewrr_payment_id;
              if (viewrrPaymentId) {
                // Update payment status to failed
                const sqlClient = neon(process.env.DATABASE_URL!);
                await sqlClient(
                  "UPDATE payments SET status='failed', failed_at=$1, version=version+1 WHERE public_id=$2 AND status NOT IN ('succeeded','refunded')",
                  [new Date().toISOString(), viewrrPaymentId]
                );
                await auditLog({
                  actorType: "webhook",
                  action: "payment_intent_failed",
                  afterState: { paymentIntentId: intent.id, failureCode: intent.last_payment_error?.code },
                  correlationId,
                });
              }
              break;
            }

            case "payment_intent.canceled": {
              const intent = event.data.object as Stripe.PaymentIntent;
              const viewrrPaymentId = intent.metadata?.viewrr_payment_id;
              if (viewrrPaymentId) {
                const sqlClient = neon(process.env.DATABASE_URL!);
                await sqlClient(
                  "UPDATE payments SET status='cancelled', cancelled_at=$1, version=version+1 WHERE public_id=$2",
                  [new Date().toISOString(), viewrrPaymentId]
                );
              }
              break;
            }

            case "charge.refunded": {
              // Handled by refund workflow — log for audit
              const charge = event.data.object as Stripe.Charge;
              console.log("[webhook] charge.refunded:", charge.id, "amount_refunded:", charge.amount_refunded);
              break;
            }

            case "refund.created":
            case "refund.updated": {
              const refund = event.data.object as Stripe.Refund;
              const viewrrRefundId = refund.metadata?.viewrr_refund_id;
              if (viewrrRefundId && refund.status) {
                const sqlClient = neon(process.env.DATABASE_URL!);
                const newStatus = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" ? "failed" : "processing";
                await sqlClient(
                  "UPDATE payment_refunds SET status=$1, stripe_refund_id=$2 WHERE public_id=$3",
                  [newStatus, refund.id, viewrrRefundId]
                );
              }
              break;
            }

            case "transfer.reversed": {
              const transfer = event.data.object as Stripe.Transfer;
              const sqlClient = neon(process.env.DATABASE_URL!);
              await sqlClient(
                "UPDATE payment_transfers SET status='partially_reversed', reversed_pence=$1 WHERE stripe_transfer_id=$2",
                [transfer.amount_reversed, transfer.id]
              );
              break;
            }

            // FR-13: account.updated — sync readiness + release held earnings
            case "account.updated": {
              const account = event.data.object as Stripe.Account;
              const viewrrUserId = Number(account.metadata?.viewrr_user_id);
              if (!viewrrUserId) break;

              const user = await storage.getUser(viewrrUserId);
              if (!user) break;

              // Sync Connect account state
              await syncConnectAccount(viewrrUserId, account.id);

              const isReady =
                account.charges_enabled === true &&
                (account.capabilities as any)?.transfers === "active";

              if (isReady) {
                // FR-12: NO 35p payout clock transfer
                // FR-08: release held earnings from ledger (not stripePendingPence)
                await releaseHeldEarnings(viewrrUserId, account.id, correlationId);
                await storage.createNotification({
                  recipientId: viewrrUserId,
                  actorId: viewrrUserId,
                  actorName: "Viewrr",
                  actorAvatar: null,
                  type: "payment_received",
                  // FR-16: accurate messaging — "allocated to Stripe balance" not "paid to bank"
                  message: "Your Stripe account is verified. Any pending earnings have been allocated to your Stripe balance.",
                  link: "/your-work",
                  read: 0,
                });
              }
              break;
            }

            // FR-10: P1 payout events
            case "payout.created":
            case "payout.updated":
            case "payout.paid":
            case "payout.failed": {
              const payout = event.data.object as Stripe.Payout;
              // Find freelancer by connected account
              const accountId = (event as any).account as string | undefined;
              if (accountId) {
                const sqlClient = neon(process.env.DATABASE_URL!);
                const users = await sqlClient(
                  "SELECT id FROM users WHERE stripe_account_id = $1 LIMIT 1",
                  [accountId]
                );
                if (users.length) {
                  const freelancerId = users[0].id;
                  const status =
                    event.type === "payout.paid" ? "paid" :
                    event.type === "payout.failed" ? "failed" :
                    event.type === "payout.created" ? "pending" : "in_transit";

                  await sqlClient(
                    `INSERT INTO payment_payouts (freelancer_id, stripe_payout_id, amount_pence, currency, status, arrival_date, failure_code, created_at, paid_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (stripe_payout_id) DO UPDATE SET status=$5, paid_at=$9`,
                    [
                      freelancerId,
                      payout.id,
                      payout.amount,
                      payout.currency,
                      status,
                      payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
                      (payout as any).failure_code ?? null,
                      new Date().toISOString(),
                      event.type === "payout.paid" ? new Date().toISOString() : null,
                    ]
                  );

                  // FR-09 (PRD-011): enriched payout notifications
                  if (event.type === "payout.paid") {
                    await storage.createNotification({
                      recipientId: freelancerId, actorId: null, actorName: "Viewrr", actorAvatar: null,
                      type: "payment_received",
                      message: `✅ Payment Complete — Your earnings of £${(payout.amount / 100).toFixed(2)} have successfully reached your bank account.`,
                      link: "/your-work", read: 0,
                    });
                  } else if (event.type === "payout.created" || event.type === "payout.updated") {
                    const isInTransit = (event.data.object as any).status === "in_transit";
                    if (isInTransit) {
                      const arrivalStr = payout.arrival_date
                        ? new Date(payout.arrival_date * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                        : null;
                      await storage.createNotification({
                        recipientId: freelancerId, actorId: null, actorName: "Viewrr", actorAvatar: null,
                        type: "payment_received",
                        message: `💸 Your payout is on its way — Stripe has initiated your payout of £${(payout.amount / 100).toFixed(2)}.${arrivalStr ? ` Estimated bank arrival: ${arrivalStr}.` : ""}`,
                        link: "/your-work", read: 0,
                      });
                    }
                  } else if (event.type === "payout.failed") {
                    await storage.createNotification({
                      recipientId: freelancerId, actorId: null, actorName: "Viewrr", actorAvatar: null,
                      type: "payment_received",
                      message: `A payout of £${(payout.amount / 100).toFixed(2)} failed. Please check your bank details in your Stripe account.`,
                      link: "/your-work", read: 0,
                    });
                  }
                }
              }
              break;
            }

            // FR-09 (PRD-011): notify freelancer when funds become available
            case "balance.available": {
              const accountId = (event as any).account as string | undefined;
              if (accountId) {
                const sqlClient = neon(process.env.DATABASE_URL!);
                const users = await sqlClient(
                  "SELECT id FROM users WHERE stripe_account_id = $1 LIMIT 1",
                  [accountId]
                );
                if (users.length) {
                  const freelancerId = users[0].id;
                  const balanceObj = event.data.object as any;
                  const available = (balanceObj.available ?? []).find((b: any) => b.currency === "gbp");
                  const amountPence = available?.amount ?? 0;
                  if (amountPence > 0) {
                    await storage.createNotification({
                      recipientId: freelancerId, actorId: null, actorName: "Viewrr", actorAvatar: null,
                      type: "payment_received",
                      message: `🎉 Your earnings are now available — Stripe has released £${(amountPence / 100).toFixed(2)} and will automatically send it to your bank according to your payout schedule.`,
                      link: "/your-work", read: 0,
                    });
                  }
                }
              }
              break;
            }

            case "charge.dispute.created": {
              const dispute = event.data.object as Stripe.Dispute;
              console.warn("[webhook] Dispute created:", dispute.id, "charge:", dispute.charge);
              // Alert admin — in production this would create an admin exception record
              await auditLog({
                actorType: "webhook",
                action: "dispute_created",
                afterState: { disputeId: dispute.id, chargeId: dispute.charge, amount: dispute.amount },
                correlationId,
              });
              break;
            }

            // ── PRD-013: Pro Viewrr subscription lifecycle events ──────────────
            case "customer.subscription.updated":
            case "customer.subscription.created": {
              const sub = event.data.object as any;
              const viewrrUserId = sub.metadata?.viewrr_user_id
                ? Number(sub.metadata.viewrr_user_id) : undefined;
              if (sub.status === "active") {
                await activateProFromWebhook(
                  sub.id,
                  sub.customer as string,
                  event.id,
                  sub.current_period_start,
                  sub.current_period_end,
                  viewrrUserId,
                );
              } else if (sub.status === "past_due" || sub.status === "unpaid") {
                await markProPaymentFailed(sub.id, event.id);
              } else if (sub.status === "canceled") {
                await expireProEntitlement(sub.id, event.id);
              }
              break;
            }
            case "customer.subscription.deleted": {
              const sub = event.data.object as any;
              await expireProEntitlement(sub.id, event.id);
              break;
            }
            case "invoice.payment_succeeded": {
              const inv = event.data.object as any;
              if (inv.subscription) {
                // Renewal — update period
                try {
                  const stripeClient = stripe;
                  const stripeSub = await stripeClient.subscriptions.retrieve(inv.subscription as string);
                  await renewProFromWebhook(
                    stripeSub.id,
                    stripeSub.customer as string,
                    event.id,
                    stripeSub.current_period_start,
                    stripeSub.current_period_end,
                  );
                } catch (e) { console.error("[pro-renew]", e); }
              }
              break;
            }
            case "invoice.payment_failed": {
              const inv = event.data.object as any;
              if (inv.subscription) {
                await markProPaymentFailed(inv.subscription as string, event.id);
              }
              break;
            }

            default:
              // Log unhandled event types for observability
              console.log("[webhook] Unhandled event type:", event.type);
          }

          await markEventProcessed(event.id);

        } catch (processingError: any) {
          console.error("[webhook] Processing error:", processingError.message);
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
      const prefs = await (storage as any).upsertNotifPrefs(req.auth!.userId, req.body);
      res.json(prefs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      await db`
        INSERT INTO terms_acceptances (user_id, terms_version_id, document, version, context, ip_address, user_agent)
        VALUES (${req.auth!.userId}, ${tv[0].id}, ${document}, ${version}, ${context ?? "manual"}, ${ip}, ${ua})
        ON CONFLICT (user_id, terms_version_id) DO UPDATE SET accepted_at = NOW()::TEXT
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

  // Start the worker (non-blocking)
  startWorker();

  // PRD-012: Retainer builder + workspace routes
  registerRetainerBuilderRoutes(app);
}

