import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Maps internal role strings to human-readable display labels. */
export function displayRole(role: string | undefined | null): string {
  if (!role) return "";
  if (role === "admin") return "Founder";
  if (role === "freelancer") return "Creative";
  if (role === "client") return "Client";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Returns the badge colour classes for a given role. */
export function roleBadgeClass(role: string | undefined | null): string {
  if (role === "admin") return "bg-primary/15 text-primary border-primary/30";
  if (role === "freelancer") return "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-violet-200 dark:border-violet-700";
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700";
}
