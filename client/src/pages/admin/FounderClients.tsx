/**
 * PRD-017 FR-08: Founder Client Directory
 * /founder/users/clients
 *
 * Founder-only view of all registered clients with search, filters,
 * and a side-panel detail view. Protected by server-side requireAdminGuard.
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  Search, X, ChevronRight, Loader2,
  Briefcase, Calendar, UserCheck, ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface Client {
  id: number;
  name: string;
  email: string;
  company: string | null;
  avatar: string | null;
  createdAt: string;
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
}

interface ClientsResponse {
  total: number;
  offset: number;
  limit: number;
  users: Client[];
}

interface DetailUser {
  user: Record<string, any>;
  profile: null;
  projects: Array<{ id: number; title: string; status: string; createdAt: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    active: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full capitalize", map[status] ?? "bg-zinc-100 text-zinc-600")}>
      {status.replace("_", " ")}
    </span>
  );
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<DetailUser>({
    queryKey: ["founder-user-detail", userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}?userId=${user?.id}`);
      if (!res.ok) throw new Error("Failed to load user");
      return res.json();
    },
    enabled: !!user?.id,
  });

  return (
    <aside className="fixed inset-y-0 right-0 w-full max-w-sm bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl z-50 flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          aria-label="Close panel"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <span className="text-xs text-zinc-400">Client Detail</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-zinc-400" />
        </div>
      ) : data ? (
        <div className="px-5 py-6 flex flex-col gap-6">
          {/* Identity */}
          <div className="flex items-center gap-3">
            {data.user.avatar ? (
              <img src={data.user.avatar} alt={data.user.name} className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold text-lg">
                {(data.user.name ?? "?")[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">{data.user.name}</p>
              <p className="text-xs text-zinc-500">{data.user.email}</p>
              {data.user.company && <p className="text-xs text-zinc-400 mt-0.5">{data.user.company}</p>}
            </div>
          </div>

          {/* Account fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Joined</p>
              <p className="text-sm font-medium">{fmtDate(data.user.createdAt)}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Total Projects</p>
              <p className="text-sm font-medium">{data.projects.length}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Active</p>
              <p className="text-sm font-medium">
                {data.projects.filter(p => p.status === "active" || p.status === "in_progress").length}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Completed</p>
              <p className="text-sm font-medium">
                {data.projects.filter(p => p.status === "completed").length}
              </p>
            </div>
          </div>

          {/* Projects */}
          <div>
            <p className="text-xs text-zinc-400 mb-2">Projects ({data.projects.length})</p>
            {data.projects.length === 0 ? (
              <p className="text-sm text-zinc-400">No projects yet.</p>
            ) : (
              <div className="flex flex-col gap-0">
                {data.projects.slice(0, 10).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <span className="text-zinc-700 dark:text-zinc-200 truncate max-w-[180px]">{p.title}</span>
                    <StatusPill status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="px-5 py-6 text-sm text-zinc-400">Could not load client details.</p>
      )}
    </aside>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FounderClients() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [hasProjects, setHasProjects] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = new URLSearchParams({
    userId: String(user?.id ?? ""),
    search,
    limit: "200",
  });
  if (hasProjects !== "all") params.set("hasProjects", hasProjects === "yes" ? "true" : "false");

  const { data, isLoading, isError } = useQuery<ClientsResponse>({
    queryKey: ["founder-clients", search, hasProjects, user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/clients?${params}`);
      if (!res.ok) throw new Error("Failed to load clients");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const clearFilters = useCallback(() => {
    setSearch("");
    setHasProjects("all");
  }, []);

  const hasActiveFilters = search || hasProjects !== "all";

  return (
    <AdminLayout>
      <DashboardHeader
        title="Clients"
        description={`${data?.total ?? "—"} registered clients on Viewrr.`}
      />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by name, email or company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Projects filter */}
        <select
          value={hasProjects}
          onChange={e => setHasProjects(e.target.value)}
          className="text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Filter by project activity"
        >
          <option value="all">All Clients</option>
          <option value="yes">Has Projects</option>
          <option value="no">No Projects</option>
        </select>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-zinc-400" />
        </div>
      ) : isError ? (
        <div className="py-20 text-center text-zinc-400 text-sm">Failed to load clients.</div>
      ) : !data?.users.length ? (
        <div className="py-20 text-center text-zinc-400 text-sm">No clients match your filters.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden sm:table-cell">Projects</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden md:table-cell">Active</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden md:table-cell">Completed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden lg:table-cell">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.users.map(client => (
                <tr
                  key={client.id}
                  onClick={() => setSelectedId(client.id === selectedId ? null : client.id)}
                  className={cn(
                    "border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 cursor-pointer transition-colors",
                    selectedId === client.id
                      ? "bg-blue-50 dark:bg-blue-900/10"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  )}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === "Enter" && setSelectedId(client.id)}
                  aria-label={`View details for ${client.name}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {client.avatar ? (
                        <img src={client.avatar} alt={client.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold text-sm shrink-0">
                          {(client.name ?? "?")[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{client.name}</p>
                        <p className="text-xs text-zinc-400">{client.company ?? client.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                      <Briefcase size={13} className="shrink-0" /> {client.totalProjects}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-blue-600 dark:text-blue-400 font-medium">{client.activeProjects}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-green-600 dark:text-green-400 font-medium">{client.completedProjects}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="flex items-center gap-1.5 text-zinc-500">
                      <Calendar size={12} className="shrink-0" /> {fmtDate(client.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight size={15} className={cn("text-zinc-400 transition-transform", selectedId === client.id && "rotate-90")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400 flex items-center gap-1.5">
            <UserCheck size={12} /> {data.total} client{data.total !== 1 ? "s" : ""} total
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedId !== null && (
        <>
          <div
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40 backdrop-blur-sm"
            onClick={() => setSelectedId(null)}
            aria-hidden="true"
          />
          <DetailPanel userId={selectedId} onClose={() => setSelectedId(null)} />
        </>
      )}
    </AdminLayout>
  );
}
