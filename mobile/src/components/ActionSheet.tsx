import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { control, radii, spacing, typography, useTheme } from "@/theme";

/**
 * The app's only modal primitive: a bottom action sheet.
 *
 * Composed from the shipped theme rather than a new dependency — RN's `Modal`
 * plus the same surfaces, radii and type scale every other screen uses, so it
 * inherits light/dark and the Satoshi/Clash Display faces for free.
 *
 * Design decisions worth keeping:
 *   • The scrim is a real button labelled "Close", so dismissing by tapping
 *     outside is available to VoiceOver users too, not just to a stray finger.
 *   • Destructive actions are tinted with --destructive and never sit first in
 *     the list, so the muscle-memory tap is not the irreversible one.
 *   • Rows are `control.minTouchTarget` tall and the sheet respects the bottom
 *     safe-area inset, so the last action is never under the home indicator.
 *   • Nothing here closes itself. The caller owns `visible`, which means an
 *     action that needs to stay open while a request runs simply can.
 */

export type ActionSheetAction = {
  label: string;
  /** Second line — use it to say what the action will actually do. */
  description?: string;
  onPress: () => void;
  icon?: LucideIcon;
  tone?: "default" | "destructive" | "primary";
  disabled?: boolean;
};

type ActionSheetProps = {
  visible: boolean;
  title: string;
  /** Plain-English context. Short: this is a sheet, not a page. */
  message?: string;
  actions: ActionSheetAction[];
  onClose: () => void;
  cancelLabel?: string;
  /**
   * Optional content between the header and the actions — a single field, at
   * most. A sheet that needs a form needs a screen instead.
   */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ActionSheet({
  visible,
  title,
  message,
  actions,
  onClose,
  cancelLabel = "Cancel",
  children,
  style,
}: ActionSheetProps) {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.scrim, { backgroundColor: colors.overlay }]}
        />

        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            shadows.lg,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, spacing[4]),
            },
            style,
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            {message ? (
              <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text>
            ) : null}
          </View>

          {children ? <View style={styles.slot}>{children}</View> : null}

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {actions.map((action, index) => {
              const tone = action.tone ?? "default";
              const labelColor = action.disabled
                ? colors.mutedForeground
                : tone === "destructive"
                  ? colors.destructive
                  : tone === "primary"
                    ? colors.primary
                    : colors.foreground;
              const Icon = action.icon;

              return (
                <View key={`${action.label}-${index}`}>
                  {index > 0 ? (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  ) : null}
                  <Pressable
                    onPress={action.onPress}
                    disabled={action.disabled}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    accessibilityHint={action.description}
                    accessibilityState={{ disabled: Boolean(action.disabled) }}
                    style={({ pressed }) => [
                      styles.action,
                      pressed && !action.disabled && { backgroundColor: colors.secondary },
                    ]}
                  >
                    {Icon ? <Icon size={18} color={labelColor} strokeWidth={2.1} /> : null}
                    <View style={styles.actionCopy}>
                      <Text style={[styles.actionLabel, { color: labelColor }]}>
                        {action.label}
                      </Text>
                      {action.description ? (
                        <Text
                          style={[styles.actionDescription, { color: colors.mutedForeground }]}
                        >
                          {action.description}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: colors.secondary, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.cancelLabel, { color: colors.foreground }]}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    borderTopLeftRadius: radii["3xl"],
    borderTopRightRadius: radii["3xl"],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    gap: spacing[3],
    maxHeight: "82%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: radii.full,
    marginBottom: spacing[2],
  },
  header: {
    gap: spacing[1],
    paddingHorizontal: spacing[1],
  },
  title: {
    ...typography.h3,
  },
  message: {
    ...typography.small,
  },
  slot: {
    paddingHorizontal: spacing[1],
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingVertical: spacing[1],
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: control.minTouchTarget,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderRadius: radii.lg,
  },
  actionCopy: {
    flex: 1,
    gap: 2,
  },
  actionLabel: {
    ...typography.bodyMedium,
  },
  actionDescription: {
    ...typography.caption,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing[2],
  },
  cancel: {
    minHeight: control.height,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLabel: {
    ...typography.bodyBold,
  },
  pressed: {
    opacity: 0.75,
  },
});
