import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MarketplaceCards from "@/components/dashboard/MarketplaceCards";
import FounderAlerts from "@/components/dashboard/FounderAlerts";
import MarketplaceHealth from "@/components/dashboard/MarketplaceHealth";
import RecentActivity from "@/components/dashboard/RecentActivity";
import { Loader2, RefreshCw } from "lucide-react";

export default function FounderDashboard() {
  const { user } = useAuth();

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["founder-dashboard", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/dashboard?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed to load dashboard data");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 60_000, // 1 min
    refetchInterval: 120_000, // auto-refresh every 2 min
  });

  return (
    <AdminLayout>
      <DashboardHeader
        title="Dashboard"
        description="Live overview of the Viewrr marketplace."
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="animate-spin text-zinc-400" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-sm text-zinc-500">Failed to load dashboard data.</p>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 text-sm text-[#FF5A1F] hover:underline"
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      ) : data ? (
        <div className="flex flex-col gap-10">
          {/* Marketplace snapshot */}
          <MarketplaceCards data={data.marketplace} />

          {/* Two-column: Alerts + Health */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-8">
            <FounderAlerts alerts={data.alerts} />
            <MarketplaceHealth score={data.health.score} signals={data.health.signals} />
          </div>

          {/* Recent Activity */}
          <RecentActivity activity={data.activity} />
        </div>
      ) : null}

      {/* Subtle refresh button */}
      {!isLoading && data && (
        <div className="flex justify-end mt-6">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      )}
    </AdminLayout>
  );
}
