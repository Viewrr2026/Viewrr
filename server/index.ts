import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { initStorage } from "./storage";
import { serveStatic } from "./static";
import { createServer } from "http";
import helmet from "helmet";
import crypto from "crypto";

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "data:", "blob:", "https:"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "wss:", "ws:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for Stripe embeds
}));

// FR-37: Structured logging — key/value context alongside message
export function log(message: string, source?: string, context?: Record<string, unknown>): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  if (context && Object.keys(context).length) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), source: source ?? "express", message, ...context }));
  } else {
    console.log(`${formattedTime} [${source ?? "express"}] ${message}`);
  }
}

// ─── P0-03: Sensitive field redaction for API logs ──────────────────────────
// NEVER log credential or financial identity fields from response bodies.
// These keys are stripped before any log line is written.
// Phase 1 will introduce structured request-ID logging as the auth model matures.
const LOG_REDACTED_KEYS = new Set([
  "passwordHash", "password_hash", "password", "newPassword",
  "token", "resetToken", "refreshToken", "rawToken", "tokenHash", "token_hash",
  "cookie", "authorization", "SESSION_SECRET",
  "stripeSecretKey", "webhookSecret", "STRIPE_SECRET_KEY",
  "clientSecret",  // Stripe PaymentIntent secret — must never be logged
  // WS-F additions:
  "verificationCode", "codeHash", "code_hash", "rawCode",
  "sessionToken", "bearerToken", "accessKey", "secretKey",
  "DATABASE_URL", "databaseUrl",
]);

function redactForLog(obj: unknown, depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.map(item => redactForLog(item, depth + 1));
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      k,
      LOG_REDACTED_KEYS.has(k) ? "[REDACTED]" : redactForLog(v, depth + 1),
    ])
  );
}

// FR-35: Assign correlation/request ID to every request
app.use((req: any, res: any, next: NextFunction) => {
  // Accept trusted X-Request-ID from infrastructure (max 64 chars, alphanumeric+dash only)
  const inbound = req.headers["x-request-id"] as string | undefined;
  const requestId = (inbound && /^[a-zA-Z0-9\-]{1,64}$/.test(inbound))
    ? inbound
    : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const requestId = (req as any).requestId;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (requestId) logLine = `[${requestId}] ${logLine}`;
      if (capturedJsonResponse) {
        // P0-03: Redact sensitive fields before logging. Never log credentials.
        const redacted = redactForLog(capturedJsonResponse);
        const serialised = JSON.stringify(redacted);
        // Truncate very long responses to avoid log flooding
        logLine += ` :: ${serialised.length > 500 ? serialised.slice(0, 500) + "…[truncated]" : serialised}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await initStorage();
  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const requestId = (req as any).requestId;

    // FR-39: Log with requestId for correlation, but don't expose stack in prod
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "unhandled_error",
      requestId,
      status,
      message: message.slice(0, 500), // cap message length
      // DO NOT include stack trace
    }));

    if (res.headersSent) {
      return next(err);
    }

    // FR-39: Include requestId in 500 response
    if (status >= 500) {
      return res.status(status).json({ error: "Internal server error", requestId });
    }
    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
