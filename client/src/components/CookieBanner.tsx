import { useState, useEffect } from "react";
import { Link } from "wouter";
import { X, Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";

const COOKIE_KEY = "viewrr_cookie_consent";

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sandboxed */ }
}

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [prefs, setPrefs] = useState(true);

  useEffect(() => {
    const stored = safeGet(COOKIE_KEY);
    if (!stored) setVisible(true);
  }, []);

  const accept = () => {
    safeSet(COOKIE_KEY, JSON.stringify({ essential: true, analytics: true, preferences: true }));
    setVisible(false);
  };

  const savePrefs = () => {
    safeSet(COOKIE_KEY, JSON.stringify({ essential: true, analytics, preferences: prefs }));
    setVisible(false);
  };

  const decline = () => {
    safeSet(COOKIE_KEY, JSON.stringify({ essential: true, analytics: false, preferences: false }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6">
      <div className="mx-auto max-w-4xl bg-card border border-border rounded-2xl shadow-2xl p-5 md:p-6">
        {!showPrefs ? (
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-start gap-3 flex-1">
              <Cookie size={20} className="text-primary mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                We use cookies to improve your experience on Viewrr. By clicking "Accept All" you consent to our use of cookies.{" "}
                <Link href="/privacy" className="text-primary underline underline-offset-2">
                  Privacy Policy
                </Link>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => setShowPrefs(true)}
                className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Manage preferences
              </button>
              <Button variant="outline" size="sm" onClick={decline} className="rounded-full">
                Decline
              </Button>
              <Button size="sm" onClick={accept} className="rounded-full bg-primary hover:bg-primary/90 text-white">
                Accept All
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Cookie size={18} className="text-primary" />
                Cookie Preferences
              </h3>
              <button onClick={() => setShowPrefs(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 mb-5">
              {/* Essential */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-muted/50">
                <div>
                  <p className="text-sm font-medium">Essential Cookies</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Required for the platform to function. Cannot be disabled.</p>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground font-medium pt-0.5">Always on</div>
              </div>
              {/* Analytics */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-muted/50">
                <div>
                  <p className="text-sm font-medium">Analytics Cookies</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Help us understand how you use Viewrr so we can improve it.</p>
                </div>
                <button
                  onClick={() => setAnalytics(!analytics)}
                  className={`shrink-0 relative w-10 h-5 rounded-full transition-colors ${analytics ? "bg-primary" : "bg-muted-foreground/30"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${analytics ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              {/* Preferences */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-muted/50">
                <div>
                  <p className="text-sm font-medium">Preference Cookies</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Remember your settings like dark mode and display preferences.</p>
                </div>
                <button
                  onClick={() => setPrefs(!prefs)}
                  className={`shrink-0 relative w-10 h-5 rounded-full transition-colors ${prefs ? "bg-primary" : "bg-muted-foreground/30"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${prefs ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={decline} className="rounded-full">
                Decline All
              </Button>
              <Button size="sm" onClick={savePrefs} className="rounded-full bg-primary hover:bg-primary/90 text-white">
                Save Preferences
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
