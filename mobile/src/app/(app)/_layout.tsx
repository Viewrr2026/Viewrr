import { Redirect, Tabs } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_CONTENT_HEIGHT, TabIcon } from "@/components/TabIcon";
import { HIDDEN_TABS, TAB_SLOTS } from "@/navigation/tabs";
import { NotificationsProvider } from "@/notifications/NotificationsProvider";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

/**
 * The authenticated shell.
 *
 * Owns: the five-tab bar, the tab surface, and the notification count that the
 * header bell reads on every screen. It does NOT own auth — session state has
 * exactly one home (SessionProvider), and this layout only reacts to it: any
 * authenticated 401 clears secure storage, flips the session to signed-out, and
 * drops the user out of this stack through the redirect below.
 *
 * Tab positions are identical for every role (see navigation/tabs). The briefs
 * stack, the notification centre and the account routes are registered here
 * with `href: null` — they exist in the tree and are reachable by navigation
 * and deep link, they just draw no tab button.
 *
 * Bar geometry, and why it is computed rather than hardcoded
 * ---------------------------------------------------------
 * Two things were clipping the captions on device, and both are fixed here.
 *
 * 1. react-navigation only supplies its own bottom inset while the bar height
 *    is left at the default. The moment `tabBarStyle.height` is set, that value
 *    becomes the WHOLE bar — safe area included — so on a home-indicator iPhone
 *    the indicator space was carved out of the content band. So the height is
 *    derived rather than guessed:
 *
 *        height        = TAB_CONTENT_HEIGHT + top padding + bottom inset
 *        paddingBottom = bottom inset
 *
 *    The content band is then a constant size on every device and the indicator
 *    space sits below it. Devices with no indicator (SE, older iPads, Android
 *    with gestures off) report inset 0, where a bare band would sit flush on the
 *    hardware edge, so a small floor keeps it deliberate there too. No device
 *    checks and no magic offsets — the arithmetic scales to whatever insets a
 *    future device reports.
 *
 * 2. Even with the right band height, `tabBarLabel` was still being squeezed:
 *    react-navigation's label is an unreserved flex child of the tab button, so
 *    a constrained button shrinks the caption first (measured at 5px against a
 *    15px line). Labels are therefore off (`tabBarShowLabel: false`) and both
 *    rows are drawn by TabIcon inside one fixed-height column.
 */

/** Space above the icon row. */
const TAB_BAR_TOP_PAD = 6;
/** Applied only where the OS reports no bottom inset. */
const MIN_BOTTOM_PAD = Platform.OS === "ios" ? 10 : 8;

export default function AppLayout() {
  const { status } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (status !== "signed-in") {
    return <Redirect href="/(auth)/welcome" />;
  }

  const bottomPad = Math.max(insets.bottom, MIN_BOTTOM_PAD);

  return (
    <NotificationsProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarStyle: [
            styles.tabBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              height: TAB_CONTENT_HEIGHT + TAB_BAR_TOP_PAD + bottomPad,
              paddingBottom: bottomPad,
            },
          ],
          tabBarShowLabel: false,
          tabBarItemStyle: styles.tabItem,
        }}
      >
        {TAB_SLOTS.map((slot) => (
          <Tabs.Screen
            key={slot.name}
            name={slot.name}
            options={{
              title: slot.label,
              tabBarIcon: ({ focused }) => (
                <TabIcon name={slot.icon} label={slot.label} focused={focused} />
              ),
            }}
          />
        ))}

        {HIDDEN_TABS.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>
    </NotificationsProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: TAB_BAR_TOP_PAD,
  },
  tabItem: {
    // Vertical rhythm belongs to the bar and to TabIcon; item padding would be
    // added on top of the computed height and reintroduce the clipping.
    paddingVertical: 0,
  },
});
