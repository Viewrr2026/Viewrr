import { useRouter } from "expo-router";
import { Briefcase, FileText } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { loadProjects, type WorkProjectDetail } from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { ProjectCard } from "@/components/work/ProjectCard";
import { sectionFor, type WorkSection } from "@/components/work/gating";
import { WorkSectionTabs, type SectionCounts } from "@/components/work/WorkSectionTabs";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useSession } from "@/session/SessionProvider";
import { gutter, spacing, typography, useTheme } from "@/theme";

/**
 * Work — the project list.
 *
 * One request: `GET /api/projects`, with NO `userId` parameter. The party is
 * derived from the session server-side (contract § D), which is what stops one
 * user asking for another's workspace.
 *
 * Sectioning is role-aware in language, not in structure. Both sides see the
 * same three sections in the same order — active, awaiting payment, completed —
 * because a creative chasing payment and a client owing it are looking at the
 * same fact from two ends. Only the labels and the explanatory copy differ.
 *
 * Nothing here is computed into a metric: there is no earnings total, no
 * completion percentage and no "3 waiting on you" count, because the list
 * endpoint returns no stages and inventing those numbers is precisely what the
 * truthful-data rule forbids. The counts on the tabs are the lengths of the
 * real grouped arrays.
 */

export default function WorkIndex() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useSession();

  const [section, setSection] = useState<WorkSection>("active");

  const loader = useCallback((signal: AbortSignal) => loadProjects(signal), []);
  const { resource, refreshing, refresh, reload } = useAsyncResource<WorkProjectDetail[]>(
    loader,
    { enabled: Boolean(user) },
  );

  const role = user?.role ?? "client";
  const viewerId = user?.id ?? 0;

  const grouped = useMemo(() => {
    const rows = resource.phase === "ready" ? resource.data : [];
    const buckets: Record<WorkSection, WorkProjectDetail[]> = {
      active: [],
      awaiting_payment: [],
      completed: [],
    };

    for (const row of rows) {
      // Soft-deleted projects are history the server should not be sending;
      // if one arrives, it is not shown as live work.
      if (row.project.deletedAt) continue;
      buckets[sectionFor(row.project)].push(row);
    }

    return buckets;
  }, [resource]);

  const counts: SectionCounts = {
    active: grouped.active.length,
    awaiting_payment: grouped.awaiting_payment.length,
    completed: grouped.completed.length,
  };

  const briefsLink = (
    <Pressable
      onPress={() => router.push("/(app)/briefs")}
      accessibilityRole="button"
      accessibilityLabel="Briefs"
      style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
    >
      <FileText size={16} color={colors.primary} strokeWidth={2.2} />
      <Text style={[styles.headerActionLabel, { color: colors.primary }]}>Briefs</Text>
    </Pressable>
  );

  return (
    <Screen edges={["top", "left", "right"]} flush>
      <View style={styles.gutter}>
        <AppHeader title="Work" brand action={briefsLink} />
      </View>

      <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={4}>
        {() => {
          const rows = grouped[section];

          return (
            <FlatList
              data={rows}
              keyExtractor={(item) => String(item.project.id)}
              renderItem={({ item }) => (
                <View style={styles.gutter}>
                  <ProjectCard
                    item={item}
                    viewerId={viewerId}
                    onPress={() =>
                      router.push({
                        pathname: "/(app)/work/[projectId]",
                        params: { projectId: String(item.project.id) },
                      })
                    }
                  />
                </View>
              )}
              ListHeaderComponent={
                <View style={[styles.gutter, styles.header]}>
                  <WorkSectionTabs
                    value={section}
                    onChange={setSection}
                    counts={counts}
                    role={role}
                  />
                  <Text style={[styles.blurb, { color: colors.mutedForeground }]}>
                    {blurbFor(section, role)}
                  </Text>
                </View>
              }
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refresh}
                  tintColor={colors.mutedForeground}
                  colors={[colors.primary]}
                />
              }
              ListEmptyComponent={
                <View style={styles.gutter}>
                  <EmptyState
                    icon={Briefcase}
                    title={emptyTitleFor(section)}
                    body={emptyBodyFor(section, role)}
                    {...(role === "freelancer"
                      ? { actionLabel: "Browse briefs", onAction: () => router.push("/(app)/briefs") }
                      : {})}
                    inline
                  />
                </View>
              }
            />
          );
        }}
      </DataState>
    </Screen>
  );
}

function blurbFor(section: WorkSection, role: "client" | "freelancer" | "admin"): string {
  switch (section) {
    case "active":
      return role === "client"
        ? "Work in progress. Open a project to review stages and approve what's ready."
        : "Work in progress. Open a project to move stages on and share deliverables.";
    case "awaiting_payment":
      return role === "client"
        ? "Finished work that hasn't been paid. Payment is completed on the Viewrr website."
        : "Finished work that hasn't been paid yet. Your client settles this on the website.";
    case "completed":
      return "Delivered and closed work, including anything cancelled.";
  }
}

function emptyTitleFor(section: WorkSection): string {
  switch (section) {
    case "active":
      return "No active work";
    case "awaiting_payment":
      return "Nothing awaiting payment";
    case "completed":
      return "No completed work yet";
  }
}

function emptyBodyFor(section: WorkSection, role: "client" | "freelancer" | "admin"): string {
  if (section === "awaiting_payment") {
    return role === "client"
      ? "When a project is finished and still unpaid, it appears here."
      : "Finished work waiting to be paid will show up here.";
  }
  if (section === "completed") {
    return "Projects move here once they're marked complete or cancelled.";
  }
  return role === "freelancer"
    ? "Projects appear here when a client accepts your interest on a brief."
    : "Projects appear here once you've accepted a creative for a brief.";
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: gutter,
  },
  header: {
    gap: spacing[2],
    paddingBottom: spacing[4],
  },
  blurb: {
    ...typography.caption,
  },
  list: {
    paddingBottom: spacing[8],
  },
  separator: {
    height: spacing[3],
  },
  headerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    minHeight: 36,
    paddingHorizontal: spacing[2],
  },
  headerActionLabel: {
    ...typography.smallBold,
  },
  pressed: {
    opacity: 0.7,
  },
});
