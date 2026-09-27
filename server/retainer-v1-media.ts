import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import {
  putPrivateObject,
  readPrivateObject,
  createPresignedDownloadUrl,
  STORAGE_CONFIGURED,
} from "./object-storage";
import {
  retainerPool,
  retainerTransaction,
  retainerError,
} from "./retainer-v1-db";
import { lockAgreement, requireWork, event } from "./retainer-v1-service";
import { canAccessOriginal } from "../shared/retainer-v1";
const exec = promisify(execFile);
export const RETAINER_MEDIA_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
export const RETAINER_MEDIA_LIMIT = 200 * 1024 * 1024;
export function requirePrivateMedia() {
  if (
    !STORAGE_CONFIGURED ||
    process.env.RETAINER_PRIVATE_STORAGE_CONFIRMED !== "true"
  )
    retainerError(
      "Protected file storage must be configured before uploading",
      503,
    );
}
export async function uploadCustomMedia(
  publicId: string,
  userId: number,
  taskPublicId: string,
  file: { path: string; originalname: string; mimetype: string; size: number },
) {
  requirePrivateMedia();
  if (
    !RETAINER_MEDIA_MIMES.has(file.mimetype) ||
    file.size > RETAINER_MEDIA_LIMIT
  )
    retainerError("Upload a supported image or video under 200 MB", 400);
  const mediaId = randomUUID(),
    key = `retainer-private/${mediaId}/original`;
  // Reserve the work under the agreement lock before any upload can race an amendment.
  const taskId = await retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    if (userId !== a.freelancer_id)
      retainerError("Only the freelancer can upload work", 403);
    const t = (
      await db.query(
        `SELECT t.* FROM retainer_cycle_tasks t JOIN retainer_cycles c ON c.id=t.retainer_cycle_id WHERE t.public_id=$1 AND c.retainer_agreement_id=$2`,
        [taskPublicId, a.id],
      )
    ).rows[0];
    if (!t) retainerError("Work item not found", 404);
    await requireWork(db, a, t.retainer_cycle_id);
    await db.query(
      "UPDATE retainer_cycles SET started_at=COALESCE(started_at,$2) WHERE id=$1",
      [t.retainer_cycle_id, new Date().toISOString()],
    );
    return t.id;
  });
  await putPrivateObject(
    key,
    createReadStream(file.path),
    file.mimetype,
    file.size,
  );
  // Recheck eligibility after storage completes. Files remain private on failure.
  await retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    const t = (
      await db.query("SELECT * FROM retainer_cycle_tasks WHERE id=$1", [taskId])
    ).rows[0];
    await requireWork(db, a, t.retainer_cycle_id);
    await db.query(
      `INSERT INTO retainer_media(id,task_id,uploaded_by,original_key,filename,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        mediaId,
        taskId,
        userId,
        key,
        file.originalname.replace(/[\r\n\x00-\x1f]/g, "").slice(0, 180),
        file.mimetype,
        file.size,
      ],
    );
    await event(db, a, userId, `upload:${mediaId}`, "media_uploaded", {
      taskId,
      mediaId,
    });
  });
  return { id: mediaId, status: "queued" };
}
export async function renderRetainerPreview(
  input: string,
  output: string,
  mime: string,
) {
  const probe = await exec(
    process.env.FFPROBE_PATH ?? "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      input,
    ],
    { timeout: 30_000, maxBuffer: 1_000_000 },
  );
  const info = JSON.parse(probe.stdout),
    video = info.streams.find((s: any) => s.codec_type === "video");
  if (
    !video ||
    video.width * video.height > 40_000_000 ||
    (mime.startsWith("video/") &&
      (!Number.isFinite(Number(info.format.duration)) ||
        Number(info.format.duration) > 1800))
  )
    throw new Error("Unsupported dimensions or video longer than 30 minutes");
  if (
    mime.startsWith("image/") &&
    !["mjpeg", "png", "webp"].includes(video.codec_name)
  )
    throw new Error("File content is not a supported still image");
  const filter =
    "scale=w='min(1280,iw)':h=-2,drawtext=text='VIEWRR PREVIEW':fontcolor=white@0.9:fontsize=h/15:box=1:boxcolor=black@0.45:boxborderw=12:x=(w-tw)/2:y=(h-th)/2";
  const args = [
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-protocol_whitelist",
    "file,pipe",
    "-threads",
    "2",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-vf",
    filter,
    "-map_metadata",
    "-1",
  ];
  if (mime.startsWith("image/")) args.push("-frames:v", "1");
  else
    args.push(
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "27",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
    );
  args.push(output);
  await exec(process.env.FFMPEG_PATH ?? "ffmpeg", args, {
    timeout: 15 * 60_000,
    maxBuffer: 1_000_000,
  });
}
export async function processNextRetainerMedia() {
  await retainerPool().query(
    "UPDATE retainer_media SET status='failed',error='Preview processing was interrupted. Please retry.',locked_at=NULL WHERE status='processing' AND attempts>=3 AND locked_at<NOW()-INTERVAL '20 minutes'",
  );
  const rows = await retainerPool().query(
    `UPDATE retainer_media SET status='processing',locked_at=NOW(),attempts=attempts+1 WHERE id=(SELECT id FROM retainer_media WHERE (status='queued' OR (status='processing' AND locked_at<NOW()-INTERVAL '20 minutes')) AND attempts<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
  );
  const m = rows.rows[0];
  if (!m) return;
  const folder = await mkdtemp(join(tmpdir(), "viewrr-preview-"));
  try {
    const input = join(folder, "input"),
      video = m.mime_type.startsWith("video/"),
      output = join(folder, video ? "preview.mp4" : "preview.jpg");
    await pipeline(
      await readPrivateObject(m.original_key),
      createWriteStream(input),
    );
    await renderRetainerPreview(input, output, m.mime_type);
    const key = `retainer-private/${m.id}/preview-${randomUUID()}.${video ? "mp4" : "jpg"}`;
    await putPrivateObject(
      key,
      createReadStream(output),
      video ? "video/mp4" : "image/jpeg",
      (await stat(output)).size,
    );
    await retainerPool().query(
      "UPDATE retainer_media SET status='ready',preview_key=$2,error=NULL,locked_at=NULL WHERE id=$1",
      [m.id, key],
    );
  } catch {
    await retainerPool().query(
      "UPDATE retainer_media SET status='failed',error='Preview processing failed. Retry or upload a supported file.',locked_at=NULL WHERE id=$1",
      [m.id],
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
export async function customMediaAccess(
  publicId: string,
  userId: number,
  mediaId: string,
  original: boolean,
) {
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    const m = (
      await db.query(
        `SELECT m.*,c.paid_at,p.status AS payment_status FROM retainer_media m JOIN retainer_cycle_tasks t ON t.id=m.task_id JOIN retainer_cycles c ON c.id=t.retainer_cycle_id LEFT JOIN payments p ON p.id=c.payment_id WHERE m.id=$1 AND c.retainer_agreement_id=$2`,
        [mediaId, a.id],
      )
    ).rows[0];
    if (!m) retainerError("File not found", 404);
    const submitted = (
      await db.query(
        "SELECT status FROM retainer_work_item_submissions WHERE media_id=$1",
        [mediaId],
      )
    ).rows;
    if (userId !== a.freelancer_id && !submitted.length)
      retainerError("This preview has not been submitted", 403);
    if (m.status !== "ready") retainerError("Preview is not ready");
    if (
      original &&
      (!submitted.some((s) => s.status === "approved") ||
        !canAccessOriginal(m.paid_at, m.payment_status))
    )
      retainerError(
        "Verified payment is required to receive the accepted clean file",
        403,
      );
    requirePrivateMedia();
    await event(
      db,
      a,
      userId,
      `file:${randomUUID()}`,
      original ? "original_access" : "preview_access",
      { mediaId },
    );
    return {
      url: await createPresignedDownloadUrl(
        original ? m.original_key : m.preview_key,
        60,
      ),
    };
  });
}
export async function retryCustomMedia(
  publicId: string,
  userId: number,
  mediaId: string,
) {
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, publicId, userId);
    if (userId !== a.freelancer_id)
      retainerError("Only the freelancer can retry processing", 403);
    const m = (
      await db.query(
        `SELECT m.*,t.retainer_cycle_id FROM retainer_media m JOIN retainer_cycle_tasks t ON t.id=m.task_id JOIN retainer_cycles c ON c.id=t.retainer_cycle_id WHERE m.id=$1 AND c.retainer_agreement_id=$2`,
        [mediaId, a.id],
      )
    ).rows[0];
    if (!m || m.status !== "failed")
      retainerError("No failed preview to retry");
    await requireWork(db, a, m.retainer_cycle_id);
    await db.query(
      "UPDATE retainer_media SET status='queued',attempts=0,error=NULL WHERE id=$1",
      [mediaId],
    );
    return { ok: true };
  });
}
