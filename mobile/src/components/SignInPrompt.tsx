import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { gutter, radii, spacing, typography, useTheme } from "@/theme";

/**
 * The sign-in gate for public surfaces — PRD 1, Decision 1.
 *
 * The feed is publicly readable with optional auth, so a signed-out viewer can
 * scroll it. Every WRITE (like, comment, repost, new post) needs a credential.
 * Rather than firing a request that will 401, or — worse — optimistically
 * painting a like that will never persist, the caller opens this sheet and
 * fires nothing at all. That is the whole point: no interaction is ever shown
 * as having happened when it has not.
 *
 * It offers both doors, because a signed-out viewer on the feed is as likely to
 * be a new visitor as a returning user, and routes into the (auth) group so the
 * auth stack's own guard keeps owning what happens next.
 */

export type SignInPromptProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * The action the viewer attempted, phrased to complete "Sign in to …" —
   * e.g. "like this post". Keeps the copy specific instead of generic.
   */
  action?: string;
};

export function SignInPrompt({ visible, onClose, action }: SignInPromptProps) {
  const router = useRouter();
  const { colors } = useTheme();

  const go = useCallback(
    (path: "/(auth)/sign-in" | "/(auth)/sign-up") => {
      // Close first so the sheet is not left mounted over the destination.
      onClose();
      router.push(path);
    },
    [onClose, router],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        {/* Swallow taps inside the sheet so only the backdrop dismisses. */}
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {}}
          accessibilityRole="none"
        >
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>

          <Logo size={28} />

          <Text style={[styles.title, { color: colors.foreground }]}>
            {action ? `Sign in to ${action}` : "Sign in to join in"}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            Browsing is open to everyone. Posting, liking and replying need an account — it takes
            a minute.
          </Text>

          <View style={styles.actions}>
            <Button
              label="Sign in"
              onPress={() => go("/(auth)/sign-in")}
              accessibilityHint="Opens the sign-in screen"
            />
            <Button
              label="Create account"
              variant="outline"
              onPress={() => go("/(auth)/sign-up")}
              accessibilityHint="Opens the account creation screen"
            />
            <Button label="Not now" variant="ghost" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopLeftRadius: radii["2xl"],
    borderTopRightRadius: radii["2xl"],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: gutter,
    paddingTop: spacing[2],
    paddingBottom: spacing[8],
    gap: spacing[3],
  },
  handleRow: {
    alignItems: "center",
    paddingBottom: spacing[2],
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radii.full,
  },
  title: {
    ...typography.h2,
  },
  body: {
    ...typography.small,
  },
  actions: {
    marginTop: spacing[2],
    gap: spacing[2],
  },
});
