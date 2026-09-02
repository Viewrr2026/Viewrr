// server/object-storage.ts
// PRD-020 WS-D: Durable object storage (Cloudflare R2 via S3 SDK)
// Provider: Cloudflare R2 — S3-compatible, no egress fees

import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

// ── Configuration ────────────────────────────────────────────────────────────
const STORAGE_ENDPOINT = process.env.OBJECT_STORAGE_ENDPOINT;      // R2: https://<acct>.r2.cloudflarestorage.com
const STORAGE_BUCKET   = process.env.OBJECT_STORAGE_BUCKET;
const STORAGE_ACCESS   = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
const STORAGE_SECRET   = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
const STORAGE_REGION   = process.env.OBJECT_STORAGE_REGION ?? "auto"; // R2 uses "auto"

export const STORAGE_CONFIGURED = !!(STORAGE_ENDPOINT && STORAGE_BUCKET && STORAGE_ACCESS && STORAGE_SECRET);

let s3: S3Client | null = null;
function getS3(): S3Client {
  if (!STORAGE_CONFIGURED) throw new Error("Object storage not configured");
  if (!s3) {
    s3 = new S3Client({
      region: STORAGE_REGION,
      endpoint: STORAGE_ENDPOINT,
      credentials: { accessKeyId: STORAGE_ACCESS!, secretAccessKey: STORAGE_SECRET! },
      forcePathStyle: false, // R2 uses virtual-hosted style
    });
  }
  return s3;
}

// ── Resource types ───────────────────────────────────────────────────────────
export type ResourceType = "portfolio" | "profile" | "project" | "deliverable" | "message";

// ── Object key generation ────────────────────────────────────────────────────
// FR-22: Never use raw user-provided filenames. Server-controlled UUID keys.
export function generateObjectKey(resourceType: ResourceType, userId: number, ext?: string): string {
  const uuid = crypto.randomUUID();
  const safExt = ext ? `.${ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8)}` : "";
  return `${resourceType}/${userId}/${uuid}${safExt}`;
}

// ── Presigned upload URL (PUT) ───────────────────────────────────────────────
// FR-19: Issue short-lived presigned PUT URL. File goes directly client→R2.
// FR-23: Validate MIME + size before issuing.
export async function createPresignedUploadUrl(opts: {
  objectKey: string;
  mimeType: string;
  maxSizeBytes: number;
  expiresInSeconds?: number;
}): Promise<string> {
  const s3 = getS3();
  const cmd = new PutObjectCommand({
    Bucket: STORAGE_BUCKET!,
    Key: opts.objectKey,
    ContentType: opts.mimeType,
    ContentLength: opts.maxSizeBytes, // hint only — client must respect
  });
  return getSignedUrl(s3, cmd, { expiresIn: opts.expiresInSeconds ?? 300 }); // 5 min
}

// ── Presigned download URL (GET) ─────────────────────────────────────────────
// FR-25: Short-lived signed download URL (15 min default).
export async function createPresignedDownloadUrl(objectKey: string, expiresInSeconds = 900): Promise<string> {
  const s3 = getS3();
  const cmd = new GetObjectCommand({ Bucket: STORAGE_BUCKET!, Key: objectKey });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

// ── Verify object exists (post-upload confirmation) ──────────────────────────
// FR-24: Confirm object actually exists before marking upload ready.
export async function verifyObjectExists(objectKey: string): Promise<{ exists: boolean; size?: number; contentType?: string }> {
  try {
    const s3 = getS3();
    const result = await s3.send(new HeadObjectCommand({ Bucket: STORAGE_BUCKET!, Key: objectKey }));
    return { exists: true, size: result.ContentLength, contentType: result.ContentType };
  } catch (e: any) {
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return { exists: false };
    throw e;
  }
}

// ── Delete object ────────────────────────────────────────────────────────────
export async function deleteObject(objectKey: string): Promise<void> {
  const s3 = getS3();
  await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET!, Key: objectKey }));
}

// ── Allowed MIME types ───────────────────────────────────────────────────────
// FR-23: Validate MIME type against allowed list.
const ALLOWED_IMAGE_MIME_LIST = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
const ALLOWED_VIDEO_MIME_LIST = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"] as const;
const ALLOWED_IMAGE_MIMES = new Set<string>(ALLOWED_IMAGE_MIME_LIST);
const ALLOWED_VIDEO_MIMES = new Set<string>(ALLOWED_VIDEO_MIME_LIST);
export const ALLOWED_MIMES: Record<ResourceType, Set<string>> = {
  portfolio:   new Set<string>([...ALLOWED_IMAGE_MIME_LIST, ...ALLOWED_VIDEO_MIME_LIST]),
  profile:     ALLOWED_IMAGE_MIMES,
  project:     new Set<string>([...ALLOWED_IMAGE_MIME_LIST, ...ALLOWED_VIDEO_MIME_LIST]),
  deliverable: new Set<string>([...ALLOWED_IMAGE_MIME_LIST, ...ALLOWED_VIDEO_MIME_LIST, "application/pdf", "application/zip"]),
  message:     new Set<string>(ALLOWED_IMAGE_MIME_LIST),
};

export const MAX_UPLOAD_BYTES: Record<ResourceType, number> = {
  portfolio:   50 * 1024 * 1024,  // 50 MB
  profile:     5 * 1024 * 1024,   // 5 MB
  project:     100 * 1024 * 1024, // 100 MB
  deliverable: 200 * 1024 * 1024, // 200 MB
  message:     5 * 1024 * 1024,   // 5 MB
};

export function isAllowedMime(resourceType: ResourceType, mimeType: string): boolean {
  return ALLOWED_MIMES[resourceType]?.has(mimeType) ?? false;
}
