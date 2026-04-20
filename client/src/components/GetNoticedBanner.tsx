import { useState } from "react";
import { Link } from "wouter";
import { X, Sparkles, ImagePlus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import { safeGet, safeSet } from "@/lib/storage";

export default function GetNoticedBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => safeGet("viewrr_nudge_dismissed") === "1");

  if (!user || user.role !== "freelancer" || dismissed) return null;

  function dismiss() {
    safeSet("viewrr_nudge_dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-4">
      <div
        className="relative flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-4 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #FF5A1F0D, #FFA50008)" }}
      >
        {/* glow */}
        <div className="absolute -top-8 -left-8 w-32 h-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />

        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles size={18} className="text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Get noticed more — share your first post</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Freelancers who post within their first week get <span className="text-primary font-semibold">3× more profile views</span>. Share a project, behind-the-scenes, or a recent win.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button asChild size="sm" className="bg-primary hover:bg-primary/90 text-white rounded-full gap-1.5">
            <Link href="/feed">
              <ImagePlus size={13} />
              Post now
              <ArrowRight size={12} />
            </Link>
          </Button>
        </div>

        <button
          onClick={dismiss}
          className="absolute top-3 right-3 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
