import { useRouter } from "expo-router";
import { Download, FileText, LifeBuoy, ShieldCheck, Trash2, UserX } from "lucide-react-native";
import { Linking, StyleSheet, View } from "react-native";

import { AppHeader } from "@/components/AppHeader";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { LEGAL_URLS } from "@/config/env";
import { SUPPORT_EMAIL, supportMailto } from "@/config/support";
import { radii, spacing, useTheme } from "@/theme";

/**
 * Privacy and account controls.
 *
 * Apple requires an in-app route to account deletion for any app with
 * accounts, so the destination is registered from the first build rather than
 * deferred. The policy documents open in the browser because they are the same
 * published documents the website serves — duplicating them in the binary would
 * only let them go stale.
 *
 * The support row is here as well as in Settings: Apple 1.2 expects a way to
 * reach a human from wherever a user is worrying about their data, and this is
 * the screen they land on when they are.
 */

const POLICY_URL = LEGAL_URLS.privacy;
const TERMS_URL = LEGAL_URLS.terms;

export default function Privacy() {
  const router = useRouter();
  const { colors } = useTheme();

  const glyph = (Icon: typeof ShieldCheck) => (
    <View style={[styles.glyph, { backgroundColor: colors.secondary }]}>
      <Icon size={17} color={colors.mutedForeground} strokeWidth={2} />
    </View>
  );

  return (
    <Screen scroll edges={["top", "left", "right"]}>
      <AppHeader title="Privacy" back />

      <View style={styles.body}>
        <Card>
          <CardLabel>Your data</CardLabel>
          <CardBody>
            Viewrr stores your profile, your work and your messages so the marketplace can
            function. You can download a copy or delete your account at any time, and you can ask
            the team about any of it at {SUPPORT_EMAIL}.
          </CardBody>
        </Card>

        <View>
          <ListRow
            title="Download my data"
            subtitle="A copy of everything Viewrr holds about you"
            leading={glyph(Download)}
            onPress={() => router.push("/(app)/account/export")}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ListRow
            title="Blocked accounts"
            subtitle="See who you've blocked, and unblock them"
            leading={glyph(UserX)}
            onPress={() => router.push("/(app)/account/blocked")}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ListRow
            title="Contact support"
            subtitle={`Email the Viewrr team at ${SUPPORT_EMAIL}`}
            leading={glyph(LifeBuoy)}
            onPress={() => void Linking.openURL(supportMailto("Privacy question"))}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ListRow
            title="Privacy policy"
            subtitle="How Viewrr handles your data"
            leading={glyph(ShieldCheck)}
            onPress={() => void Linking.openURL(POLICY_URL)}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ListRow
            title="Terms of service"
            subtitle="The agreement you signed up under"
            leading={glyph(FileText)}
            onPress={() => void Linking.openURL(TERMS_URL)}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ListRow
            title="Delete my account"
            subtitle="Permanently remove your Viewrr account"
            leading={glyph(Trash2)}
            onPress={() => router.push("/(app)/account/deletion")}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[5],
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
});
