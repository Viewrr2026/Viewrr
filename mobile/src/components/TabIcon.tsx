import { Briefcase, Compass, FileText, Home, MessageCircle, User } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { typography, useTheme } from "@/theme";

export type TabIconName = "home" | "discover" | "briefs" | "work" | "messages" | "profile";

/**
 * Tab glyphs use lucide-react-native — the native build of the same icon set
 * the website's navbar uses (client/src/components/Navbar.tsx imports from
 * lucide-react), so shapes and stroke weights match the product.
 *
 * Two glyphs deliberately differ from the web navbar. Web labels the feed
 * "Feed" with an Rss mark and Browse Talent with Users, because on a desktop
 * navbar those sit in a row of named links. In a bottom tab bar the first slot
 * is the app's home and reads as Home, and a compass is the established native
 * idiom for browse/explore. Destinations are identical; only the two glyphs and
 * the first label are adapted to the platform.
 *
 * The caption is drawn here rather than by `tabBarLabel`, and the layout owns
 * the whole tab button (`tabBarShowLabel: false`). react-navigation's label is a
 * flex child of the tab button with no reserved basis, so once the button height
 * is constrained the label is the thing that shrinks — it was measured
 * collapsing to 5px against a 15px line, which is exactly the clipped-caption
 * symptom seen on device. Owning both rows in one fixed-height column means the
 * caption cannot be squeezed by anything above it.
 */
const ICONS = {
  home: Home,
  discover: Compass,
  briefs: FileText,
  work: Briefcase,
  messages: MessageCircle,
  profile: User,
} as const;

export function TabIcon({
  name,
  label,
  focused,
}: {
  name: TabIconName;
  label: string;
  focused: boolean;
}) {
  const { colors } = useTheme();
  const Glyph = ICONS[name];
  const tint = focused ? colors.primary : colors.mutedForeground;

  return (
    <View style={styles.tab}>
      <Glyph size={22} color={tint} strokeWidth={focused ? 2.4 : 2} />
      <Text style={[styles.label, { color: tint }]} numberOfLines={1} allowFontScaling={false}>
        {label}
      </Text>
    </View>
  );
}

export const TAB_CONTENT_HEIGHT = 46;

const styles = StyleSheet.create({
  tab: {
    height: TAB_CONTENT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    // Wide enough for "Messages" at this size on the narrowest supported
    // phone, so the caption never truncates to an ellipsis.
    minWidth: 64,
  },
  label: {
    fontFamily: typography.captionBold.fontFamily,
    fontSize: 11,
    lineHeight: 14,
    // A fixed row: nothing above can borrow from it.
    height: 14,
    textAlign: "center",
    includeFontPadding: false,
  },
});
