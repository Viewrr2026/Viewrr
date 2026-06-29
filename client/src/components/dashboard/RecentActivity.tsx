import { UserPlus, CheckCircle2, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityUser {
  id: number;
  role: string;
  createdAt: string;
}

interface ActivityProject {
  id: number;
  title: string;
  clientName: string;
  freelancerName: string;
  createdAt: string;
  status: string;
}

interface ActivityData {
  recentFreelancers: ActivityUser[];
  recentClients: ActivityUser[];
  recentProjects: ActivityProject[];
  recentCompletedProjects: ActivityProject[];
}

interface RecentActivityProps {
  activity: ActivityData;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ActivityItem({
  icon: Icon,
  iconClass,
  label,
  sub,
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className={cn("w-7 h-7 rounded-md flex items-center justify-center mt-0.5 flex-shrink-0", iconClass)}>
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{label}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>
      </div>
    </div>
  );
}

export default function RecentActivity({ activity }: RecentActivityProps) {
  type FeedItem = {
    key: string;
    icon: React.ElementType;
    iconClass: string;
    label: string;
    sub: string;
    sortDate: string;
  };

  const items: FeedItem[] = [
    ...activity.recentFreelancers.map((u) => ({
      key: `fl-${u.id}`,
      icon: UserPlus,
      iconClass: "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400",
      label: "New Creative joined",
      sub: timeAgo(u.createdAt),
      sortDate: u.createdAt,
    })),
    ...activity.recentClients.map((u) => ({
      key: `cl-${u.id}`,
      icon: UserPlus,
      iconClass: "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400",
      label: "New Client joined",
      sub: timeAgo(u.createdAt),
      sortDate: u.createdAt,
    })),
    ...activity.recentProjects.filter((p) => p.status !== "completed").map((p) => ({
      key: `proj-${p.id}`,
      icon: FolderPlus,
      iconClass: "bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400",
      label: p.title,
      sub: `${p.clientName} · ${timeAgo(p.createdAt)}`,
      sortDate: p.createdAt,
    })),
    ...activity.recentCompletedProjects.map((p) => ({
      key: `done-${p.id}`,
      icon: CheckCircle2,
      iconClass: "bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400",
      label: `${p.title} completed`,
      sub: `${p.freelancerName} → ${p.clientName} · ${timeAgo(p.createdAt)}`,
      sortDate: p.createdAt,
    })),
  ]
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
    .slice(0, 10);

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-4">
        Recent Activity
      </h2>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center py-8 italic">
            No activity yet — the platform is ready for your first users.
          </p>
        ) : (
          items.map((item) => (
            <ActivityItem
              key={item.key}
              icon={item.icon}
              iconClass={item.iconClass}
              label={item.label}
              sub={item.sub}
            />
          ))
        )}
      </div>
    </div>
  );
}
