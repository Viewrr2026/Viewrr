import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Honest destination state for tabs whose feature phase has not been built.
 *
 * These routes exist now so the navigation tree, deep links and the
 * notification resolver all have real targets from day one. What they must not
 * do is imply a half-built feature: no fake rows, no disabled controls, no
 * spinner that never resolves. The copy states plainly what is coming and where
 * the capability lives today.
 */

type ComingNextProps = {
  title: string;
  body: string;
  icon: LucideIcon;
  /** Where the user can do this right now, if anywhere. */
  meanwhile?: string;
};

export function ComingNext({ title, body, icon: Icon, meanwhile }: ComingNextProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.badge,
          { backgroundColor: colors.primaryWash, borderColor: colors.primaryWashBorder },
        ]}
      >
        <Icon size={26} color={colors.primary} strokeWidth={2} />
      </View>

      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{body}</Text>
      </View>

      {meanwhile ? (
        <View style={[styles.note, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.noteText, { color: colors.mutedForeground }]}>{meanwhile}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[4],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[10],
  },
  badge: {
    width: 60,
    height: 60,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    gap: spacing[2],
    alignItems: "center",
  },
  title: {
    ...typography.h2,
    textAlign: "center",
  },
  body: {
    ...typography.small,
    textAlign: "center",
    maxWidth: 300,
  },
  note: {
    borderRadius: radii.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    maxWidth: 320,
  },
  noteText: {
    ...typography.caption,
    textAlign: "center",
  },
});
