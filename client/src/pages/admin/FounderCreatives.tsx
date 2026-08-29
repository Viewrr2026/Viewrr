/**
 * PRD-017 FR-07: Founder Creative Directory
 * /founder/users/creatives
 *
 * Founder-only view of all registered creatives with search, filters,
 * and a side-panel detail view. Protected by server-side requireAdminGuard.
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import AdminLayout from "@/components/dashboard/AdminLayout";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  Search, Filter, X, ChevronRight, Loader2,
  Shield, ShieldCheck, Star, Briefcase, Calendar,
  Users, ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface Creative {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  createdAt: string;
  isAdmin: boolean;
  accreditationLevel: string | null;
  isPro: boolean;
  projectCount: number;
  specialisms: string;
}

interface CreativesResponse {
  total: number;
  offset: number;
  limit: number;
  users: Creative[];
}

interface DetailUser {
  user: Record<string, any>;
  profile: {
    accreditationLevel: string | null;
    isPro: boolean;
    projectCount: number;
    specialisms: string;
    availability: string | null;
    yearsExperience: string | null;
  } | null;
  projects: Array<{ id: number; title: string; status: string; createdAt: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

function AccreditationBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-xs text-zinc-400">—</span>;
  const map: Record<string, { label: string; cls: string }> = {
    verified: { label: "Verified", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    approved: { label: "Approved", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    elite:    { label: "Elite",    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  };
  const config = map[level] ?? { label: level, cls: "bg-zinc-100 text-zinc-600" };
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", config.cls)}>
      <ShieldCheck size={11} /> {config.label}
    </span>
  );
}

function ProBadge({ isPro }: { isPro: boolean }) {
  if (!isPro) return <span className="text-xs text-zinc-400">Standard</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
      <Star size={10} fill="currentColor" /> Pro
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

  const specialisms = data?.profile?.specialisms
    ? JSON.parse(data.profile.specialisms || "[]") as string[]
    : [];

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
        <span className="text-xs text-zinc-400">Creative Detail</span>
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
              <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 font-semibold text-lg">
                {(data.user.name ?? "?")[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">{data.user.name}</p>
              <p className="text-xs text-zinc-500">{data.user.email}</p>
            </div>
          </div>

          {/* Account fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Role</p>
              <p className="text-sm font-medium capitalize">{data.user.role}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Joined</p>
              <p className="text-sm font-medium">{fmtDate(data.user.createdAt)}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Accreditation</p>
              <AccreditationBadge level={data.profile?.accreditationLevel ?? null} />
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
              <p className="text-xs text-zinc-400">Pro Viewrr</p>
              <ProBadge isPro={data.profile?.isPro ?? false} />
            </div>
            {data.profile?.yearsExperience && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
                <p className="text-xs text-zinc-400">Experience</p>
                <p className="text-sm font-medium">{data.profile.yearsExperience}</p>
              </div>
            )}
            {data.profile?.availability && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col gap-1">
                <p className="text-xs text-zinc-400">Availability</p>
                <p className="text-sm font-medium capitalize">{data.profile.availability.replace("_", " ")}</p>
              </div>
            )}
          </div>

          {/* Specialisms */}
          {specialisms.length > 0 && (
            <div>
              <p className="text-xs text-zinc-400 mb-2">Specialisms</p>
              <div className="flex flex-wrap gap-1.5">
                {specialisms.map((s: string) => (
                  <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Projects */}
          <div>
            <p className="text-xs text-zinc-400 mb-2">Projects ({data.projects.length})</p>
            {data.projects.length === 0 ? (
              <p className="text-sm text-zinc-400">No projects yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.projects.slice(0, 8).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <span className="text-zinc-700 dark:text-zinc-200 truncate max-w-[180px]">{p.title}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full capitalize",
                      p.status === "completed" ? "bg-green-100 text-green-700" :
                      p.status === "active" || p.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                      "bg-zinc-100 text-zinc-600"
                    )}>
                      {p.status.replace("_", " ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="px-5 py-6 text-sm text-zinc-400">Could not load user details.</p>
      )}
    </aside>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FounderCreatives() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [accreditation, setAccreditation] = useState("all");
  const [pro, setPro] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = new URLSearchParams({
    userId: String(user?.id ?? ""),
    search,
    accreditation,
    pro,
    limit: "200",
  });

  const { data, isLoading, isError } = useQuery<CreativesResponse>({
    queryKey: ["founder-creatives", search, accreditation, pro, user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/creatives?${params}`);
      if (!res.ok) throw new Error("Failed to load creatives");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const clearFilters = useCallback(() => {
    setSearch("");
    setAccreditation("all");
    setPro("all");
  }, []);

  const hasFilters = search || accreditation !== "all" || pro !== "all";

  return (
    <AdminLayout>
      <DashboardHeader
        title="Creatives"
        description={`${data?.total ?? "—"} registered creatives on Viewrr.`}
      />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by name or email…"
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

        {/* Accreditation filter */}
        <select
          value={accreditation}
          onChange={e => setAccreditation(e.target.value)}
          className="text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Filter by accreditation"
        >
          <option value="all">All Accreditation</option>
          <option value="none">Not Accredited</option>
          <option value="verified">Verified</option>
          <option value="approved">Viewrr Approved</option>
          <option value="elite">Viewrr Elite</option>
        </select>

        {/* Pro filter */}
        <select
          value={pro}
          onChange={e => setPro(e.target.value)}
          className="text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Filter by Pro status"
        >
          <option value="all">All Plans</option>
          <option value="pro">Pro Viewrr</option>
          <option value="standard">Standard</option>
        </select>

        {hasFilters && (
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
        <div className="py-20 text-center text-zinc-400 text-sm">Failed to load creatives.</div>
      ) : !data?.users.length ? (
        <div className="py-20 text-center text-zinc-400 text-sm">No creatives match your filters.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Creative</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden sm:table-cell">Accreditation</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden md:table-cell">Pro</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden md:table-cell">Projects</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden lg:table-cell">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.users.map(creative => (
                <tr
                  key={creative.id}
                  onClick={() => setSelectedId(creative.id === selectedId ? null : creative.id)}
                  className={cn(
                    "border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 cursor-pointer transition-colors",
                    selectedId === creative.id
                      ? "bg-violet-50 dark:bg-violet-900/10"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  )}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === "Enter" && setSelectedId(creative.id)}
                  aria-label={`View details for ${creative.name}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {creative.avatar ? (
                        <img src={creative.avatar} alt={creative.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 font-semibold text-sm shrink-0">
                          {(creative.name ?? "?")[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{creative.name}</p>
                        <p className="text-xs text-zinc-400">{creative.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <AccreditationBadge level={creative.accreditationLevel} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <ProBadge isPro={creative.isPro} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                      <Briefcase size={13} className="shrink-0" /> {creative.projectCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="flex items-center gap-1.5 text-zinc-500">
                      <Calendar size={12} className="shrink-0" /> {fmtDate(creative.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight size={15} className={cn("text-zinc-400 transition-transform", selectedId === creative.id && "rotate-90")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400 flex items-center gap-1.5">
            <Users size={12} /> {data.total} creative{data.total !== 1 ? "s" : ""} total
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
