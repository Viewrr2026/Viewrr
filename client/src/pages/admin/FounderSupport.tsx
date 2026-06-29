import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { HeadphonesIcon, Mail } from "lucide-react";

export default function FounderSupport() {
  return (
    <AdminLayout>
      <DashboardHeader
        title="Support"
        description="User tickets, disputes, and contact management."
      />
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <HeadphonesIcon size={24} className="text-zinc-400 dark:text-zinc-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Support Centre</p>
          <p className="text-xs text-zinc-400 mt-1">Coming in Sprint 2 — ticket triage, dispute handling</p>
        </div>
        <a
          href="mailto:support@viewrr.co.uk"
          className="flex items-center gap-2 text-xs text-[#FF5A1F] hover:underline mt-2"
        >
          <Mail size={12} /> support@viewrr.co.uk
        </a>
      </div>
    </AdminLayout>
  );
}
