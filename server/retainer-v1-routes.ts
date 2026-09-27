import rateLimit from "express-rate-limit";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import multer from "multer";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { requireAuth } from "./auth-middleware";
import { retainerPool, retainerError } from "./retainer-v1-db";
import {
  customRetainerInvitations,
  createCustomRetainer,
  proposeCustomRetainer,
  reviewProposal,
  customWorkspace,
  submitCustomWork,
  reviewCustomWork,
} from "./retainer-v1-service";
import {
  uploadCustomMedia,
  customMediaAccess,
  retryCustomMedia,
  RETAINER_MEDIA_LIMIT,
  RETAINER_MEDIA_MIMES,
} from "./retainer-v1-media";
const asyncRoute =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      res.set("Cache-Control", "private, no-store");
      res.json(await fn(req));
    } catch (e: any) {
      res.status(e instanceof z.ZodError ? 400 : (e.status ?? 500)).json({
        error:
          e instanceof z.ZodError
            ? e.issues.map((i: any) => i.message).join("; ")
            : e.status
              ? e.message
              : "Unable to complete this action. Please try again.",
      });
      if (!e.status && !(e instanceof z.ZodError))
        console.error("[retainer-v1]", e.message);
    }
  };
const publicId = (req: Request) => String(req.params.publicId);
const positive = z.number().int().positive();
export function registerCustomRetainerRoutes(app: Express) {
  app.get("/api/custom-retainers/config", requireAuth, (_req, res) =>
    res.json({ enabled: process.env.CUSTOM_RETAINERS_ENABLED === "true" }),
  );
  app.get("/api/custom-retainer-invitations", requireAuth,
    asyncRoute(req => customRetainerInvitations(req.auth!.userId)));
  app.post(
    "/api/custom-retainers",
    requireAuth,
    asyncRoute((req) => {
      if (process.env.CUSTOM_RETAINERS_ENABLED !== "true")
        retainerError("Custom retainers are not enabled yet", 503);
      return createCustomRetainer(
        req.auth!.userId,
        positive.parse(req.body.recipientId),
        req.body.plan,
      );
    }),
  );
  app.get(
    "/api/custom-retainers/:publicId",
    requireAuth,
    asyncRoute((req) => customWorkspace(publicId(req), req.auth!.userId)),
  );
  app.post(
    "/api/custom-retainers/:publicId/propose",
    requireAuth,
    asyncRoute((req) =>
      proposeCustomRetainer(
        publicId(req),
        req.auth!.userId,
        positive.parse(req.body.expectedVersion),
        req.body.plan,
      ),
    ),
  );
  app.post(
    "/api/custom-retainers/:publicId/review",
    requireAuth,
    asyncRoute((req) =>
      reviewProposal(
        publicId(req),
        req.auth!.userId,
        positive.parse(req.body.version),
        z.enum(["accept", "request_changes", "decline"]).parse(req.body.action),
        z.string().max(5000).default("").parse(req.body.feedback),
      ),
    ),
  );
  app.post(
    "/api/custom-retainers/:publicId/tasks/:taskId/submit",
    requireAuth,
    asyncRoute((req) =>
      submitCustomWork(
        publicId(req),
        req.auth!.userId,
        String(req.params.taskId),
        z.string().uuid().parse(req.body.mediaId),
        z.string().max(5000).parse(req.body.note),
      ),
    ),
  );
  app.post(
    "/api/custom-retainers/:publicId/submissions/:submissionId/review",
    requireAuth,
    asyncRoute((req) =>
      reviewCustomWork(
        publicId(req),
        req.auth!.userId,
        positive.parse(Number(req.params.submissionId)),
        z.enum(["approve", "request_changes"]).parse(req.body.action),
        z.string().max(5000).default("").parse(req.body.feedback),
      ),
    ),
  );
  const mediaLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.auth!.userId),
  });
  const upload = multer({
    dest: tmpdir(),
    limits: { fileSize: RETAINER_MEDIA_LIMIT, files: 1 },
    fileFilter: (_req, file, cb) =>
      cb(null, RETAINER_MEDIA_MIMES.has(file.mimetype)),
  });
  app.post(
    "/api/custom-retainers/:publicId/tasks/:taskId/media",
    requireAuth,
    mediaLimiter,
    upload.single("file"),
    asyncRoute(async (req) => {
      if (!req.file) retainerError("Choose a supported image or video", 400);
      try {
        return await uploadCustomMedia(
          publicId(req),
          req.auth!.userId,
          String(req.params.taskId),
          req.file,
        );
      } finally {
        await rm(req.file.path, { force: true });
      }
    }),
  );
  app.get(
    "/api/custom-retainers/:publicId/media/:mediaId",
    requireAuth,
    asyncRoute((req) =>
      customMediaAccess(
        publicId(req),
        req.auth!.userId,
        z.string().uuid().parse(req.params.mediaId),
        req.query.original === "true",
      ),
    ),
  );
  app.post(
    "/api/custom-retainers/:publicId/media/:mediaId/retry",
    requireAuth,
    asyncRoute((req) =>
      retryCustomMedia(
        publicId(req),
        req.auth!.userId,
        z.string().uuid().parse(req.params.mediaId),
      ),
    ),
  );
  app.use(
    "/api/custom-retainers",
    (err: any, _req: Request, res: Response, next: NextFunction) => {
      if (err instanceof multer.MulterError)
        return res.status(400).json({
          error:
            err.code === "LIMIT_FILE_SIZE"
              ? "Maximum file size is 200 MB"
              : "Unable to upload this file",
        });
      next(err);
    },
  );
}
// Version boundary: the new model cannot be modified by legacy progression routes.
export async function guardCustomRetainerLegacy(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const r = req.path.match(/^\/api\/retainer\/([^/]+)\/(.+)$/);
  const project = req.path.match(
    /^\/api\/projects\/(\d+)\/(confirm-payment|advance|actions\/complete|retainer\/.+|stages.*|plan\/.*|payments|invoice|deliverables)$/,
  );
  const invoice = req.path.match(/^\/api\/invoices\/(\d+)\/paid$/);
  if (!r && !project && !invoice) return next();
  if (r && ["requests", "pause", "end", "usage"].includes(r[2])) return next();
  if (!req.auth) {
    await requireAuth(req, res, () => {
      void guardCustomRetainerLegacy(req, res, next);
    });
    return;
  }
  try {
    const result = r
      ? await retainerPool().query(
          "SELECT id FROM retainer_agreements WHERE public_id=$1 AND workflow_version=1",
          [r[1]],
        )
      : project
        ? await retainerPool().query(
            "SELECT id FROM retainer_agreements WHERE project_id=$1 AND workflow_version=1",
            [Number(project[1])],
          )
        : await retainerPool().query(
            "SELECT a.id FROM invoices i JOIN retainer_agreements a ON a.project_id=i.project_id WHERE i.id=$1 AND a.workflow_version=1",
            [Number(invoice![1])],
          );
    if (result.rows.length)
      return res
        .status(409)
        .json({ error: "Use the custom cycle workspace for this agreement" });
    next();
  } catch (e) {
    next(e);
  }
}
