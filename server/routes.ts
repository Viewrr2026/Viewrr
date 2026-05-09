import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
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
import { insertUserSchema, insertReviewSchema, insertMessageSchema, insertPostSchema, insertPostCommentSchema, insertProjectSchema, insertProjectUpdateSchema, insertBriefSchema, insertBriefInterestSchema } from "@shared/schema";

// Helper: fire-and-forget notification (never throws)
async function notify(data: Parameters<typeof storage.createNotification>[0]) {
  try { await storage.createNotification(data); } catch { /* non-fatal */ }
}

export async function registerRoutes(httpServer: Server, app: Express) {
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
    const { note, authorId } = req.body;
    const updated = await storage.advanceProjectStage(Number(req.params.id), note || "", Number(authorId));
    if (!updated) return res.status(404).json({ error: "Project not found" });
    res.json(await storage.getProject(updated.id));
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
      const projectId = Number(req.params.id);
      const { cycleId } = req.body;
      // Mark the cycle as paid
      await storage.updateRetainerCycle(Number(cycleId), {
        status: "paid",
        paymentStatus: "paid",
      });
      // Check if there's a totalCycles limit
      const projRows = await storage.getProject(projectId);
      const proj = projRows?.project;
      if (proj?.totalCycles && (proj.currentCycleNumber ?? 1) >= proj.totalCycles) {
        // All cycles done — complete the retainer
        await storage.updateProjectStatus(projectId, "completed", "paid");
        return res.json({ done: true, completed: true });
      }
      // Auto-start the next cycle
      const nextCycle = await storage.startNextCycle(projectId);
      res.json({ done: true, nextCycle });
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

  // ─── Briefs ────────────────────────────────────────────────────────────────
  app.get("/api/briefs", async (req, res) => {
    const { category, location } = req.query;
    let briefs = await storage.getBriefs();
    if (category && category !== "All") briefs = briefs.filter(b => b.category === category);
    if (location) briefs = briefs.filter(b => b.location.toLowerCase().includes(String(location).toLowerCase()));
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
      const { status, clientName, clientAvatar } = req.body;
      if (!["pending", "viewed", "accepted", "declined"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const interest = await storage.getBriefInterest(Number(req.params.id));
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
          await storage.createProject({
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
  app.post("/api/stripe/connect-account", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });

      const user = await storage.getUser(Number(userId));
      if (!user) return res.status(404).json({ error: "User not found" });

      // Re-use existing account if already created
      if (user.stripeAccountId) {
        try {
          const existing = await stripe.accounts.retrieve(user.stripeAccountId);
          return res.json({
            accountId: user.stripeAccountId,
            onboarded: user.stripeOnboarded === 1,
            chargesEnabled: existing.charges_enabled,
          });
        } catch {
          // Account no longer exists in Stripe — create a fresh one
        }
      }

      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        email: user.email,
        business_type: "individual",
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { product_description: "Freelance creative services via Viewrr" },
        settings: { payouts: { schedule: { interval: "manual" } } },
        metadata: { viewrr_user_id: String(userId) },
      });

      await storage.updateStripeAccount(Number(userId), { stripeAccountId: account.id, stripeOnboarded: 0 });

      return res.json({ accountId: account.id, onboarded: false });
    } catch (e: any) {
      console.error("[stripe/connect-account]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 2. Generate onboarding link so freelancer can enter their bank details
  app.post("/api/stripe/onboarding-link", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });

      const user = await storage.getUser(Number(userId));
      if (!user?.stripeAccountId) return res.status(400).json({ error: "No Stripe account found. Create one first." });

      const link = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: `${APP_BASE_URL}/your-work?stripe=refresh`,
        return_url:  `${APP_BASE_URL}/your-work?stripe=complete`,
        type: "account_onboarding",
      });

      res.json({ url: link.url });
    } catch (e: any) {
      console.error("[stripe/onboarding-link]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 3. Check onboarding status
  app.get("/api/stripe/status/:userId", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const user = await storage.getUser(Number(req.params.userId));
      if (!user) return res.status(404).json({ error: "User not found" });

      if (!user.stripeAccountId) {
        return res.json({ connected: false, onboarded: false, pendingPence: 0 });
      }

      const account = await stripe.accounts.retrieve(user.stripeAccountId);
      const fullyOnboarded = account.charges_enabled === true && account.capabilities?.transfers === "active";

      // Sync onboarded status if it changed
      if (fullyOnboarded && user.stripeOnboarded !== 1) {
        await storage.updateStripeAccount(Number(req.params.userId), { stripeOnboarded: 1 });
      }

      res.json({
        connected: true,
        onboarded: fullyOnboarded,
        chargesEnabled: account.charges_enabled,
        pendingPence: user.stripePendingPence ?? 0,
      });
    } catch (e: any) {
      console.error("[stripe/status]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 4. Create a Stripe Checkout payment session (client pays freelancer)
  app.post("/api/stripe/create-payment", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const { projectId, amountPence, currency = "gbp", clientUserId, description } = req.body;
      if (!projectId || !amountPence || !clientUserId) {
        return res.status(400).json({ error: "projectId, amountPence, clientUserId required" });
      }

      const pw = await storage.getProject(Number(projectId));
      if (!pw) return res.status(404).json({ error: "Project not found" });

      const freelancer = await storage.getUser(pw.project.freelancerId);
      if (!freelancer) return res.status(404).json({ error: "Freelancer not found" });

      const platformFeePence = Math.round(amountPence * (VIEWRR_FEE_PERCENT / 100));
      const freelancerPence  = amountPence - platformFeePence;

      // Check if freelancer has a verified Stripe account
      let useDirectTransfer = false;
      if (freelancer.stripeAccountId) {
        try {
          const acct = await stripe.accounts.retrieve(freelancer.stripeAccountId);
          useDirectTransfer = acct.charges_enabled === true && acct.capabilities?.transfers === "active";
        } catch { /* account check failed — fall through to platform-held */ }
      }

      // If freelancer has no account yet, create one silently (deferred onboarding)
      if (!freelancer.stripeAccountId) {
        const acct = await stripe.accounts.create({
          type: "express", country: "GB", email: freelancer.email,
          business_type: "individual",
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          business_profile: { product_description: "Freelance creative services via Viewrr" },
          settings: { payouts: { schedule: { interval: "manual" } } },
          metadata: { viewrr_user_id: String(freelancer.id) },
        });
        await storage.updateStripeAccount(freelancer.id, { stripeAccountId: acct.id, stripeOnboarded: 0 });
      }

      const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = useDirectTransfer
        ? {
            application_fee_amount: platformFeePence,
            transfer_data: { destination: freelancer.stripeAccountId! },
            metadata: {
              projectId: String(projectId),
              freelancerId: String(freelancer.id),
              clientUserId: String(clientUserId),
              payment_type: "direct_transfer",
              viewrr_fee_pence: String(platformFeePence),
              freelancer_pence: String(freelancerPence),
            },
          }
        : {
            metadata: {
              projectId: String(projectId),
              freelancerId: String(freelancer.id),
              clientUserId: String(clientUserId),
              payment_type: "platform_held",
              viewrr_fee_pence: String(platformFeePence),
              freelancer_pence: String(freelancerPence),
              transfer_when_ready: "true",
            },
          };

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [{
          price_data: {
            currency,
            product_data: {
              name: description ?? pw.project.title,
              description: `Viewrr project payment — ${pw.project.title}`,
            },
            unit_amount: amountPence,
          },
          quantity: 1,
        }],
        payment_intent_data: paymentIntentData,
        success_url: `${APP_BASE_URL}/your-work?payment=success&project=${projectId}`,
        cancel_url:  `${APP_BASE_URL}/your-work?payment=cancelled&project=${projectId}`,
        customer_email: (await storage.getUser(Number(clientUserId)))?.email,
        metadata: {
          projectId: String(projectId),
          clientUserId: String(clientUserId),
          freelancerId: String(freelancer.id),
        },
      });

      res.json({
        url: session.url,
        sessionId: session.id,
        paymentStrategy: useDirectTransfer ? "direct_transfer" : "platform_held",
        freelancerOnboarded: useDirectTransfer,
      });
    } catch (e: any) {
      console.error("[stripe/create-payment]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 5b. Create Payment Intent — for embedded card form (no redirect)
  app.post("/api/stripe/create-payment-intent", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const { projectId, amountPence, clientUserId } = req.body;
      if (!projectId || !amountPence || !clientUserId)
        return res.status(400).json({ error: "projectId, amountPence, clientUserId required" });

      const pw = await storage.getProject(Number(projectId));
      if (!pw) return res.status(404).json({ error: "Project not found" });

      const freelancer = await storage.getUser(pw.project.freelancerId);
      if (!freelancer) return res.status(404).json({ error: "Freelancer not found" });

      const platformFeePence = Math.round(amountPence * (VIEWRR_FEE_PERCENT / 100));
      const freelancerPence  = amountPence - platformFeePence;

      // Ensure freelancer has a Stripe account (create silently if not)
      let stripeAccountId = freelancer.stripeAccountId;
      if (!stripeAccountId) {
        const acct = await stripe.accounts.create({
          type: "express", country: "GB", email: freelancer.email,
          business_type: "individual",
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          business_profile: { product_description: "Freelance creative services via Viewrr" },
          settings: { payouts: { schedule: { interval: "manual" } } },
          metadata: { viewrr_user_id: String(freelancer.id) },
        });
        stripeAccountId = acct.id;
        await storage.updateStripeAccount(freelancer.id, { stripeAccountId: acct.id, stripeOnboarded: 0 });
      }

      // Check if freelancer is fully verified for direct transfer
      let useDirectTransfer = false;
      try {
        const acct = await stripe.accounts.retrieve(stripeAccountId);
        useDirectTransfer = acct.charges_enabled === true && acct.capabilities?.transfers === "active";
      } catch { /* fall through */ }

      const clientUser = await storage.getUser(Number(clientUserId));

      const intentParams: Stripe.PaymentIntentCreateParams = {
        amount: amountPence,
        currency: "gbp",
        automatic_payment_methods: { enabled: true },
        receipt_email: clientUser?.email,
        description: pw.project.title,
        metadata: {
          projectId: String(projectId),
          freelancerId: String(freelancer.id),
          clientUserId: String(clientUserId),
          payment_type: useDirectTransfer ? "direct_transfer" : "platform_held",
          viewrr_fee_pence: String(platformFeePence),
          freelancer_pence: String(freelancerPence),
          transfer_when_ready: useDirectTransfer ? "false" : "true",
        },
        ...(useDirectTransfer ? {
          application_fee_amount: platformFeePence,
          transfer_data: { destination: stripeAccountId },
        } : {}),
      };

      const intent = await stripe.paymentIntents.create(intentParams);

      res.json({
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        amountPence,
        freelancerOnboarded: useDirectTransfer,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
      });
    } catch (e: any) {
      console.error("[stripe/create-payment-intent]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 5c. Confirm payment after successful intent (mark project paid)
  app.post("/api/stripe/confirm-intent", async (req, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
      const { paymentIntentId, projectId, clientUserId } = req.body;
      if (!paymentIntentId || !projectId)
        return res.status(400).json({ error: "paymentIntentId and projectId required" });

      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.status !== "succeeded")
        return res.status(400).json({ error: `Payment not succeeded: ${intent.status}` });

      const pw = await storage.getProject(Number(projectId));
      if (!pw) return res.status(404).json({ error: "Project not found" });

      const freelancer = await storage.getUser(pw.project.freelancerId);
      const amountPence = intent.amount;
      const freelancerPence = Number(intent.metadata?.freelancer_pence ?? amountPence);
      const paymentType = intent.metadata?.payment_type;

      // Update project to completed + paid
      await storage.updateProject(Number(projectId), {
        status: "completed",
        paymentStatus: "paid",
      });

      // If freelancer is fully onboarded, transfer immediately
      if (paymentType === "direct_transfer") {
        // Transfer already set up via transfer_data on the intent
      } else if (freelancer?.stripeAccountId) {
        // Platform-held: try to transfer now if they're verified
        try {
          const acct = await stripe.accounts.retrieve(freelancer.stripeAccountId);
          if (acct.charges_enabled && acct.capabilities?.transfers === "active") {
            await stripe.transfers.create({
              amount: freelancerPence,
              currency: "gbp",
              destination: freelancer.stripeAccountId,
              source_transaction: typeof intent.latest_charge === "string" ? intent.latest_charge : undefined,
              metadata: { projectId: String(projectId), viewrr_transfer: "on_confirm" },
            });
            await storage.updateStripeAccount(freelancer.id, { stripePendingPence: 0 });
          } else {
            // Hold it — add to pending
            const current = freelancer.stripePendingPence ?? 0;
            await storage.updateStripeAccount(freelancer.id, { stripePendingPence: current + freelancerPence });
          }
        } catch (te: any) {
          console.error("[confirm-intent] transfer error", te.message);
          const current = freelancer.stripePendingPence ?? 0;
          await storage.updateStripeAccount(freelancer.id, { stripePendingPence: current + freelancerPence });
        }
      }

      res.json({ ok: true, projectStatus: "completed", paymentStatus: "paid" });
    } catch (e: any) {
      console.error("[stripe/confirm-intent]", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 5. Webhook — MUST use raw body parser (registered before JSON middleware)
  // Note: this route reads raw bytes; Express json() middleware must NOT parse it
  app.post("/api/stripe/webhook",
    (req, res, next) => {
      let data = Buffer.alloc(0);
      req.on("data", chunk => { data = Buffer.concat([data, chunk]); });
      req.on("end",  () => { (req as any).rawBody = data; next(); });
    },
    async (req, res) => {
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

        // ─ checkout.session.completed ─────────────────────────────────────
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as Stripe.Checkout.Session;
          const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string);
          const meta = pi.metadata;

          if (meta.payment_type === "platform_held") {
            const freelancerId = Number(meta.freelancerId);
            const freelancerPence = Number(meta.freelancer_pence ?? 0);
            const user = await storage.getUser(freelancerId);
            if (user) {
              const newPending = (user.stripePendingPence ?? 0) + freelancerPence;
              await storage.updateStripeAccount(freelancerId, { stripePendingPence: newPending });
              console.log(`[webhook] Holding ${freelancerPence}p for freelancer ${freelancerId} (total: ${newPending}p)`);
            }
            // Mark project as paid
            const projectId = Number(meta.projectId);
            if (projectId) {
              await storage.updateProject(projectId, { status: "completed", paymentStatus: "paid" } as any);
            }
          } else if (meta.payment_type === "direct_transfer") {
            // Direct transfer — just mark project paid
            const projectId = Number(meta.projectId);
            if (projectId) {
              await storage.updateProject(projectId, { status: "completed", paymentStatus: "paid" } as any);
            }
            console.log(`[webhook] Direct transfer complete for project ${meta.projectId}`);
          }

          // Notify both parties
          const projectId = Number(meta.projectId);
          if (projectId) {
            const pw = await storage.getProject(projectId);
            if (pw) {
              await notify({
                recipientId: pw.project.freelancerId,
                actorId: pw.project.clientId,
                actorName: pw.client.name,
                actorAvatar: pw.client.avatar ?? null,
                type: "payment_received",
                message: `Payment received for "${pw.project.title}"`,
                link: "/your-work",
                read: 0,
              });
            }
          }
        }

        // ─ account.updated (freelancer completed onboarding) ──────────────
        if (event.type === "account.updated") {
          const account = event.data.object as Stripe.Account;
          const fullyVerified = account.charges_enabled === true && account.capabilities?.transfers === "active";
          if (!fullyVerified) return res.json({ received: true });

          // Find the user by stripeAccountId
          // We stored viewrr_user_id in metadata at account creation
          const viewrrUserId = Number(account.metadata?.viewrr_user_id);
          if (!viewrrUserId) return res.json({ received: true });

          const user = await storage.getUser(viewrrUserId);
          if (!user) return res.json({ received: true });

          const pendingPence = user.stripePendingPence ?? 0;

          // Transfer any held earnings now they're verified
          if (pendingPence > 0 && user.stripeAccountId) {
            try {
              await stripe.transfers.create({
                amount: pendingPence,
                currency: "gbp",
                destination: user.stripeAccountId,
                description: `Viewrr held earnings release for user ${viewrrUserId}`,
                metadata: { viewrr_user_id: String(viewrrUserId) },
              }, { idempotencyKey: `transfer_${viewrrUserId}_${Date.now()}` });

              await storage.updateStripeAccount(viewrrUserId, { stripeOnboarded: 1, stripePendingPence: 0 });
              console.log(`[webhook] Released ${pendingPence}p to user ${viewrrUserId}`);

              // Switch to automatic daily payouts now they're verified
              await stripe.accounts.update(user.stripeAccountId, {
                settings: { payouts: { schedule: { interval: "daily" } } },
              });

              await notify({
                recipientId: viewrrUserId,
                actorId: viewrrUserId,
                actorName: "Viewrr",
                actorAvatar: null,
                type: "payment_received",
                message: `Your Stripe account is verified and £${(pendingPence / 100).toFixed(2)} has been released to your bank.`,
                link: "/your-work",
                read: 0,
              });
            } catch (err: any) {
              console.error("[webhook] Transfer failed:", err.message);
            }
          } else {
            // No pending earnings — just mark as onboarded
            await storage.updateStripeAccount(viewrrUserId, { stripeOnboarded: 1 });
            await stripe.accounts.update(user.stripeAccountId!, {
              settings: { payouts: { schedule: { interval: "daily" } } },
            });
          }
        }

        res.json({ received: true });
      } catch (e: any) {
        console.error("[stripe/webhook] Error:", e.message);
        res.status(500).json({ error: e.message });
      }
    }
  );
}
