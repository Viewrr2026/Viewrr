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
import { Label } from "@/components/ui/label"; // still used for name/email/bio fields
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { User, MapPin, Mail, AlignLeft, Clock, CheckCircle } from "lucide-react";
import ImageUpload from "@/components/ImageUpload";

// ── Availability options ─────────────────────────────────────────────────────
const AVAILABILITY_OPTIONS = [
  { value: "available",      label: "Available now" },
  { value: "limited",        label: "Limited availability" },
  { value: "busy",           label: "Busy — not taking work" },
  { value: "open_to_offers", label: "Open to offers" },
];

// ── EditProfileModal ──────────────────────────────────────────────────────────
export default function EditProfileModal({
  open,
  onClose,
  user,
  profile,   // freelancer profile (may be undefined for clients)
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
    location?: string;
    role: string;
  };
  profile?: {
    id: number;
    availability: string;
  };
}) {
  const { toast } = useToast();
  const { updateUser } = useAuth();
  const isFreelancer = user.role === "freelancer";

  // Form state — user fields
  const [name,     setName]     = useState(user.name ?? "");
  const [email,    setEmail]    = useState(user.email ?? "");
  const [bio,      setBio]      = useState(user.bio ?? "");
  const [location, setLocation] = useState(user.location ?? "");
  const [avatar,   setAvatar]   = useState<string | undefined>(user.avatar ?? undefined);
  const [banner,   setBanner]   = useState<string | undefined>(user.banner ?? undefined);

  // Freelancer-only
  const [availability, setAvailability] = useState(profile?.availability ?? "available");

  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // 1 — patch user
      const userRes = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:     name.trim()     || undefined,
          email:    email.trim()    || undefined,
          bio:      bio.trim()      || undefined,
          location: location.trim() || undefined,
          avatar:   avatar || undefined,
          banner:   banner || undefined,
        }),
      });
      if (!userRes.ok) throw new Error("Failed to update profile");
      const updatedUser = await userRes.json();

      // 2 — patch profile (availability) — freelancers only
      if (isFreelancer && profile?.id) {
        const profRes = await fetch(`/api/profiles/${profile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ availability }),
        });
        if (!profRes.ok) throw new Error("Failed to update availability");
      }

      return updatedUser;
    },
    onSuccess: (updatedUser) => {
      // Push new user data into AuthProvider + localStorage immediately
      updateUser({
        name:     updatedUser.name,
        email:    updatedUser.email,
        bio:      updatedUser.bio,
        avatar:   updatedUser.avatar,
        banner:   updatedUser.banner,
        location: updatedUser.location,
      });
      // Bust profile queries so availability + profile page refresh
      queryClient.invalidateQueries({ queryKey: ["/api/profiles/own"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1200);
      toast({ title: "Profile updated!" });
    },
    onError: (e: any) => toast({ title: e.message ?? "Failed to save", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
        {/* Live banner + avatar preview strip */}
        <div className="relative">
          <div
            className="h-28 w-full rounded-t-xl bg-gradient-to-r from-primary/30 via-primary/10 to-background overflow-hidden bg-cover bg-center"
            style={banner ? { backgroundImage: `url(${banner})` } : {}}
          />
          <div className="absolute -bottom-8 left-6">
            <Avatar className="w-16 h-16 border-4 border-background shadow-md">
              {avatar
                ? <AvatarImage src={avatar} />
                : <AvatarFallback className="bg-primary text-white text-xl font-bold">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              }
            </Avatar>
          </div>
        </div>

        <DialogHeader className="px-6 pt-12 pb-0">
          <DialogTitle className="text-lg font-bold">Edit profile</DialogTitle>
          <p className="text-xs text-muted-foreground">Changes will be visible on your public profile immediately.</p>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4 space-y-5">

          {/* Avatar upload */}
          <ImageUpload
            value={avatar}
            onChange={setAvatar}
            label="Profile picture"
            hint="Square photo works best · compressed to under 300KB automatically"
            roundedFull
            maxSizeKB={300}
            maxWidthPx={500}
          />

          {/* Banner upload */}
          <ImageUpload
            value={banner}
            onChange={setBanner}
            label="Banner image"
            hint="Wide image displayed at the top of your profile · compressed to under 500KB"
            aspectRatio={4}
            maxSizeKB={500}
            maxWidthPx={1200}
          />

          {/* Name */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <User size={11} /> Full name *
            </Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="text-sm"
              placeholder="Your full name"
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Mail size={11} /> Email *
            </Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="text-sm"
              placeholder="you@example.com"
            />
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <AlignLeft size={11} /> Bio
            </Label>
            <Textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Tell clients a little about yourself…"
              className="text-sm resize-none"
            />
            <p className="text-[11px] text-muted-foreground text-right">{bio.length}/300</p>
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin size={11} /> Location
            </Label>
            <Input
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="text-sm"
              placeholder="e.g. London, UK"
            />
          </div>

          {/* Availability — freelancers only */}
          {isFreelancer && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock size={11} /> Availability
              </Label>
              <Select value={availability} onValueChange={setAvailability}>
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABILITY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Shown on your public profile and in search results.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={onClose}
              disabled={saveMutation.isPending}
            >
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
