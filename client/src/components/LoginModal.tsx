import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import { useToast } from "@/hooks/use-toast";

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

export default function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  function handleDemoLogin(account: typeof DEMO_ACCOUNTS[0]) {
    login(account.user as any);
    toast({ title: `Welcome back, ${account.user.name}!` });
    onClose();
    setEmail("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // Check if it matches a demo account first (works on static site)
    const demo = DEMO_ACCOUNTS.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (demo) {
      handleDemoLogin(demo);
      setLoading(false);
      return;
    }

    // Otherwise try the API (works when backend is running)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "User not found");
      login(data.user);
      toast({ title: `Welcome back, ${data.user.name}!` });
      onClose();
      setEmail("");
    } catch (err: any) {
      toast({ title: "Sign in failed", description: "Email not recognised. Try a demo account below.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#FF5A1F"/>
              <path d="M7 8l7 16h4l7-16h-4l-5 11.5L11 8H7z" fill="white"/>
            </svg>
            Sign in to Viewrr
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleLogin} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              data-testid="input-email"
            />
          </div>
          <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-white" disabled={loading} data-testid="btn-login-submit">
            {loading ? "Signing in..." : "Continue"}
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
                data-testid={`demo-${a.email}`}
              >
                <span className="font-medium">{a.label}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{a.email}</span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
