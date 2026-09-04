import { useMemo, useState } from "react";
import { KeyRound, CheckCircle2, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const token = useMemo(() => {
    const hash = window.location.hash;
    const query = hash.includes("?") ? hash.split("?", 2)[1] : "";
    return new URLSearchParams(query).get("token") ?? "";
  }, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is invalid. Please request a new password reset.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Password reset failed.");
      }

      setDone(true);
      setPassword("");
      setConfirm("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn't reset your password. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-80px)] bg-background px-4 py-16">
      <div className="mx-auto max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        {done ? (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-7 w-7 text-primary" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold">Password updated</h1>
              <p className="text-muted-foreground">
                Your Viewrr password has been changed successfully. You can now return to the Viewrr app and sign in.
              </p>
            </div>

            <Button className="w-full" onClick={() => { window.location.hash = "#/"; }}>
              Back to Viewrr
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>

              <div>
                <h1 className="text-2xl font-bold">Choose a new password</h1>
                <p className="mt-1 text-muted-foreground">
                  Enter a new password for your Viewrr account.
                </p>
              </div>
            </div>

            {!token ? (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                This reset link is invalid. Please request a new one.
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={saving || !token}
            >
              {saving ? "Updating password..." : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
