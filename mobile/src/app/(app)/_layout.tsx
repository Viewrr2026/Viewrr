import { Redirect, Tabs } from "expo-router";
import { StyleSheet } from "react-native";

import { TabIcon } from "@/components/TabIcon";
import { useSession } from "@/session/SessionProvider";
import { typography, useTheme } from "@/theme";

/**
 * Authenticated shell. Guarded by session status, which is now backed by a real
 * PRD-019 Bearer credential: any authenticated 401 clears secure storage and
 * flips the session to signed-out, which drops the user out of this stack.
 *
 * The bar uses --card over --background with a hairline --border top edge, the
 * same surface/among-border relationship as the web navbar (bg-card, border-b
 * border-border), and tints the active item with --primary.
 */
export default function AppLayout() {
  const { status } = useSession();
  const { colors } = useTheme();

  if (status !== "signed-in") {
    return <Redirect href="/(auth)/welcome" />;
  }

  return (
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
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: "Work",
          tabBarIcon: ({ focused }) => <TabIcon name="work" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} />,
        }}
      />
    </Tabs>
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
