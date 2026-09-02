import { ExternalLink, Lock } from "lucide-react-native";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { Deliverable } from "@/api/work";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * One deliverable — locked or open (Decision 10).
 *
 * The gate is real and server-side: when `locked` is true the response does not
 * contain `url` or `embedUrl` at all. So a locked row has nothing to open, and
 * this component does not pretend otherwise. It does not blur, overlay or
 * watermark an asset it can see — the web CSS watermark was never protection
 * and is not reimplemented here — and there is no code path that tries to
 * reconstruct a withheld URL.
 *
 * What a locked row does instead is explain itself: what is locked, why, and
 * who unlocks it. Payment is completed on the web via Stripe; mobile never
 * mutates payment state.
 */

type DeliverableRowProps = {
  deliverable: Deliverable;
  /** Role-appropriate explanation of how the lock clears. */
  lockCopy: string;
};

export function DeliverableRow({ deliverable, lockCopy }: DeliverableRowProps) {
  const { colors } = useTheme();

  const target = deliverable.url ?? deliverable.embedUrl ?? null;
  const openable = !deliverable.locked && target !== null;

  const body = (
    <>
      <View
        style={[
          styles.icon,
          {
            backgroundColor: deliverable.locked ? colors.secondary : colors.primaryWash,
            borderColor: deliverable.locked ? colors.border : colors.primaryWashBorder,
          },
        ]}
      >
        {deliverable.locked ? (
          <Lock size={16} color={colors.mutedForeground} strokeWidth={2.2} />
        ) : (
          <ExternalLink size={16} color={colors.primary} strokeWidth={2.2} />
        )}
      </View>

      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.foreground }]} numberOfLines={2}>
          {deliverable.label}
        </Text>
        <Text style={[styles.platform, { color: colors.mutedForeground }]} numberOfLines={1}>
          {deliverable.platform}
        </Text>
        {deliverable.locked ? (
          <Text style={[styles.lockCopy, { color: colors.mutedForeground }]}>{lockCopy}</Text>
        ) : null}
      </View>
    </>
  );

  if (!openable) {
    return (
      <View
        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityLabel={
          deliverable.locked
            ? `${deliverable.label}, locked. ${lockCopy}`
            : `${deliverable.label}. No link available.`
        }
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => void Linking.openURL(target)}
      accessibilityRole="link"
      accessibilityLabel={`Open ${deliverable.label}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: 56,
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing[3],
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...typography.smallBold,
  },
  platform: {
    ...typography.caption,
  },
  lockCopy: {
    ...typography.caption,
    paddingTop: 2,
  },
  pressed: {
    opacity: 0.75,
  },
});
