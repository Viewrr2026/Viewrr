import { useRouter } from "expo-router";
import {
  Bell,
  Building2,
  Download,
  LifeBuoy,
  MoreHorizontal,
  Moon,
  Pencil,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  UserX,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "@/api/client";
import type { PublicUser, UserProfile } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { ListRow } from "@/components/ListRow";
import { Pill } from "@/components/Pill";
import { Screen } from "@/components/Screen";
import { SUPPORT_EMAIL, supportMailto } from "@/config/support";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { profileProgress } from "@/lib/format";
import { useSession } from "@/session/SessionProvider";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Profile: who the user is on Viewrr, plus the account controls.
 *
 * Editing, settings, notification preferences and privacy are all real screens
 * behind these rows. Nothing on this screen offers a purchase, a plan upgrade
 * or a link out to web checkout — iOS accounts see their Pro status only where
 * it already applies to them.
 *
 * The header overflow carries the account and trust actions in one place, the
 * way iOS users expect to find them. Note what is deliberately absent: there is
 * no "report" or "block" action here, because this is the signed-in user's own
 * profile and there is no other party to report. Those live where a second
 * party exists — the blocked-accounts rows (unblock / report) and, as a
 * follow-up outside this agent's ownership, the public profile route
 * `discover/[profileId].tsx`, which should mount the same ActionSheet plus
 * ReportDialog pair against that profile's user id.
 */

type ProfileSnapshot = {
  account: PublicUser | null;
  profile: UserProfile | null;
};

export default function ProfileHome() {
  const { user, signOut, signingOut } = useSession();
  const { colors, scheme, isSystem, toggle, useSystem } = useTheme();
  const router = useRouter();

  const userId = user?.id ?? null;
  const [overflow, setOverflow] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal): Promise<ProfileSnapshot> => {
      if (userId === null) return { account: null, profile: null };

      const [account, profile] = await Promise.all([
        api.get<PublicUser>(`/api/users/${userId}`, { signal }),
        // A client has no creative profile row; a 404 here is normal, not a
        // failure of the screen.
        api
          .get<UserProfile>(`/api/profile-by-user/${userId}`, { signal })
          .catch(() => null),
      ]);

      return { account, profile };
    },
    [userId],
  );

  const { resource, refreshing, refresh, reload } = useAsyncResource<ProfileSnapshot>(load, {
    enabled: userId !== null,
  });

  const roleLabel =
    user?.role === "freelancer" ? "Creative" : user?.role === "admin" ? "Founder" : "Client";

  return (
    <Screen
      scroll
      edges={["top", "left", "right"]}
      refreshing={refreshing}
      onRefresh={resource.phase === "ready" ? refresh : undefined}
    >
      <AppHeader
        title="Profile"
        brand
        action={
          <Pressable
            onPress={() => setOverflow(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Account options"
            accessibilityHint="Opens editing, settings, blocked accounts, support and deletion"
            style={[styles.headerButton, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          >
            <MoreHorizontal size={20} color={colors.foreground} strokeWidth={2.4} />
          </Pressable>
        }
      />

      <ActionSheet
        visible={overflow}
        title="Account"
        message="Your profile, your data and your account controls."
        onClose={() => setOverflow(false)}
        actions={[
          {
            label: "Edit profile",
            icon: Pencil,
            onPress: () => {
              setOverflow(false);
              router.push("/(app)/profile/edit");
            },
          },
          {
            label: "Notification preferences",
            icon: Bell,
            description: "Email and push, managed separately",
            onPress: () => {
              setOverflow(false);
              router.push("/(app)/profile/notification-preferences");
            },
          },
          {
            label: "Blocked accounts",
            icon: UserX,
            description: "Unblock or report someone you've blocked",
            onPress: () => {
              setOverflow(false);
              router.push("/(app)/account/blocked");
            },
          },
          {
            label: "Download my data",
            icon: Download,
            onPress: () => {
              setOverflow(false);
              router.push("/(app)/account/export");
            },
          },
          {
            label: "Contact support",
            icon: LifeBuoy,
            description: SUPPORT_EMAIL,
            onPress: () => {
              setOverflow(false);
              void Linking.openURL(supportMailto("Support request"));
            },
          },
          {
            label: "Delete my account",
            icon: Trash2,
            tone: "destructive",
            onPress: () => {
              setOverflow(false);
              router.push("/(app)/account/deletion");
            },
          },
        ]}
      />

      <DataState resource={resource} onRetry={reload} skeleton="dashboard">
        {({ account, profile }) => {
          const name = account?.name ?? user?.displayName ?? "Your account";
          const progress = profileProgress(profile, account);
          const isAgency =
            account?.accountSubtype === "agency_owner" ||
            account?.accountSubtype === "agency_member";

          return (
            <View style={styles.body}>
              <View style={styles.identity}>
                <Avatar name={name} uri={account?.avatar} size="lg" ring />
                <View style={styles.identityCopy}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {account?.headline ? (
                    <Text
                      style={[styles.headline, { color: colors.mutedForeground }]}
                      numberOfLines={2}
                    >
                      {account.headline}
                    </Text>
                  ) : null}
                  <View style={styles.pills}>
                    <Pill label={roleLabel} tone="brand" />
                    {profile?.isPro === 1 ? <Pill label="Pro" tone="available" /> : null}
                    {profile?.accreditationLevel ? (
                      <Pill label={profile.accreditationLevel} tone="neutral" />
                    ) : null}
                  </View>
                </View>
              </View>

              {user?.role === "freelancer" && progress.nextStep ? (
                <Card style={styles.card}>
                  <CardLabel>Profile strength</CardLabel>
                  <View style={[styles.track, { backgroundColor: colors.muted }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          width: `${Math.max(progress.percent, 4)}%`,
                          backgroundColor: colors.primary,
                        },
                      ]}
                    />
                  </View>
                  <CardBody>
                    {progress.percent}% complete · next: {progress.nextStep.toLowerCase()}.
                  </CardBody>
                </Card>
              ) : null}

              {isAgency ? (
                <Card style={styles.card}>
                  <View style={styles.agencyHead}>
                    <Building2 size={18} color={colors.primary} strokeWidth={2.2} />
                    <Text style={[styles.agencyTitle, { color: colors.foreground }]}>
                      {account?.accountSubtype === "agency_owner"
                        ? "Agency owner account"
                        : "Agency member account"}
                    </Text>
                  </View>
                  <CardBody>
                    {account?.accountSubtype === "agency_owner"
                      ? "Roster management, team assignment and agency billing are handled on viewrr.co.uk for now. Everything else in the app works exactly as it does for a solo account."
                      : "You're part of an agency. Your own projects, messages and notifications work normally here; agency-wide tools live on viewrr.co.uk for now."}
                  </CardBody>
                </Card>
              ) : null}

              <View style={styles.group}>
                <ListRow
                  title="Edit profile"
                  subtitle="Photo, headline, bio and rates"
                  leading={<Glyph icon={Pencil} />}
                  onPress={() => router.push("/(app)/profile/edit")}
                />
                <Divider />
                <ListRow
                  title="Notification preferences"
                  subtitle="Choose what Viewrr tells you about"
                  leading={<Glyph icon={Bell} />}
                  onPress={() => router.push("/(app)/profile/notification-preferences")}
                />
                <Divider />
                <ListRow
                  title="Privacy"
                  subtitle="Your data, visibility and account deletion"
                  leading={<Glyph icon={ShieldCheck} />}
                  onPress={() => router.push("/(app)/profile/privacy")}
                />
                <Divider />
                <ListRow
                  title="Settings"
                  subtitle="App preferences and account details"
                  leading={<Glyph icon={Settings} />}
                  onPress={() => router.push("/(app)/profile/settings")}
                />
              </View>

              {/* Appearance mirrors the Sun/Moon toggle in the web navbar. */}
              <Card style={styles.card}>
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
                    accessibilityLabel={
                      scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"
                    }
                    style={[
                      styles.toggle,
                      { borderColor: colors.border, backgroundColor: colors.secondary },
                    ]}
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

              <Button
                label={signingOut ? "Signing out" : "Sign out"}
                variant="ghost"
                loading={signingOut}
                onPress={() => void signOut()}
                accessibilityHint="Signs out on this device and revokes the session"
              />
            </View>
          );
        }}
      </DataState>
    </Screen>
  );
}

function Glyph({ icon: Icon }: { icon: typeof Pencil }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.glyph, { backgroundColor: colors.secondary }]}>
      <Icon size={17} color={colors.mutedForeground} strokeWidth={2} />
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[5],
    paddingBottom: spacing[4],
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
  },
  identityCopy: {
    flex: 1,
    gap: spacing[1],
  },
  name: {
    ...typography.h2,
  },
  headline: {
    ...typography.small,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[1],
  },
  card: {
    gap: spacing[3],
  },
  track: {
    height: 6,
    borderRadius: radii.full,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radii.full,
  },
  agencyHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  agencyTitle: {
    ...typography.bodyMedium,
    flex: 1,
  },
  group: {
    gap: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
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
