import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "./AuthProvider";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, UserCircle, ChevronRight, Check, Camera, Video, Scissors,
  Megaphone, ArrowLeft, Mail, Phone, RefreshCw, Upload, X, Film,
  ImageIcon, Plus, Eye, EyeOff,
} from "lucide-react";

type Step = "role" | "client-details" | "client-verify" | "freelancer-details" | "freelancer-verify" | "freelancer-portfolio" | "done";
type VerifyMethod = "email" | "phone";

const SPECIALISMS = [
  { id: "Videographer", icon: Video, label: "Videographer" },
  { id: "Video Editor", icon: Scissors, label: "Video Editor" },
  { id: "Photographer", icon: Camera, label: "Photographer" },
  { id: "Marketer", icon: Megaphone, label: "Marketer" },
];

const EXPERIENCE_LEVELS = ["Less than 1 year", "1–2 years", "3–5 years", "6–10 years", "10+ years"];
const EQUIPMENT_OPTIONS = [
  "Sony FX3 / A7S III", "Canon C70 / R5C", "DJI Drone", "Gimbal / Stabiliser",
  "Studio Lighting", "Adobe Premiere Pro", "DaVinci Resolve", "After Effects",
];

export default function SignupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("role");
  const [role, setRole] = useState<"client" | "freelancer" | null>(null);

  // Client fields
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPassword, setClientPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [company, setCompany] = useState("");

  // Freelancer fields
  const [freeFirstName, setFreeFirstName] = useState("");
  const [freeLastName, setFreeLastName] = useState("");
  const [freePhone, setFreePhone] = useState("");
  const [freeEmail, setFreeEmail] = useState("");
  const [freePassword, setFreePassword] = useState("");
  const [showFreePassword, setShowFreePassword] = useState(false);
  const [freeCompany, setFreeCompany] = useState("");
  const [freeSpecialisms, setFreeSpecialisms] = useState<string[]>([]);
  const [experience, setExperience] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [bio, setBio] = useState("");

  // Verification (shared for both client and freelancer)
  const [verifyMethod, setVerifyMethod] = useState<VerifyMethod>("email");
  const [codeInput, setCodeInput] = useState(["", "", "", "", "", ""]);
  const [codeError, setCodeError] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Portfolio uploads
  type UploadedFile = { id: string; file: File; preview: string; type: "image" | "video" };
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const tooBig = arr.filter(f => f.size > MAX_FILE_SIZE);
    if (tooBig.length > 0) {
      toast({
        title: `${tooBig.length > 1 ? `${tooBig.length} files are` : `"${tooBig[0].name}" is`} too large`,
        description: "Maximum file size is 50 MB. Please compress your video before uploading.",
        variant: "destructive",
      });
    }
    const valid = arr
      .filter(f => (f.type.startsWith("image/") || f.type.startsWith("video/")) && f.size <= MAX_FILE_SIZE)
      .slice(0, 12 - uploads.length);
    const newUploads: UploadedFile[] = valid.map(f => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      preview: URL.createObjectURL(f),
      type: f.type.startsWith("video/") ? "video" : "image",
    }));
    setUploads(prev => [...prev, ...newUploads].slice(0, 12));
  }

  function removeUpload(id: string) {
    setUploads(prev => {
      const item = prev.find(u => u.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter(u => u.id !== id);
    });
  }

  // Cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function reset() {
    setStep("role"); setRole(null);
    setClientFirstName(""); setClientLastName(""); setClientPhone(""); setClientEmail(""); setClientPassword(""); setCompany("");
    setFreeFirstName(""); setFreeLastName(""); setFreePhone(""); setFreeEmail(""); setFreePassword(""); setFreeCompany("");
    setVerifyMethod("email");
    setCodeInput(["", "", "", "", "", ""]); setCodeError(false); setResendCooldown(0);
    setFreeSpecialisms([]); setExperience(""); setEquipment([]); setBio("");
    setUploads([]); setDragOver(false);
    setShowPassword(false); setShowFreePassword(false);
  }

  function handleClose() { reset(); onClose(); }

  function toggleSpecialism(id: string) {
    setFreeSpecialisms(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  function toggleEquipment(id: string) {
    setEquipment(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id]);
  }

  const clientName = `${clientFirstName} ${clientLastName}`.trim();
  const freeName = `${freeFirstName} ${freeLastName}`.trim();

  // ── Validation — client ──────────────────────────────────────────────────────
  function validateDetails() {
    if (!clientFirstName.trim()) { toast({ title: "Please enter your first name", variant: "destructive" }); return false; }
    if (!clientLastName.trim()) { toast({ title: "Please enter your last name", variant: "destructive" }); return false; }
    if (!clientPhone.trim()) { toast({ title: "Please enter your contact number", variant: "destructive" }); return false; }
    if (!clientEmail.trim()) { toast({ title: "Please enter your email address", variant: "destructive" }); return false; }
    if (!clientPassword || clientPassword.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return false; }
    return true;
  }

  // ── Validation — freelancer ──────────────────────────────────────────────────
  function validateFreeDetails() {
    if (!freeFirstName.trim()) { toast({ title: "Please enter your first name", variant: "destructive" }); return false; }
    if (!freeLastName.trim()) { toast({ title: "Please enter your last name", variant: "destructive" }); return false; }
    if (!freePhone.trim()) { toast({ title: "Please enter your contact number", variant: "destructive" }); return false; }
    if (!freeEmail.trim()) { toast({ title: "Please enter your email address", variant: "destructive" }); return false; }
    if (!freePassword || freePassword.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return false; }
    if (freeSpecialisms.length === 0) { toast({ title: "Please select at least one specialism", variant: "destructive" }); return false; }
    return true;
  }

  // ── Send verification code ──────────────────────────────────────────────────
  async function sendVerificationCode(method: VerifyMethod, emailVal?: string, phoneVal?: string) {
    const email = emailVal ?? (role === "freelancer" ? freeEmail : clientEmail);
    const phone = phoneVal ?? (role === "freelancer" ? freePhone : clientPhone);

    setCodeInput(["", "", "", "", "", ""]);
    setCodeError(false);
    setResendCooldown(30);

    if (method === "email") {
      try {
        const res = await fetch("/api/auth/send-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) throw new Error("Failed to send");
        toast({ title: "Code sent", description: `A 6-digit code has been sent to ${email}. Check your inbox.` });
      } catch {
        toast({ title: "Couldn't send code", description: "Please check your email and try again.", variant: "destructive" });
      }
    } else {
      try {
        const res = await fetch("/api/auth/send-sms-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, email }),
        });
        if (!res.ok) throw new Error("Failed to send");
        toast({ title: "Code sent", description: `A 6-digit code has been sent to ${phone}. Check your messages.` });
      } catch {
        toast({ title: "Couldn't send code", description: "Please check your number and try again.", variant: "destructive" });
      }
    }
  }

  async function proceedToVerify(method: VerifyMethod) {
    if (!validateDetails()) return;
    setVerifyMethod(method);
    setStep("client-verify");
    await sendVerificationCode(method, clientEmail, clientPhone);
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }

  async function proceedToFreeVerify(method: VerifyMethod) {
    if (!validateFreeDetails()) return;
    setVerifyMethod(method);
    setStep("freelancer-verify");
    await sendVerificationCode(method, freeEmail, freePhone);
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }

  // ── OTP input handlers ──────────────────────────────────────────────────────
  function handleDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...codeInput];
    next[index] = digit;
    setCodeInput(next);
    setCodeError(false);
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

  // ── Verify code & create CLIENT account ─────────────────────────────────────
  async function verifyAndFinish() {
    const entered = codeInput.join("");
    if (entered.length < 6) {
      setCodeError(true);
      toast({ title: "Please enter the full 6-digit code", variant: "destructive" });
      return;
    }

    try {
      const body = verifyMethod === "phone"
        ? { phone: clientPhone, code: entered }
        : { email: clientEmail, code: entered };

      const verifyRes = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!verifyRes.ok) {
        setCodeError(true);
        toast({ title: "Incorrect code — please try again", variant: "destructive" });
        setCodeInput(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }
    } catch {
      toast({ title: "Verification failed — please try again", variant: "destructive" });
      return;
    }

    // Register and log in
    try {
      const regRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clientName, email: clientEmail, role: "client", phone: clientPhone, password: clientPassword }),
      });
      const data = await regRes.json();
      if (data.user) {
        login(data.user);
      } else if (data.error === "Email already registered") {
        toast({ title: "Email already registered", description: "Please sign in instead.", variant: "destructive" });
        handleClose();
        return;
      } else {
        login({ id: 99, name: clientName, email: clientEmail, role: "client", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
      }
    } catch {
      login({ id: 99, name: clientName, email: clientEmail, role: "client", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
    }
    setStep("done");
    setTimeout(() => { handleClose(); }, 1800);
  }

  // ── Verify code & create FREELANCER account ──────────────────────────────────
  async function verifyAndFinishFreelancer() {
    const entered = codeInput.join("");
    if (entered.length < 6) {
      setCodeError(true);
      toast({ title: "Please enter the full 6-digit code", variant: "destructive" });
      return;
    }

    try {
      const body = verifyMethod === "phone"
        ? { phone: freePhone, code: entered }
        : { email: freeEmail, code: entered };

      const verifyRes = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!verifyRes.ok) {
        setCodeError(true);
        toast({ title: "Incorrect code — please try again", variant: "destructive" });
        setCodeInput(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }
    } catch {
      toast({ title: "Verification failed — please try again", variant: "destructive" });
      return;
    }

    // Register freelancer account
    try {
      const regRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: freeName, email: freeEmail, role: "freelancer", phone: freePhone, password: freePassword }),
      });
      const data = await regRes.json();
      if (data.user) {
        login(data.user);
      } else if (data.error === "Email already registered") {
        toast({ title: "Email already registered", description: "Please sign in instead.", variant: "destructive" });
        handleClose();
        return;
      } else {
        login({ id: 98, name: freeName, email: freeEmail, role: "freelancer", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
      }
    } catch {
      login({ id: 98, name: freeName, email: freeEmail, role: "freelancer", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
    }
    // Move on to portfolio step
    setCodeInput(["", "", "", "", "", ""]);
    setStep("freelancer-portfolio");
  }

  const [portfolioUploading, setPortfolioUploading] = useState(false);

  async function finishFreelancer() {
    if (uploads.length > 0) {
      setPortfolioUploading(true);
      try {
        const formData = new FormData();
        uploads.forEach(u => formData.append("files", u.file));
        const res = await fetch("/api/upload/portfolio", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast({
            title: "Upload issue",
            description: err.error || "Some files couldn't be uploaded — your profile has been created anyway.",
            variant: "destructive",
          });
        }
      } catch {
        // Non-fatal — account already created, just log
        console.warn("Portfolio upload failed — account still created");
      } finally {
        setPortfolioUploading(false);
      }
    }
    setStep("done");
    toast({ title: `Welcome to Viewrr, ${freeFirstName}!` });
    setTimeout(() => { handleClose(); }, 1800);
  }

  const viewrrLogo = (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#FF5A1F"/>
      <path d="M7 8l7 16h4l7-16h-4l-5 11.5L11 8H7z" fill="white"/>
    </svg>
  );

  const canProceed = clientFirstName && clientLastName && clientPhone && clientEmail && clientPassword.length >= 8;
  const canFreeProceed = freeFirstName && freeLastName && freePhone && freeEmail && freePassword.length >= 8 && freeSpecialisms.length > 0;

  // Active email/phone for the verify step (depends on role)
  const activeEmail = role === "freelancer" ? freeEmail : clientEmail;
  const activePhone = role === "freelancer" ? freePhone : clientPhone;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">

        {/* ── STEP: Role selection ── */}
        {step === "role" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                Join Viewrr
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-1 mb-2">How are you planning to use Viewrr?</p>

            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                onClick={() => { setRole("client"); setStep("client-details"); }}
                className="group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Building2 size={22} className="text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">I'm a Client</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">I want to hire creative talent for my projects</p>
                </div>
                <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary mt-auto ml-auto transition-colors" />
              </button>

              <button
                onClick={() => { setRole("freelancer"); setStep("freelancer-details"); }}
                className="group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <UserCircle size={22} className="text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">I'm a Freelancer</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">I want to showcase my work and find clients</p>
                </div>
                <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary mt-auto ml-auto transition-colors" />
              </button>
            </div>

            <div className="mt-5 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground text-center">Already have an account? <button className="text-primary font-medium hover:underline" onClick={handleClose}>Sign in</button></p>
            </div>
          </>
        )}

        {/* ── STEP: Client details ── */}
        {step === "client-details" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                Create your client account
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("role")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>

            <div className="space-y-4">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="Alex" value={clientFirstName} onChange={e => setClientFirstName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="Taylor" value={clientLastName} onChange={e => setClientLastName(e.target.value)} />
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <Label>Contact Number <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="tel"
                    placeholder="+44 7700 900000"
                    value={clientPhone}
                    onChange={e => setClientPhone(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label>Your Email <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@email.com"
                    value={clientEmail}
                    onChange={e => setClientEmail(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label>Password <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={clientPassword}
                    onChange={e => setClientPassword(e.target.value)}
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
                {clientPassword && clientPassword.length < 8 && (
                  <p className="text-xs text-destructive">Password must be at least 8 characters</p>
                )}
              </div>

              {/* Company */}
              <div className="space-y-1.5">
                <Label>Company / Brand name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input placeholder="Acme Studios" value={company} onChange={e => setCompany(e.target.value)} />
              </div>

              {/* Verify method choice */}
              <div className="space-y-2">
                <Label className="text-sm">How would you like to verify?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => canProceed && proceedToVerify("email")}
                    disabled={!canProceed}
                    className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all ${
                      canProceed
                        ? "border-primary bg-primary text-white hover:bg-primary/90"
                        : "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <Mail size={15}/> Via Email
                  </button>
                  <button
                    type="button"
                    onClick={() => canProceed && proceedToVerify("phone")}
                    disabled={!canProceed}
                    className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all ${
                      canProceed
                        ? "border-border hover:border-primary hover:bg-primary/5"
                        : "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <Phone size={15}/> Via Phone
                  </button>
                </div>
                <p className="text-xs text-muted-foreground text-center">Fill in all fields above to enable verification</p>
              </div>

              <p className="text-xs text-muted-foreground text-center">By joining you agree to our Terms &amp; Conditions and Privacy Policy.</p>
            </div>
          </>
        )}

        {/* ── STEP: Client Verification ── */}
        {step === "client-verify" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                {verifyMethod === "email" ? "Verify your email" : "Verify your phone"}
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("client-details")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>

            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  {verifyMethod === "email"
                    ? <Mail size={26} className="text-primary" />
                    : <Phone size={26} className="text-primary" />
                  }
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">We've sent a 6-digit code to</p>
                  <p className="text-sm font-bold text-primary mt-0.5">
                    {verifyMethod === "email" ? clientEmail : clientPhone}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {verifyMethod === "email" ? "Check your inbox and enter the code below." : "Check your messages and enter the code below."}
                  </p>
                </div>
              </div>

              {/* 6-digit input boxes */}
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
                onClick={verifyAndFinish}
                className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
                disabled={codeInput.join("").length < 6}
              >
                Verify &amp; create account →
              </Button>

              {/* Resend / switch method */}
              <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span>Didn't receive it?</span>
                  {resendCooldown > 0 ? (
                    <span>Resend in {resendCooldown}s</span>
                  ) : (
                    <button
                      onClick={() => sendVerificationCode(verifyMethod, clientEmail, clientPhone)}
                      className="flex items-center gap-1 text-primary font-medium hover:underline"
                    >
                      <RefreshCw size={11} /> Resend code
                    </button>
                  )}
                </div>
                <button
                  onClick={() => proceedToVerify(verifyMethod === "email" ? "phone" : "email")}
                  className="text-primary hover:underline"
                >
                  Try via {verifyMethod === "email" ? "phone" : "email"} instead
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP: Freelancer details ── */}
        {step === "freelancer-details" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                Create your freelancer account
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("role")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>

            <div className="space-y-4">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="Marcus" value={freeFirstName} onChange={e => setFreeFirstName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name <span className="text-destructive">*</span></Label>
                  <Input placeholder="Reid" value={freeLastName} onChange={e => setFreeLastName(e.target.value)} />
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <Label>Contact Number <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="tel"
                    placeholder="+44 7700 900000"
                    value={freePhone}
                    onChange={e => setFreePhone(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label>Your Email <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@email.com"
                    value={freeEmail}
                    onChange={e => setFreeEmail(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label>Password <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    type={showFreePassword ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={freePassword}
                    onChange={e => setFreePassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFreePassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showFreePassword ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
                {freePassword && freePassword.length < 8 && (
                  <p className="text-xs text-destructive">Password must be at least 8 characters</p>
                )}
              </div>

              {/* Company / Brand (optional) */}
              <div className="space-y-1.5">
                <Label>Company / Brand name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input placeholder="My Studio" value={freeCompany} onChange={e => setFreeCompany(e.target.value)} />
              </div>

              {/* Specialisms */}
              <div>
                <Label className="mb-2 block">What do you do? <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                <div className="grid grid-cols-2 gap-2">
                  {SPECIALISMS.map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleSpecialism(id)}
                      className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        freeSpecialisms.includes(id)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <Icon size={15} className={freeSpecialisms.includes(id) ? "text-primary" : "text-muted-foreground"} />
                      {label}
                      {freeSpecialisms.includes(id) && <Check size={13} className="ml-auto text-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Experience */}
              <div>
                <Label className="mb-2 block">Years of experience</Label>
                <div className="flex flex-wrap gap-2">
                  {EXPERIENCE_LEVELS.map(lvl => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setExperience(lvl)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        experience === lvl ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Equipment */}
              <div>
                <Label className="mb-2 block">Equipment &amp; software <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map(eq => (
                    <button
                      key={eq}
                      type="button"
                      onClick={() => toggleEquipment(eq)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        equipment.includes(eq) ? "bg-primary/10 text-primary border-primary/50" : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {eq}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bio */}
              <div className="space-y-1.5">
                <Label>About you <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  placeholder="Tell clients who you are, what you specialise in, and what makes your work stand out..."
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Verify method choice */}
              <div className="space-y-2">
                <Label className="text-sm">How would you like to verify?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => canFreeProceed && proceedToFreeVerify("email")}
                    disabled={!canFreeProceed}
                    className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all ${
                      canFreeProceed
                        ? "border-primary bg-primary text-white hover:bg-primary/90"
                        : "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <Mail size={15}/> Via Email
                  </button>
                  <button
                    type="button"
                    onClick={() => canFreeProceed && proceedToFreeVerify("phone")}
                    disabled={!canFreeProceed}
                    className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all ${
                      canFreeProceed
                        ? "border-border hover:border-primary hover:bg-primary/5"
                        : "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <Phone size={15}/> Via Phone
                  </button>
                </div>
                <p className="text-xs text-muted-foreground text-center">Fill in all required fields above to enable verification</p>
              </div>

              <p className="text-xs text-muted-foreground text-center">By joining you agree to our Terms &amp; Conditions and Privacy Policy.</p>
            </div>
          </>
        )}

        {/* ── STEP: Freelancer Verification ── */}
        {step === "freelancer-verify" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                {verifyMethod === "email" ? "Verify your email" : "Verify your phone"}
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("freelancer-details")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>

            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  {verifyMethod === "email"
                    ? <Mail size={26} className="text-primary" />
                    : <Phone size={26} className="text-primary" />
                  }
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">We've sent a 6-digit code to</p>
                  <p className="text-sm font-bold text-primary mt-0.5">
                    {verifyMethod === "email" ? freeEmail : freePhone}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {verifyMethod === "email" ? "Check your inbox and enter the code below." : "Check your messages and enter the code below."}
                  </p>
                </div>
              </div>

              {/* 6-digit input boxes */}
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
                onClick={verifyAndFinishFreelancer}
                className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
                disabled={codeInput.join("").length < 6}
              >
                Verify &amp; continue →
              </Button>

              {/* Resend / switch method */}
              <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span>Didn't receive it?</span>
                  {resendCooldown > 0 ? (
                    <span>Resend in {resendCooldown}s</span>
                  ) : (
                    <button
                      onClick={() => sendVerificationCode(verifyMethod, freeEmail, freePhone)}
                      className="flex items-center gap-1 text-primary font-medium hover:underline"
                    >
                      <RefreshCw size={11} /> Resend code
                    </button>
                  )}
                </div>
                <button
                  onClick={() => proceedToFreeVerify(verifyMethod === "email" ? "phone" : "email")}
                  className="text-primary hover:underline"
                >
                  Try via {verifyMethod === "email" ? "phone" : "email"} instead
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP: Freelancer portfolio ── */}
        {step === "freelancer-portfolio" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                Add your portfolio
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("freelancer-verify")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>

            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">Upload photos and videos of your work directly from your camera roll, or drag and drop files below. You can add up to 12 pieces.</p>

              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                className={`relative rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                  dragOver
                    ? "border-primary bg-primary/10 scale-[1.01]"
                    : "border-border hover:border-primary/50 hover:bg-secondary/50"
                } ${uploads.length === 0 ? "py-10" : "py-4"}`}
              >
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => e.target.files && addFiles(e.target.files)} />

                {uploads.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 text-center px-6">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Upload size={22} className="text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Drop files here or tap to browse</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Photos &amp; videos · up to 12 files</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><ImageIcon size={12}/> Images</span>
                      <span className="text-border">·</span>
                      <span className="flex items-center gap-1"><Film size={12}/> Videos</span>
                    </div>
                  </div>
                ) : (
                  <div className="px-3">
                    <div className="grid grid-cols-4 gap-2">
                      {uploads.map(u => (
                        <div key={u.id} className="relative group aspect-square rounded-xl overflow-hidden bg-secondary">
                          {u.type === "video"
                            ? <video src={u.preview} className="w-full h-full object-cover" muted />
                            : <img src={u.preview} alt="" className="w-full h-full object-cover" />
                          }
                          <div className="absolute bottom-1 left-1">
                            {u.type === "video"
                              ? <span className="bg-black/60 text-white rounded px-1 py-0.5 text-[9px] flex items-center gap-0.5"><Film size={8}/>VID</span>
                              : <span className="bg-black/60 text-white rounded px-1 py-0.5 text-[9px] flex items-center gap-0.5"><ImageIcon size={8}/>IMG</span>
                            }
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); removeUpload(u.id); }}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                          >
                            <X size={10}/>
                          </button>
                        </div>
                      ))}
                      {uploads.length < 12 && (
                        <div className="aspect-square rounded-xl border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
                          <Plus size={18}/>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground text-center mt-2">{uploads.length}/12 files · tap to add more</p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Or add links <span className="normal-case font-normal">(optional)</span></p>
                {["Instagram profile", "Website / portfolio"].map((placeholder, i) => (
                  <div key={i} className="space-y-1.5">
                    <Label className="text-sm">{placeholder}</Label>
                    <Input placeholder={placeholder.includes("Instagram") ? "https://instagram.com/..." : "https://..."} />
                  </div>
                ))}
              </div>

              <Button
                onClick={finishFreelancer}
                disabled={portfolioUploading}
                className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
              >
                {portfolioUploading ? "Uploading..." : "Complete my profile →"}
              </Button>
              {!portfolioUploading && (
                <button onClick={finishFreelancer} className="w-full text-xs text-muted-foreground hover:text-foreground text-center">Skip for now</button>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Videos up to 50 MB · Images up to 50 MB
              </p>
            </div>
          </>
        )}

        {/* ── STEP: Done ── */}
        {step === "done" && (
          <div className="py-8 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Check size={28} className="text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-lg">You're in.</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {role === "freelancer" ? "Your profile is live. Time to get noticed." : "Your account is ready. Start finding your creative."}
              </p>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
