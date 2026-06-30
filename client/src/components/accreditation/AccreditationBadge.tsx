/**
 * AccreditationBadge
 *
 * Renders a badge for a freelancer's accreditation level with a tooltip.
 * Levels: "verified" | "approved" | "elite" | null
 *
 * Trust is earned, never purchased.
 */

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldCheck, BadgeCheck, Star, Shield } from "lucide-react";

export type AccreditationLevel = "verified" | "approved" | "elite" | null;

export interface AccreditationConfig {
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ElementType;
  badgeClass: string;
  iconClass: string;
  dotClass: string;
}

export const ACCREDITATION_CONFIG: Record<NonNullable<AccreditationLevel>, AccreditationConfig> = {
  verified: {
    label: "Verified",
    shortLabel: "Verified",
    description: "Verified identity and completed professional profile.",
    icon: ShieldCheck,
    badgeClass:
      "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    iconClass: "text-blue-600 dark:text-blue-400",
    dotClass: "bg-blue-500",
  },
  approved: {
    label: "Viewrr Approved",
    shortLabel: "Approved",
    description:
      "Portfolio personally reviewed and professionally approved by Viewrr.",
    icon: BadgeCheck,
    badgeClass:
      "bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    iconClass: "text-[#FF5A1F] dark:text-orange-400",
    dotClass: "bg-[#FF5A1F]",
  },
  elite: {
    label: "Viewrr Elite",
    shortLabel: "Elite",
    description:
      "Recognised by Viewrr for consistently delivering exceptional work and earning outstanding client trust.",
    icon: Star,
    badgeClass:
      "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    iconClass: "text-amber-500 dark:text-amber-400",
    dotClass: "bg-amber-500",
  },
};

interface AccreditationBadgeProps {
  level: AccreditationLevel;
  /** "badge" = full pill with icon + label; "icon" = icon only; "dot" = coloured dot; "inline" = compact inline chip */
  variant?: "badge" | "icon" | "dot" | "inline";
  className?: string;
  /** Show tooltip. Default true. */
  tooltip?: boolean;
}

export default function AccreditationBadge({
  level,
  variant = "badge",
  className,
  tooltip = true,
}: AccreditationBadgeProps) {
  if (!level) return null;

  const config = ACCREDITATION_CONFIG[level];
  if (!config) return null;

  const Icon = config.icon;

  const BadgeContent = () => {
    if (variant === "dot") {
      return (
        <span
          className={cn(
            "inline-block w-2.5 h-2.5 rounded-full",
            config.dotClass,
            className
          )}
        />
      );
    }

    if (variant === "icon") {
      return (
        <Icon
          size={16}
          strokeWidth={2}
          className={cn(config.iconClass, className)}
        />
      );
    }

    if (variant === "inline") {
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border",
            config.badgeClass,
            className
          )}
        >
          <Icon size={11} strokeWidth={2.5} />
          {config.shortLabel}
        </span>
      );
    }

    // Default: "badge"
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border select-none",
          config.badgeClass,
          className
        )}
      >
        <Icon size={12} strokeWidth={2.5} />
        {config.label}
      </span>
    );
  };

  if (!tooltip) return <BadgeContent />;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">
            <BadgeContent />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[220px] text-center text-xs leading-relaxed"
        >
          <p className="font-semibold mb-0.5">{config.label}</p>
          <p className="text-muted-foreground">{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Convenience: get ordered level list for comparisons */
export const LEVEL_ORDER: NonNullable<AccreditationLevel>[] = [
  "verified",
  "approved",
  "elite",
];

/** Returns true if candidate is higher than current */
export function isPromotion(
  current: AccreditationLevel,
  candidate: AccreditationLevel
): boolean {
  if (!candidate) return false;
  if (!current) return true;
  return LEVEL_ORDER.indexOf(candidate) > LEVEL_ORDER.indexOf(current);
}
