import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Settings, User, Shield, Bell } from "lucide-react";
import { displayRole } from "@/lib/utils";

export default function FounderSettings() {
  const { user } = useAuth();

  return (
    <AdminLayout>
      <DashboardHeader
        title="Settings"
        description="Founder account and platform configuration."
      />

      <div className="max-w-2xl flex flex-col gap-6">
        {/* Account info */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center gap-2 mb-5">
            <User size={16} className="text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Account</h2>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <Row label="Name" value={user?.name ?? "—"} />
            <Row label="Email" value={user?.email ?? "—"} />
            <Row label="Role" value={displayRole(user?.role ?? "admin")} />
            <Row label="Account ID" value={`#${user?.id}`} mono />
          </div>
        </section>

        {/* Permissions */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-center gap-2 mb-5">
            <Shield size={16} className="text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Permissions</h2>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            {[
              "dashboard.view",
              "marketplace.view",
              "projects.view",
              "community.view",
              "insights.view",
              "support.view",
              "settings.view",
            ].map((perm) => (
              <div key={perm} className="flex items-center justify-between py-1.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
                <span className="text-zinc-600 dark:text-zinc-400 font-mono text-xs">{perm}</span>
                <span className="text-xs text-green-600 dark:text-green-400 font-semibold">✓ Granted</span>
              </div>
            ))}
          </div>
        </section>

        {/* Platform config (Sprint 2) */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 opacity-60">
          <div className="flex items-center gap-2 mb-2">
            <Settings size={16} className="text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Platform Config</h2>
            <span className="text-xs text-zinc-400 ml-auto">Sprint 2</span>
          </div>
          <p className="text-xs text-zinc-400">Fee rates, feature flags, email templates, Stripe config — coming soon.</p>
        </section>
      </div>
    </AdminLayout>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-50 dark:border-zinc-800 pb-2 last:border-0">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={`text-zinc-800 dark:text-zinc-200 font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
