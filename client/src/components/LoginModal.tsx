import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Mail, ArrowLeft, RefreshCw, KeyRound, CheckCircle2 } from "lucide-react";

// ── Demo accounts — fully client-side, no backend needed ─────────────────────
const DEMO_ACCOUNTS = [
  {
    label: "Client — Alex Taylor",
    email: "alex@business.co",
    user: { id: 1, name: "Alex Taylor", email: "alex@business.co", role: "client",
            avatar: "https://i.pravatar.cc/150?img=32", location: "London, UK",
            bio: "Marketing Director at Taylor & Co.", createdAt: "2026-01-01" },
  },
  {
    label: "Videographer — Marcus Reid",
    email: "marcus@viewrr.co",
    user: { id: 2, name: "Marcus Reid", email: "marcus@viewrr.co", role: "freelancer",
            avatar: "https://i.pravatar.cc/150?img=11", location: "London, UK",
            bio: "Award-winning cinematographer with 8 years shooting brand films.", createdAt: "2026-01-01" },
  },
  {
    label: "Editor — Sophia Chen",
    email: "sophia@viewrr.co",
    user: { id: 3, name: "Sophia Chen", email: "sophia@viewrr.co", role: "freelancer",
            avatar: "https://i.pravatar.cc/150?img=47", location: "Manchester, UK",
            bio: "Post-production specialist and colour grader. Netflix, BBC, global ad agencies.", createdAt: "2026-01-01" },
  },
];

type ModalStep = "login" | "forgot-email" | "forgot-verify" | "forgot-newpassword" | "forgot-done";

const viewrrLogo = (
  <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="8" fill="#FF5A1F"/>
    <path d="M7 8l7 16h4l7-16h-4l-5 11.5L11 8H7z" fill="white"/>
  </svg>
);

export default function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login } = useAuth();
  const { toast } = useToast();

  // ── Login state ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState<ModalStep>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ── Forgot password state ─────────────────────────────────────────────────
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [codeInput, setCodeInput] = useState(["", "", "", "", "", ""]);
  const [codeError, setCodeError] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function resetAll() {
    setStep("login");
    setEmail(""); setPassword(""); setShowPassword(false);
    setForgotEmail(""); setForgotLoading(false);
    setCodeInput(["", "", "", "", "", ""]); setCodeError(false); setResendCooldown(0);
    setNewPassword(""); setNewPasswordConfirm(""); setShowNew(false); setShowConfirm(false);
  }

  function handleClose() { resetAll(); onClose(); }

  // ── Demo login ────────────────────────────────────────────────────────────
  function handleDemoLogin(account: typeof DEMO_ACCOUNTS[0]) {
    login(account.user as any);
    toast({ title: `Welcome back, ${account.user.name}!` });
    handleClose();
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: "Please enter your email and password", variant: "destructive" });
      return;
    }
    setLoading(true);

    const demo = DEMO_ACCOUNTS.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (demo) { handleDemoLogin(demo); setLoading(false); return; }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Sign in failed");
      login(data.user);
      toast({ title: `Welcome back, ${data.user.name}!` });
      handleClose();
    } catch (err: any) {
      toast({ title: "Sign in failed", description: err.message || "Incorrect email or password.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // ── Forgot — send code ────────────────────────────────────────────────────
  async function sendResetCode(emailVal: string) {
    setForgotLoading(true);
    setResendCooldown(30);
    setCodeInput(["", "", "", "", "", ""]);
    setCodeError(false);
    try {
      const res = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal }),
      });
      if (!res.ok) throw new Error("Send failed");
      toast({ title: "Code sent", description: `Check your inbox at ${emailVal}` });
    } catch {
      toast({ title: "Couldn't send code", description: "Please check the email address and try again.", variant: "destructive" });
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail.trim()) { toast({ title: "Please enter your email address", variant: "destructive" }); return; }
    await sendResetCode(forgotEmail.trim());
    setStep("forgot-verify");
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }

  // ── OTP handlers ─────────────────────────────────────────────────────────
  function handleDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...codeInput]; next[index] = digit;
    setCodeInput(next); setCodeError(false);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !codeInput[index] && index > 0) inputRefs.current[index - 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const next = [...codeInput];
    paste.split("").forEach((ch, i) => { next[i] = ch; });
    setCodeInput(next);
    inputRefs.current[Math.min(paste.length, 5)]?.focus();
  }

  // ── Verify OTP then move to new-password step ─────────────────────────────
  async function handleVerifyCode() {
    const entered = codeInput.join("");
    if (entered.length < 6) { setCodeError(true); return; }
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, code: entered }),
      });
      if (!res.ok) {
        setCodeError(true);
        toast({ title: "Incorrect code — please try again", variant: "destructive" });
        setCodeInput(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }
      setStep("forgot-newpassword");
    } catch {
      toast({ title: "Verification failed — please try again", variant: "destructive" });
    }
  }

  // ── Save new password ─────────────────────────────────────────────────────
  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    if (newPassword !== newPasswordConfirm) { toast({ title: "Passwords don't match", variant: "destructive" }); return; }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setStep("forgot-done");
    } catch (err: any) {
      toast({ title: "Password reset failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">

        {/* ── STEP: Sign in ── */}
        {step === "login" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                {viewrrLogo} Sign in to Viewrr
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleLogin} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => { setForgotEmail(email); setStep("forgot-email"); }}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-white" disabled={loading || !email || !password}>
                {loading ? "Signing in..." : "Sign in →"}
              </Button>
            </form>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-3">Try a demo account — click to sign in instantly:</p>
              <div className="space-y-2">
                {DEMO_ACCOUNTS.map(a => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => handleDemoLogin(a)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary hover:bg-primary/5 text-sm transition-colors"
                  >
                    <span className="font-medium">{a.label}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{a.email}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── STEP: Forgot — enter email ── */}
        {step === "forgot-email" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                {viewrrLogo} Reset your password
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("login")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground -mt-1 mb-2">
              <ArrowLeft size={12}/> Back to sign in
            </button>

            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <KeyRound size={26} className="text-primary" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Enter the email address linked to your Viewrr account and we'll send you a 6-digit reset code.
                </p>
              </div>

              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Email address</Label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
                  disabled={forgotLoading || !forgotEmail.trim()}
                >
                  {forgotLoading ? "Sending..." : "Send reset code →"}
                </Button>
              </form>
            </div>
          </>
        )}

        {/* ── STEP: Forgot — enter OTP ── */}
        {step === "forgot-verify" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                {viewrrLogo} Check your inbox
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("forgot-email")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground -mt-1 mb-2">
              <ArrowLeft size={12}/> Back
            </button>

            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mail size={26} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">We've sent a 6-digit code to</p>
                  <p className="text-sm font-bold text-primary mt-0.5">{forgotEmail}</p>
                  <p className="text-xs text-muted-foreground mt-1">Enter it below to continue.</p>
                </div>
              </div>

              {/* OTP boxes */}
              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {codeInput.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleDigit(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className={`w-11 text-center text-xl font-bold rounded-xl border-2 bg-background focus:outline-none transition-all
                      ${codeError
                        ? "border-destructive text-destructive"
                        : digit ? "border-primary text-primary" : "border-border focus:border-primary"
                      }`}
                    style={{ height: "3.25rem" }}
                    aria-label={`Digit ${i + 1}`}
                  />
                ))}
              </div>

              {codeError && (
                <p className="text-xs text-destructive text-center -mt-2">Incorrect code. Please try again.</p>
              )}

              <Button
                onClick={handleVerifyCode}
                className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
                disabled={codeInput.join("").length < 6}
              >
                Verify code →
              </Button>

              <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span>Didn't receive it?</span>
                  {resendCooldown > 0 ? (
                    <span>Resend in {resendCooldown}s</span>
                  ) : (
                    <button
                      onClick={() => sendResetCode(forgotEmail)}
                      className="flex items-center gap-1 text-primary font-medium hover:underline"
                    >
                      <RefreshCw size={11} /> Resend code
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── STEP: Forgot — set new password ── */}
        {step === "forgot-newpassword" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                {viewrrLogo} Choose a new password
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-1">
              <p className="text-sm text-muted-foreground">
                Your identity has been verified. Enter a new password for <span className="font-medium text-foreground">{forgotEmail}</span>.
              </p>

              <form onSubmit={handleSavePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>New password</Label>
                  <div className="relative">
                    <Input
                      type={showNew ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNew ? <EyeOff size={15}/> : <Eye size={15}/>}
                    </button>
                  </div>
                  {newPassword && newPassword.length < 8 && (
                    <p className="text-xs text-destructive">Must be at least 8 characters</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Confirm new password</Label>
                  <div className="relative">
                    <Input
                      type={showConfirm ? "text" : "password"}
                      placeholder="Repeat your new password"
                      value={newPasswordConfirm}
                      onChange={e => setNewPasswordConfirm(e.target.value)}
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff size={15}/> : <Eye size={15}/>}
                    </button>
                  </div>
                  {newPasswordConfirm && newPassword !== newPasswordConfirm && (
                    <p className="text-xs text-destructive">Passwords don't match</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
                  disabled={savingPassword || newPassword.length < 8 || newPassword !== newPasswordConfirm}
                >
                  {savingPassword ? "Saving..." : "Save new password →"}
                </Button>
              </form>
            </div>
          </>
        )}

        {/* ── STEP: Done ── */}
        {step === "forgot-done" && (
          <div className="py-8 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Password updated</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Your password has been reset. Sign in with your new password.
              </p>
            </div>
            <Button
              className="bg-primary hover:bg-primary/90 text-white rounded-full px-8"
              onClick={() => { setEmail(forgotEmail); setPassword(""); setStep("login"); }}
            >
              Sign in →
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
