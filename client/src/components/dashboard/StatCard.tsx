import { useLocation } from "wouter";
import { LucideIcon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  accent?: "orange" | "green" | "blue" | "violet" | "default";
  className?: string;
  /** Wouter path to navigate to on click (e.g. "/founder/users/creatives"). Uses hash routing. */
  href?: string;
  /** Accessible label for screen readers */
  ariaLabel?: string;
}

const accentMap = {
  orange: {
    icon: "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400",
    value: "text-orange-600 dark:text-orange-400",
  },
  green: {
    icon: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400",
    value: "text-green-600 dark:text-green-400",
  },
  blue: {
    icon: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
    value: "text-blue-600 dark:text-blue-400",
  },
  violet: {
    icon: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
    value: "text-violet-600 dark:text-violet-400",
  },
  default: {
    icon: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    value: "text-zinc-900 dark:text-zinc-100",
  },
};

export default function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  trendLabel,
  accent = "default",
  className,
  href,
  ariaLabel,
}: StatCardProps) {
  const [, navigate] = useLocation();
  const colors = accentMap[accent];
  const isClickable = !!href;

  function handleClick() {
    if (href) navigate(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (href && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      navigate(href);
    }
  }

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</span>
        <div className="flex items-center gap-1.5">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", colors.icon)}>
            <Icon size={18} strokeWidth={1.75} />
          </div>
          {isClickable && (
            <ChevronRight size={14} className="text-zinc-400 dark:text-zinc-600 shrink-0" />
          )}
        </div>
      </div>

      <div className={cn("text-3xl font-semibold tracking-tight", colors.value)}>
        {value}
      </div>

      {trend && trendLabel && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span
            className={cn(
              "inline-flex items-center",
              trend === "up" && "text-green-600 dark:text-green-400",
              trend === "down" && "text-red-500 dark:text-red-400",
              trend === "neutral" && "text-zinc-400"
            )}
          >
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
          </span>
          <span>{trendLabel}</span>
        </div>
      )}
    </>
  );

  const baseClass = cn(
    "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-3 shadow-sm transition-all",
    isClickable
      ? "hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      : "hover:shadow-md",
    className
  );

  if (isClickable) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={baseClass}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel ?? `View all ${title}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <div className={baseClass}>
      {inner}
    </div>
  );
}
