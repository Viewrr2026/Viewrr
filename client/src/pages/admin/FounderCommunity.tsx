import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Construction } from "lucide-react";

export default function FounderCommunity() {
  return (
    <AdminLayout>
      <DashboardHeader
        title="Community"
        description="Feed posts, flagged content, user reports."
      />
      <ComingSoon label="Community management" sprint="Sprint 2" />
    </AdminLayout>
  );
}

function ComingSoon({ label, sprint }: { label: string; sprint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
        <Construction size={24} className="text-zinc-400 dark:text-zinc-500" />
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">{label}</p>
        <p className="text-xs text-zinc-400 mt-1">Coming in {sprint}</p>
      </div>
    </div>
  );
}
