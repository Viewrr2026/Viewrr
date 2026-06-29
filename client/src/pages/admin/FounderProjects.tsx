import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Loader2, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectRow {
  id: number;
  title: string;
  status: string;
  clientName: string;
  freelancerName: string;
  createdAt: string;
}

const statusStyle: Record<string, string> = {
  active: "bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  completed: "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  pending: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  cancelled: "bg-red-50 dark:bg-red-950/40 text-red-500 dark:text-red-400",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export default function FounderProjects() {
  const { user } = useAuth();

  const { data: projects = [], isLoading } = useQuery<ProjectRow[]>({
    queryKey: ["admin-projects", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/projects?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id,
  });

  return (
    <AdminLayout>
      <DashboardHeader
        title="Projects"
        description="All projects across the marketplace."
      />

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 size={24} className="animate-spin text-zinc-400" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <FolderKanban size={36} className="text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm text-zinc-400 italic">No projects yet</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Project</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden sm:table-cell">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden md:table-cell">Creative</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden lg:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200">{p.title}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 hidden sm:table-cell">{p.clientName}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 hidden md:table-cell">{p.freelancerName || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", statusStyle[p.status] ?? statusStyle.pending)}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs hidden lg:table-cell">{timeAgo(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
