import type { LucideIcon } from "lucide-react-native";
import { Inbox } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Empty is a designed state, not an absence.
 *
 * Every empty state must say what the emptiness means and offer the next
 * useful move. "No results" on its own is a dead end, so `title` and `body`
 * are both required and the action is strongly encouraged.
 */

type EmptyStateProps = {
  title: string;
  body: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  /** Compact treatment for use inside a card, rather than filling a screen. */
  inline?: boolean;
};

export function EmptyState({
  title,
  body,
  icon: Icon = Inbox,
  actionLabel,
  onAction,
  inline = false,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, inline ? styles.inline : styles.fill]}>
      <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
        <Icon size={22} color={colors.mutedForeground} strokeWidth={2} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{body}</Text>
      </View>
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="secondary"
          size="compact"
          block={false}
          onPress={onAction}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
  },
  fill: {
    flex: 1,
    padding: spacing[6],
  },
  inline: {
    paddingVertical: spacing[5],
    gap: spacing[3],
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    gap: spacing[2],
    alignItems: "center",
  },
  title: {
    ...typography.h3,
    textAlign: "center",
  },
  body: {
    ...typography.small,
    textAlign: "center",
    maxWidth: 300,
  },
});
