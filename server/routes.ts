import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
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
import crypto from "crypto";
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
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "viewrr_salt_2026").digest("hex");
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
  // ─── Version / health ─────────────────────────────────────────────────────
  app.get("/api/version", (_req, res) => res.json({ version: "2026-05-11-agency", features: ["agency", "accountSubtype"] }));

  // ─── Auth (simple demo auth by email) ─────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = await storage.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "No account found with that email" });
    // Check password if the account has one set
    if (user.passwordHash && password) {
      const hash = hashPassword(password);
      if (hash !== user.passwordHash) return res.status(401).json({ error: "Incorrect password" });
    } else if (user.passwordHash && !password) {
      return res.status(401).json({ error: "Password required" });
    }
    let profile = user.role === "freelancer" ? await storage.getProfileByUserId(user.id) : null;
    // Safety net: auto-create profile if a freelancer somehow has none
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
    res.json({ user, profile });
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { name, email, role, phone, password } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: "Name, email and role are required" });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "Email already registered" });
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

      res.json({ user, profile });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Email Verification ───────────────────────────────────────────────────
  app.post("/api/auth/send-verification", async (req, res) => {
    const { email } = req.body;
    console.log(`[verify] Request received for: ${email}`);
    if (!email) return res.status(400).json({ error: "Email required" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    verificationCodes.set(email.toLowerCase(), { code, expires: Date.now() + 10 * 60 * 1000 }); // 10 min expiry

    if (!resend) {
      console.log(`[verify] RESEND_API_KEY not set — code for ${email}: ${code}`);
      return res.json({ ok: true, dev: true, code });
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

  // Send verification code via SMS (phone)
  app.post("/api/auth/send-sms-verification", async (req, res) => {
    const { phone, email } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    // Store against phone number as key
    verificationCodes.set(phone.replace(/\s+/g, ""), { code, expires: Date.now() + 10 * 60 * 1000 });

    // For now send via email to the provided email as fallback (Twilio can be added later)
    // If no Resend, just log
    if (!resend || !email) {
      console.log(`[verify-sms] Code for ${phone}: ${code}`);
      return res.json({ ok: true, dev: true });
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

  // ─── Password reset ────────────────────────────────────────────────────────
  // Step 1: user requests reset — we re-use the existing send-verification endpoint
  // Step 2: verify-code endpoint is also reused (no new code needed)
  // Step 3: set new password once code is verified
  app.post("/api/auth/reset-password", async (req, res) => {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error: "Email and new password required" });
    if (newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const user = await storage.getUserByEmail(email.toLowerCase());
    if (!user) return res.status(404).json({ error: "No account found with that email" });

    await storage.updateUserPassword(user.id, hashPassword(newPassword));
    res.json({ ok: true });
  });

  // ─── File uploads ──────────────────────────────────────────────────────
  // Max 50 MB per file, images and videos only
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
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
        cb(null, true);
      } else {
        cb(new Error("Only images and videos are allowed"));
      }
    },
  });

  // Portfolio upload — accepts up to 12 files, returns their server paths/URLs
  app.post("/api/upload/portfolio",
    upload.array("files", 12),
    (req: any, res: any) => {
      try {
        const files: Express.Multer.File[] = req.files as Express.Multer.File[];
        if (!files || files.length === 0) return res.status(400).json({ error: "No files received" });
        const result = files.map(f => ({
          filename: f.filename,
          originalName: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          // On Render, /tmp is ephemeral — stored temporarily during the session
          path: f.path,
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
      return res.status(413).json({ error: "File too large. Maximum size is 50 MB per file." });
    }
    if (err?.message) return res.status(400).json({ error: err.message });
    next(err);
  });

    // ─── Profiles ──────────────────────────────────────────────────────────────
  app.get("/api/profiles", async (req, res) => {
    const { specialism, availability, search } = req.query as Record<string, string>;
    const profiles = await storage.getProfiles({ specialism, availability, search });
    res.json(profiles);
  });

  app.get("/api/profiles/featured", async (req, res) => {
    res.json(await storage.getFeaturedProfiles());
  });

  // ─── Profile Views ───────────────────────────────────────────────────────
  // Called by ProfilePage on load — records one view per viewer per 24h
  app.post("/api/profile-views/:id", async (req, res) => {
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
      res.json(profile);
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
    res.json({ ...pw, reviews });
  });

  app.patch("/api/profiles/:id", async (req, res) => {
    const updated = await storage.updateProfile(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    res.json(updated);
  });

  // ─── Reviews ──────────────────────────────────────────────────────────────
  app.post("/api/reviews", async (req, res) => {
    try {
      const data = insertReviewSchema.parse(req.body);
      // Prevent duplicate reviews for the same project by the same reviewer
      if (data.projectId) {
        const existing = await storage.getReviewsByProfile(data.profileId);
        const dupe = existing.find(r => r.projectId === data.projectId && r.clientId === data.clientId);
        if (dupe) return res.status(409).json({ error: "Review already submitted for this project" });
      }
      const review = await storage.createReview(data);
      // Mark review given on the project
      if (data.projectId && req.body.role) {
        await storage.markReviewGiven(data.projectId, req.body.role as "client" | "freelancer");
      }
      // Notify the reviewee
      const revieweeProfile = await storage.getProfileByUserId(data.profileId);
      if (revieweeProfile) {
        await storage.createNotification({
          recipientId: revieweeProfile.userId,
          actorId: data.clientId,
          actorName: data.clientName,
          actorAvatar: data.clientAvatar || null,
          type: "review",
          message: `${data.clientName} left you a ${data.rating}-star review`,
          link: "/dashboard",
          read: 0,
        });
      }
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

  app.post("/api/interest-messages", async (req, res) => {
    try {
      const { fromId, toId, content, interestId, briefTitle } = req.body;
      if (!fromId || !toId || !content || !interestId) {
        return res.status(400).json({ error: "Missing fields" });
      }
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
  app.get("/api/messages/:userId/conversations", async (req, res) => {
    const convs = await storage.getConversations(Number(req.params.userId));
    res.json(convs);
  });

  app.get("/api/messages/:fromId/:toId", async (req, res) => {
    const msgs = await storage.getMessagesBetween(Number(req.params.fromId), Number(req.params.toId));
    await storage.markMessagesRead(Number(req.params.fromId), Number(req.params.toId));
    res.json(msgs);
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const data = insertMessageSchema.parse(req.body);
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

  app.post("/api/saved/toggle", async (req, res) => {
    const { clientId, profileId } = req.body;
    const saved = await storage.toggleSaved(Number(clientId), Number(profileId));
    res.json({ saved });
  });

  app.get("/api/saved/:clientId/:profileId", async (req, res) => {
    const saved = await storage.isSaved(Number(req.params.clientId), Number(req.params.profileId));
    res.json({ saved });
  });

  // ─── AI Search ────────────────────────────────────────────────────────────
  app.post("/api/ai-search", async (req, res) => {
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
    res.json(user);
  });

  app.patch("/api/users/:id", async (req, res) => {
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
      res.json(updated);
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

  app.post("/api/feed", async (req, res) => {
    try {
      const data = insertPostSchema.parse(req.body);
      const post = await storage.createPost(data);
      const pw = await storage.getPost(post.id);
      bustFeedCache();
      res.json(pw);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/feed/:id", async (req, res) => {
    const { userId, caption, tags } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const post = await storage.updatePost(Number(req.params.id), Number(userId), caption ?? "", tags ?? "[]");
    if (!post) return res.status(403).json({ error: "Not allowed" });
    const pw = await storage.getPost(post.id);
    res.json(pw);
  });

  app.delete("/api/feed/:id", async (req, res) => {
    const { userId } = req.body;
    const ok = await storage.deletePost(Number(req.params.id), Number(userId));
    if (!ok) return res.status(403).json({ error: "Not allowed" });
    bustFeedCache();
    res.json({ success: true });
  });

  // Admin-only: remove any post + notify the owner
  app.delete("/api/admin/feed/:id", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const admin = await storage.getUser(Number(userId));
    if (!admin || !admin.isAdmin) return res.status(403).json({ error: "Admin only" });
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
  app.get("/api/admin/deleted-posts", async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });
    const admin = await storage.getUser(userId);
    if (!admin || !admin.isAdmin) return res.status(403).json({ error: "Admin only" });
    const log = await storage.getDeletedPosts();
    res.json(log);
  });

  app.post("/api/feed/:id/like", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const liked = await storage.toggleLike(Number(req.params.id), Number(userId));
    const post = await storage.getPost(Number(req.params.id));
    // Notify post owner when someone likes (not when unliking, not self-like)
    if (liked && post && post.post.userId !== Number(userId)) {
      const actor = await storage.getUser(Number(userId));
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

  app.post("/api/feed/:id/comments", async (req, res) => {
    try {
      const data = insertPostCommentSchema.parse({ ...req.body, postId: Number(req.params.id) });
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

  // ─── Pro Viewrr Subscription ─────────────────────────────────────────────
  // In a real app this would hit Stripe. For demo: toggle isPro on the profile.
  app.post("/api/pro/subscribe", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const profile = await storage.getProfileByUserId(Number(userId));
    if (!profile) return res.status(404).json({ error: "Profile not found. Only freelancers can subscribe." });
    const updated = await storage.subscribePro(profile.id);
    res.json({ success: true, profile: updated });
  });

  app.get("/api/pro/status/:userId", async (req, res) => {
    const profile = await storage.getProfileByUserId(Number(req.params.userId));
    if (!profile) return res.json({ isPro: false });
    res.json({ isPro: profile.isPro === 1, proSince: profile.proSince });
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

  app.post("/api/projects", async (req, res) => {
    try {
      const data = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(data);
      const full = await storage.getProject(project.id);
      res.json(full);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Confirm final payment → marks project completed ──────────────────────
  app.post("/api/projects/:id/confirm-payment", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const { clientId } = req.body;
      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });
      if (pw.project.clientId !== Number(clientId)) {
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

  app.post("/api/projects/:id/advance", async (req, res) => {
    try {
      const { note, authorId } = req.body;
      const callerId = Number(authorId);
      if (!callerId) return res.status(400).json({ error: "authorId required" });
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

  app.post("/api/projects/:id/updates", async (req, res) => {
    try {
      const data = insertProjectUpdateSchema.parse({ ...req.body, projectId: Number(req.params.id) });
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
  app.post("/api/projects/:id/meetings", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const { createdBy, title, scheduledAt, isInstant } = req.body;
      if (!createdBy) return res.status(400).json({ error: "createdBy required" });

      // Generate a unique Google Meet link using a random room code
      const roomId = `viewrr-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
      const meetLink = `https://meet.google.com/${roomId}`;

      const meeting = await storage.createMeeting({
        projectId,
        createdBy: Number(createdBy),
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
  app.patch("/api/meetings/:id/cancel", async (req, res) => {
    try {
      await storage.cancelMeeting(Number(req.params.id));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to cancel meeting" });
    }
  });

  // ─── Project Invitations ────────────────────────────────────────────────────

  // Create invitation
  app.post("/api/invitations", async (req, res) => {
    try {
      const { senderId, recipientId, title, description, category, budget, timeline, startStage,
              isRetainer, billingCycle, deliverablesPerCycle, totalCycles } = req.body;
      if (!senderId || !recipientId || !title) return res.status(400).json({ error: "Missing fields" });
      const inv = await storage.createInvitation({
        senderId: Number(senderId), recipientId: Number(recipientId),
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
      const sender = await storage.getUser(Number(senderId));
      await notify({
        recipientId: Number(recipientId),
        actorId: Number(senderId),
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
  app.patch("/api/invitations/:id/accept", async (req, res) => {
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
  app.patch("/api/invitations/:id/decline", async (req, res) => {
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
  app.post("/api/projects/:id/retainer/submit-cycle", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
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
  app.post("/api/projects/:id/retainer/signoff-cycle", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
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
  app.post("/api/projects/:id/retainer/pay-cycle", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const projectId = Number(req.params.id);
      const { cycleId, clientUserId, amountPence } = req.body;
      if (!cycleId || !clientUserId || !amountPence) {
        return res.status(400).json({ error: "cycleId, clientUserId, and amountPence required" });
      }

      const pw = await storage.getProject(projectId);
      if (!pw) return res.status(404).json({ error: "Project not found" });

      const freelancer = await storage.getUser(pw.project.freelancerId);
      if (!freelancer) return res.status(404).json({ error: "Freelancer not found" });

      const platformFeePence = Math.round(Number(amountPence) * (VIEWRR_FEE_PERCENT / 100));
      const freelancerPence = Number(amountPence) - platformFeePence;

      // Ensure freelancer has a Stripe account
      let stripeAccountId = freelancer.stripeAccountId;
      if (!stripeAccountId) {
        const acct = await stripe.accounts.create({
          type: "express", country: "GB", email: freelancer.email,
          business_type: "individual",
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { viewrr_user_id: String(freelancer.id) },
        });
        stripeAccountId = acct.id;
        await storage.updateStripeAccount(freelancer.id, { stripeAccountId: acct.id, stripeOnboarded: 0 });
      }

      let useDirectTransfer = false;
      try {
        const acct = await stripe.accounts.retrieve(stripeAccountId);
        useDirectTransfer = acct.charges_enabled === true && acct.capabilities?.transfers === "active";
      } catch {}

      const clientUser = await storage.getUser(Number(clientUserId));
      const intentParams: Stripe.PaymentIntentCreateParams = {
        amount: Number(amountPence),
        currency: "gbp",
        automatic_payment_methods: { enabled: true },
        receipt_email: clientUser?.email,
        description: `${pw.project.title} — Retainer Cycle`,
        metadata: {
          projectId: String(projectId),
          cycleId: String(cycleId),
          freelancerId: String(freelancer.id),
          clientUserId: String(clientUserId),
          payment_type: useDirectTransfer ? "direct_transfer" : "platform_held",
          viewrr_fee_pence: String(platformFeePence),
          freelancer_pence: String(freelancerPence),
          retainer_cycle: "true",
        },
        ...(useDirectTransfer ? {
          application_fee_amount: platformFeePence,
          transfer_data: { destination: stripeAccountId },
        } : {}),
      };

      const intent = await stripe.paymentIntents.create(intentParams);

      return res.json({
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        amountPence: Number(amountPence),
        freelancerOnboarded: useDirectTransfer,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
        requiresStripeConfirm: true,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST pause retainer
  app.post("/api/projects/:id/retainer/pause", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const { cycleId } = req.body;
      await storage.updateRetainerCycle(Number(cycleId), { status: "paused" });
      await storage.updateProjectStatus(projectId, "paused");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST resume retainer
  app.post("/api/projects/:id/retainer/resume", async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const { cycleId } = req.body;
      await storage.updateRetainerCycle(Number(cycleId), { status: "active" });
      await storage.updateProjectStatus(projectId, "active");
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Deliverables ──────────────────────────────────────────────────────────
  app.get("/api/projects/:id/deliverables", async (req, res) => {
    const list = await storage.getDeliverables(Number(req.params.id));
    res.json(list);
  });

  app.post("/api/projects/:id/deliverables", async (req, res) => {
    const { url, label, platform, embedUrl, createdBy } = req.body;
    if (!url || !label || !platform || !embedUrl || !createdBy) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const d = await storage.addDeliverable({
      projectId: Number(req.params.id),
      url, label, platform, embedUrl,
      createdBy: Number(createdBy),
    });
    res.json(d);
  });

  app.delete("/api/deliverables/:id", async (req, res) => {
    const { userId } = req.body;
    const ok = await storage.deleteDeliverable(Number(req.params.id), Number(userId));
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
  app.post("/api/projects/:id/time-entries", async (req, res) => {
    try {
      const { userId, agencyId, description, minutes, billable, loggedAt } = req.body;
      if (!userId || !minutes || !loggedAt) {
        return res.status(400).json({ error: "userId, minutes, and loggedAt are required" });
      }
      const entry = await storage.createTimeEntry({
        projectId: Number(req.params.id),
        userId: Number(userId),
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
  app.patch("/api/time-entries/:id", async (req, res) => {
    try {
      const { userId, ...data } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const updated = await storage.updateTimeEntry(Number(req.params.id), Number(userId), data);
      if (!updated) return res.status(403).json({ error: "Not found or not allowed" });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: "Failed to update time entry" });
    }
  });

  // DELETE /api/time-entries/:id — delete a time entry (owner only)
  app.delete("/api/time-entries/:id", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const ok = await storage.deleteTimeEntry(Number(req.params.id), Number(userId));
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

  app.post("/api/briefs", async (req, res) => {
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
  app.post("/api/interests", async (req, res) => {
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
  app.patch("/api/interests/:id/counter", async (req, res) => {
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
  app.patch("/api/interests/:id/accept-counter", async (req, res) => {
    try {
      const interest = await storage.getBriefInterest(Number(req.params.id));
      if (!interest) return res.status(404).json({ error: "Not found" });
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
  app.patch("/api/interests/:id/status", async (req, res) => {
    try {
      const { status, clientName, clientAvatar, clientUserId } = req.body;
      if (!["pending", "viewed", "accepted", "declined"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const interest = await storage.getBriefInterest(Number(req.params.id));
      if (!interest) return res.status(404).json({ error: "Interest not found" });
      // Only the brief owner (client) can change status to accepted/declined
      if (["accepted", "declined"].includes(status) && clientUserId && interest.briefClientId !== Number(clientUserId)) {
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
  app.get("/api/notifications/:userId", async (req, res) => {
    try {
      const notifs = await storage.getNotifications(Number(req.params.userId));
      res.json(notifs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get unread count only (for polling)
  app.get("/api/notifications/:userId/unread-count", async (req, res) => {
    try {
      const count = await storage.getUnreadNotificationCount(Number(req.params.userId));
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark a single notification as read
  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      await storage.markNotificationRead(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mark ALL notifications as read for a user
  app.patch("/api/notifications/user/:userId/read-all", async (req, res) => {
    try {
      await storage.markAllNotificationsRead(Number(req.params.userId));
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

  app.post("/api/workspace/tasks", async (req, res) => {
    try {
      const task = await storage.createTask(req.body);
      res.json(task);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/workspace/tasks/:id", async (req, res) => {
    try {
      const { userId, ...data } = req.body;
      const task = await storage.updateTask(Number(req.params.id), Number(userId), data);
      if (!task) return res.status(404).json({ error: "Not found" });
      res.json(task);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/workspace/tasks/:id", async (req, res) => {
    try {
      const ok = await storage.deleteTask(Number(req.params.id), Number(req.body.userId));
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

  app.post("/api/workspace/events", async (req, res) => {
    try {
      const event = await storage.createCalendarEvent(req.body);
      res.json(event);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/workspace/events/:id", async (req, res) => {
    try {
      const { userId, ...data } = req.body;
      const event = await storage.updateCalendarEvent(Number(req.params.id), Number(userId), data);
      if (!event) return res.status(404).json({ error: "Not found" });
      res.json(event);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/workspace/events/:id", async (req, res) => {
    try {
      const ok = await storage.deleteCalendarEvent(Number(req.params.id), Number(req.body.userId));
      if (!ok) return res.status(403).json({ error: "Not allowed" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ─── Connection Requests (LinkedIn-style) ───────────────────────────────────

  // Send a connection request
  app.post("/api/connections/request", async (req, res) => {
    try {
      const { senderId, recipientId } = req.body;
      if (!senderId || !recipientId) return res.status(400).json({ error: "Missing fields" });
      if (senderId === recipientId) return res.status(400).json({ error: "Cannot connect with yourself" });
      // Check if already accepted
      const already = await storage.isConnected(Number(senderId), Number(recipientId));
      if (already) return res.status(409).json({ error: "Already connected" });
      const req2 = await storage.sendConnectionRequest(Number(senderId), Number(recipientId));
      // Notify recipient
      const sender = await storage.getUser(Number(senderId));
      if (sender) {
        await notify({
          recipientId: Number(recipientId),
          actorId: Number(senderId),
          actorName: sender.name,
          actorAvatar: sender.avatar ?? null,
          type: "connection_request",
          message: `${sender.name} sent you a connection request`,
          link: "/dashboard",
          read: 0,
        });
      }
      res.json(req2);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Accept / decline a connection request
  app.patch("/api/connections/request/:id", async (req, res) => {
    try {
      const { status } = req.body; // 'accepted' | 'declined'
      if (!['accepted','declined'].includes(status)) return res.status(400).json({ error: "Invalid status" });
      await storage.respondToConnectionRequest(Number(req.params.id), status);
      // If accepted, notify the original sender
      if (status === 'accepted') {
        // Fetch the request to get IDs
        const allConns = await storage.getPendingConnectionRequests(0); // won't work for accepted
        // Use a direct DB fetch approach — get from DB by id
        // Instead notify via the responderId stored in req.body
        const { responderId } = req.body;
        if (responderId) {
          const responder = await storage.getUser(Number(responderId));
          const reqRow = await storage.getConnectionRequestBetween(Number(responderId), Number(responderId)); // fallback
          // We'll get sender from id via a lookup below
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Better accept/decline route with proper notification
  app.post("/api/connections/respond", async (req, res) => {
    try {
      const { requestId, responderId, status } = req.body;
      if (!requestId || !responderId || !['accepted','declined'].includes(status)) {
        return res.status(400).json({ error: "Missing or invalid fields" });
      }
      await storage.respondToConnectionRequest(Number(requestId), status);
      if (status === 'accepted') {
        // Look up sender — need to read the request row
        // We don't have a getConnectionRequestById, so use getPendingRequests won't help
        // Instead: notify via the responderId's name to the other party
        const responder = await storage.getUser(Number(responderId));
        // Get the request row by searching
        const conns = await storage.getConnections(Number(responderId));
        // Just send a general notification
        if (responder) {
          // Find the sender by checking connections (the new connection)
          const allConns2 = await storage.getConnections(Number(responderId));
          // The sender is someone who is now connected to responderId
          // We'll track it via senderId in req.body
          const { senderId } = req.body;
          if (senderId) {
            await notify({
              recipientId: Number(senderId),
              actorId: Number(responderId),
              actorName: responder.name,
              actorAvatar: responder.avatar ?? null,
              type: "connection_accepted",
              message: `${responder.name} accepted your connection request`,
              link: "/dashboard",
              read: 0,
            });
          }
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
      const req2 = await storage.getConnectionRequestBetween(userA, userB);
      res.json({ status: req2?.status ?? 'none', requestId: req2?.id ?? null, senderId: req2?.senderId ?? null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Remove a connection
  app.delete("/api/connections", async (req, res) => {
    try {
      const { userA, userB } = req.body;
      if (!userA || !userB) return res.status(400).json({ error: "Missing fields" });
      await storage.removeConnection(Number(userA), Number(userB));
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
  app.post("/api/stripe/connect-account", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const { userId, termsAccepted } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      if (!termsAccepted) return res.status(400).json({ error: "You must accept the payment terms before connecting Stripe" });

      const user = await storage.getUser(Number(userId));
      if (!user) return res.status(404).json({ error: "User not found" });
      // FR-02: must be a freelancer
      if (user.role !== "freelancer") return res.status(403).json({ error: "Only freelancers can connect Stripe" });

      if (user.stripeAccountId) {
        // Re-use existing account — sync readiness state
        const connectState = await syncConnectAccount(user.id, user.stripeAccountId).catch(() => null);
        return res.json({
          accountId: user.stripeAccountId,
          readinessState: connectState?.readinessState ?? "verification_pending",
          alreadyExists: true,
        });
      }

      // FR-07: deterministic idempotency key
      const idempotencyKey = `connect_account:${userId}:v1`;
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        email: user.email,
        business_type: "individual",
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { product_description: "Freelance creative services via Viewrr" },
        metadata: { viewrr_user_id: String(userId) },
      }, { idempotencyKey });

      // Store in legacy field for backward compat + new connect accounts table
      await storage.updateStripeAccount(user.id, { stripeAccountId: account.id, stripeOnboarded: 0 });
      await syncConnectAccount(user.id, account.id);

      await auditLog({
        actorType: "user",
        actorId: user.id,
        action: "stripe_account_created",
        afterState: { stripeAccountId: account.id },
      });

      res.json({ accountId: account.id, readinessState: "onboarding_required" });
    } catch (e: any) {
      console.error("[stripe/connect-account]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // FR-14: Onboarding link — FR-02: no userId in path/body (use body for now, validated against DB)
  app.post("/api/stripe/onboarding-link", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });

      const user = await storage.getUser(Number(userId));
      if (!user || !user.stripeAccountId)
        return res.status(404).json({ error: "No Stripe account found. Connect Stripe first." });
      if (user.role !== "freelancer")
        return res.status(403).json({ error: "Only freelancers can access onboarding links" });

      const link = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: `${APP_BASE_URL}/#/your-work?stripe=refresh`,
        return_url: `${APP_BASE_URL}/#/your-work?stripe=complete`,
        type: "account_onboarding",
      });

      res.json({ url: link.url });
    } catch (e: any) {
      console.error("[stripe/onboarding-link]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // FR-13: Full Connect readiness status (richer than before)
  app.get("/api/stripe/status/:userId", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const userId = Number(req.params.userId);

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      if (!user.stripeAccountId) {
        return res.json({
          connected: false,
          readinessState: "not_created",
          chargesEnabled: false,
          payoutsEnabled: false,
          transfersReady: false,
          pendingRequirements: [],
        });
      }

      // Sync from Stripe
      const connectState = await syncConnectAccount(userId, user.stripeAccountId);

      res.json({
        connected: true,
        readinessState: connectState.readinessState,
        detailsSubmitted: connectState.detailsSubmitted === 1,
        chargesEnabled: connectState.chargesEnabled === 1,
        payoutsEnabled: connectState.payoutsEnabled === 1,
        transfersReady: connectState.readinessState === "transfers_ready" || connectState.readinessState === "payouts_ready",
        currentlyDue: JSON.parse(connectState.currentlyDue ?? "[]"),
        pastDue: JSON.parse(connectState.pastDue ?? "[]"),
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
  app.post("/api/projects/:projectId/payments", async (req, res) => {
    try {
      const { invoiceId, clientUserId } = req.body;
      const projectId = Number(req.params.projectId);
      if (!invoiceId) return res.status(400).json({ error: "invoiceId required" });
      // clientUserId supplied by frontend (no sessions) — validated against project ownership
      if (!clientUserId) return res.status(400).json({ error: "clientUserId required" });

      const result = await createPayment(projectId, Number(invoiceId), Number(clientUserId));
      res.json(result);
    } catch (e: any) {
      const status = (e as any).status ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  // Payment status endpoint (FR-03: browser polls this after stripe.confirmPayment)
  app.get("/api/payments/:publicId", async (req, res) => {
    try {
      const { userId } = req.query;
      // Load payment — returning only what the requesting party can see
      const db = (await import("./payment-service")).reconcilePayment; // just to ensure service loaded
      const neonClient = neon(process.env.DATABASE_URL!);
      const rows = await neonClient(
        "SELECT * FROM payments WHERE public_id = $1 LIMIT 1",
        [req.params.publicId]
      );
      if (!rows.length) return res.status(404).json({ error: "Payment not found" });
      const p = rows[0];
      // Only client or freelancer on the project can view
      const uid = Number(userId);
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
  app.post("/api/stripe/create-payment-intent", async (req, res) => {
    try {
      const { projectId, amountPence: _ignore, clientUserId } = req.body;
      if (!projectId || !clientUserId)
        return res.status(400).json({ error: "projectId and clientUserId required" });

      // Find or create the invoice for this project
      const inv = await storage.getInvoiceByProject(Number(projectId));
      if (!inv) return res.status(400).json({ error: "No invoice found for this project. Please create an invoice first." });

      const result = await createPayment(Number(projectId), inv.id, Number(clientUserId));
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
  app.post("/api/stripe/confirm-intent", async (req, res) => {
    try {
      const { paymentIntentId, projectId, clientUserId } = req.body;
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
    (req, res, next) => {
      let data = Buffer.alloc(0);
      req.on("data", chunk => { data = Buffer.concat([data, chunk]); });
      req.on("end",  () => { (req as any).rawBody = data; next(); });
    },
    async (req, res) => {
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

        // Acknowledge receipt immediately (Stripe requires 200 within 30s)
        // Processing happens synchronously here but with idempotency guard
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

                  if (event.type === "payout.paid") {
                    // FR-16: accurate "Stripe has marked your payout as paid"
                    await storage.createNotification({
                      recipientId: freelancerId,
                      actorId: null,
                      actorName: "Viewrr",
                      actorAvatar: null,
                      type: "payment_received",
                      message: `Stripe has marked your payout of £${(payout.amount / 100).toFixed(2)} as paid.`,
                      link: "/your-work",
                      read: 0,
                    });
                  } else if (event.type === "payout.failed") {
                    await storage.createNotification({
                      recipientId: freelancerId,
                      actorId: null,
                      actorName: "Viewrr",
                      actorAvatar: null,
                      type: "payment_received",
                      message: `A payout of £${(payout.amount / 100).toFixed(2)} failed. Please check your Stripe account.`,
                      link: "/your-work",
                      read: 0,
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

            default:
              // Log unhandled event types for observability
              console.log("[webhook] Unhandled event type:", event.type);
          }

          await markEventProcessed(event.id);
          res.json({ received: true });

        } catch (processingError: any) {
          console.error("[webhook] Processing error:", processingError.message);
          await markEventProcessed(event.id, processingError.message);
          // Still return 200 to prevent Stripe retrying — we handle internally
          res.json({ received: true, error: "processing_failed" });
        }

      } catch (e: any) {
        console.error("[stripe/webhook] Fatal error:", e.message);
        res.status(500).json({ error: e.message });
      }
    }
  );

  // ─── PRD-007: Admin Refund & Reconciliation Routes ────────────────────────────

  // FR-05: Admin-only refund endpoint
  app.post("/api/admin/payments/:paymentPublicId/refunds", async (req, res) => {
    try {
      const { userId, amountPence, reasonCode, internalNote, notifyParties } = req.body;
      if (!userId) return res.status(401).json({ error: "userId required" });
      const admin = await storage.getUser(Number(userId));
      if (!admin?.isAdmin) return res.status(403).json({ error: "Admin access required" });

      const refund = await initiateRefund({
        paymentPublicId: req.params.paymentPublicId,
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
  app.post("/api/admin/payments/:paymentId/reconcile", async (req, res) => {
    try {
      const { userId } = req.body;
      const admin = await storage.getUser(Number(userId));
      if (!admin?.isAdmin) return res.status(403).json({ error: "Admin access required" });

      const result = await reconcilePayment(Number(req.params.paymentId));
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Admin ledger view
  app.get("/api/admin/payments", async (req, res) => {
    try {
      const { userId } = req.query;
      const admin = await storage.getUser(Number(userId));
      if (!admin?.isAdmin) return res.status(403).json({ error: "Admin access required" });

      const sqlClient = neon(process.env.DATABASE_URL!);
      const rows = await sqlClient(
        "SELECT p.*, pt.stripe_transfer_id, pt.status as transfer_status, pt.reversed_pence FROM payments p LEFT JOIN payment_transfers pt ON pt.payment_id = p.id ORDER BY p.created_at DESC LIMIT 100"
      );
      res.json({ payments: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/payments/:paymentPublicId", async (req, res) => {
    try {
      const { userId } = req.query;
      const admin = await storage.getUser(Number(userId));
      if (!admin?.isAdmin) return res.status(403).json({ error: "Admin access required" });

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
  app.post("/api/agencies", async (req, res) => {
    try {
      const { ownerUserId, name, bio, specialisms, reelUrl, location, website } = req.body;
      if (!ownerUserId || !name) return res.status(400).json({ error: "ownerUserId and name are required" });

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
      res.json({ agency, members });
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
  app.post("/api/agencies/:id/join", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.id);
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });

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
  app.post("/api/agencies/members/:memberId/approve", async (req, res) => {
    try {
      const memberId = parseInt(req.params.memberId);
      const { userId } = req.body;

      await storage.approveAgencyMember(memberId);

      if (userId) {
        const memberRecord = await storage.getAgencyMemberByUser(userId);
        if (memberRecord) {
          await storage.updateUserAgencyFields(userId, { accountSubtype: "agency_member", agencyId: memberRecord.agencyId });
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/agencies/:agencyId/members/:userId — owner removes a member
  app.delete("/api/agencies/:agencyId/members/:userId", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.agencyId);
      const userId = parseInt(req.params.userId);
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
      res.json(dashboard);
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
  app.patch("/api/agencies/:agencyId/members/:memberId/rate", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.agencyId);
      const memberId = parseInt(req.params.memberId);
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
  app.patch("/api/agencies/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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
        .where(drizzleSql`${schema.agencyBriefs.clientId} = ${clientId} AND ${schema.agencyBriefs.status} IN ('proposal_sent', 'won', 'lost')`);
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
  app.post("/api/agencies/:id/briefs", async (req, res) => {
    try {
      const agencyId = parseInt(req.params.id);
      const { clientId, clientName, clientAvatar, title, description, category, budgetMin, budgetMax, startDate, duration, requirements } = req.body;
      if (!clientId || !title || !description) return res.status(400).json({ error: "clientId, title and description are required" });
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
  app.patch("/api/agencies/briefs/:briefId/status", async (req, res) => {
    try {
      const briefId = parseInt(req.params.briefId);
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
  app.post("/api/agencies/briefs/:briefId/proposal", async (req, res) => {
    try {
      const briefId = parseInt(req.params.briefId);
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
  app.patch("/api/agencies/proposals/:proposalId/status", async (req, res) => {
    try {
      const proposalId = parseInt(req.params.proposalId);
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
  app.get('/api/invoice-template', async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId query param required' });
    const template = await storage.getInvoiceTemplate(userId);
    res.json(template || null);
  });

  // POST /api/invoice-template — create or update template
  app.post('/api/invoice-template', async (req, res) => {
    try {
      const { userId, ...rest } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const template = await storage.upsertInvoiceTemplate(Number(userId), rest);
      res.json(template);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Invoices ──────────────────────────────────────────────────────────────────

  // GET /api/projects/:id/invoice — get the invoice for a project
  app.get('/api/projects/:id/invoice', async (req, res) => {
    try {
      const invoice = await storage.getInvoiceByProject(Number(req.params.id));
      if (!invoice) return res.status(404).json({ error: 'No invoice found' });
      // Also attach the freelancer's template for rendering
      const template = await storage.getInvoiceTemplate(invoice.freelancerId);
      res.json({ invoice, template: template || null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/projects/:id/invoice — freelancer sends invoice
  app.post('/api/projects/:id/invoice', async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const { freelancerId, clientId, clientName, clientEmail, projectTitle, lineItems, notes, vatPercent } = req.body;
      if (!freelancerId || !clientId || !lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ error: 'freelancerId, clientId and lineItems required' });
      }
      // Calculate totals
      const subtotalPence = lineItems.reduce((sum: number, item: any) => sum + (item.totalPence || 0), 0);
      const vatPence = vatPercent ? Math.round(subtotalPence * vatPercent / 100) : 0;
      const totalPence = subtotalPence + vatPence;
      // Get next invoice number
      const invoiceNumber = await storage.getNextInvoiceNumber(Number(freelancerId));
      const invoice = await storage.createInvoice({
        invoiceNumber,
        projectId,
        freelancerId: Number(freelancerId),
        clientId: Number(clientId),
        clientName: clientName || '',
        clientEmail: clientEmail || '',
        projectTitle: projectTitle || '',
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
        const freelancer = await storage.getUser(Number(freelancerId));
        await notify({
          recipientId: Number(clientId),
          actorId: Number(freelancerId),
          actorName: freelancer?.name ?? "Freelancer",
          actorAvatar: freelancer?.avatar ?? null,
          type: "invoice_sent",
          message: `Your invoice for "${projectTitle || 'your project'}" is ready to view`,
          link: `/invoice/${projectId}`,
          read: 0,
        });
      } catch {}
      res.json(invoice);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/invoices/:id/paid — mark invoice paid (called when Stripe payment confirmed)
  app.patch('/api/invoices/:id/paid', async (req, res) => {
    try {
      await storage.markInvoicePaid(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Founder Dashboard API ────────────────────────────────────────────────────
  app.get('/api/admin/dashboard', async (req, res) => {
    // Guard: only admin users
    const userId = Number(req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await storage.getUserById(userId);
    if (!user || !user.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    try {
      const data = await getDashboardData();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/users', async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const requester = await storage.getUserById(userId);
    if (!requester || !requester.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/projects', async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const requester = await storage.getUserById(userId);
    if (!requester || !requester.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Accreditation API ────────────────────────────────────────────────────────

  /** GET /api/admin/accreditation — all freelancer profiles with accreditation data */
  app.get('/api/admin/accreditation', async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const requester = await storage.getUserById(userId);
    if (!requester || !requester.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    try {
      const profiles = await storage.getFreelancerProfilesWithAccreditation();
      res.json(profiles);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/admin/accreditation/history — recent audit log */
  app.get('/api/admin/accreditation/history', async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const requester = await storage.getUserById(userId);
    if (!requester || !requester.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    try {
      const history = await storage.getAllAccreditationHistory(100);
      res.json(history);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/admin/accreditation/history/:freelancerUserId — history for one freelancer */
  app.get('/api/admin/accreditation/history/:freelancerUserId', async (req, res) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const requester = await storage.getUserById(userId);
    if (!requester || !requester.isAdmin) return res.status(403).json({ error: 'Forbidden' });
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
  app.post('/api/admin/accreditation/update', async (req, res) => {
    const { userId, freelancerUserId, profileId, newLevel, action, reason, internalNotes } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const requester = await storage.getUserById(Number(userId));
    if (!requester || !requester.isAdmin) return res.status(403).json({ error: 'Forbidden — only Founders may modify accreditations.' });

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
  app.patch('/api/admin/accreditation/notes', async (req, res) => {
    const { userId, profileId, internalNotes } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const requester = await storage.getUserById(Number(userId));
    if (!requester || !requester.isAdmin) return res.status(403).json({ error: 'Forbidden' });
    try {
      await storage.updateAccreditationNotes(Number(profileId), internalNotes ?? '');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PRD-006: Notification Preferences (inlined inside registerRoutes) ────
  app.get("/api/notifications/preferences/:userId", async (req, res) => {
    try {
      const prefs = await (storage as any).getNotifPrefs(Number(req.params.userId));
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

  app.patch("/api/notifications/preferences/:userId", async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const prefs = await (storage as any).upsertNotifPrefs(userId, req.body);
      res.json(prefs);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

