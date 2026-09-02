import { useLocalSearchParams, useRouter } from "expo-router";
import { Activity, ExternalLink, ListChecks, Package } from "lucide-react-native";
import { useCallback } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { loadProjectDetail, type ProjectDetailSnapshot } from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Card, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { ErrorState } from "@/components/ErrorState";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import {
  isLegacyProject,
  isRetainer,
  LEGACY_STAGES,
  partyFor,
} from "@/components/work/gating";
import { ProgressBar } from "@/components/work/ProgressBar";
import { webProjectUrl, WEB_WORK_URL } from "@/components/work/webLinks";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatPence } from "@/lib/format";
import { relativeTime } from "@/lib/time";
import { useSession } from "@/session/SessionProvider";
import { spacing, typography, useTheme } from "@/theme";

/**
 * Project overview.
 *
 * Four things, in the order they matter: what the project is, who is on it,
 * what stage it is at, and what the money is doing.
 *
 * ── Payment is READ-ONLY here, on purpose ────────────────────────────────
 * `POST /api/projects/:id/confirm-payment` and `PATCH /api/invoices/:id/paid`
 * are not called anywhere in mobile and are not even declared in `api/work.ts`.
 * A tap that flips a project to "paid" without money moving is a way to lose
 * someone's fee. Real payment goes through the web Stripe path, so this screen
 * reports payment state and links out to it.
 *
 * ── Legacy and retainer ──────────────────────────────────────────────────
 * A legacy project (Decision 11) shows its historical stage position and sends
 * the user to a read-only timeline. A retainer (Decision 12) shows its agreed
 * cycle facts and a "Manage on web" link, and offers no cycle action at all.
 */

export default function ProjectDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  const id = Number(projectId);
  const valid = Number.isInteger(id) && id > 0;

  const loader = useCallback((signal: AbortSignal) => loadProjectDetail(id, signal), [id]);
  const { resource, refreshing, refresh, reload } = useAsyncResource<ProjectDetailSnapshot>(
    loader,
    { enabled: valid, deps: [id] },
  );

  if (!valid) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <AppHeader title="Project" back />
        <ErrorState
          title="Project not found"
          message="That project reference isn't valid. Open the project from your Work list."
        />
      </Screen>
    );
  }

  return (
    <Screen
      edges={["top", "left", "right"]}
      scroll
      refreshing={refreshing}
      onRefresh={refresh}
      style={styles.content}
    >
      <AppHeader title="Project" back />

      <DataState resource={resource} onRetry={reload} skeleton="dashboard">
        {({ detail, plan, deliverables, deliverablesFailed }) => {
          const { project, client, freelancer } = detail;
          const party = user ? partyFor(project, user.id) : "observer";
          const legacy = isLegacyProject(project);
          const retainer = isRetainer(project);

          const amount = formatPence(project.agreedAmountPence);
          const paid = project.paymentStatus === "paid";

          const activeStage = plan?.activeStage ?? null;
          const legacyStage = legacy
            ? LEGACY_STAGES[
                Math.max(0, Math.min(LEGACY_STAGES.length - 1, project.currentStage))
              ]
            : null;

          const lockedCount = deliverables.filter((item) => item.locked).length;

          return (
            <View style={styles.body}>
              {/* ── Overview ─────────────────────────────────────────── */}
              <Card>
                <Text style={[styles.title, { color: colors.foreground }]}>{project.title}</Text>

                <View style={styles.badges}>
                  <StatusBadge status={project.status} />
                  {project.paymentStatus ? <StatusBadge status={project.paymentStatus} /> : null}
                  {retainer ? <StatusBadge status="retainer" /> : null}
                  <StatusBadge status={project.planningStatus} />
                </View>

                {project.description ? (
                  <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                    {project.description}
                  </Text>
                ) : null}

                <View style={styles.metaRow}>
                  {project.briefCategory ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      {project.briefCategory}
                    </Text>
                  ) : null}
                  {relativeTime(project.createdAt) ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      Started {relativeTime(project.createdAt)}
                    </Text>
                  ) : null}
                  {project.completedAt && relativeTime(project.completedAt) ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      Completed {relativeTime(project.completedAt)}
                    </Text>
                  ) : null}
                </View>
              </Card>

              {/* ── Parties ──────────────────────────────────────────── */}
              <Card>
                <CardLabel>People</CardLabel>
                <ListRow
                  title={client?.name ?? project.clientName ?? "Client"}
                  subtitle={
                    party === "client" ? "Client · you" : client?.headline ?? "Client"
                  }
                  leading={
                    <Avatar
                      name={client?.name ?? project.clientName ?? "Client"}
                      uri={client?.avatar ?? null}
                      size="md"
                    />
                  }
                />
                <ListRow
                  title={freelancer?.name ?? project.freelancerName ?? "Creative"}
                  subtitle={
                    party === "freelancer"
                      ? "Creative · you"
                      : freelancer?.headline ?? "Creative"
                  }
                  leading={
                    <Avatar
                      name={freelancer?.name ?? project.freelancerName ?? "Creative"}
                      uri={freelancer?.avatar ?? null}
                      size="md"
                    />
                  }
                  onPress={
                    party === "client" && freelancer?.id
                      ? () =>
                          router.push({
                            pathname: "/(app)/discover/[profileId]",
                            params: { profileId: String(freelancer.id) },
                          })
                      : undefined
                  }
                />
              </Card>

              {/* ── Current stage ────────────────────────────────────── */}
              <Card>
                <CardLabel>Where it's at</CardLabel>

                {legacy ? (
                  <>
                    <Text style={[styles.stageTitle, { color: colors.foreground }]}>
                      {legacyStage ?? "Original timeline"}
                    </Text>
                    <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                      This project uses Viewrr&apos;s original six-stage timeline. It is shown
                      read-only on mobile — stage changes are made on the website.
                    </Text>
                    <ProgressBar
                      percent={null}
                      caption={`Stage ${project.currentStage + 1} of ${LEGACY_STAGES.length}`}
                    />
                  </>
                ) : activeStage ? (
                  <>
                    <Text style={[styles.stageTitle, { color: colors.foreground }]}>
                      {activeStage.title}
                    </Text>
                    <View style={styles.badges}>
                      <StatusBadge status={activeStage.status} />
                      {activeStage.approvalRequired === 1 ? (
                        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                          Client approval required
                        </Text>
                      ) : null}
                    </View>
                    {activeStage.description ? (
                      <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                        {activeStage.description}
                      </Text>
                    ) : null}
                    <ProgressBar
                      percent={plan?.progress ?? null}
                      caption={
                        plan
                          ? `${plan.stageCount} ${plan.stageCount === 1 ? "stage" : "stages"} in the plan`
                          : undefined
                      }
                    />
                  </>
                ) : plan && plan.stageCount === 0 ? (
                  <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                    No stages have been agreed on this project yet. The plan is built on the
                    website.
                  </Text>
                ) : (
                  <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                    No stage is currently in progress.
                  </Text>
                )}
              </Card>

              {/* ── Payment (read-only) ──────────────────────────────── */}
              <Card>
                <CardLabel>Payment</CardLabel>
                <View style={styles.paymentRow}>
                  <Text style={[styles.amount, { color: colors.foreground }]}>
                    {amount ?? "—"}
                  </Text>
                  <StatusBadge status={project.paymentStatus ?? "unpaid"} />
                </View>
                <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                  {amount === null
                    ? "No agreed amount is recorded on this project."
                    : paid
                      ? "This project is marked paid."
                      : party === "client"
                        ? "Payment is taken securely on the Viewrr website. It can't be marked paid from the app."
                        : "Your client pays through the Viewrr website. Payment state can't be changed from the app."}
                </Text>
                {!paid ? (
                  <Pressable
                    onPress={() => void Linking.openURL(webProjectUrl(project.id))}
                    accessibilityRole="link"
                    accessibilityLabel="Open this project on the web"
                    style={({ pressed }) => [styles.webLink, pressed && styles.pressed]}
                  >
                    <ExternalLink size={14} color={colors.primary} strokeWidth={2.2} />
                    <Text style={[styles.webLinkLabel, { color: colors.primary }]}>
                      Open on the web
                    </Text>
                  </Pressable>
                ) : null}
              </Card>

              {/* ── Retainer (Decision 12) ───────────────────────────── */}
              {retainer ? (
                <Card tone="brand">
                  <CardLabel>Retainer</CardLabel>
                  <Text style={[styles.copy, { color: colors.foreground }]}>
                    Cycle sign-off, pausing and billing for retainers aren&apos;t in the mobile
                    app yet. Everything here is read-only.
                  </Text>
                  <View style={styles.metaRow}>
                    {project.billingCycle ? (
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                        Billing: {project.billingCycle}
                      </Text>
                    ) : null}
                    {typeof project.currentCycleNumber === "number" ? (
                      <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                        Cycle {project.currentCycleNumber}
                        {typeof project.totalCycles === "number" && project.totalCycles > 0
                          ? ` of ${project.totalCycles}`
                          : ""}
                      </Text>
                    ) : null}
                  </View>
                  {project.deliverablesPerCycle ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      Per cycle: {project.deliverablesPerCycle}
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={() => void Linking.openURL(WEB_WORK_URL)}
                    accessibilityRole="link"
                    accessibilityLabel="Manage this retainer on the web"
                    style={({ pressed }) => [styles.webLink, pressed && styles.pressed]}
                  >
                    <ExternalLink size={14} color={colors.primary} strokeWidth={2.2} />
                    <Text style={[styles.webLinkLabel, { color: colors.primary }]}>
                      Manage on web
                    </Text>
                  </Pressable>
                </Card>
              ) : null}

              {/* ── Navigation ──────────────────────────────────────── */}
              <Card>
                <CardLabel>More</CardLabel>
                <ListRow
                  title="Stages"
                  subtitle={
                    legacy
                      ? "Original six-stage timeline, read-only"
                      : plan
                        ? `${plan.stageCount} ${plan.stageCount === 1 ? "stage" : "stages"}`
                        : "Stage timeline"
                  }
                  leading={<ListChecks size={18} color={colors.mutedForeground} strokeWidth={2} />}
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/work/[projectId]/stages",
                      params: { projectId: String(project.id) },
                    })
                  }
                />
                <ListRow
                  title="Activity"
                  subtitle="Stage events and project updates"
                  leading={<Activity size={18} color={colors.mutedForeground} strokeWidth={2} />}
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/work/[projectId]/activity",
                      params: { projectId: String(project.id) },
                    })
                  }
                />
                <ListRow
                  title="Deliverables"
                  subtitle={
                    deliverablesFailed
                      ? "Couldn't be loaded"
                      : deliverables.length === 0
                        ? "None shared yet"
                        : lockedCount > 0
                          ? `${deliverables.length} shared · ${lockedCount} locked`
                          : `${deliverables.length} shared`
                  }
                  leading={<Package size={18} color={colors.mutedForeground} strokeWidth={2} />}
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/work/[projectId]/deliverables",
                      params: { projectId: String(project.id) },
                    })
                  }
                />
              </Card>
            </View>
          );
        }}
      </DataState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing[10],
  },
  body: {
    gap: spacing[4],
  },
  title: {
    ...typography.h2,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing[2],
  },
  copy: {
    ...typography.small,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  meta: {
    ...typography.caption,
  },
  stageTitle: {
    ...typography.h3,
  },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  amount: {
    ...typography.h2,
  },
  webLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: 32,
  },
  webLinkLabel: {
    ...typography.smallBold,
  },
  pressed: {
    opacity: 0.7,
  },
});
