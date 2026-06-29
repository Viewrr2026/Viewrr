import { TrendingUp, TrendingDown, Minus, HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthSignals {
  completedProjectsTrend: "up" | "down";
  registrationsTrend: "up" | "down";
  pendingApprovalsCount: number;
  overdueCount: number;
  paymentIssuesCount: number;
  repeatClientsCount: number;
}

interface MarketplaceHealthProps {
  score: "healthy" | "watch" | "needs_attention";
  signals: HealthSignals;
}

const scoreConfig = {
  healthy: {
    label: "Healthy",
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950/40",
    border: "border-green-200 dark:border-green-800",
    dot: "bg-green-500",
  },
  watch: {
    label: "Watch",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-800",
    dot: "bg-amber-500",
  },
  needs_attention: {
    label: "Needs Attention",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
    dot: "bg-red-500",
  },
};

function Signal({
  label,
  trend,
  value,
}: {
  label: string;
  trend?: "up" | "down" | "neutral";
  value?: number | string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-1.5">
        {value !== undefined && (
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{value}</span>
        )}
        {trend && (
          <span
            className={cn(
              "w-5 h-5 flex items-center justify-center rounded",
              trend === "up" && "text-green-600 dark:text-green-400",
              trend === "down" && "text-red-500 dark:text-red-400",
              trend === "neutral" && "text-zinc-400"
            )}
          >
            {trend === "up" ? (
              <TrendingUp size={14} />
            ) : trend === "down" ? (
              <TrendingDown size={14} />
            ) : (
              <Minus size={14} />
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MarketplaceHealth({ score, signals }: MarketplaceHealthProps) {
  const config = scoreConfig[score];

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-4">
        Marketplace Health
      </h2>
      <div className={cn("rounded-xl border p-5", config.bg, config.border)}>
        {/* Score header */}
        <div className="flex items-center gap-3 mb-5">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", config.bg)}>
            <HeartPulse size={18} className={config.color} />
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("w-2.5 h-2.5 rounded-full animate-pulse", config.dot)} />
            <span className={cn("font-semibold text-base", config.color)}>
              {config.label}
            </span>
          </div>
        </div>

        {/* Signals */}
        <div>
          <Signal
            label="New registrations (30d)"
            trend={signals.registrationsTrend}
          />
          <Signal
            label="Completed projects (30d)"
            trend={signals.completedProjectsTrend}
          />
          <Signal
            label="Repeat clients"
            value={signals.repeatClientsCount}
            trend={signals.repeatClientsCount > 0 ? "up" : "neutral"}
          />
          <Signal
            label="Overdue projects"
            value={signals.overdueCount}
            trend={signals.overdueCount === 0 ? "up" : "down"}
          />
          <Signal
            label="Payment issues"
            value={signals.paymentIssuesCount}
            trend={signals.paymentIssuesCount === 0 ? "up" : "down"}
          />
          <Signal
            label="Stale approvals"
            value={signals.pendingApprovalsCount}
            trend={signals.pendingApprovalsCount === 0 ? "up" : signals.pendingApprovalsCount < 3 ? "neutral" : "down"}
          />
        </div>
      </div>
    </div>
  );
}
