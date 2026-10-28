import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';

function message(error: unknown) {
  if (error instanceof Error) {
    try {
      const details = JSON.parse(error.message.replace(/^\d+:\s*/, ''));
      if (typeof details.error === 'string') return details.error;
    } catch { /* Use a helpful fallback for network failures. */ }
  }
  return 'Could not complete verification. Please try again.';
}

export default function EmailVerificationPanel({ onVerified }: { onVerified?: () => void }) {
  const { user, updateUser } = useAuth();
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);

  function complete(at?: string) {
    updateUser({ emailVerified: true, ...(at ? { emailVerifiedAt: new Date(at) } : {}) });
    setError('');
    onVerified?.();
  }

  async function sendCode() {
    if (busy) return;
    if (Date.now() < cooldownUntil) {
      setError('Please wait a minute before requesting another code.');
      return;
    }
    setBusy('send'); setError('');
    try {
      const data = await (await apiRequest('POST', '/api/auth/resend-verification')).json();
      if (data.alreadyVerified) complete();
      else { setSent(true); setCooldownUntil(Date.now() + 60_000); }
    } catch (error) { setError(message(error)); }
    finally { setBusy(null); }
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !/^\d{6}$/.test(code.trim())) return;
    setBusy('verify'); setError('');
    try {
      const data = await (await apiRequest('POST', '/api/auth/verify-email', { code: code.trim() })).json();
      if (data.verified !== true) throw new Error('Verification was not confirmed');
      complete(data.emailVerifiedAt);
    } catch (error) { setError(message(error)); }
    finally { setBusy(null); }
  }

  if (!user) return <p>Sign in to verify your email address.</p>;
  if (user.emailVerified === true) return <p role="status" className="text-sm text-green-700">Your email address is verified.</p>;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3" aria-label="Email verification">
      <div>
        <h3 className="font-semibold text-sm">Confirm your email to publish</h3>
        <p className="text-sm text-muted-foreground mt-1">Send a code to {user.email}, then enter it here.</p>
      </div>
      <Button type="button" variant="outline" onClick={sendCode} disabled={busy !== null}>
        {busy === 'send' ? 'Sending…' : sent ? 'Resend code' : 'Send verification code'}
      </Button>
      {sent && <p role="status" className="text-sm">Code sent. Check your inbox and spam folder. It expires after 10 minutes.</p>}
      <form onSubmit={confirmCode} className="space-y-2">
        <label className="block text-sm font-medium">
          Verification code
          <Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Six-digit code" className="mt-1" />
        </label>
        <Button type="submit" disabled={busy !== null || !/^\d{6}$/.test(code)}>
          {busy === 'verify' ? 'Verifying…' : 'Verify email'}
        </Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
