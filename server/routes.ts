import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import crypto from "crypto";

// Simple password hashing using SHA-256 + salt (no bcrypt needed for this use case)
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "viewrr_salt_2026").digest("hex");
}
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// In-memory store for verification codes (email -> { code, expires })
const verificationCodes = new Map<string, { code: string; expires: number }>();
import { insertUserSchema, insertReviewSchema, insertMessageSchema, insertPostSchema, insertPostCommentSchema, insertProjectSchema, insertProjectUpdateSchema, insertBriefSchema } from "@shared/schema";

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
    const profile = user.role === "freelancer" ? await storage.getProfileByUserId(user.id) : null;
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
      res.json({ user });
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

    // ─── Profiles ──────────────────────────────────────────────────────────────
  app.get("/api/profiles", async (req, res) => {
    const { specialism, availability, search } = req.query as Record<string, string>;
    const profiles = await storage.getProfiles({ specialism, availability, search });
    res.json(profiles);
  });

  app.get("/api/profiles/featured", async (req, res) => {
    res.json(await storage.getFeaturedProfiles());
  });

  app.get("/api/profiles/:id", async (req, res) => {
    const pw = await storage.getProfile(Number(req.params.id));
    if (!pw) return res.status(404).json({ error: "Profile not found" });
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
      const review = await storage.createReview(data);
      res.json(review);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Messages ─────────────────────────────────────────────────────────────
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
  app.get("/api/users/:id", async (req, res) => {
    const user = await storage.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(user);
  });

  // Feed
  app.get("/api/feed", async (req, res) => {
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;
    const viewerUserId = req.query.viewerUserId ? Number(req.query.viewerUserId) : undefined;
    res.json(await storage.getFeedPosts(limit, offset, viewerUserId));
  });

  app.post("/api/feed", async (req, res) => {
    try {
      const data = insertPostSchema.parse(req.body);
      const post = await storage.createPost(data);
      const pw = await storage.getPost(post.id);
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
    res.json({ success: true });
  });

  app.post("/api/feed/:id/like", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const liked = await storage.toggleLike(Number(req.params.id), Number(userId));
    const post = await storage.getPost(Number(req.params.id));
    res.json({ liked, likeCount: post?.post.likeCount ?? 0 });
  });

  app.get("/api/feed/:id/comments", async (req, res) => {
    res.json(await storage.getComments(Number(req.params.id)));
  });

  app.post("/api/feed/:id/comments", async (req, res) => {
    try {
      const data = insertPostCommentSchema.parse({ ...req.body, postId: Number(req.params.id) });
      const comment = await storage.createComment(data);
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
    res.json(await storage.getProjectsForUser(Number(userId)));
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
}
