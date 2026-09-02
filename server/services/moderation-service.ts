// server/services/moderation-service.ts
// PRD 1 — Decisions 7, 8, 9. Contract §G.
//
// Two-tier moderation, implemented ENTIRELY in-process:
//
//   Tier 1 — hard reject on publish. HTTP 422 { code: "CONTENT_REJECTED" }.
//            Clearly prohibited terms, non-https media schemes, media hosts
//            outside the allow-list, over-length bodies, bad mediaType.
//
//   Tier 2 — accept but flag. The content publishes normally and a
//            `content_flags` row (state 'pending') is written for the
//            founder/admin queue.
//
// Decision 9: NO external moderation provider, NO new paid dependency.
// Everything here is plain string matching against lists held in this file.
//
// HONEST LIMITATIONS (read before trusting this):
//  * This is a keyword/heuristic filter. It catches lazy abuse and obvious spam.
//    It does NOT understand context, images, video content behind a link, coded
//    language, or non-English abuse. It will produce both false negatives and
//    false positives. The tier-2 queue and user reporting are the real
//    safety net; this is only the cheap first pass.
//  * The prohibited-term list is deliberately short and unambiguous. Long
//    keyword lists are where automated moderation goes wrong (the "Scunthorpe
//    problem"), so ambiguous words go in the tier-2 list, never tier 1.
//  * Word-boundary matching is used to avoid substring false positives.

import { neon } from "@neondatabase/serverless";

function getSql() { return neon(process.env.DATABASE_URL!); }

// ─── Limits (contract §G) ────────────────────────────────────────────────────

export const POST_BODY_MAX = 5000;
export const COMMENT_BODY_MAX = 2000;
export const MEDIA_URL_MAX = 2048;
export const TAGS_JSON_MAX = 1000;

/** Allowed values for posts.media_type. */
export const MEDIA_TYPES = ["image", "video", "link", "embed"] as const;
export type MediaType = typeof MEDIA_TYPES[number];

/**
 * Media host allow-list. Decision 9 keeps feed media LINK-BASED for V1 — there
 * is no upload path and no third-party moderation provider, so the only
 * defensible control is to restrict which hosts a mediaUrl may point at.
 *
 * Matching is exact host or a subdomain of the entry (".youtube.com" matches
 * "www.youtube.com" but never "youtube.com.evil.tld").
 */
export const MEDIA_HOST_ALLOWLIST = [
  // Viewrr's own storage / CDN
  "viewrr.co.uk",
  "www.viewrr.co.uk",
  "cdn.viewrr.co.uk",
  // Video platforms used by the freelancer base
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
  // Image / portfolio hosts
  "res.cloudinary.com",
  "images.unsplash.com",
  "i.imgur.com",
  "behance.net",
  "cdn.dribbble.com",
] as const;

// ─── Tier 1: clearly prohibited terms ────────────────────────────────────────
// Short, unambiguous, no plausible innocent use in a UK creative-freelance
// marketplace. Slurs are represented as regex source so the file stays greppable
// without embedding a wall of abuse; each entry is a whole-word pattern.
//
// Keep this list SHORT. If a term has any innocent reading, it belongs in the
// tier-2 list instead, where a human decides.
const TIER1_RULES: { key: string; pattern: RegExp }[] = [
  // Racial / ethnic slurs (whole word, common obfuscations of the vowel).
  { key: "slur_racial",      pattern: /\bn[i1!*]gg(?:er|a|ah)s?\b/i },
  { key: "slur_racial",      pattern: /\bk[i1!*]kes?\b/i },
  { key: "slur_racial",      pattern: /\bch[i1!*]nks?\b/i },
  { key: "slur_racial",      pattern: /\bp[a@]k[i1!*]s?\b/i },
  { key: "slur_racial",      pattern: /\bsp[i1!*]cs?\b/i },
  { key: "slur_racial",      pattern: /\bw[e3]tb[a@]cks?\b/i },
  // Homophobic / transphobic slurs.
  { key: "slur_homophobic",  pattern: /\bf[a@]gg?[o0]ts?\b/i },
  { key: "slur_homophobic",  pattern: /\btr[a@]nn(?:y|ies)\b/i },
  // Ableist slur.
  { key: "slur_ableist",     pattern: /\bret[a@]rds?\b/i },
  // Child sexual abuse material — zero tolerance, no review tier.
  { key: "csam",             pattern: /\bc(?:hild|p)\s*(?:porn|pornography)\b/i },
  { key: "csam",             pattern: /\bunderage\s+(?:porn|nudes?|sex)\b/i },
  // Explicit incitement / credible threat.
  { key: "violent_threat",   pattern: /\b(?:i(?:'?m| am)? ?(?:will|gonna|going to)|we(?:'?ll| will))\s+(?:kill|murder|stab|shoot)\s+(?:you|u|him|her|them)\b/i },
  // Doxxing solicitation.
  { key: "doxxing",          pattern: /\b(?:home|house)\s+address\s+of\s+@?\w+/i },
];

// ─── Tier 2: ambiguous — publish, then flag for review ───────────────────────
// These are patterns that are USUALLY spam/abuse but have real innocent uses.
// They must never hard-reject. Each match writes one content_flags row.
const TIER2_RULES: { key: string; pattern: RegExp }[] = [
  // Off-platform payment solicitation (fee avoidance / scam vector). Real
  // freelancers legitimately mention invoicing, so this is review-only.
  { key: "offplatform_payment", pattern: /\b(?:pay(?:ment)?s?\s+(?:me\s+)?(?:direct(?:ly)?|off[- ]?platform|outside\s+(?:of\s+)?viewrr)|cash\s+in\s+hand|bank\s+transfer\s+only)\b/i },
  { key: "crypto_solicitation", pattern: /\b(?:bitcoin|btc|eth(?:ereum)?|usdt|crypto)\s*(?:wallet|address|payment|only)\b/i },
  // Recruitment / MLM spam.
  { key: "mlm_spam",            pattern: /\b(?:passive\s+income|financial\s+freedom|work\s+from\s+home\s+opportunity|dm\s+me\s+to\s+earn)\b/i },
  { key: "followback_spam",     pattern: /\b(?:f4f|follow\s*4\s*follow|follow\s+back|sub4sub|like\s*4\s*like)\b/i },
  // Contact-detail harvesting in public feed content.
  { key: "contact_details",     pattern: /\b(?:whats\s?app|telegram|signal)\b[^\n]{0,20}\+?\d[\d\s().-]{8,}/i },
  // Unmoderated general profanity aimed at a person — often fine, sometimes not.
  { key: "targeted_abuse",      pattern: /\byou(?:'?re| are)\s+(?:a\s+)?(?:c[u*]nt|w[a@]nker|prick|scum(?:bag)?)\b/i },
  // Adult content advertising (not permitted on the feed, but not tier 1).
  { key: "adult_content",       pattern: /\b(?:only\s?fans|fansly|nsfw\s+content|escort\s+services?)\b/i },
  // Claims of accreditation Viewrr does not award.
  { key: "false_accreditation", pattern: /\b(?:viewrr\s+)?(?:certified|accredited|verified)\s+by\s+viewrr\b/i },
];

// ─── Result types ────────────────────────────────────────────────────────────

export type ModerationRejection = {
  outcome: "reject";
  /** Machine code returned to the client. Always CONTENT_REJECTED (422). */
  code: "CONTENT_REJECTED";
  /** Matched rule key — logged, never shown verbatim to the user. */
  rule: string;
  /** User-facing message. Points at the Community Guidelines. */
  message: string;
};

export type ModerationAcceptance = {
  outcome: "accept";
  /** Tier-2 rule keys matched. Empty = clean. */
  flags: string[];
};

export type ModerationResult = ModerationRejection | ModerationAcceptance;

export type ModeratableContent = {
  kind: "post" | "comment";
  body: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
};

export const GUIDELINES_URL = "https://www.viewrr.co.uk/#/community-guidelines";

function reject(rule: string, message: string): ModerationRejection {
  return { outcome: "reject", code: "CONTENT_REJECTED", rule, message };
}

// ─── Media URL validation (tier 1) ───────────────────────────────────────────

export function hostIsAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return MEDIA_HOST_ALLOWLIST.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/**
 * Tier 1 mediaUrl checks. Returns null when the URL is acceptable.
 *
 * Rejects: anything that is not parseable, any scheme other than https:
 * (this kills `javascript:`, `data:`, `file:`, `http:` downgrade and
 * protocol-relative URLs), credentials in the URL, and hosts outside the
 * allow-list.
 */
export function checkMediaUrl(rawUrl: string): ModerationRejection | null {
  const value = rawUrl.trim();
  if (!value) return null;

  if (value.length > MEDIA_URL_MAX) {
    return reject("media_url_too_long", `Media links must be under ${MEDIA_URL_MAX} characters.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return reject("media_url_unparseable", "That media link is not a valid URL. Use a full https:// link.");
  }

  if (parsed.protocol !== "https:") {
    return reject(
      "media_url_scheme",
      "Media links must start with https://. Other link types are not accepted.",
    );
  }

  if (parsed.username || parsed.password) {
    return reject("media_url_credentials", "Media links must not contain login credentials.");
  }

  if (!hostIsAllowed(parsed.hostname)) {
    return reject(
      "media_url_host",
      `Media can only be linked from approved hosts (${MEDIA_HOST_ALLOWLIST.slice(0, 5).join(", ")} and a few others). See the Community Guidelines: ${GUIDELINES_URL}`,
    );
  }

  return null;
}

export function checkMediaType(value: string | null | undefined): ModerationRejection | null {
  if (value === null || value === undefined || value === "") return null;
  if (!MEDIA_TYPES.includes(value as MediaType)) {
    return reject("media_type_invalid", `mediaType must be one of: ${MEDIA_TYPES.join(", ")}.`);
  }
  return null;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Run both moderation tiers over a candidate post or comment.
 * PURE — no DB access, no network. Safe to call before persisting.
 *
 * Call `recordContentFlags()` afterwards with the returned `flags` and the id of
 * the row that was actually created.
 */
export function moderateContent(input: ModeratableContent): ModerationResult {
  const body = input.body ?? "";
  const cap = input.kind === "post" ? POST_BODY_MAX : COMMENT_BODY_MAX;

  // Tier 1 — length cap.
  if (body.length > cap) {
    return reject(
      "body_too_long",
      `That ${input.kind} is ${body.length} characters. The limit is ${cap}.`,
    );
  }

  // Tier 1 — media.
  const typeProblem = checkMediaType(input.mediaType);
  if (typeProblem) return typeProblem;

  if (input.mediaUrl) {
    const urlProblem = checkMediaUrl(input.mediaUrl);
    if (urlProblem) return urlProblem;
  }

  // Tier 1 — prohibited terms. Scan body AND the media URL (a slur can be in a
  // path or query string).
  const haystack = `${body}\n${input.mediaUrl ?? ""}`;
  for (const rule of TIER1_RULES) {
    if (rule.pattern.test(haystack)) {
      return reject(
        rule.key,
        `This ${input.kind} breaches the Viewrr Community Guidelines and was not published. Read them here: ${GUIDELINES_URL}`,
      );
    }
  }

  // Tier 2 — ambiguous. Publish, collect flags.
  const flags: string[] = [];
  for (const rule of TIER2_RULES) {
    if (rule.pattern.test(haystack) && !flags.includes(rule.key)) {
      flags.push(rule.key);
    }
  }

  return { outcome: "accept", flags };
}

// ─── Tier 2 persistence ──────────────────────────────────────────────────────

/** Trim an excerpt for the review queue. Never store the whole body twice. */
export function buildExcerpt(body: string, max = 280): string {
  const collapsed = (body ?? "").replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Write tier-2 flags for freshly published content.
 * Fire-and-forget safe: NEVER throws, because a flag-write failure must not
 * fail a request whose content was already accepted.
 */
export async function recordContentFlags(opts: {
  subjectType: "post" | "comment";
  subjectId: number;
  authorUserId: number;
  reasons: string[];
  body: string;
}): Promise<void> {
  if (!opts.reasons.length) return;
  try {
    const sql = getSql();
    const excerpt = buildExcerpt(opts.body);
    for (const reason of opts.reasons) {
      await sql`
        INSERT INTO content_flags
          (subject_type, subject_id, author_user_id, reason, excerpt, state, created_at)
        VALUES
          (${opts.subjectType}, ${opts.subjectId}, ${opts.authorUserId}, ${reason}, ${excerpt}, 'pending', NOW())
      `;
    }
  } catch (e: any) {
    console.warn("[moderation] Failed to record content flag (non-fatal):", e?.message);
  }
}

// ─── Founder/admin review queue ──────────────────────────────────────────────

export type ContentFlagRow = {
  id: number;
  subjectType: string;
  subjectId: number;
  authorUserId: number;
  authorName: string | null;
  reason: string;
  excerpt: string | null;
  state: string;
  createdAt: string;
  reviewedBy: number | null;
  reviewedAt: string | null;
  /** Live body of the flagged row, or null if it has since been deleted. */
  subjectBody: string | null;
};

export async function listContentFlags(opts: {
  state?: string;
  limit?: number;
  offset?: number;
}): Promise<{ flags: ContentFlagRow[]; total: number }> {
  const sql = getSql();
  const state = opts.state ?? "pending";
  const limit = Math.min(Math.max(Number(opts.limit ?? 50), 1), 100);
  const offset = Math.max(Number(opts.offset ?? 0), 0);

  const rows = await sql`
    SELECT cf.id, cf.subject_type, cf.subject_id, cf.author_user_id,
           cf.reason, cf.excerpt, cf.state, cf.created_at,
           cf.reviewed_by, cf.reviewed_at,
           u.name AS author_name,
           CASE cf.subject_type
             WHEN 'post'    THEN (SELECT p.caption  FROM posts p         WHERE p.id = cf.subject_id)
             WHEN 'comment' THEN (SELECT c.content  FROM post_comments c WHERE c.id = cf.subject_id)
             ELSE NULL
           END AS subject_body
    FROM content_flags cf
    LEFT JOIN users u ON u.id = cf.author_user_id
    WHERE cf.state = ${state}
    ORDER BY cf.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await sql`SELECT COUNT(*) FROM content_flags WHERE state = ${state}` as any;

  return {
    total: Number(count),
    flags: rows.map((r: any) => ({
      id: r.id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      authorUserId: r.author_user_id,
      authorName: r.author_name ?? null,
      reason: r.reason,
      excerpt: r.excerpt ?? null,
      state: r.state,
      createdAt: r.created_at,
      reviewedBy: r.reviewed_by ?? null,
      reviewedAt: r.reviewed_at ?? null,
      subjectBody: r.subject_body ?? null,
    })),
  };
}

/**
 * Resolve a flag.
 *  - "cleared": the content is fine; it stays published.
 *  - "removed": the content is deleted and the author is notified by the caller.
 *
 * Returns the flag's subject so the route can perform the deletion, or null when
 * the flag does not exist / was already reviewed.
 */
export async function resolveContentFlag(opts: {
  flagId: number;
  adminUserId: number;
  action: "cleared" | "removed";
  note?: string;
}): Promise<{ subjectType: string; subjectId: number; authorUserId: number } | null> {
  const sql = getSql();
  const rows = await sql`
    UPDATE content_flags
    SET state = ${opts.action},
        reviewed_by = ${opts.adminUserId},
        reviewed_at = NOW()
    WHERE id = ${opts.flagId} AND state = 'pending'
    RETURNING subject_type, subject_id, author_user_id
  `;
  if (!rows.length) return null;

  await recordModerationAudit({
    actorType: "admin",
    actorId: opts.adminUserId,
    action: opts.action === "cleared" ? "content_flag_cleared" : "content_flag_removed",
    subjectType: "content_flag",
    subjectId: opts.flagId,
    reason: opts.note ?? null,
  });

  const row = rows[0] as any;
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    authorUserId: row.author_user_id,
  };
}

// ─── Moderation audit log ────────────────────────────────────────────────────
// Replaces the old practice of writing moderation rows into payment_audit_log.

export async function recordModerationAudit(opts: {
  actorType: "admin" | "system";
  actorId: number | null;
  action: string;
  subjectType: "user" | "post" | "comment" | "content_flag";
  subjectId: number | null;
  reason?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO moderation_audit_log
        (actor_type, actor_id, action, subject_type, subject_id, reason, detail, created_at)
      VALUES
        (${opts.actorType}, ${opts.actorId}, ${opts.action}, ${opts.subjectType},
         ${opts.subjectId}, ${opts.reason ?? null}, ${opts.detail ?? null}, NOW())
    `;
  } catch (e: any) {
    // An audit write must never break the moderation action itself, but it must
    // be loud in the logs.
    console.error("[moderation] AUDIT WRITE FAILED:", opts.action, opts.subjectType, opts.subjectId, e?.message);
  }
}
