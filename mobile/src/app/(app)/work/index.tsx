import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  getInvitations,
  getRetainerInvitations,
} from "@/api/projectInvitations";
import { loadProjects } from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { ProjectCard } from "@/components/work/ProjectCard";
import { ProjectInvitations } from "@/components/work/ProjectInvitations";
import { WorkSectionTabs } from "@/components/work/WorkSectionTabs";
import { workLists, type WorkSection } from "@/components/work/gating";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useRefreshOnReturn } from "@/hooks/useRefreshOnReturn";
import { useSession } from "@/session/SessionProvider";
import { spacing } from "@/theme";

export default function WorkIndex() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invitations?: string }>();
  const { user } = useSession();
  const [section, setSection] = useState<WorkSection>("all");
  const [tab, setTab] = useState<"Received" | "Sent">("Received");
  const options = { enabled: Boolean(user), deps: [user?.id] };
  const projects = useAsyncResource(loadProjects, options);
  const invitations = useAsyncResource(getInvitations, options);
  const retainers = useAsyncResource(getRetainerInvitations, options);
  const refresh = useCallback(() => {
    projects.refresh();
    invitations.refresh();
    retainers.refresh();
  }, [projects.refresh, invitations.refresh, retainers.refresh]);
  useRefreshOnReturn(refresh);
  useEffect(() => {
    if (params.invitations === "sent") {
      setTab("Sent");
      refresh();
      router.setParams({ invitations: undefined });
    }
  }, [params.invitations, refresh, router]);
  const grouped = useMemo(
    () =>
      workLists(
        projects.resource.phase === "ready" ? projects.resource.data : [],
      ),
    [projects.resource],
  );
  return (
    <Screen
      scroll
      edges={["top", "left", "right"]}
      refreshing={
        projects.refreshing || invitations.refreshing || retainers.refreshing
      }
      onRefresh={refresh}
    >
      <AppHeader
        title="Work"
        brand
        action={
          <Button
            label="Briefs"
            size="compact"
            variant="ghost"
            block={false}
            onPress={() => router.push("/(app)/briefs")}
          />
        }
      />
      <View style={{ gap: spacing[5], paddingBottom: spacing[10] }}>
        <Button
          label="Create Project"
          onPress={() => router.push("/(app)/work/new")}
        />
        <ProjectInvitations
          userId={user?.id ?? 0}
          tab={tab}
          onTab={setTab}
          invitations={invitations}
          retainers={retainers}
          onRespond={refresh}
        />
        <DataState
          resource={projects.resource}
          onRetry={projects.reload}
          skeleton="list"
        >
          {() => (
            <>
              <WorkSectionTabs
                value={section}
                onChange={setSection}
                role={user?.role ?? "client"}
                counts={{
                  all: grouped.all.length,
                  active: grouped.active.length,
                  completed: grouped.completed.length,
                  awaiting_payment: grouped.awaiting_payment.length,
                }}
              />
              {grouped[section].length ? (
                grouped[section].map((item) => (
                  <ProjectCard
                    key={item.project.id}
                    item={item}
                    viewerId={user?.id ?? 0}
                    onPress={() =>
                      router.push({
                        pathname: "/(app)/work/[projectId]",
                        params: { projectId: String(item.project.id) },
                      })
                    }
                  />
                ))
              ) : (
                <EmptyState
                  title={
                    section === "all"
                      ? "No projects yet"
                      : section === "completed"
                        ? "No completed projects"
                        : section === "awaiting_payment"
                          ? "Nothing awaiting payment"
                          : "No active projects"
                  }
                  body={
                    section === "all"
                      ? "Create a project and invite a connection to get started."
                      : "Projects matching this filter will appear here."
                  }
                  inline
                />
              )}
            </>
          )}
        </DataState>
      </View>
    </Screen>
  );
}
