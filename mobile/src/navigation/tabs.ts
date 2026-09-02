/**
 * The permanent five-position bottom navigation.
 *
 * Every normal user — client, creative, admin — gets the same five primary
 * destinations, in the same order, and they mirror the website's own product
 * surfaces:
 *
 *   1  Home       the Viewrr Feed          (web /feed)
 *   2  Discover   Browse Talent            (web /marketplace)
 *   3  Work       projects and delivery    (web /your-work)
 *   4  Messages   inbox and conversations  (web /messages)
 *   5  Profile    profile, settings, account
 *
 * Navigation is deliberately NOT role-adaptive. A tab bar that rearranges
 * itself per account type teaches two different products, breaks muscle memory
 * the moment an account changes role, and makes every screenshot, support
 * answer and onboarding note conditional. Role differences belong inside the
 * screens — what the Feed shows a creative, what actions a profile offers —
 * not in the primary navigation.
 *
 * Brief opportunities still matter to creatives; they surface inside the Feed
 * and Work rather than displacing Browse Talent from the bar.
 */

export type TabSlot = {
  /** Expo Router segment under app/(app). */
  name: "index" | "discover" | "work" | "messages" | "profile";
  label: string;
  icon: "home" | "discover" | "work" | "messages" | "profile";
};

export const TAB_SLOTS: readonly TabSlot[] = [
  { name: "index", label: "Home", icon: "home" },
  { name: "discover", label: "Discover", icon: "discover" },
  { name: "work", label: "Work", icon: "work" },
  { name: "messages", label: "Messages", icon: "messages" },
  { name: "profile", label: "Profile", icon: "profile" },
] as const;

/**
 * Routes that live in the tab navigator but must never draw a tab button:
 * the notification centre (reached from the header bell everywhere), the
 * briefs stack (reached from the Feed opportunities module and from Work),
 * and the account routes.
 */
export const HIDDEN_TABS: readonly string[] = ["briefs", "notifications", "account"] as const;
