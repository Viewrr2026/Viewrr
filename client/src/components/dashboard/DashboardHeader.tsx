import { useAuth } from "@/components/AuthProvider";
import { displayRole } from "@/lib/utils";

interface DashboardHeaderProps {
  title: string;
  description?: string;
}

export default function DashboardHeader({ title, description }: DashboardHeaderProps) {
  const { user } = useAuth();

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-1 pb-6 border-b border-zinc-200 dark:border-zinc-800 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-0.5">
            {greeting}, {user?.name ?? "Founder"}
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>
          )}
        </div>
        <div className="text-right hidden sm:block">
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800">
            {displayRole(user?.role ?? "admin")}
          </span>
        </div>
      </div>
    </div>
  );
}
