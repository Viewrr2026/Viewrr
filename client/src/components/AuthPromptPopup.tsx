import { useEffect, useState } from "react";
import { X, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { safeGet, safeSet } from "@/lib/storage";

// Shows once per session (not per page) to logged-out users
// Appears after 8 seconds, can be dismissed permanently for this session

interface AuthPromptPopupProps {
  onLogin: () => void;
  onSignup: () => void;
}

export default function AuthPromptPopup({ onLogin, onSignup }: AuthPromptPopupProps) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if logged in or already dismissed this session
    if (user) return;
    const alreadyDismissed = safeGet("auth_prompt_dismissed") === "1";
    if (alreadyDismissed) return;

    const timer = setTimeout(() => {
      setVisible(true);
    }, 8000);

    return () => clearTimeout(timer);
  }, [user]);

  function dismiss() {
    setVisible(false);
    setDismissed(true);
    safeSet("auth_prompt_dismissed", "1");
  }

  if (user || !visible || dismissed) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-full max-w-sm mx-4 animate-in slide-in-from-bottom-4 fade-in duration-300"
      role="dialog"
      aria-label="Sign in to Viewrr"
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Orange accent bar */}
        <div className="h-1 w-full bg-primary" />

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Sparkles size={15} className="text-primary" />
              </div>
              <p className="font-semibold text-sm leading-tight">
                Join the UK's creative marketplace
              </p>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
              aria-label="Close"
              data-testid="btn-dismiss-auth-prompt"
            >
              <X size={16} />
            </button>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed mb-4">
            Connect with top creative talent, post briefs, and manage projects — all in one place.
          </p>

          {/* CTAs */}
          <div className="flex flex-col gap-2">
            <Button
              className="w-full bg-primary hover:bg-primary/90 text-white gap-2 rounded-xl"
              onClick={() => { onSignup(); dismiss(); }}
              data-testid="btn-auth-prompt-signup"
            >
              Create a free account <ArrowRight size={14} />
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-xl border-border"
              onClick={() => { onLogin(); dismiss(); }}
              data-testid="btn-auth-prompt-login"
            >
              Sign in
            </Button>
          </div>

          <button
            onClick={dismiss}
            className="w-full mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
            data-testid="btn-auth-prompt-browse"
          >
            Continue browsing without an account
          </button>
        </div>
      </div>
    </div>
  );
}
