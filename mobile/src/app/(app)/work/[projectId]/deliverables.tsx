import { useLocalSearchParams } from "expo-router";
import { ExternalLink } from "lucide-react-native";
import { useCallback } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { loadProjectDetail, type ProjectDetailSnapshot } from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Screen } from "@/components/Screen";
import { DeliverableRow } from "@/components/work/DeliverableRow";
import { partyFor } from "@/components/work/gating";
import { webProjectUrl } from "@/components/work/webLinks";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useSession } from "@/session/SessionProvider";
import { spacing, typography, useTheme } from "@/theme";

/**
 * Deliverables (Decision 10).
 *
 * The lock is enforced by the server: `GET /api/projects/:id/deliverables`
 * returns `locked: boolean` and OMITS `url` and `embedUrl` entirely on locked
 * items. This screen therefore has nothing to hide and nothing to leak — it
 * renders a locked item as locked, with copy explaining what clears it, and no
 * code path anywhere attempts to reconstruct a withheld link.
 *
 * The web build's CSS watermark is not reimplemented. A watermark drawn over an
 * asset the client already downloaded protects nothing; withholding the URL
 * does. Mobile relies on the server-side gate alone.
 *
 * Unlocking happens by paying on the website. Mobile never mutates payment.
 */

export default function ProjectDeliverables() {
  const { colors } = useTheme();
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
        <AppHeader title="Deliverables" back />
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
      <AppHeader title="Deliverables" back />

      <DataState resource={resource} onRetry={reload} skeleton="list" skeletonRows={3}>
        {({ detail, deliverables, deliverablesFailed }) => {
          const project = detail.project;
          const party = user ? partyFor(project, user.id) : "observer";
          const locked = deliverables.filter((item) => item.locked);

          if (deliverablesFailed) {
            return (
              <ErrorState
                title="Couldn't load deliverables"
                message="The deliverables for this project didn't load. Pull down to try again."
                onRetry={reload}
                inline
              />
            );
          }

          if (deliverables.length === 0) {
            return (
              <EmptyState
                title="Nothing shared yet"
                body={
                  party === "freelancer"
                    ? "Deliverables you share on this project will be listed here."
                    : "When your creative shares work on this project, it'll appear here."
                }
                inline
              />
            );
          }

          const lockCopy =
            party === "client"
              ? "Locked until the project is paid. Payment is completed on the Viewrr website."
              : "Locked for your client until the project is paid.";

          return (
            <View style={styles.body}>
              {locked.length > 0 ? (
                <Card tone="brand">
                  <CardLabel>
                    {locked.length} of {deliverables.length} locked
                  </CardLabel>
                  <Text style={[styles.copy, { color: colors.foreground }]}>
                    {party === "client"
                      ? "Locked files stay hidden until payment clears. Once it does, they unlock here automatically."
                      : "Locked files stay hidden from your client until the project is paid."}
                  </Text>
                  {party === "client" ? (
                    <Pressable
                      onPress={() => void Linking.openURL(webProjectUrl(project.id))}
                      accessibilityRole="link"
                      accessibilityLabel="Pay for this project on the web"
                      style={({ pressed }) => [styles.webLink, pressed && styles.pressed]}
                    >
                      <ExternalLink size={14} color={colors.primary} strokeWidth={2.2} />
                      <Text style={[styles.webLinkLabel, { color: colors.primary }]}>
                        Pay on the web
                      </Text>
                    </Pressable>
                  ) : null}
                </Card>
              ) : null}

              <View style={styles.list}>
                {deliverables.map((item) => (
                  <DeliverableRow key={item.id} deliverable={item} lockCopy={lockCopy} />
                ))}
              </View>
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
  list: {
    gap: spacing[3],
  },
  copy: {
    ...typography.small,
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
