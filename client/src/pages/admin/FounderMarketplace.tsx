import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Loader2, Users, UserCheck, Star, MapPin } from "lucide-react";
import { displayRole } from "@/lib/utils";

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  location?: string;
  createdAt: string;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export default function FounderMarketplace() {
  const { user } = useAuth();

  const { data: users = [], isLoading } = useQuery<UserRow[]>({
    queryKey: ["admin-users", user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!user?.id,
  });

  const freelancers = users.filter((u) => u.role === "freelancer");
  const clients = users.filter((u) => u.role === "client");

  return (
    <AdminLayout>
      <DashboardHeader
        title="Marketplace"
        description="All creatives and clients on the platform."
      />

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 size={24} className="animate-spin text-zinc-400" />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Creatives */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Users size={16} className="text-violet-500" />
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Creatives ({freelancers.length})
              </h2>
            </div>
            <UserTable users={freelancers} />
          </section>

          {/* Clients */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <UserCheck size={16} className="text-blue-500" />
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Clients ({clients.length})
              </h2>
            </div>
            <UserTable users={clients} />
          </section>
        </div>
      )}
    </AdminLayout>
  );
}

function UserTable({ users }: { users: UserRow[] }) {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-10 text-center">
        <p className="text-sm text-zinc-400 italic">No users yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Name</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden sm:table-cell">Email</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden md:table-cell">Role</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{u.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 hidden sm:table-cell">{u.email}</td>
              <td className="px-4 py-3 hidden md:table-cell">
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                  {displayRole(u.role)}
                </span>
              </td>
              <td className="px-4 py-3 text-zinc-400 text-xs">{timeAgo(u.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
