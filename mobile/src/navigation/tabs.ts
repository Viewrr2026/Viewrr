import type { SessionUser } from "@/session/SessionProvider";

/**
 * The permanent five-position bottom navigation.
 *
 * Positions are fixed. Only slot 2 changes by role, and it changes to the
 * surface that role actually opens the app for:
 *
 *   position   client      creative
 *   1          Home        Home
 *   2          Discover    Briefs
 *   3          Work        Work
 *   4          Messages    Messages
 *   5          Profile     Profile
 *
 * A creative does not hire creatives, and a client does not apply to briefs,
 * so giving both the same slot-2 destination would waste a primary tab for one
 * of them. Everything else stays put, so muscle memory survives a role change.
 */

export type TabRole = "client" | "creative";

export type TabSlot = {
  /** Expo Router segment under app/(app). */
  name: "index" | "discover" | "briefs" | "work" | "messages" | "profile";
  label: string;
  icon: "home" | "discover" | "briefs" | "work" | "messages" | "profile";
};

/** Admin accounts use the client shell — the founder console stays on web. */
export function tabRoleFor(user: SessionUser | null): TabRole {
  return user?.role === "freelancer" ? "creative" : "client";
}

const HOME: TabSlot = { name: "index", label: "Home", icon: "home" };
const DISCOVER: TabSlot = { name: "discover", label: "Discover", icon: "discover" };
const BRIEFS: TabSlot = { name: "briefs", label: "Briefs", icon: "briefs" };
const WORK: TabSlot = { name: "work", label: "Work", icon: "work" };
const MESSAGES: TabSlot = { name: "messages", label: "Messages", icon: "messages" };
const PROFILE: TabSlot = { name: "profile", label: "Profile", icon: "profile" };

export function tabsFor(role: TabRole): TabSlot[] {
  return [HOME, role === "creative" ? BRIEFS : DISCOVER, WORK, MESSAGES, PROFILE];
}

/**
 * Routes that exist in the tab navigator but must never draw a tab button:
 * the notification centre (reached from the header bell), the role's unused
 * slot-2 sibling, and the account routes.
 */
export function hiddenTabsFor(role: TabRole): string[] {
  return [role === "creative" ? DISCOVER.name : BRIEFS.name, "notifications", "account"];
}
