import { AlertTriangle, Clock, CreditCard, CheckSquare, UserX } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlertItem {
  id: number;
  label: string;
  sub?: string;
}

interface AlertSection {
  title: string;
  icon: React.ElementType;
  items: AlertItem[];
  severity: "high" | "medium" | "low";
}

interface AlertsData {
  overdueProjects: { id: number; title: string; clientName: string; freelancerName: string; createdAt: string }[];
  awaitingFreelancer: { id: number; title: string; createdAt: string }[];
  awaitingClient: { id: number; briefTitle: string }[];
  paymentIssues: { id: number; clientName: string; projectTitle: string; totalPence: number; issuedAt: string }[];
  pendingApprovals: { id: number; briefTitle: string; freelancerName: string; createdAt: string }[];
}

interface FounderAlertsProps {
  alerts: AlertsData;
}

const severityStyle = {
  high: "border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20",
  medium: "border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20",
  low: "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50",
};

const severityIcon = {
  high: "text-red-500 dark:text-red-400",
  medium: "text-amber-500 dark:text-amber-400",
  low: "text-zinc-500 dark:text-zinc-400",
};

function AlertRow({ item, severity }: { item: AlertItem; severity: AlertSection["severity"] }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.label}</span>
      {item.sub && <span className="text-xs text-zinc-500 dark:text-zinc-400">{item.sub}</span>}
    </div>
  );
}

function AlertCard({ section }: { section: AlertSection }) {
  const { title, icon: Icon, items, severity } = section;
  const count = items.length;

  return (
    <div className={cn("rounded-xl border p-4", severityStyle[severity])}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className={severityIcon[severity]} />
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{title}</span>
        <span
          className={cn(
            "ml-auto text-xs font-semibold px-2 py-0.5 rounded-full",
            count === 0
              ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
              : severity === "high"
              ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
              : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
          )}
        >
          {count}
        </span>
      </div>

      {count === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">All clear</p>
      ) : (
        <div>
          {items.slice(0, 4).map((item) => (
            <AlertRow key={item.id} item={item} severity={severity} />
          ))}
          {count > 4 && (
            <p className="text-xs text-zinc-400 mt-1">+{count - 4} more</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function FounderAlerts({ alerts }: FounderAlertsProps) {
  const sections: AlertSection[] = [
    {
      title: "Overdue Projects",
      icon: AlertTriangle,
      severity: "high",
      items: alerts.overdueProjects.map((p) => ({
        id: p.id,
        label: p.title,
        sub: `Client: ${p.clientName} · Creative: ${p.freelancerName}`,
      })),
    },
    {
      title: "Payment Issues",
      icon: CreditCard,
      severity: "high",
      items: alerts.paymentIssues.map((i) => ({
        id: i.id,
        label: i.projectTitle,
        sub: `${i.clientName} · £${(i.totalPence / 100).toFixed(2)} overdue`,
      })),
    },
    {
      title: "Pending Approvals",
      icon: CheckSquare,
      severity: "medium",
      items: alerts.pendingApprovals.map((i) => ({
        id: i.id,
        label: i.briefTitle,
        sub: `From ${i.freelancerName}`,
      })),
    },
    {
      title: "Briefs Awaiting Talent",
      icon: UserX,
      severity: "medium",
      items: alerts.awaitingFreelancer.map((b) => ({
        id: b.id,
        label: b.title,
      })),
    },
    {
      title: "Awaiting Client Action",
      icon: Clock,
      severity: "low",
      items: alerts.awaitingClient.map((i) => ({
        id: i.id,
        label: i.briefTitle,
      })),
    },
  ];

  const totalAlerts = sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
          Attention Required
        </h2>
        {totalAlerts > 0 && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">
            {totalAlerts}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sections.map((s) => (
          <AlertCard key={s.title} section={s} />
        ))}
      </div>
    </div>
  );
}
