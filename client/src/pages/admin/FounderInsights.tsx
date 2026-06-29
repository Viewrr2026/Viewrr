import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { BarChart3 } from "lucide-react";

export default function FounderInsights() {
  return (
    <AdminLayout>
      <DashboardHeader
        title="Insights"
        description="Revenue, growth trends, and platform analytics."
      />
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <BarChart3 size={24} className="text-zinc-400 dark:text-zinc-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Analytics &amp; Insights</p>
          <p className="text-xs text-zinc-400 mt-1">Coming in Sprint 2 — revenue charts, GMV, cohort analysis</p>
        </div>
      </div>
    </AdminLayout>
  );
}
