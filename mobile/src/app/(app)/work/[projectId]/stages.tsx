import { Button } from "@/components/Button";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  approveStage,
  startStage,
  submitStage,
  advanceProject,
  completeStage,
  loadStagesSnapshot,
  requestStageChanges,
  type ProjectStage,
  type StagesSnapshot,
} from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import {
  gateStage,
  isLegacyProject,
  legacyStageRows,
  partyFor,
  type StageActionKind,
} from "@/components/work/gating";
import { ProgressBar } from "@/components/work/ProgressBar";
import { StageActions } from "@/components/work/StageActions";
import { StageRow } from "@/components/work/StageRow";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useSession } from "@/session/SessionProvider";
import { spacing, typography, useTheme } from "@/theme";

/** Project stage actions share the authenticated web workflow. */

type Pending = { stageId: number; kind: StageActionKind } | null;

export default function ProjectStages() {
  const { colors } = useTheme();
  const { user } = useSession();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  const id = Number(projectId);
  const valid = Number.isInteger(id) && id > 0;

  const loader = useCallback((signal: AbortSignal) => loadStagesSnapshot(id, signal), [id]);
  const { resource, refreshing, refresh, reload } = useAsyncResource<StagesSnapshot>(loader, {
    enabled: valid,
    deps: [id],
  });

  const [pending, setPending] = useState<Pending>(null);
  const [failure, setFailure] = useState<{ stageId: number; message: string } | null>(null);

  const run = useCallback(
    async (stageId: number, kind: StageActionKind, action: () => Promise<unknown>) => {
      setPending({ stageId, kind });
      setFailure(null);
      try {
        await action();
        // Re-read rather than patch locally: an approval can also move the
        // project's active stage and progress, and only the server knows the
        // resulting shape.
        await reload();
      } catch (error) {
        setFailure({
          stageId,
          message:
            error instanceof Error && error.message
              ? error.message
              : "That didn't go through. Check your connection and try again.",
        });
      } finally {
        setPending(null);
      }
    },
    [reload],
  );

  if (!valid) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <AppHeader title="Stages" back />
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
      <AppHeader title="Stages" back />

      <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={4}>
        {({ detail, stages, progress }) => {
          const project = detail.project;
          const party = user ? partyFor(project, user.id) : "observer";
          const legacy = isLegacyProject(project);

          if (legacy) {
            const rows = legacyStageRows(project);

            return (
              <View style={styles.body}>
                <Card>
                  <CardLabel>Original timeline</CardLabel>
                  <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                    This project started before Viewrr moved to agreed stage plans, so it still
                    runs on the original six-stage timeline. Your freelancer can progress it here.
                  </Text>
                  {party === "freelancer" && !project.isRetainer && project.status === "active" && project.currentStage < 5 && <Button label="Move to next stage" loading={pending !== null} disabled={pending !== null} onPress={() => void run(0, "start", () => advanceProject(project.id))} />}
                  {failure?.stageId === 0 && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{failure.message}</Text>}
                  <ProgressBar
                    percent={null}
                    caption={`Stage ${project.currentStage + 1} of ${rows.length}`}
                  />
                </Card>

                <View style={styles.timeline}>
                  {rows.map((row) => {
                    const done = row.status === "completed";
                    const current = row.status === "in_progress";

                    return (
                      <View key={row.title} style={styles.legacyRow}>
                        <View
                          style={[
                            styles.legacyDot,
                            {
                              backgroundColor: done ? colors.primary : colors.card,
                              borderColor: done || current ? colors.primary : colors.border,
                            },
                          ]}
                        />
                        <View style={styles.legacyCopy}>
                          <Text
                            style={[
                              styles.legacyTitle,
                              { color: current ? colors.foreground : colors.mutedForeground },
                            ]}
                          >
                            {row.index + 1}. {row.title}
                          </Text>
                          <StatusBadge status={row.status} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          }

          if (stages.length === 0) {
            return (
              <EmptyState
                title="No stages yet"
                body="This project doesn't have an agreed stage plan. Plans are created and confirmed on the Viewrr website."
                inline
              />
            );
          }

          const activeId = activeStageId(stages);

          return (
            <View style={styles.body}>
              <Card>
                <CardLabel>Plan progress</CardLabel>
                <ProgressBar
                  percent={progress}
                  caption={`${stages.length} ${stages.length === 1 ? "stage" : "stages"} agreed`}
                />
                <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                  {party === "client"
                    ? "Approve a stage once you're happy with it, or ask for changes where the plan allows."
                    : party === "freelancer"
                      ? "Mark a stage complete when the work is done. Stages that need approval go to your client first."
                      : "You're viewing this project as an observer."}
                </Text>
              </Card>

              <View style={styles.timeline}>
                {stages.map((stage, index) => {
                  const gating = gateStage(project, stage, party);
                  if (stages.slice(0, index).some(s => !["approved", "completed"].includes(s.status))) gating.actions = [];

                  return (
                    <StageRow
                      key={stage.id}
                      stage={stage}
                      index={index + 1}
                      total={stages.length}
                      active={stage.id === activeId}
                      last={index === stages.length - 1}
                    >
                      <StageActions
                        actions={gating.actions}
                        disabled={pending !== null}
                        onStart={() => void run(stage.id, "start", () => startStage(project.id, stage.id))}
                        onSubmit={() => void run(stage.id, "submit", () => submitStage(project.id, stage.id))}
                        note={gating.note}
                        pending={pending?.stageId === stage.id ? pending.kind : null}
                        error={failure?.stageId === stage.id ? failure.message : null}
                        onApprove={() =>
                          void run(stage.id, "approve", () => approveStage(project.id, stage.id))
                        }
                        onComplete={() =>
                          void run(stage.id, "complete", () =>
                            completeStage(project.id, stage.id),
                          )
                        }
                        onRequestChanges={(message) =>
                          void run(stage.id, "request-changes", () =>
                            requestStageChanges(project.id, stage.id, message),
                          )
                        }
                      />
                    </StageRow>
                  );
                })}
              </View>
            </View>
          );
        }}
      </DataState>
    </Screen>
  );
}

/**
 * The stage work is sitting on: the first that isn't finished. Ordering comes
 * from the server's `stageOrder`, which `loadStagesSnapshot` preserves.
 */
function activeStageId(stages: ProjectStage[]): number | null {
  for (const stage of stages) {
    if (!["completed", "approved"].includes(stage.status)) return stage.id;
  }
  return null;
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing[10],
  },
  body: {
    gap: spacing[4],
  },
  timeline: {
    gap: spacing[3],
  },
  copy: {
    ...typography.small,
  },
  legacyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  legacyDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  legacyCopy: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  legacyTitle: {
    ...typography.small,
    flexShrink: 1,
  },
});
