import type { Express, RequestHandler } from 'express';

type Account = { id: number; email: string; emailVerified?: boolean | null };
type Dependencies = {
  requireAuth: RequestHandler;
  resendLimiter: RequestHandler;
  verifyLimiter: RequestHandler;
  getUser: (id: number) => Promise<Account | undefined>;
  sendEmail: (email: string) => Promise<{ ok: boolean; dev?: boolean }>;
  consumeCode: (email: string, purpose: 'email_verification', code: string) => Promise<{ ok: boolean; error?: string }>;
  markVerified: (id: number, email: string, at: Date) => Promise<boolean>;
};

// Both clients use the same authenticated flow. The request can never choose
// which account/address receives the code or gets marked verified.
export function registerAccountEmailVerification(app: Express, deps: Dependencies) {
  app.post(['/api/auth/resend-verification', '/api/auth/mobile/resend-verification'], deps.requireAuth, deps.resendLimiter, async (req, res) => {
    try {
      const user = await deps.getUser(req.auth!.userId);
      if (!user?.email) return res.status(404).json({ error: 'Account not found' });
      if (user.emailVerified) return res.json({ sent: true, alreadyVerified: true });
      const sent = await deps.sendEmail(user.email);
      if (!sent.ok && !sent.dev) return res.status(503).json({ error: 'Email service unavailable. Please try again shortly.' });
      return res.json({ sent: true, dev: sent.dev ? true : undefined });
    } catch {
      return res.status(500).json({ error: 'Could not send verification email' });
    }
  });

  app.post(['/api/auth/verify-email', '/api/auth/mobile/verify-email'], deps.requireAuth, deps.verifyLimiter, async (req, res) => {
    try {
      const user = await deps.getUser(req.auth!.userId);
      if (!user?.email) return res.status(404).json({ error: 'Account not found' });
      if (user.emailVerified) return res.json({ verified: true, emailVerified: true, alreadyVerified: true });
      const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit code from your email.', code: 'INVALID_CODE' });
      const result = await deps.consumeCode(user.email, 'email_verification', code);
      if (!result.ok) return res.status(400).json({ error: result.error ?? 'Invalid or expired code', code: 'INVALID_CODE' });
      const now = new Date();
      if (!await deps.markVerified(user.id, user.email, now)) {
        return res.status(409).json({ error: 'Your email address changed. Request a new code and try again.' });
      }
      return res.json({ verified: true, emailVerified: true, emailVerifiedAt: now.toISOString() });
    } catch {
      return res.status(500).json({ error: 'Could not verify your email. Please request a new code and try again.' });
    }
  });
}
