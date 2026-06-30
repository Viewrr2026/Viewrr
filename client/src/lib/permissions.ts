/**
 * Viewrr Role & Permissions Architecture
 *
 * Roles (Sprint 1 — only Founder exists):
 *   founder   → isAdmin === true, role === "admin"
 *   admin     → (future)
 *   support   → (future)
 *   moderator → (future)
 *
 * Permissions determine which founder-panel sections are visible.
 * Future roles simply get a subset of these permissions.
 */

import type { User } from "@shared/schema";

export type FounderRole = "founder" | "admin" | "support" | "moderator";

export type Permission =
  | "dashboard.view"
  | "marketplace.view"
  | "projects.view"
  | "community.view"
  | "insights.view"
  | "support.view"
  | "settings.view"
  | "accreditation.view"       // can see accreditation panel
  | "accreditation.manage";    // can approve / reject / promote / demote

const ROLE_PERMISSIONS: Record<FounderRole, Permission[]> = {
  founder: [
    "dashboard.view",
    "marketplace.view",
    "projects.view",
    "community.view",
    "insights.view",
    "support.view",
    "settings.view",
    "accreditation.view",
    "accreditation.manage",
  ],
  admin: [
    "dashboard.view",
    "marketplace.view",
    "projects.view",
    "community.view",
    "support.view",
    "accreditation.view",  // read-only
  ],
  support: ["support.view", "community.view"],
  moderator: ["community.view", "marketplace.view"],
};

/** Resolve the founder-panel role for a user. Returns null if not a panel user. */
export function getFounderRole(user: User | null): FounderRole | null {
  if (!user) return null;
  if (user.isAdmin || user.role === "admin") return "founder";
  return null;
}

/** Check if a user has a specific permission. */
export function hasPermission(user: User | null, permission: Permission): boolean {
  const role = getFounderRole(user);
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Check if a user can access the founder panel at all. */
export function isFounderPanelUser(user: User | null): boolean {
  return getFounderRole(user) !== null;
}
