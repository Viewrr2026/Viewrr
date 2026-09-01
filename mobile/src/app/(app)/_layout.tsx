import { Redirect, Tabs } from "expo-router";
import { StyleSheet } from "react-native";

import { TabIcon } from "@/components/TabIcon";
import { hiddenTabsFor, tabRoleFor, tabsFor } from "@/navigation/tabs";
import { NotificationsProvider } from "@/notifications/NotificationsProvider";
import { useSession } from "@/session/SessionProvider";
import { typography, useTheme } from "@/theme";

/**
 * The authenticated shell.
 *
 * Owns: the role-aware tab set, the tab surface, and the notification count
 * that the header bell reads on every screen. It does NOT own auth — session
 * state has exactly one home (SessionProvider), and this layout only reacts to
 * it: any authenticated 401 clears secure storage, flips the session to
 * signed-out, and drops the user out of this stack through the redirect below.
 *
 * Tab positions are fixed and only slot 2 varies by role (see navigation/tabs).
 * The unused slot-2 sibling, the notification centre and the account routes are
 * all registered here with `href: null` — they exist in the tree, they are
 * reachable by navigation and deep link, they just draw no tab button.
 *
 * The bar uses --card over --background with a hairline --border top edge, the
 * same surface/border relationship as the web navbar (bg-card, border-b
 * border-border), and tints the active item with --primary.
 */
export default function AppLayout() {
  const { status, user } = useSession();
  const { colors } = useTheme();

  if (status !== "signed-in") {
    return <Redirect href="/(auth)/welcome" />;
  }

  const role = tabRoleFor(user);
  const slots = tabsFor(role);
  const hidden = hiddenTabsFor(role);

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
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ],
          tabBarLabelStyle: styles.tabLabel,
          tabBarItemStyle: styles.tabItem,
          tabBarIconStyle: styles.tabIcon,
        }}
      >
        {slots.map((slot) => (
          <Tabs.Screen
            key={slot.name}
            name={slot.name}
            options={{
              title: slot.label,
              tabBarIcon: ({ focused }) => <TabIcon name={slot.icon} focused={focused} />,
            }}
          />
        ))}

        {hidden.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>
    </NotificationsProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    // Explicit height gives the 22pt glyph and its caption room to sit without
    // the label descenders clipping; the bottom safe-area inset is added by the
    // navigator on top of this.
    height: 72,
  },
  tabItem: {
    paddingTop: 10,
    paddingBottom: 10,
  },
  tabIcon: {
    marginBottom: 2,
  },
  tabLabel: {
    fontFamily: typography.captionBold.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: 16,
  },
});
