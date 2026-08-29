import { ArrowRight } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { checkBackend, type Connectivity } from "@/api/connectivity";
import { Button } from "@/components/Button";
import { Card, CardBody, CardLabel, CardTitle } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { Logo } from "@/components/Logo";
import { Pill } from "@/components/Pill";
import { Screen } from "@/components/Screen";
import { API_BASE_URL, APP_ENV } from "@/config/env";
import { useSession } from "@/session/SessionProvider";
import { radii, spacing, status as statusColors, typography, useTheme } from "@/theme";

const NEXT_UP = [
  "Native auth against a reviewed endpoint",
  "Briefs feed",
  "Stage approvals",
  "Payout summary",
] as const;

export default function Home() {
  const { user, signOut } = useSession();
  const { colors } = useTheme();
  const [connectivity, setConnectivity] = useState<Connectivity | null>(null);
  const [checking, setChecking] = useState(false);

  const probe = useCallback(async () => {
    setChecking(true);
    const result = await checkBackend();
    setConnectivity(result);
    setChecking(false);
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const roleLabel =
    user?.role === "freelancer" ? "Creative" : user?.role === "admin" ? "Founder" : "Client";

  return (
    <Screen scroll edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good afternoon</Text>
          <Text style={[styles.name, { color: colors.foreground }]}>
            {user?.displayName ?? "Viewrr"}
          </Text>
        </View>
        <Logo size={30} />
      </View>

      <Pill label={roleLabel} tone="brand" style={styles.rolePill} />

      <Card style={styles.card}>
        <CardLabel>Backend connectivity</CardLabel>
        {checking && !connectivity ? (
          <LoadingState message="Contacting Viewrr" fill={false} />
        ) : connectivity?.state === "reachable" ? (
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: statusColors.successBright }]} />
            <Text style={[styles.statusText, { color: colors.foreground }]}>
              Reachable · {connectivity.latencyMs}ms
            </Text>
          </View>
        ) : connectivity ? (
          <ErrorState
            inline
            title="Backend unreachable"
            message={connectivity.reason}
            onRetry={probe}
          />
        ) : null}

        <View style={styles.metaGrid}>
          <View style={styles.metaBlock}>
            <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Environment</Text>
            <Text style={[styles.metaValue, { color: colors.foreground }]}>{APP_ENV}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>API base</Text>
            <Text style={[styles.metaValue, { color: colors.foreground }]} numberOfLines={1}>
              {API_BASE_URL}
            </Text>
          </View>
        </View>
      </Card>

      <Card style={styles.card}>
        <CardLabel>Shell placeholder</CardLabel>
        <CardTitle>Foundation is in place</CardTitle>
        <CardBody>
          Routing, theming and the API layer are wired up. Feature surfaces land after native auth
          is approved.
        </CardBody>
        <View style={styles.list}>
          {NEXT_UP.map((item) => (
            <View key={item} style={styles.listRow}>
              <ArrowRight size={14} color={colors.primary} strokeWidth={2.4} />
              <Text style={[styles.listText, { color: colors.mutedForeground }]}>{item}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Button label="Sign out" variant="ghost" onPress={signOut} style={styles.signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing[4],
  },
  headerCopy: {
    gap: 2,
  },
  greeting: {
    ...typography.small,
  },
  name: {
    ...typography.h2,
  },
  rolePill: {
    marginTop: spacing[4],
  },
  card: {
    marginTop: spacing[5],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: radii.full,
  },
  statusText: {
    ...typography.bodyMedium,
  },
  metaGrid: {
    gap: spacing[3],
  },
  metaBlock: {
    gap: 2,
  },
  metaLabel: {
    ...typography.caption,
  },
  metaValue: {
    ...typography.smallMedium,
  },
  list: {
    gap: spacing[2],
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  listText: {
    ...typography.small,
    flex: 1,
  },
  signOut: {
    marginTop: spacing[5],
  },
});
