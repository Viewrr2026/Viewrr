import { useRouter } from "expo-router";
import {
  Bell,
  Download,
  FileText,
  LifeBuoy,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
  UserX,
} from "lucide-react-native";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/AppHeader";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { LEGAL_URLS } from "@/config/env";
import { SUPPORT_EMAIL, supportMailto } from "@/config/support";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Settings — Decision 16.
 *
 * Every row here does something real. What is NOT here, and why:
 *   • Change password — deferred (Decision 16). Password reset stays on the
 *     existing email mechanism, so there is nothing to expose in-app.
 *   • Change email — deferred (Decision 16).
 *   • Push toggles — they live in Notification preferences, in their own
 *     section, and duplicating them here would imply a third store.
 *   • Profile visibility, two-factor authentication, device/session list —
 *     unsupported by the backend. A row that renders a switch over nothing is
 *     worse than no row.
 *
 * Appearance is local-only and stays that way: the theme override lives in
 * ThemeProvider for the session, exactly as the web toggle does.
 */
const COMMUNITY_GUIDELINES_URL = "https://www.viewrr.co.uk/#/community-guidelines";

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, scheme, isSystem, toggle, useSystem } = useTheme();

  const glyph = (Icon: typeof Bell) => (
    <View style={[styles.glyph, { backgroundColor: colors.secondary }]}>
      <Icon size={17} color={colors.mutedForeground} strokeWidth={2} />
    </View>
  );

  return (
    <Screen scroll edges={["top", "left", "right"]}>
      <AppHeader title="Settings" back bell={false} />

      <View style={styles.body}>
        <Card>
          <CardLabel>Your data</CardLabel>
          <View>
            <ListRow
              title="Download my data"
              subtitle="A copy of everything Viewrr holds about you"
              leading={glyph(Download)}
              onPress={() => router.push("/(app)/account/export")}
            />
            <Divider />
            <ListRow
              title="Blocked accounts"
              subtitle="See who you've blocked, and unblock them"
              leading={glyph(UserX)}
              onPress={() => router.push("/(app)/account/blocked")}
            />
            <Divider />
            <ListRow
              title="Notification preferences"
              subtitle="Email and push, managed separately"
              leading={glyph(Bell)}
              onPress={() => router.push("/(app)/profile/notification-preferences")}
            />
          </View>
        </Card>

        {/* Appearance — the same Sun/Moon control as the web navbar, local to
            this device and this session. */}
        <Card>
          <CardLabel>Appearance</CardLabel>
          <CardBody>
            {isSystem
              ? `Following your device setting (${scheme}).`
              : `Set to ${scheme} for this session.`}
          </CardBody>
          <View style={styles.row}>
            <Pressable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              style={[styles.toggle, { borderColor: colors.border, backgroundColor: colors.secondary }]}
            >
              {scheme === "dark" ? (
                <Sun size={18} color={colors.foreground} strokeWidth={2.2} />
              ) : (
                <Moon size={18} color={colors.foreground} strokeWidth={2.2} />
              )}
              <Text style={[styles.toggleLabel, { color: colors.foreground }]}>
                {scheme === "dark" ? "Light" : "Dark"}
              </Text>
            </Pressable>
            {isSystem ? null : (
              <Pressable
                onPress={useSystem}
                accessibilityRole="button"
                accessibilityLabel="Follow device appearance"
                style={[styles.toggle, { borderColor: colors.border }]}
              >
                <Text style={[styles.toggleLabel, { color: colors.mutedForeground }]}>
                  Use device
                </Text>
              </Pressable>
            )}
          </View>
        </Card>

        <Card>
          <CardLabel>Help and legal</CardLabel>
          <View>
            <ListRow
              title="Community Guidelines"
              subtitle="Rules for content, conduct, reporting and moderation"
              leading={glyph(FileText)}
              onPress={() => void Linking.openURL(COMMUNITY_GUIDELINES_URL)}
            />
            <Divider />
            <ListRow
              title="Contact support"
              subtitle={`Email the Viewrr team at ${SUPPORT_EMAIL}`}
              leading={glyph(LifeBuoy)}
              onPress={() => void Linking.openURL(supportMailto("Support request"))}
            />
            <Divider />
            <ListRow
              title="Privacy policy"
              subtitle="How Viewrr handles your data"
              leading={glyph(ShieldCheck)}
              onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}
            />
            <Divider />
            <ListRow
              title="Terms of service"
              subtitle="The agreement you signed up under"
              leading={glyph(FileText)}
              onPress={() => void Linking.openURL(LEGAL_URLS.terms)}
            />
          </View>
        </Card>

        <Card>
          <CardLabel>Account</CardLabel>
          <View>
            <ListRow
              title="Delete my account"
              subtitle="Permanently delete your Viewrr account"
              leading={glyph(Trash2)}
              onPress={() => router.push("/(app)/account/deletion")}
            />
          </View>
          <CardBody>
            Changing your password or email address isn&apos;t available in the app yet — use the
            password reset link on viewrr.co.uk, or email {SUPPORT_EMAIL}.
          </CardBody>
        </Card>
      </View>
    </Screen>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    gap: spacing[2],
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: 44,
    paddingHorizontal: spacing[4],
    borderRadius: radii.full,
    borderWidth: 1,
  },
  toggleLabel: {
    ...typography.smallMedium,
  },
});
