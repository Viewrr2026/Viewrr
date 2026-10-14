import { verifyCode } from './verification-service';

/** Consume the email code at account creation, never trust a browser's verified flag. */
export async function verifySignupEmail(
  email: string,
  code: unknown,
  consume: typeof verifyCode = verifyCode,
) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    throw Object.assign(new Error('Enter the six-digit code sent to your email.'), { status: 400 });
  }
  const result = await consume(email.trim().toLowerCase(), 'email_verification', code.trim());
  if (!result.ok) {
    throw Object.assign(new Error(result.error || 'Invalid or expired verification code.'), { status: 400 });
  }
  return { emailVerified: true, emailVerifiedAt: new Date() };
}
