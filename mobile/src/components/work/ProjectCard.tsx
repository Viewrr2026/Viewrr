import { ExternalLink } from "lucide-react-native";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { WorkProjectDetail } from "@/api/work";
import { Avatar } from "@/components/Avatar";
import { StatusBadge } from "@/components/StatusBadge";
import { isLegacyProject, isRetainer, LEGACY_STAGES } from "@/components/work/gating";
import { WEB_WORK_URL } from "@/components/work/webLinks";
import { formatPence } from "@/lib/format";
import { relativeTime } from "@/lib/time";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * One project in the Work list.
 *
 * Everything on this card is a column the server sent. There is no progress
 * ring on a dynamic-stage project, because the list endpoint returns no stages
 * and a percentage assembled from nothing is exactly the invented metric the
 * truthful-data rule forbids. Legacy projects DO get a stage line, because
 * `currentStage` is a real number for them and names the historical stage.
 *
 * Retainers (Decision 12) are shown, never actioned: status, cycle facts the
 * row genuinely carries, and a "Manage on web" link. No cycle controls appear
 * anywhere in mobile V1.
 */

type ProjectCardProps = {
  item: WorkProjectDetail;
  /** The signed-in user's role, which decides which party is "the other one". */
  viewerId: number;
  onPress: () => void;
};

export function ProjectCard({ item, viewerId, onPress }: ProjectCardProps) {
  const { colors, shadows } = useTheme();
  const { project, client, freelancer } = item;

  const viewerIsFreelancer = project.freelancerId === viewerId;
  const counterparty = viewerIsFreelancer ? client : freelancer;
  const counterpartyName =
    counterparty?.name ??
    (viewerIsFreelancer ? project.clientName : project.freelancerName) ??
    "Viewrr user";
  const counterpartyRole = viewerIsFreelancer ? "Client" : "Creative";

  const legacy = isLegacyProject(project);
  const retainer = isRetainer(project);

  const amount = formatPence(project.agreedAmountPence);
  const created = relativeTime(project.createdAt);

  const legacyStage = legacy
    ? LEGACY_STAGES[Math.max(0, Math.min(LEGACY_STAGES.length - 1, project.currentStage))]
    : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${project.title}, ${counterpartyRole} ${counterpartyName}`}
      accessibilityHint="Opens the project"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        shadows.sm,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.head}>
        <Avatar name={counterpartyName} uri={counterparty?.avatar ?? null} size="md" />
        <View style={styles.headCopy}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
            {project.title}
          </Text>
          <Text style={[styles.party, { color: colors.mutedForeground }]} numberOfLines={1}>
            {counterpartyRole} · {counterpartyName}
          </Text>
        </View>
      </View>

      <View style={styles.badges}>
        <StatusBadge status={project.status} />
        {project.paymentStatus ? <StatusBadge status={project.paymentStatus} /> : null}
        {retainer ? <StatusBadge status="retainer" /> : null}
        {legacy ? <StatusBadge status="legacy" /> : null}
      </View>

      <View style={styles.meta}>
        {project.briefCategory ? (
          <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {project.briefCategory}
          </Text>
        ) : null}
        {amount ? (
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{amount}</Text>
        ) : null}
        {created ? (
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            Started {created}
          </Text>
        ) : null}
      </View>

      {legacyStage ? (
        <Text style={[styles.stageLine, { color: colors.mutedForeground }]} numberOfLines={1}>
          Stage {project.currentStage + 1} of {LEGACY_STAGES.length} · {legacyStage}
        </Text>
      ) : null}

      {retainer ? (
        <View style={[styles.retainer, { borderColor: colors.border }]}>
          <Text style={[styles.retainerCopy, { color: colors.mutedForeground }]}>
            Retainer cycles, sign-off and billing are handled on the web for now.
          </Text>
          <Pressable
            onPress={() => void Linking.openURL(WEB_WORK_URL)}
            accessibilityRole="link"
            accessibilityLabel="Manage this retainer on the web"
            style={({ pressed }) => [styles.webLink, pressed && styles.pressed]}
          >
            <ExternalLink size={14} color={colors.primary} strokeWidth={2.2} />
            <Text style={[styles.webLinkLabel, { color: colors.primary }]}>Manage on web</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing[4],
    gap: spacing[3],
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  headCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.h3,
  },
  party: {
    ...typography.small,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  metaText: {
    ...typography.caption,
  },
  stageLine: {
    ...typography.caption,
  },
  retainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  retainerCopy: {
    ...typography.caption,
  },
  webLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: 28,
  },
  webLinkLabel: {
    ...typography.smallBold,
  },
  pressed: {
    opacity: 0.75,
  },
});
