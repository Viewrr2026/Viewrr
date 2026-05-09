import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/AuthProvider";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  User, MapPin, Mail, AlignLeft, Clock, CheckCircle, Briefcase,
  Video, Scissors, Camera, Megaphone, PoundSterling, Check, Wrench,
  ChevronDown,
} from "lucide-react";
import ImageUpload from "@/components/ImageUpload";

// ── Constants ─────────────────────────────────────────────────────────────────
const AVAILABILITY_OPTIONS = [
  { value: "available",      label: "Available now" },
  { value: "limited",        label: "Limited availability" },
  { value: "busy",           label: "Busy — not taking work" },
  { value: "open_to_offers", label: "Open to offers" },
];

const SPECIALISMS = [
  { id: "Videographer",  icon: Video,     label: "Videographer" },
  { id: "Video Editor",  icon: Scissors,  label: "Video Editor" },
  { id: "Photographer",  icon: Camera,    label: "Photographer" },
  { id: "Marketer",      icon: Megaphone, label: "Marketer" },
];

const EXPERIENCE_LEVELS = [
  { label: "< 1 year",   years: 0 },
  { label: "1–2 years",  years: 1 },
  { label: "3–5 years",  years: 3 },
  { label: "6–10 years", years: 6 },
  { label: "10+ years",  years: 10 },
];

const SUGGESTED_SKILLS = [
  "Sony FX3 / A7S III", "Canon C70 / R5C", "DJI Drone", "Gimbal / Stabiliser",
  "Studio Lighting", "Adobe Premiere Pro", "DaVinci Resolve", "After Effects",
  "Cinematography", "Colour Grading", "Sound Design", "Motion Graphics",
  "Brand Films", "Documentaries", "Social Media", "Weddings",
];

function yearsToLabel(yrs: number): string {
  if (yrs <= 0) return "< 1 year";
  if (yrs === 1) return "1–2 years";
  if (yrs === 3) return "3–5 years";
  if (yrs === 6) return "6–10 years";
  return "10+ years";
}

// ── Accordion section ─────────────────────────────────────────────────────────
function Section({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-secondary/50 transition-colors"
      >
        <div>
          <p className="font-semibold text-sm">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <ChevronDown
          size={16}
          className={`text-muted-foreground flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-border bg-background">
          {children}
        </div>
      )}
    </div>
  );
}

// ── EditProfileModal ──────────────────────────────────────────────────────────
export default function EditProfileModal({
  open,
  onClose,
  user,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  user: {
    id: number;
    name: string;
    email: string;
    bio?: string;
    avatar?: string;
    banner?: string;
    headline?: string;
    location?: string;
    role: string;
  };
  profile?: {
    id: number;
    availability: string;
    specialisms?: string;
    skills?: string;
    yearsExperience?: number | null;
    hourlyRate?: number | null;
    dayRate?: number | null;
    cardThumbnail?: string | null;
  };
}) {
  const { toast } = useToast();
  const { updateUser } = useAuth();
  const isFreelancer = user.role === "freelancer";

  // Which accordion sections are open
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    appearance: true,
    basics: true,
    card: true,
  });

  function toggleSection(key: string) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // ── User fields ─────────────────────────────────────────────────────────────
  const [name,     setName]     = useState(user.name ?? "");
  const [email,    setEmail]    = useState(user.email ?? "");
  const [bio,      setBio]      = useState(user.bio ?? "");
  const [headline, setHeadline] = useState(user.headline ?? "");
  const [location, setLocation] = useState(user.location ?? "");
  const [avatar,   setAvatar]   = useState<string | undefined>(user.avatar ?? undefined);
  const [banner,   setBanner]   = useState<string | undefined>(user.banner ?? undefined);

  // ── Profile fields (freelancer only) ────────────────────────────────────────
  const [availability, setAvailability] = useState(profile?.availability ?? "available");

  const initSpecialisms: string[] = (() => {
    try { return JSON.parse(profile?.specialisms || "[]"); } catch { return []; }
  })();
  const initSkills: string[] = (() => {
    try { return JSON.parse(profile?.skills || "[]"); } catch { return []; }
  })();

  const [specialisms,     setSpecialisms]     = useState<string[]>(initSpecialisms);
  const [skills,          setSkills]          = useState<string[]>(initSkills);
  const [yearsExperience, setYearsExperience] = useState<number>(profile?.yearsExperience ?? 0);
  const [hourlyRate,      setHourlyRate]      = useState<string>(profile?.hourlyRate ? String(profile.hourlyRate) : "");
  const [dayRate,         setDayRate]         = useState<string>(profile?.dayRate    ? String(profile.dayRate)    : "");
  const [customSkill,     setCustomSkill]     = useState("");
  const [cardThumbnail,   setCardThumbnail]   = useState<string | undefined>(profile?.cardThumbnail ?? undefined);

  const [saved, setSaved] = useState(false);

  function toggleSpecialism(id: string) {
    setSpecialisms(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  function toggleSkill(skill: string) {
    setSkills(s => s.includes(skill) ? s.filter(x => x !== skill) : [...s, skill]);
  }
  function addCustomSkill() {
    const trimmed = customSkill.trim();
    if (!trimmed || skills.includes(trimmed)) { setCustomSkill(""); return; }
    setSkills(s => [...s, trimmed]);
    setCustomSkill("");
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const userRes = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:     name.trim()     || undefined,
          email:    email.trim()    || undefined,
          bio:      bio.trim()      || undefined,
          headline: headline.trim() || undefined,
          location: location.trim() || undefined,
          avatar:   avatar || undefined,
          banner:   banner || undefined,
        }),
      });
      if (!userRes.ok) throw new Error("Failed to update profile");
      const updatedUser = await userRes.json();

      if (isFreelancer && profile?.id) {
        const profBody: Record<string, any> = {
          availability,
          specialisms:     JSON.stringify(specialisms),
          skills:          JSON.stringify(skills),
          yearsExperience: yearsExperience,
          cardThumbnail:   cardThumbnail || null,
        };
        if (hourlyRate !== "") profBody.hourlyRate = Number(hourlyRate) || null;
        if (dayRate    !== "") profBody.dayRate    = Number(dayRate)    || null;

        const profRes = await fetch(`/api/profiles/${profile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profBody),
        });
        if (!profRes.ok) throw new Error("Failed to update profile details");
      }

      return updatedUser;
    },
    onSuccess: (updatedUser) => {
      updateUser({
        name:     updatedUser.name,
        email:    updatedUser.email,
        bio:      updatedUser.bio,
        headline: updatedUser.headline,
        avatar:   updatedUser.avatar,
        banner:   updatedUser.banner,
        location: updatedUser.location,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles/own"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1200);
      toast({ title: "Profile updated!" });
    },
    onError: (e: any) => toast({ title: e.message ?? "Failed to save", variant: "destructive" }),
  });

  // ── Subtitles summarising current values ────────────────────────────────────
  const appearanceSubtitle = avatar ? "Profile photo set" : "No photo yet";
  const basicsSubtitle = [name, headline, location].filter(Boolean).join(" · ") || "Fill in your details";
  const cardSubtitle = isFreelancer
    ? [
        specialisms.length ? specialisms.join(", ") : null,
        dayRate ? `£${dayRate}/day` : null,
        yearsExperience !== null ? yearsToLabel(yearsExperience) : null,
      ].filter(Boolean).join(" · ") || "Customise your public card"
    : "";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">

        {/* Live banner + avatar preview */}
        <div className="relative flex-shrink-0">
          <div
            className="h-24 w-full rounded-t-xl bg-gradient-to-r from-primary/30 via-primary/10 to-background overflow-hidden bg-cover bg-center"
            style={banner ? { backgroundImage: `url(${banner})` } : {}}
          />
          <div className="absolute -bottom-7 left-5">
            <Avatar className="w-14 h-14 border-4 border-background shadow-md">
              {avatar
                ? <AvatarImage src={avatar} />
                : <AvatarFallback className="bg-primary text-white text-lg font-bold">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              }
            </Avatar>
          </div>
        </div>

        <DialogHeader className="px-5 pt-11 pb-2">
          <DialogTitle className="text-lg font-bold">Edit profile</DialogTitle>
          <p className="text-xs text-muted-foreground">Open a section to make changes. Save when you're done.</p>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-3">

          {/* ── APPEARANCE ────────────────────────────────────────────────── */}
          <Section
            title="Appearance"
            subtitle={appearanceSubtitle}
            open={openSections.appearance}
            onToggle={() => toggleSection("appearance")}
          >
            <ImageUpload
              value={avatar}
              onChange={setAvatar}
              label="Profile picture"
              hint="Square photo works best · compressed to under 300 KB automatically"
              roundedFull
              maxSizeKB={300}
              maxWidthPx={500}
            />
            <ImageUpload
              value={banner}
              onChange={setBanner}
              label="Banner image"
              hint="Wide image at the top of your profile · compressed to under 500 KB"
              aspectRatio={4}
              maxSizeKB={500}
              maxWidthPx={1200}
            />
          </Section>

          {/* ── BASICS ───────────────────────────────────────────────────── */}
          <Section
            title="Basics"
            subtitle={basicsSubtitle}
            open={openSections.basics}
            onToggle={() => toggleSection("basics")}
          >
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <User size={11} /> Full name *
              </Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="text-sm" placeholder="Your full name" />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Mail size={11} /> Email *
              </Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="text-sm" placeholder="you@example.com" />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Briefcase size={11} /> Headline
              </Label>
              <Input value={headline} onChange={e => setHeadline(e.target.value)} maxLength={100} className="text-sm" placeholder="e.g. Videographer & Director · London" />
              <p className="text-[11px] text-muted-foreground">Shown beneath your name on your public profile.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <AlignLeft size={11} /> Bio
              </Label>
              <Textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={300} placeholder="Tell clients a little about yourself…" className="text-sm resize-none" />
              <p className="text-[11px] text-muted-foreground text-right">{bio.length}/300</p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin size={11} /> Location
              </Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} className="text-sm" placeholder="e.g. London, UK" />
            </div>
          </Section>

          {/* ── PROFILE CARD (freelancers only) ──────────────────────────── */}
          {isFreelancer && (
            <Section
              title="Profile card"
              subtitle={cardSubtitle}
              open={openSections.card}
              onToggle={() => toggleSection("card")}
            >
              <p className="text-xs text-muted-foreground -mt-1">
                What clients see on Browse Talent and in connection previews.
              </p>

              {/* Card thumbnail */}
              <ImageUpload
                value={cardThumbnail}
                onChange={setCardThumbnail}
                label="Card thumbnail"
                hint="The image shown at the top of your browse card — wide/landscape works best · compressed to under 500 KB"
                aspectRatio={16 / 9}
                maxSizeKB={500}
                maxWidthPx={1200}
              />

              {/* Availability */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Clock size={11} /> Availability
                </Label>
                <Select value={availability} onValueChange={setAvailability}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AVAILABILITY_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Specialisms */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Video size={11} /> What do you do?
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {SPECIALISMS.map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleSpecialism(id)}
                      className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        specialisms.includes(id)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/40 text-foreground"
                      }`}
                    >
                      <Icon size={15} className={specialisms.includes(id) ? "text-primary" : "text-muted-foreground"} />
                      {label}
                      {specialisms.includes(id) && <Check size={13} className="ml-auto text-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Skills */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Wrench size={11} /> Skills &amp; equipment
                </Label>
                <p className="text-[11px] text-muted-foreground">Up to 3 shown on your card; all visible on your full profile.</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_SKILLS.map(skill => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        skills.includes(skill)
                          ? "bg-primary/10 text-primary border-primary/50"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {skill}
                    </button>
                  ))}
                </div>
                {/* Custom skills not in preset list */}
                {skills.filter(s => !SUGGESTED_SKILLS.includes(s)).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {skills.filter(s => !SUGGESTED_SKILLS.includes(s)).map(skill => (
                      <button
                        key={skill}
                        type="button"
                        onClick={() => toggleSkill(skill)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium border bg-primary/10 text-primary border-primary/50"
                      >
                        {skill} ×
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    value={customSkill}
                    onChange={e => setCustomSkill(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomSkill(); } }}
                    placeholder="Add a custom skill…"
                    className="text-sm h-8"
                    maxLength={40}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addCustomSkill} disabled={!customSkill.trim()} className="h-8 px-3 text-xs rounded-lg">Add</Button>
                </div>
              </div>

              {/* Experience */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Clock size={11} /> Years of experience
                </Label>
                <div className="flex flex-wrap gap-2">
                  {EXPERIENCE_LEVELS.map(({ label, years }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setYearsExperience(years)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        yearsExperience === years
                          ? "bg-primary text-white border-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rates */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <PoundSterling size={11} /> Rates
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">Day rate <span className="text-primary font-medium">· shown on card</span></p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                      <Input type="number" min={0} value={dayRate} onChange={e => setDayRate(e.target.value)} className="text-sm pl-7" placeholder="e.g. 650" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">Hourly rate <span className="text-muted-foreground">· full profile</span></p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                      <Input type="number" min={0} value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} className="text-sm pl-7" placeholder="e.g. 85" />
                    </div>
                  </div>
                </div>
              </div>
            </Section>
          )}

          {/* ── SAVE ─────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 pt-1">
            <Button variant="outline" className="rounded-full" onClick={onClose} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !name.trim() || !email.trim()}
              className="ml-auto bg-primary hover:bg-primary/90 text-white rounded-full px-6"
            >
              {saved
                ? <><CheckCircle size={14} className="mr-1.5" /> Saved!</>
                : saveMutation.isPending ? "Saving…" : "Save changes"
              }
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
