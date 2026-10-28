import EmailVerificationPanel from '@/components/EmailVerificationPanel';

export default function VerifyEmail() {
  return (
    <main className="mx-auto max-w-lg p-6 space-y-4">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      <EmailVerificationPanel />
    </main>
  );
}
