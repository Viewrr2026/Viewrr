import {
  Briefcase,
  Compass,
  FileText,
  LayoutDashboard,
  MessageCircle,
  User,
} from "lucide-react-native";

import { useTheme } from "@/theme";

export type TabIconName = "home" | "discover" | "briefs" | "work" | "messages" | "profile";

/**
 * Tab glyphs use lucide-react-native — the native build of the exact icon set
 * the website uses (client/src/components/Navbar.tsx imports LayoutDashboard,
 * Briefcase and User from lucide-react for the same destinations), so the app
 * and the site draw identical shapes at identical stroke weights.
 */
const ICONS = {
  home: LayoutDashboard,
  discover: Compass,
  briefs: FileText,
  work: Briefcase,
  messages: MessageCircle,
  profile: User,
} as const;

export function TabIcon({ name, focused }: { name: TabIconName; focused: boolean }) {
  const { colors } = useTheme();
  const Glyph = ICONS[name];

  return (
    <Glyph
      size={22}
      color={focused ? colors.primary : colors.mutedForeground}
      strokeWidth={focused ? 2.4 : 2}
    />
  );
}
