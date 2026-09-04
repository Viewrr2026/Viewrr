import { useRouter } from "expo-router";
import { Bell, ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Logo } from "@/components/Logo";
import { NotificationBadge } from "@/components/NotificationBadge";
import { useNotifications } from "@/notifications/NotificationsProvider";
import { control, hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * The one authenticated header for the whole app.
 *
 * Two forms, no third: a root form for tab screens (brand mark, optional
 * greeting eyebrow, title, bell) and a detail form (back chevron, title). The
 * bell is the only entry point to the notification centre, so it lives here and
 * nowhere else, and it reads its count from the shell-level provider rather
 * than fetching its own.
 *
 * The header sits inside the screen's safe area — Screen already insets "top",
 * so this component adds spacing, not insets.
 */

type AppHeaderProps = {
  title: string;
  /** Small line above the title. Used for Home's greeting. */
  eyebrow?: string;
  /** Show the Viewrr mark on the left. Root screens only. */
  brand?: boolean;
  /** Show a back chevron instead of the mark. Detail screens. */
  back?: boolean;
  /** Override navigation history when a detail screen has a canonical parent. */
  onBackPress?: () => void;
  /** Hide the bell — the notification centre itself does not need one. */
  bell?: boolean;
  /** One optional contextual control on the right, beside the bell. */
  action?: ReactNode;
};

export function AppHeader({
  title,
  eyebrow,
  brand = false,
  back = false,
  onBackPress,
  bell = true,
  action,
}: AppHeaderProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { unread } = useNotifications();

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {back ? (
          <Pressable
            onPress={() => {
              if (onBackPress) {
                onBackPress();
                return;
              }
              router.canGoBack() ? router.back() : router.replace("/(app)");
            }}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.secondary, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <ChevronLeft size={20} color={colors.foreground} strokeWidth={2.4} />
          </Pressable>
        ) : brand ? (
          <Logo size={30} />
        ) : null}

        <View style={styles.copy}>
          {eyebrow ? (
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]} numberOfLines={1}>
              {eyebrow}
            </Text>
          ) : null}
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        {action}
        {bell ? (
          <Pressable
            onPress={() => router.push("/(app)/notifications")}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel={
              unread && unread > 0
                ? `Notifications, ${unread} unread`
                : "Notifications"
            }
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: colors.secondary, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Bell size={20} color={colors.foreground} strokeWidth={2.2} />
            <NotificationBadge count={unread} floating />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    // Leaves the right-hand controls their room and lets the title truncate
    // rather than shove them off the edge at large dynamic-type sizes.
    flexShrink: 1,
  },
  copy: {
    flexShrink: 1,
    gap: 1,
  },
  eyebrow: {
    ...typography.small,
  },
  title: {
    ...typography.h2,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  iconButton: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
