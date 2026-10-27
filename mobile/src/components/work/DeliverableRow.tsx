import { ExternalLink, Eye, Lock } from "lucide-react-native";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { Deliverable } from "@/api/work";
import { MediaViewer } from "@/components/MediaViewer";
import { parseVideoUrl } from "@/lib/media";
import { mediaKind } from "@/lib/mediaPlayback";
import { radii, spacing, typography, useTheme } from "@/theme";

/** Originals remain payment-gated. Uploaded work can expose a separately
 * watermarked preview; native clients resolve its short-lived URL with bearer auth.
 */

type DeliverableRowProps = {
  deliverable: Deliverable;
  /** Role-appropriate explanation of how the lock clears. */
  lockCopy: string;
};

export function DeliverableRow({ deliverable, lockCopy }: DeliverableRowProps) {
  const { colors } = useTheme();
  const [viewing, setViewing] = useState(false);

  const target = deliverable.locked ? deliverable.previewUrl ?? null : deliverable.url ?? deliverable.embedUrl ?? null;
  const openable = target !== null;
  const inApp = !!target && (mediaKind(target) !== "web" || !!parseVideoUrl(target));

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
          inApp ? <Eye size={16} color={colors.primary} strokeWidth={2.2} /> : <ExternalLink size={16} color={colors.primary} strokeWidth={2.2} />
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
          <Text style={[styles.lockCopy, { color: colors.mutedForeground }]}>{deliverable.previewUrl ? "Tap to review the watermarked preview. The original unlocks after payment." : "Ask your freelancer to add a review preview. " + lockCopy}</Text>
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
    <>
    {viewing && <MediaViewer source={{ kind: "url", url: target }} title={deliverable.label} backLabel="Back to deliveries" onClose={() => setViewing(false)} />}
    <Pressable
      onPress={() => {
        if (inApp) setViewing(true);
        else void Linking.openURL(target).catch(() => Alert.alert("Unable to open link", "Please try again."));
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${deliverable.label}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      {body}
    </Pressable>
    </>
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
