import { useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

type RemovalBlocker = {
  code: string;
  label: string;
  detail: string;
  clearsAutomatically: boolean;
};

interface FounderRemoveAccountProps {
  userId: number;
  userName: string;
  isAdmin?: boolean;
  onRemoved: () => void;
}

export default function FounderRemoveAccount({
  userId,
  userName,
  isAdmin = false,
  onRemoved,
}: FounderRemoveAccountProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [blockers, setBlockers] = useState<RemovalBlocker[]>([]);

  if (isAdmin) return null;

  async function removeAccount() {
    if (confirmation !== "REMOVE" || removing) return;

    setRemoving(true);
    setError("");
    setBlockers([]);

    try {
      const res = await fetch(`/api/admin/users/${userId}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation,
          reason: reason.trim(),
        }),
      });

      const body = await res.json().catch(() => null);

      if (res.status === 409 && body?.code === "ACCOUNT_REMOVAL_BLOCKED") {
        setBlockers(Array.isArray(body.blockers) ? body.blockers : []);
        setError(
          body?.error ??
            "This account cannot be removed until its outstanding obligations are resolved.",
        );
        return;
      }

      if (!res.ok) {
        throw new Error(body?.error ?? "Could not remove this account.");
      }

      onRemoved();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove this account.");
    } finally {
      setRemoving(false);
    }
  }

  if (!open) {
    return (
      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5">
        <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-2">
          Account removal
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-900/60 px-3 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
        >
          <Trash2 size={15} />
          Remove account
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-2">
          <AlertTriangle
            size={18}
            className="text-red-600 dark:text-red-400 shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">
              Remove {userName} from Viewrr?
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1 leading-relaxed">
              Access will be revoked immediately and personal/public account data
              will be anonymised. Financial, project and legal records that Viewrr
              must retain are preserved internally.
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="Cancel account removal"
          onClick={() => {
            if (removing) return;
            setOpen(false);
            setConfirmation("");
            setReason("");
            setError("");
            setBlockers([]);
          }}
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. Smoke-test account"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500/30"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
            Type <span className="font-bold">REMOVE</span> to confirm
          </label>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500/30"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-white/70 dark:bg-zinc-900/70 p-3">
            <p className="text-xs font-medium text-red-700 dark:text-red-300">
              {error}
            </p>

            {blockers.length > 0 && (
              <div className="mt-2 space-y-2">
                {blockers.map((blocker) => (
                  <div key={blocker.code}>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      {blocker.label}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {blocker.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={confirmation !== "REMOVE" || removing}
          onClick={() => void removeAccount()}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {removing && <Loader2 size={15} className="animate-spin" />}
          Permanently remove account
        </button>
      </div>
    </div>
  );
}
