import { useRouter } from "expo-router";
import { Briefcase, FileText, Sparkles } from "lucide-react-native";
import { useCallback, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { loadHome, type HomeData } from "@/api/home";
import type { BriefInterest, ConversationSummary, ProjectWithDetails } from "@/api/types";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Card, CardBody, CardLabel, CardTitle } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ListRow } from "@/components/ListRow";
import { Metric } from "@/components/Metric";
import { Screen } from "@/components/Screen";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatBudget, formatPence, profileProgress } from "@/lib/format";
import { greetingFor, relativeTime } from "@/lib/time";
import { useNotifications } from "@/notifications/NotificationsProvider";
import { useSession } from "@/session/SessionProvider";
import { radii, spacing, useTheme } from "@/theme";

/**
 * Home V1.
 *
 * Every number and row on this screen is read from the API. Where a value
 * cannot be read it renders as "—" and where a collection is empty the section
 * is replaced by an empty state — nothing is padded out with sample content,
 * because a dashboard that lies once is never trusted again.
 *
 * One loader serves the whole screen (api/home), so the cards here share a
 * single round-trip rather than each fetching for themselves.
 */

/** Sections show a few rows and hand off to the tab for the rest. */
const PREVIEW = 3;

export default function Home() {
  const { user } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const { refresh: refreshBadge } = useNotifications();

  const userId = user?.id ?? null;
  const role = user?.role ?? "client";

  const load = useCallback(
    (signal: AbortSignal) => {
      if (userId === null) return Promise.reject(new Error("No session"));
      return loadHome(userId, role, signal);
    },
    [role, userId],
  );

  const { resource, refreshing, refresh, reload } = useAsyncResource<HomeData>(load, {
    enabled: userId !== null,
  });

  const onRefresh = useCallback(() => {
    refresh();
    refreshBadge();
  }, [refresh, refreshBadge]);

  const firstName = (user?.displayName ?? "").trim().split(/\s+/)[0] || "there";

  return (
    <Screen
      scroll
      edges={["top", "left", "right"]}
      refreshing={refreshing}
      onRefresh={resource.phase === "ready" ? onRefresh : undefined}
    >
      <AppHeader title={firstName} eyebrow={greetingFor()} brand />

      <DataState resource={resource} onRetry={reload} skeleton="dashboard">
        {(data) =>
          data.role === "freelancer" ? (
            <CreativeHome data={data} colors={colors} router={router} />
          ) : (
            <ClientHome data={data} colors={colors} router={router} />
          )
        }
      </DataState>
    </Screen>
  );
}

/* ── shared pieces ───────────────────────────────────────────────────────── */

type Router = ReturnType<typeof useRouter>;
type Colors = ReturnType<typeof useTheme>["colors"];

function activeProjects(projects: ProjectWithDetails[]): ProjectWithDetails[] {
  return projects.filter((entry) => entry.project.status === "active");
}

function unreadMessages(conversations: ConversationSummary[]): number {
  return conversations.reduce((total, conversation) => total + (conversation.unread || 0), 0);
}

function ProjectRow({
  entry,
  viewerRole,
  onPress,
}: {
  entry: ProjectWithDetails;
  viewerRole: "client" | "freelancer";
  onPress: () => void;
}) {
  const { project, client, freelancer } = entry;
  // Show the other side of the job, never the user's own name.
  const counterpart = viewerRole === "client" ? freelancer : client;
  const amount = formatPence(project.agreedAmountPence);

  return (
    <ListRow
      title={project.title}
      subtitle={counterpart?.name ? `with ${counterpart.name}` : undefined}
      meta={amount ? `${amount} · stage ${project.currentStage}` : `Stage ${project.currentStage}`}
      leading={<Avatar name={counterpart?.name ?? "Viewrr"} uri={counterpart?.avatar} size="md" />}
      trailing={<StatusBadge status={project.status} />}
      chevron={false}
      onPress={onPress}
    />
  );
}

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: ConversationSummary;
  onPress: () => void;
}) {
  return (
    <ListRow
      title={conversation.otherName}
      subtitle={conversation.lastMessage}
      meta={relativeTime(conversation.lastAt)}
      leading={
        <Avatar name={conversation.otherName} uri={conversation.otherAvatar} size="md" />
      }
      highlighted={conversation.unread > 0}
      onPress={onPress}
    />
  );
}

function InterestRow({
  interest,
  counterparty,
  onPress,
}: {
  interest: BriefInterest;
  /** Whose name to show: the applicant (client view) or the brief owner (creative view). */
  counterparty: "freelancer" | "client";
  onPress: () => void;
}) {
  const price = formatPence(interest.counterOfferPence ?? interest.proposedPricePence);
  const name = counterparty === "freelancer" ? interest.freelancerName : interest.briefClientName;
  const avatar = counterparty === "freelancer" ? interest.freelancerAvatar : null;

  return (
    <ListRow
      title={interest.briefTitle}
      subtitle={name}
      meta={price ? `${price} · ${relativeTime(interest.createdAt)}` : relativeTime(interest.createdAt)}
      leading={<Avatar name={name} uri={avatar} size="md" />}
      trailing={<StatusBadge status={interest.status} />}
      chevron={false}
      onPress={onPress}
    />
  );
}

function Section({
  title,
  count,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader
        title={title}
        {...(typeof count === "number" ? { count } : {})}
        {...(actionLabel && onAction ? { actionLabel, onAction } : {})}
      />
      <View>{children}</View>
    </View>
  );
}

/* ── creative ────────────────────────────────────────────────────────────── */

function CreativeHome({
  data,
  colors,
  router,
}: {
  data: Extract<HomeData, { role: "freelancer" }>;
  colors: Colors;
  router: Router;
}) {
  const active = useMemo(() => activeProjects(data.projects), [data.projects]);
  const unread = unreadMessages(data.conversations);
  const liveInterests = useMemo(
    () => data.interests.filter((interest) => interest.status !== "declined"),
    [data.interests],
  );
  const openBriefs = useMemo(
    () => data.briefs.filter((brief) => brief.status === "open" || brief.isActive).slice(0, PREVIEW),
    [data.briefs],
  );

  const progress = profileProgress(data.profile, data.user);
  const nothingOn = active.length === 0 && liveInterests.length === 0 && unread === 0;

  return (
    <View style={styles.body}>
      <View style={styles.metrics}>
        <Metric
          label="Active projects"
          value={active.length}
          onPress={() => router.push("/(app)/work")}
        />
        <Metric
          label="Unread messages"
          value={unread}
          emphasis
          onPress={() => router.push("/(app)/messages")}
        />
        <Metric
          label="Live applications"
          value={liveInterests.length}
          onPress={() => router.push("/(app)/briefs")}
        />
      </View>

      {progress.nextStep ? (
        <Card style={styles.card}>
          <CardLabel>Your profile</CardLabel>
          <CardTitle>{progress.percent}% complete</CardTitle>
          <View style={[styles.track, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.fill,
                { width: `${Math.max(progress.percent, 4)}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          <CardBody>
            {progress.complete} of {progress.total} done. Next: {progress.nextStep.toLowerCase()}.
          </CardBody>
        </Card>
      ) : null}

      {active.length > 0 ? (
        <Section
          title="Active work"
          count={active.length}
          actionLabel="All work"
          onAction={() => router.push("/(app)/work")}
        >
          {active.slice(0, PREVIEW).map((entry) => (
            <ProjectRow
              key={entry.project.id}
              entry={entry}
              viewerRole="freelancer"
              onPress={() =>
                router.push({
                  pathname: "/(app)/work/[projectId]",
                  params: { projectId: String(entry.project.id) },
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {liveInterests.length > 0 ? (
        <Section
          title="Your applications"
          count={liveInterests.length}
          actionLabel="Briefs"
          onAction={() => router.push("/(app)/briefs")}
        >
          {liveInterests.slice(0, PREVIEW).map((interest) => (
            <InterestRow
              key={interest.id}
              interest={interest}
              counterparty="client"
              onPress={() =>
                router.push({
                  pathname: "/(app)/briefs/[briefId]",
                  params: { briefId: String(interest.briefId) },
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {openBriefs.length > 0 ? (
        <Section title="Open briefs" actionLabel="See all" onAction={() => router.push("/(app)/briefs")}>
          {openBriefs.map((brief) => {
            const budget = formatBudget(brief.budgetMin, brief.budgetMax, brief.budgetType);
            return (
              <ListRow
                key={brief.id}
                title={brief.title}
                subtitle={[brief.category, brief.remote ? "Remote" : brief.location]
                  .filter(Boolean)
                  .join(" · ")}
                meta={budget ?? relativeTime(brief.createdAt)}
                leading={<Avatar name={brief.clientName} uri={brief.clientAvatar} size="md" />}
                onPress={() =>
                  router.push({
                    pathname: "/(app)/briefs/[briefId]",
                    params: { briefId: String(brief.id) },
                  })
                }
              />
            );
          })}
        </Section>
      ) : null}

      {data.conversations.length > 0 ? (
        <Section title="Recent messages" actionLabel="Inbox" onAction={() => router.push("/(app)/messages")}>
          {data.conversations.slice(0, PREVIEW).map((conversation) => (
            <ConversationRow
              key={conversation.otherId}
              conversation={conversation}
              onPress={() => router.push("/(app)/messages")}
            />
          ))}
        </Section>
      ) : null}

      {nothingOn && openBriefs.length === 0 ? (
        <EmptyState
          inline
          icon={Sparkles}
          title="Nothing on right now"
          body="When a brief matches your specialisms or a client gets in touch, it will show up here."
          actionLabel="Browse briefs"
          onAction={() => router.push("/(app)/briefs")}
        />
      ) : null}
    </View>
  );
}

/* ── client ──────────────────────────────────────────────────────────────── */

function ClientHome({
  data,
  colors,
  router,
}: {
  data: Extract<HomeData, { role: "client" }>;
  colors: Colors;
  router: Router;
}) {
  const active = useMemo(() => activeProjects(data.projects), [data.projects]);
  const unread = unreadMessages(data.conversations);
  const newApplicants = useMemo(
    () => data.interests.filter((interest) => interest.status === "pending"),
    [data.interests],
  );
  const openBriefs = useMemo(
    () => data.myBriefs.filter((brief) => brief.status === "open" || brief.isActive),
    [data.myBriefs],
  );

  const nothingOn =
    active.length === 0 && openBriefs.length === 0 && data.interests.length === 0 && unread === 0;

  return (
    <View style={styles.body}>
      <View style={styles.metrics}>
        <Metric
          label="Active projects"
          value={active.length}
          onPress={() => router.push("/(app)/work")}
        />
        <Metric
          label="Unread messages"
          value={unread}
          emphasis
          onPress={() => router.push("/(app)/messages")}
        />
        <Metric label="New applicants" value={newApplicants.length} emphasis />
      </View>

      {newApplicants.length > 0 ? (
        <Section title="Waiting on you" count={newApplicants.length}>
          {newApplicants.slice(0, PREVIEW).map((interest) => (
            <InterestRow
              key={interest.id}
              interest={interest}
              counterparty="freelancer"
              onPress={() =>
                router.push({
                  pathname: "/(app)/briefs/[briefId]",
                  params: { briefId: String(interest.briefId) },
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {active.length > 0 ? (
        <Section
          title="Active projects"
          count={active.length}
          actionLabel="All work"
          onAction={() => router.push("/(app)/work")}
        >
          {active.slice(0, PREVIEW).map((entry) => (
            <ProjectRow
              key={entry.project.id}
              entry={entry}
              viewerRole="client"
              onPress={() =>
                router.push({
                  pathname: "/(app)/work/[projectId]",
                  params: { projectId: String(entry.project.id) },
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {openBriefs.length > 0 ? (
        <Section title="Your open briefs" count={openBriefs.length}>
          {openBriefs.slice(0, PREVIEW).map((brief) => (
            <ListRow
              key={brief.id}
              title={brief.title}
              subtitle={[brief.category, brief.remote ? "Remote" : brief.location]
                .filter(Boolean)
                .join(" · ")}
              meta={`${brief.applicationCount} ${
                brief.applicationCount === 1 ? "applicant" : "applicants"
              } · ${relativeTime(brief.createdAt)}`}
              leading={
                <View style={[styles.briefGlyph, { backgroundColor: colors.secondary }]}>
                  <FileText size={18} color={colors.mutedForeground} strokeWidth={2} />
                </View>
              }
              trailing={<StatusBadge status={brief.status} />}
              chevron={false}
              onPress={() =>
                router.push({
                  pathname: "/(app)/briefs/[briefId]",
                  params: { briefId: String(brief.id) },
                })
              }
            />
          ))}
        </Section>
      ) : null}

      {data.conversations.length > 0 ? (
        <Section title="Recent messages" actionLabel="Inbox" onAction={() => router.push("/(app)/messages")}>
          {data.conversations.slice(0, PREVIEW).map((conversation) => (
            <ConversationRow
              key={conversation.otherId}
              conversation={conversation}
              onPress={() => router.push("/(app)/messages")}
            />
          ))}
        </Section>
      ) : null}

      {nothingOn ? (
        <EmptyState
          inline
          icon={Briefcase}
          title="Nothing on right now"
          body="Post a brief or find a creative, and your projects, applicants and messages will gather here."
          actionLabel="Find creatives"
          onAction={() => router.push("/(app)/discover")}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[5],
    paddingBottom: spacing[4],
  },
  metrics: {
    flexDirection: "row",
    gap: spacing[3],
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
  section: {
    gap: spacing[1],
  },
  briefGlyph: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
