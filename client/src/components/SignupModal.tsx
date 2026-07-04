import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "./AuthProvider";
import { useToast } from "@/hooks/use-toast";
import VideoEmbed from "@/components/VideoEmbed";
import { parseVideoUrl, isValidVideoUrl } from "@/lib/videoEmbed";
import {
  Building2, UserCircle, ChevronRight, Check, Camera, Video, Scissors,
  Megaphone, ArrowLeft, Mail, Phone, RefreshCw, Film, Plus, Eye, EyeOff,
  Trash2, GripVertical, Banknote, ShieldCheck, Zap,
} from "lucide-react";

type Step = "role" | "client-details" | "client-verify" | "freelancer-type" | "freelancer-details" | "freelancer-verify" | "freelancer-accreditation" | "freelancer-portfolio" | "freelancer-payouts" | "agency-setup" | "done";
type ClientSubStep = 1 | 2;
type FreeSubStep = 1 | 2 | 3;
type VerifyMethod = "email" | "phone";
type PortfolioItem = { url: string; title: string };

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

function experienceToYears(lvl: string): number {
  if (lvl === "Less than 1 year") return 0;
  if (lvl === "1–2 years") return 1;
  if (lvl === "3–5 years") return 3;
  if (lvl === "6–10 years") return 6;
  if (lvl === "10+ years") return 10;
  return 0;
}

export default function SignupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("role");
  const [clientSubStep, setClientSubStep] = useState<ClientSubStep>(1);
  const [freeSubStep, setFreeSubStep] = useState<FreeSubStep>(1);
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

  // Agency fields (for Creative Agency account type)
  const [accountSubtype, setAccountSubtype] = useState<"sole" | "agency_owner">("sole");
  const [agencyName, setAgencyName] = useState("");
  const [agencyBio, setAgencyBio] = useState("");
  const [agencySpecialisms, setAgencySpecialisms] = useState<string[]>([]);
  const [agencyReelUrl, setAgencyReelUrl] = useState("");
  const [agencyCreating, setAgencyCreating] = useState(false);

  // Tracks the newly created freelancer's profile ID so we can PATCH it
  const [newProfileId, setNewProfileId] = useState<number | null>(null);
  const [newUserId, setNewUserId] = useState<number | null>(null);
  const [payoutsPopupOpen, setPayoutsPopupOpen] = useState(false);
  const [payoutsPopupDone, setPayoutsPopupDone] = useState(false);
  const payoutsPopupRef = useRef<Window | null>(null);
  const payoutsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Verification
  const [verifyMethod, setVerifyMethod] = useState<VerifyMethod>("email");
  const [codeInput, setCodeInput] = useState(["", "", "", "", "", ""]);
  const [codeError, setCodeError] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Portfolio — link-based (matches dashboard)
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([{ url: "", title: "" }]);
  const [portfolioSaving, setPortfolioSaving] = useState(false);

  // Cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function reset() {
    setStep("role"); setRole(null); setClientSubStep(1); setFreeSubStep(1);
    setClientFirstName(""); setClientLastName(""); setClientPhone(""); setClientEmail(""); setClientPassword(""); setCompany("");
    setFreeFirstName(""); setFreeLastName(""); setFreePhone(""); setFreeEmail(""); setFreePassword(""); setFreeCompany("");
    setVerifyMethod("email");
    setCodeInput(["", "", "", "", "", ""]); setCodeError(false); setResendCooldown(0);
    setFreeSpecialisms([]); setExperience(""); setEquipment([]); setBio("");
    setPortfolioItems([{ url: "", title: "" }]);
    setNewProfileId(null);
    setShowPassword(false); setShowFreePassword(false);
    setAccountSubtype("sole"); setAgencyName(""); setAgencyBio(""); setAgencySpecialisms([]); setAgencyReelUrl("");
  }

  function handleClose() { reset(); onClose(); }

  function toggleSpecialism(id: string) {
    setFreeSpecialisms(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  function toggleEquipment(id: string) {
    setEquipment(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id]);
  }

  // Portfolio item helpers
  function setPortfolioItem(index: number, field: keyof PortfolioItem, value: string) {
    setPortfolioItems(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it));
  }
  function addPortfolioItem() {
    setPortfolioItems(prev => [...prev, { url: "", title: "" }]);
  }
  function removePortfolioItem(index: number) {
    setPortfolioItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  }

  const clientName = `${clientFirstName} ${clientLastName}`.trim();
  const freeName = `${freeFirstName} ${freeLastName}`.trim();

  // ── Validation ──────────────────────────────────────────────────────────────
  // Step 1 — identity fields only
  function validateClientStep1() {
    if (!clientFirstName.trim()) { toast({ title: "Please enter your first name", variant: "destructive" }); return false; }
    if (!clientLastName.trim()) { toast({ title: "Please enter your last name", variant: "destructive" }); return false; }
    if (!clientEmail.trim()) { toast({ title: "Please enter your email address", variant: "destructive" }); return false; }
    if (!clientPassword || clientPassword.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return false; }
    return true;
  }
  // Step 2 — all remaining fields needed to proceed to verify
  function validateDetails() {
    if (!validateClientStep1()) return false;
    if (!clientPhone.trim()) { toast({ title: "Please enter your contact number", variant: "destructive" }); return false; }
    return true;
  }

  // Freelancer step-specific validators
  function validateFreeStep1() {
    if (!freeFirstName.trim()) { toast({ title: "Please enter your first name", variant: "destructive" }); return false; }
    if (!freeLastName.trim()) { toast({ title: "Please enter your last name", variant: "destructive" }); return false; }
    if (!freeEmail.trim()) { toast({ title: "Please enter your email address", variant: "destructive" }); return false; }
    if (!freePassword || freePassword.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return false; }
    return true;
  }
  function validateFreeStep2() {
    if (!freePhone.trim()) { toast({ title: "Please enter your contact number", variant: "destructive" }); return false; }
    if (freeSpecialisms.length === 0) { toast({ title: "Please select at least one specialism", variant: "destructive" }); return false; }
    return true;
  }
  function validateFreeDetails() {
    if (!validateFreeStep1()) return false;
    if (!validateFreeStep2()) return false;
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

  // ── OTP handlers ────────────────────────────────────────────────────────────
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

  // ── Verify & create CLIENT account ─────────────────────────────────────────
  async function verifyAndFinish() {
    const entered = codeInput.join("");
    if (entered.length < 6) { setCodeError(true); toast({ title: "Please enter the full 6-digit code", variant: "destructive" }); return; }

    try {
      const body = verifyMethod === "phone" ? { phone: clientPhone, code: entered } : { email: clientEmail, code: entered };
      const verifyRes = await fetch("/api/auth/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!verifyRes.ok) {
        setCodeError(true);
        toast({ title: "Incorrect code — please try again", variant: "destructive" });
        setCodeInput(["", "", "", "", "", ""]); inputRefs.current[0]?.focus(); return;
      }
    } catch { toast({ title: "Verification failed — please try again", variant: "destructive" }); return; }

    try {
      const regRes = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clientName, email: clientEmail, role: "client", phone: clientPhone, password: clientPassword }),
      });
      const data = await regRes.json();
      if (data.user) { login(data.user); }
      else if (data.error === "Email already registered") {
        toast({ title: "Email already registered", description: "Please sign in instead.", variant: "destructive" });
        handleClose(); return;
      } else {
        login({ id: 99, name: clientName, email: clientEmail, role: "client", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
      }
    } catch {
      login({ id: 99, name: clientName, email: clientEmail, role: "client", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
    }
    setStep("done");
    // Welcome screen stays open — user dismisses via CTA buttons
  }

  // ── Verify & create FREELANCER account ─────────────────────────────────────
  async function verifyAndFinishFreelancer() {
    const entered = codeInput.join("");
    if (entered.length < 6) { setCodeError(true); toast({ title: "Please enter the full 6-digit code", variant: "destructive" }); return; }

    try {
      const body = verifyMethod === "phone" ? { phone: freePhone, code: entered } : { email: freeEmail, code: entered };
      const verifyRes = await fetch("/api/auth/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!verifyRes.ok) {
        setCodeError(true);
        toast({ title: "Incorrect code — please try again", variant: "destructive" });
        setCodeInput(["", "", "", "", "", ""]); inputRefs.current[0]?.focus(); return;
      }
    } catch { toast({ title: "Verification failed — please try again", variant: "destructive" }); return; }

    // Register freelancer account
    let userId: number | null = null;
    let profileId: number | null = null;
    try {
      const regRes = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: freeName, email: freeEmail, role: "freelancer", phone: freePhone, password: freePassword }),
      });
      const data = await regRes.json();
      if (data.error === "Email already registered") {
        toast({ title: "Email already registered", description: "Please sign in instead.", variant: "destructive" });
        handleClose(); return;
      }
      if (data.user) {
        userId = data.user.id;
        profileId = data.profile?.id ?? null;
        setNewUserId(userId);
        login(data.user);
      } else {
        login({ id: 98, name: freeName, email: freeEmail, role: "freelancer", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
      }
    } catch {
      login({ id: 98, name: freeName, email: freeEmail, role: "freelancer", avatar: null, location: null, createdAt: new Date().toISOString() } as any);
    }

    // Save profile details (specialisms, skills, experience, bio) right after registration
    // Small delay to ensure profile row is committed before PATCH
    await new Promise(r => setTimeout(r, 600));
    if (profileId) {
      setNewProfileId(profileId);
      try {
        await fetch(`/api/profiles/${profileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            specialisms: JSON.stringify(freeSpecialisms),
            skills: JSON.stringify(equipment),
            yearsExperience: experienceToYears(experience),
            bio: bio.trim() || undefined,
          }),
        });
      } catch {
        console.warn("[signup] Could not save profile details — user can update from dashboard");
      }
    } else if (userId) {
      // Fallback: fetch the profile by userId if ID not returned
      try {
        const pr = await fetch(`/api/profiles/${userId}`);
        if (pr.ok) {
          const pd = await pr.json();
          const pid = pd?.profile?.id ?? pd?.id ?? null;
          if (pid) {
            setNewProfileId(pid);
            await fetch(`/api/profiles/${pid}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                specialisms: JSON.stringify(freeSpecialisms),
                skills: JSON.stringify(equipment),
                yearsExperience: experienceToYears(experience),
                bio: bio.trim() || undefined,
              }),
            });
          }
        }
      } catch {
        console.warn("[signup] Could not save profile details via fallback");
      }
    }

    setCodeInput(["", "", "", "", "", ""]);
    setStep("freelancer-accreditation");
    setPayoutsPopupDone(false);
  }

  // ── Finish freelancer — save portfolio links ─────────────────────────────
  async function finishFreelancer() {
    const valid = portfolioItems.filter(it => it.url.trim() && isValidVideoUrl(it.url.trim()));
    if (valid.length > 0 && newProfileId) {
      setPortfolioSaving(true);
      try {
        const primaryReel = valid[0]?.url ?? "";
        await fetch(`/api/profiles/${newProfileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reelUrl: primaryReel,
            portfolioItems: JSON.stringify(valid),
          }),
        });
      } catch {
        console.warn("[signup] Portfolio save failed — user can update from dashboard");
      } finally {
        setPortfolioSaving(false);
      }
    }
    setStep("freelancer-payouts");
  }

  const viewrrLogo = (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#FF5A1F"/>
      <path d="M7 8l7 16h4l7-16h-4l-5 11.5L11 8H7z" fill="white"/>
    </svg>
  );

  // Step 1 complete: name + email + password
  const canProceedStep1 = !!(clientFirstName.trim() && clientLastName.trim() && clientEmail.trim() && clientPassword.length >= 8);
  // Full client form complete: step 1 + phone
  const canProceed = canProceedStep1 && !!clientPhone.trim();
  // Freelancer per-step completion flags
  const canFreeStep1 = !!(freeFirstName.trim() && freeLastName.trim() && freeEmail.trim() && freePassword.length >= 8);
  const canFreeStep2 = canFreeStep1 && !!freePhone.trim() && freeSpecialisms.length > 0;
  const canFreeProceed = canFreeStep2; // kept for proceedToFreeVerify compat
  const activeEmail = role === "freelancer" ? freeEmail : clientEmail;
  const activePhone = role === "freelancer" ? freePhone : clientPhone;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">

        {/* ── STEP: Role ── */}
        {step === "role" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{viewrrLogo} Join Viewrr</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-1 mb-2">How are you planning to use Viewrr?</p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button onClick={() => { setRole("client"); setStep("client-details"); }} className="group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors"><Building2 size={22} className="text-primary" /></div>
                <div><p className="font-semibold text-sm">I'm a Client</p><p className="text-xs text-muted-foreground mt-0.5 leading-snug">I want to hire creative talent for my projects</p></div>
                <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary mt-auto ml-auto transition-colors" />
              </button>
              <button onClick={() => { setRole("freelancer"); setStep("freelancer-type"); }} className="group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors"><UserCircle size={22} className="text-primary" /></div>
                <div><p className="font-semibold text-sm">I'm a Freelancer</p><p className="text-xs text-muted-foreground mt-0.5 leading-snug">I want to showcase my work and find clients</p></div>
                <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary mt-auto ml-auto transition-colors" />
              </button>
            </div>
            <div className="mt-5 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground text-center">Already have an account? <button className="text-primary font-medium hover:underline" onClick={handleClose}>Sign in</button></p>
            </div>
          </>
        )}

        {/* ── STEP: Freelancer type — Sole vs Agency ── */}
        {step === "freelancer-type" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{viewrrLogo} How do you work?</DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("role")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>
            <p className="text-sm text-muted-foreground mb-4">Choose the account type that best fits how you operate.</p>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => { setAccountSubtype("sole"); setStep("freelancer-details"); }}
                className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <UserCircle size={22} className="text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm">Sole Freelancer</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">You work independently. Your profile represents you alone.</p>
                </div>
                <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary mt-1 transition-colors" />
              </button>
              <button
                onClick={() => { setAccountSubtype("agency_owner"); setStep("freelancer-details"); }}
                className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Building2 size={22} className="text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm">Creative Agency</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">You run a team. Invite other freelancers to join your agency — each keeps their own profile.</p>
                </div>
                <ChevronRight size={14} className="text-muted-foreground group-hover:text-primary mt-1 transition-colors" />
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Client details (two-sub-step) ── */}
        {step === "client-details" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                {clientSubStep === 1 ? "Create your business profile" : "Almost there"}
              </DialogTitle>
            </DialogHeader>

            {/* Back button */}
            <button
              onClick={() => clientSubStep === 1 ? setStep("role") : setClientSubStep(1)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1 -mt-1"
            >
              <ArrowLeft size={12}/> Back
            </button>

            {/* Progress indicator */}
            <div className="space-y-1.5 mb-4" aria-label={`Step ${clientSubStep} of 2`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Step {clientSubStep} of 2</span>
                <span className="text-xs font-medium text-primary">{clientSubStep === 1 ? "50%" : "100%"}</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: clientSubStep === 1 ? "50%" : "100%" }}
                />
              </div>
            </div>

            {/* Sub-step 1: identity */}
            {clientSubStep === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground -mt-1">Start hiring trusted UK creative professionals.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>First Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="Alex" value={clientFirstName} onChange={e => setClientFirstName(e.target.value)} autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Last Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="Taylor" value={clientLastName} onChange={e => setClientLastName(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Email Address <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input type="email" placeholder="you@email.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} className="pl-9" />
                  </div>
                </div>
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

                {/* Continue button — animates active when step 1 complete */}
                <button
                  type="button"
                  onClick={() => { if (validateClientStep1()) setClientSubStep(2); }}
                  disabled={!canProceedStep1}
                  className={[
                    "w-full py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300",
                    canProceedStep1
                      ? "bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/25 scale-100"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  ].join(" ")}
                >
                  Continue
                  <ChevronRight size={15} className={canProceedStep1 ? "opacity-100" : "opacity-40"} />
                </button>

                <p className="text-xs text-muted-foreground text-center">
                  By joining you agree to our{" "}
                  <span className="text-primary hover:underline cursor-pointer">Terms &amp; Conditions</span> and{" "}
                  <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>.
                </p>
              </div>
            )}

            {/* Sub-step 2: business info + verify */}
            {clientSubStep === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground -mt-1">Tell us a bit about your business.</p>
                <div className="space-y-1.5">
                  <Label>Business Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input placeholder="Acme Studios" value={company} onChange={e => setCompany(e.target.value)} autoFocus />
                </div>
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

                <div className="space-y-2">
                  <Label className="text-sm">Verify your account via</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => canProceed && proceedToVerify("email")}
                      disabled={!canProceed}
                      className={[
                        "flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all duration-300",
                        canProceed
                          ? "border-primary bg-primary text-white hover:bg-primary/90 shadow-sm shadow-primary/20"
                          : "border-border text-muted-foreground opacity-50 cursor-not-allowed",
                      ].join(" ")}
                    >
                      <Mail size={15}/> Email
                    </button>
                    <button
                      type="button"
                      onClick={() => canProceed && proceedToVerify("phone")}
                      disabled={!canProceed}
                      className={[
                        "flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all",
                        canProceed
                          ? "border-border hover:border-primary hover:bg-primary/5"
                          : "border-border text-muted-foreground opacity-50 cursor-not-allowed",
                      ].join(" ")}
                    >
                      <Phone size={15}/> Phone
                    </button>
                  </div>
                  {!canProceed && (
                    <p className="text-xs text-muted-foreground text-center">Enter your contact number to continue</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── STEP: Client Verification ── */}
        {step === "client-verify" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo} {verifyMethod === "email" ? "Check your inbox" : "Check your messages"}
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => { setStep("client-details"); setClientSubStep(2); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  {verifyMethod === "email" ? <Mail size={26} className="text-primary" /> : <Phone size={26} className="text-primary" />}
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We've sent a 6-digit verification code to your{" "}
                    {verifyMethod === "email" ? "email address" : "phone number"}.
                    <br />Enter the code below to activate your Viewrr account.
                  </p>
                  <p className="text-sm font-semibold text-primary mt-2">
                    {verifyMethod === "email" ? clientEmail : clientPhone}
                  </p>
                </div>
              </div>
              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {codeInput.map((digit, i) => (
                  <input key={i} ref={el => { inputRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1} value={digit} onChange={e => handleDigit(i, e.target.value)} onKeyDown={e => handleKeyDown(i, e)} className={`w-11 text-center text-xl font-bold rounded-xl border-2 bg-background focus:outline-none transition-all ${codeError ? "border-destructive text-destructive" : digit ? "border-primary text-primary" : "border-border focus:border-primary"}`} style={{ height: "3.25rem" }} aria-label={`Digit ${i + 1}`} />
                ))}
              </div>
              {codeError && <p className="text-xs text-destructive text-center -mt-2">That code doesn't match. Please try again.</p>}
              <Button onClick={verifyAndFinish} className="w-full bg-primary hover:bg-primary/90 text-white rounded-full" disabled={codeInput.join("").length < 6}>
                Activate my account →
              </Button>
              <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span>Didn't receive it?</span>
                  {resendCooldown > 0
                    ? <span>Resend in {resendCooldown}s</span>
                    : <button onClick={() => sendVerificationCode(verifyMethod, clientEmail, clientPhone)} className="flex items-center gap-1 text-primary font-medium hover:underline"><RefreshCw size={11} /> Resend code</button>
                  }
                </div>
                <button onClick={() => proceedToVerify(verifyMethod === "email" ? "phone" : "email")} className="text-primary hover:underline">
                  Try via {verifyMethod === "email" ? "phone" : "email"} instead
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP: Freelancer details (3 sub-steps) ── */}
        {step === "freelancer-details" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo}
                {freeSubStep === 1 ? "Join the UK's trusted network" : freeSubStep === 2 ? "Your professional profile" : "Your creative story"}
              </DialogTitle>
            </DialogHeader>

            {/* Back button */}
            <button
              onClick={() => {
                if (freeSubStep === 1) setStep("freelancer-type");
                else setFreeSubStep(prev => (prev - 1) as FreeSubStep);
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1 -mt-1"
            >
              <ArrowLeft size={12}/> Back
            </button>

            {/* Progress indicator */}
            <div className="space-y-1.5 mb-4" aria-label={`Step ${freeSubStep} of 3`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Step {freeSubStep} of 3</span>
                <span className="text-xs font-medium text-primary">
                  {freeSubStep === 1 ? "33%" : freeSubStep === 2 ? "67%" : "100%"}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: freeSubStep === 1 ? "33%" : freeSubStep === 2 ? "67%" : "100%" }}
                />
              </div>
            </div>

            {/* Sub-step 1: Personal Details */}
            {freeSubStep === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground -mt-1">Build your profile, showcase your work and become part of a curated creative marketplace.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>First Name <span className="text-destructive">*</span></Label><Input placeholder="Marcus" value={freeFirstName} onChange={e => setFreeFirstName(e.target.value)} autoFocus /></div>
                  <div className="space-y-1.5"><Label>Last Name <span className="text-destructive">*</span></Label><Input placeholder="Reid" value={freeLastName} onChange={e => setFreeLastName(e.target.value)} /></div>
                </div>
                <div className="space-y-1.5">
                  <Label>Email Address <span className="text-destructive">*</span></Label>
                  <div className="relative"><Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input type="email" placeholder="you@email.com" value={freeEmail} onChange={e => setFreeEmail(e.target.value)} className="pl-9" /></div>
                </div>
                <div className="space-y-1.5">
                  <Label>Password <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <Input type={showFreePassword ? "text" : "password"} placeholder="At least 8 characters" value={freePassword} onChange={e => setFreePassword(e.target.value)} className="pr-10" />
                    <button type="button" onClick={() => setShowFreePassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showFreePassword ? <EyeOff size={15}/> : <Eye size={15}/>}</button>
                  </div>
                  {freePassword && freePassword.length < 8 && <p className="text-xs text-destructive">Password must be at least 8 characters</p>}
                </div>
                <button
                  type="button"
                  onClick={() => { if (validateFreeStep1()) setFreeSubStep(2); }}
                  disabled={!canFreeStep1}
                  className={[
                    "w-full py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300",
                    canFreeStep1
                      ? "bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/25"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  ].join(" ")}
                >
                  Continue <ChevronRight size={15} className={canFreeStep1 ? "opacity-100" : "opacity-40"} />
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  By joining you agree to our{" "}
                  <span className="text-primary hover:underline cursor-pointer">Terms &amp; Conditions</span> and{" "}
                  <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>.
                </p>
              </div>
            )}

            {/* Sub-step 2: Professional Profile */}
            {freeSubStep === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground -mt-1">Tell us about your craft and how you work.</p>
                <div className="space-y-1.5">
                  <Label>Contact Number <span className="text-destructive">*</span></Label>
                  <div className="relative"><Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input type="tel" placeholder="+44 7700 900000" value={freePhone} onChange={e => setFreePhone(e.target.value)} className="pl-9" autoFocus /></div>
                </div>

                {/* Specialisms */}
                <div>
                  <Label className="mb-2 block">Creative Specialisms <span className="text-destructive">*</span> <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                  <div className="grid grid-cols-2 gap-2">
                    {SPECIALISMS.map(({ id, icon: Icon, label }) => (
                      <button key={id} type="button" onClick={() => toggleSpecialism(id)} className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${freeSpecialisms.includes(id) ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
                        <Icon size={15} className={freeSpecialisms.includes(id) ? "text-primary" : "text-muted-foreground"} />
                        {label}
                        {freeSpecialisms.includes(id) && <Check size={13} className="ml-auto text-primary" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Experience */}
                <div>
                  <Label className="mb-2 block">Years of Experience</Label>
                  <div className="flex flex-wrap gap-2">
                    {EXPERIENCE_LEVELS.map(lvl => (
                      <button key={lvl} type="button" onClick={() => setExperience(lvl)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${experience === lvl ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>{lvl}</button>
                    ))}
                  </div>
                </div>

                {/* Equipment */}
                <div>
                  <Label className="mb-2 block">Equipment &amp; Software <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <div className="flex flex-wrap gap-2">
                    {EQUIPMENT_OPTIONS.map(eq => (
                      <button key={eq} type="button" onClick={() => toggleEquipment(eq)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${equipment.includes(eq) ? "bg-primary/10 text-primary border-primary/50" : "border-border text-muted-foreground hover:border-primary/40"}`}>{eq}</button>
                    ))}
                  </div>
                </div>

                {/* Company / Brand */}
                <div className="space-y-1.5">
                  <Label>Company / Brand Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input placeholder="My Studio" value={freeCompany} onChange={e => setFreeCompany(e.target.value)} />
                </div>

                <button
                  type="button"
                  onClick={() => { if (validateFreeStep2()) setFreeSubStep(3); }}
                  disabled={!canFreeStep2}
                  className={[
                    "w-full py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300",
                    canFreeStep2
                      ? "bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/25"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  ].join(" ")}
                >
                  Continue <ChevronRight size={15} className={canFreeStep2 ? "opacity-100" : "opacity-40"} />
                </button>
              </div>
            )}

            {/* Sub-step 3: Creative Story */}
            {freeSubStep === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground -mt-1">Help clients understand who you are and what it's like to work with you.</p>

                {/* Bio */}
                <div className="space-y-1.5">
                  <Label>About You <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Textarea
                    placeholder="Tell clients what it's like to work with you. What makes your creative process different? What experience can clients expect?"
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                </div>

                {/* Verify method — completes registration */}
                <div className="space-y-2">
                  <Label className="text-sm">Verify to complete registration</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => canFreeProceed && proceedToFreeVerify("email")} disabled={!canFreeProceed} className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all ${canFreeProceed ? "border-primary bg-primary text-white hover:bg-primary/90" : "border-border text-muted-foreground opacity-50 cursor-not-allowed"}`}><Mail size={15}/> Via Email</button>
                    <button type="button" onClick={() => canFreeProceed && proceedToFreeVerify("phone")} disabled={!canFreeProceed} className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-all ${canFreeProceed ? "border-border hover:border-primary hover:bg-primary/5" : "border-border text-muted-foreground opacity-50 cursor-not-allowed"}`}><Phone size={15}/> Via Phone</button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center">By joining you agree to our Terms &amp; Conditions and Privacy Policy.</p>
              </div>
            )}
          </>
        )}

        {/* ── STEP: Freelancer Verification ── */}
        {step === "freelancer-verify" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {viewrrLogo} {verifyMethod === "email" ? "Check your inbox" : "Check your messages"}
              </DialogTitle>
            </DialogHeader>
            <button onClick={() => setStep("freelancer-details")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 -mt-1"><ArrowLeft size={12}/> Back</button>
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  {verifyMethod === "email" ? <Mail size={26} className="text-primary" /> : <Phone size={26} className="text-primary" />}
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We've sent a 6-digit verification code to your{" "}
                    {verifyMethod === "email" ? "email address" : "phone number"}.
                    <br />Enter the code below to activate your Viewrr account.
                  </p>
                  <p className="text-sm font-semibold text-primary mt-2">
                    {verifyMethod === "email" ? freeEmail : freePhone}
                  </p>
                </div>
              </div>
              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {codeInput.map((digit, i) => (
                  <input key={i} ref={el => { inputRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1} value={digit} onChange={e => handleDigit(i, e.target.value)} onKeyDown={e => handleKeyDown(i, e)} className={`w-11 text-center text-xl font-bold rounded-xl border-2 bg-background focus:outline-none transition-all ${codeError ? "border-destructive text-destructive" : digit ? "border-primary text-primary" : "border-border focus:border-primary"}`} style={{ height: "3.25rem" }} aria-label={`Digit ${i + 1}`} />
                ))}
              </div>
              {codeError && <p className="text-xs text-destructive text-center -mt-2">That code doesn't match. Please try again.</p>}
              <Button onClick={verifyAndFinishFreelancer} className="w-full bg-primary hover:bg-primary/90 text-white rounded-full" disabled={codeInput.join("").length < 6}>
                Activate my account →
              </Button>
              <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span>Didn't receive it?</span>
                  {resendCooldown > 0
                    ? <span>Resend in {resendCooldown}s</span>
                    : <button onClick={() => sendVerificationCode(verifyMethod, freeEmail, freePhone)} className="flex items-center gap-1 text-primary font-medium hover:underline"><RefreshCw size={11} /> Resend code</button>
                  }
                </div>
                <button onClick={() => proceedToFreeVerify(verifyMethod === "email" ? "phone" : "email")} className="text-primary hover:underline">
                  Try via {verifyMethod === "email" ? "phone" : "email"} instead
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP: Freelancer Accreditation Journey ── */}
        {step === "freelancer-accreditation" && (
          <div className="py-6 flex flex-col items-center text-center gap-5">
            {/* Icon */}
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,90,31,0.1)" }}>
              <ShieldCheck size={30} style={{ color: "#FF5A1F" }} />
            </div>

            <div className="space-y-1.5">
              <h3 className="font-bold text-xl text-foreground">Welcome to Viewrr.</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your account has been successfully created.
              </p>
            </div>

            {/* Verified badge */}
            <div className="w-full rounded-2xl border border-border bg-muted/30 p-4 text-left">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,90,31,0.12)" }}>
                  <Check size={16} style={{ color: "#FF5A1F" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold">✅ Verified</p>
                  <p className="text-xs text-muted-foreground">Your current accreditation level</p>
                </div>
              </div>
            </div>

            {/* Aspiration: Viewrr Approved */}
            <div className="w-full rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 text-left space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,90,31,0.12)" }}>
                  <Zap size={16} style={{ color: "#FF5A1F" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold">⭐ Viewrr Approved</p>
                  <p className="text-xs text-muted-foreground">Your next milestone</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed pl-11">
                Our Founder team personally reviews every creative portfolio submitted to Viewrr. Viewrr Approved represents professional quality — a badge that sets you apart in the marketplace.
              </p>
            </div>

            {/* What happens next */}
            <div className="w-full text-left space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What happens next</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Complete your portfolio below. Once submitted, our Founder team will review your work and consider you for Viewrr Approved status.
              </p>
            </div>

            <Button
              className="w-full bg-primary hover:bg-primary/90 text-white rounded-full font-semibold"
              onClick={() => setStep("freelancer-portfolio")}
            >
              Complete my portfolio →
            </Button>
          </div>
        )}

        {/* ── STEP: Freelancer portfolio ── */}
        {step === "freelancer-portfolio" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{viewrrLogo} Add your portfolio</DialogTitle>
            </DialogHeader>

            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Add Vimeo or YouTube links to showcase your work — they'll display on your public profile with no file size limits.
              </p>

              <div className="space-y-4">
                {portfolioItems.map((item, index) => {
                  const valid = item.url.trim() ? isValidVideoUrl(item.url.trim()) : null;
                  const parsed = item.url.trim() ? parseVideoUrl(item.url.trim()) : null;
                  return (
                    <div key={index} className="border border-border rounded-xl p-4 space-y-3 bg-background">
                      <div className="flex items-center gap-2">
                        <GripVertical size={14} className="text-muted-foreground/40 flex-shrink-0" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Video {index + 1}{index === 0 ? " · Featured" : ""}
                        </span>
                        {portfolioItems.length > 1 && (
                          <button onClick={() => removePortfolioItem(index)} className="ml-auto text-muted-foreground hover:text-destructive transition-colors" title="Remove">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>

                      <Input
                        placeholder="Title (optional) — e.g. Wedding Showreel 2024"
                        value={item.title}
                        onChange={e => setPortfolioItem(index, "title", e.target.value)}
                        className="text-sm"
                      />

                      <div className="relative">
                        <Input
                          placeholder="https://vimeo.com/123456789  or  https://youtu.be/..."
                          value={item.url}
                          onChange={e => setPortfolioItem(index, "url", e.target.value)}
                          className={`text-sm pr-24 ${item.url.trim() && valid === false ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        />
                        {item.url.trim() && (
                          <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide ${valid ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                            {valid ? (parsed?.provider === "vimeo" ? "Vimeo ✓" : "YouTube ✓") : "Invalid"}
                          </span>
                        )}
                      </div>

                      {valid && item.url.trim() && (
                        <VideoEmbed url={item.url.trim()} className="rounded-lg" />
                      )}
                    </div>
                  );
                })}
              </div>

              <button onClick={addPortfolioItem} className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
                <Plus size={15} /> Add another video
              </button>

              {portfolioItems.every(it => !it.url.trim()) && (
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl py-8 gap-2 text-muted-foreground">
                  <Film size={28} className="opacity-30" />
                  <p className="text-sm">No videos added yet</p>
                  <p className="text-xs opacity-60">Paste Vimeo or YouTube links above</p>
                </div>
              )}

              <Button
                onClick={finishFreelancer}
                disabled={portfolioSaving}
                className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
              >
                {portfolioSaving ? "Saving..." : "Complete my profile →"}
              </Button>
              {!portfolioSaving && (
                <button onClick={finishFreelancer} className="w-full text-xs text-muted-foreground hover:text-foreground text-center">Skip for now</button>
              )}
              <p className="text-xs text-muted-foreground text-center">Your videos stay hosted on Vimeo or YouTube — no upload limits</p>
            </div>
          </>
        )}

        {/* ── STEP: Freelancer Payouts Setup ── */}
        {step === "freelancer-payouts" && (
          <>
            {/* Popup waiting overlay — rendered inside Dialog */}
            {payoutsPopupOpen && (
              <div
                className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
              >
                <div className="flex flex-col items-center text-center px-6">
                  <div className="relative mb-5">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(255,90,31,0.12)" }}>
                      <Banknote size={24} style={{ color: "#FF5A1F" }} />
                    </div>
                    <svg className="absolute inset-0 w-14 h-14" viewBox="0 0 56 56" style={{ animation: "spin 2s linear infinite" }}>
                      <circle cx="28" cy="28" r="25" fill="none" stroke="#FF5A1F" strokeWidth="2.5" strokeDasharray="50 100" strokeLinecap="round" />
                    </svg>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  </div>
                  <p className="text-sm font-semibold mb-1">Stripe verification open</p>
                  <p className="text-xs text-muted-foreground mb-5">Complete the steps in the window.<br/>This will update automatically.</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => payoutsPopupRef.current?.focus()}>Bring to front</Button>
                    <Button size="sm" variant="ghost" className="rounded-full text-xs text-muted-foreground"
                      onClick={() => {
                        payoutsPopupRef.current?.close();
                        if (payoutsPollRef.current) clearInterval(payoutsPollRef.current);
                        setPayoutsPopupOpen(false);
                      }}
                    >Cancel</Button>
                  </div>
                </div>
              </div>
            )}

            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{viewrrLogo} Set up your payouts</DialogTitle>
            </DialogHeader>

            <div className="space-y-5">
              {payoutsPopupDone ? (
                /* Success state */
                <div className="py-4 flex flex-col items-center text-center gap-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)" }}>
                    <Check size={26} style={{ color: "#16a34a" }} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Payout details submitted</p>
                    <p className="text-xs text-muted-foreground mt-1">Stripe will verify your details shortly. Payments will flow to you automatically.</p>
                  </div>
                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
                    onClick={() => {
                      setStep("done");
                      toast({ title: `Welcome to Viewrr, ${freeFirstName}!` });
                      setTimeout(() => { handleClose(); navigate("/dashboard"); }, 1800);
                    }}
                  >
                    Go to my dashboard →
                  </Button>
                </div>
              ) : (
                /* Default state */
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Connect your bank account so clients can pay you directly. Takes about 2 minutes via Stripe.
                  </p>

                  {/* Trust bullets */}
                  <div className="space-y-2.5">
                    {[
                      { icon: ShieldCheck, text: "Identity verified once — never again" },
                      { icon: Zap,         text: "Payments land in your account automatically" },
                      { icon: Banknote,    text: "Standard Stripe processing rates — no Viewrr fee" },
                    ].map(({ icon: Icon, text }) => (
                      <div key={text} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                        <Icon size={13} style={{ color: "#FF5A1F", flexShrink: 0 }} />
                        {text}
                      </div>
                    ))}
                  </div>

                  <Button
                    className="w-full text-white rounded-full"
                    style={{ background: "linear-gradient(135deg,#FF5A1F,#FF8C42)" }}
                    disabled={!newUserId}
                    onClick={async () => {
                      if (!newUserId) return;
                      try {
                        const r1 = await fetch("/api/stripe/connect-account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: newUserId }) });
                        if (!r1.ok) throw new Error("Could not create account");
                        const r2 = await fetch("/api/stripe/onboarding-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: newUserId }) });
                        if (!r2.ok) throw new Error("Could not get link");
                        const { url } = await r2.json();
                        const w = 520, h = 720;
                        const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
                        const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);
                        const popup = window.open(url, "stripe_onboarding", `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
                        if (popup) {
                          payoutsPopupRef.current = popup;
                          setPayoutsPopupOpen(true);
                          if (payoutsPollRef.current) clearInterval(payoutsPollRef.current);
                          payoutsPollRef.current = setInterval(async () => {
                            if (payoutsPopupRef.current?.closed) {
                              clearInterval(payoutsPollRef.current!);
                              setPayoutsPopupOpen(false);
                              return;
                            }
                            try {
                              const sr = await fetch(`/api/stripe/status/${newUserId}`);
                              if (sr.ok) {
                                const sd = await sr.json();
                                if (sd.onboarded) {
                                  clearInterval(payoutsPollRef.current!);
                                  payoutsPopupRef.current?.close();
                                  setPayoutsPopupOpen(false);
                                  setPayoutsPopupDone(true);
                                }
                              }
                            } catch {}
                          }, 2500);
                        } else {
                          window.location.href = url;
                        }
                      } catch (e: any) {
                        toast({ title: "Could not open Stripe", description: e.message, variant: "destructive" });
                      }
                    }}
                  >
                    <Banknote size={14} className="mr-1" /> Connect bank account
                  </Button>

                  <button
                    className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
                    onClick={() => {
                      if (accountSubtype === "agency_owner") {
                        setStep("agency-setup");
                      } else {
                        setStep("done");
                        toast({ title: `Welcome to Viewrr, ${freeFirstName}!`, description: "You can add bank details anytime from Your Work." });
                        setTimeout(() => { handleClose(); navigate("/dashboard"); }, 1800);
                      }
                    }}
                  >
                    {accountSubtype === "agency_owner" ? "Continue to agency setup →" : "Skip for now — I'll do this later"}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* ── STEP: Agency Setup ── */}
        {step === "agency-setup" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{viewrrLogo} Set up your agency</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-1 mb-4">Give your agency a name and a few details. You can edit everything later from your dashboard.</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Agency Name <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. Spark Films" value={agencyName} onChange={e => setAgencyName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>About your agency <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  placeholder="What kind of work do you take on? What makes your team different?"
                  value={agencyBio}
                  onChange={e => setAgencyBio(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>
              <div className="space-y-2">
                <Label>Specialisms</Label>
                <div className="flex flex-wrap gap-2">
                  {SPECIALISMS.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setAgencySpecialisms(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        agencySpecialisms.includes(s.id)
                          ? "bg-primary text-white border-primary"
                          : "border-border hover:border-primary hover:text-primary"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Showreel URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input placeholder="YouTube or Vimeo link" value={agencyReelUrl} onChange={e => setAgencyReelUrl(e.target.value)} />
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90 text-white rounded-full"
                disabled={!agencyName.trim() || agencyCreating}
                onClick={async () => {
                  if (!newUserId) return;
                  setAgencyCreating(true);
                  try {
                    const res = await fetch("/api/agencies", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        ownerUserId: newUserId,
                        name: agencyName.trim(),
                        bio: agencyBio.trim(),
                        specialisms: agencySpecialisms,
                        reelUrl: agencyReelUrl.trim() || undefined,
                      }),
                    });
                    if (!res.ok) {
                      const err = await res.json();
                      toast({ title: "Couldn't create agency", description: err.error ?? "Please try again.", variant: "destructive" });
                      return;
                    }
                    setStep("done");
                    toast({ title: `Agency "${agencyName}" created!`, description: "Your invite link is ready in your dashboard." });
                    setTimeout(() => { handleClose(); navigate("/dashboard"); }, 1800);
                  } catch {
                    toast({ title: "Something went wrong", variant: "destructive" });
                  } finally {
                    setAgencyCreating(false);
                  }
                }}
              >
                {agencyCreating ? "Creating agency…" : "Create agency →"}
              </Button>
              <button
                className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
                onClick={() => {
                  setStep("done");
                  toast({ title: `Welcome to Viewrr, ${freeFirstName}!`, description: "You can set up your agency anytime from your dashboard." });
                  setTimeout(() => { handleClose(); navigate("/dashboard"); }, 1800);
                }}
              >
                Skip — I'll do this later
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Done / Welcome Screen ── */}
        {step === "done" && (
          <div className="py-8 flex flex-col items-center text-center gap-5">
            {/* Emoji celebration */}
            <div className="text-5xl select-none" role="img" aria-label="Celebration">🎉</div>

            <div className="space-y-2">
              <h3 className="font-bold text-xl text-foreground">Welcome to Viewrr.</h3>
              {role === "client" ? (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Your business profile has been created successfully.
                    <br />You're now ready to hire trusted UK creative professionals.
                  </p>
                </>
              ) : null}
            </div>

            {role === "client" ? (
              <div className="flex flex-col gap-2.5 w-full">
                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-white rounded-full font-semibold"
                  onClick={() => { handleClose(); navigate("/marketplace"); }}
                >
                  Browse Creatives →
                </Button>
                <Button
                  variant="outline"
                  className="w-full rounded-full font-medium"
                  onClick={() => { handleClose(); navigate("/dashboard"); }}
                >
                  Complete Business Profile
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 w-full">
                <p className="text-sm text-muted-foreground leading-relaxed -mt-1">
                  Your creative profile has been created.<br />
                  You're now part of a curated community of UK creative professionals.
                </p>
                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-white rounded-full font-semibold"
                  onClick={() => { handleClose(); navigate("/dashboard"); }}
                >
                  Complete Portfolio
                </Button>
                <Button
                  variant="outline"
                  className="w-full rounded-full font-medium"
                  onClick={() => { handleClose(); navigate("/marketplace"); }}
                >
                  Explore Community
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Share your profile on LinkedIn to let clients know you're available.
            </p>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
