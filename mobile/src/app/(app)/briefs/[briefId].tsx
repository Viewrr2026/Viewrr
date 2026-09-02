import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { loadBriefDetail, type BriefDetailSnapshot, type BriefInterest } from "@/api/work";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Card, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { InterestThread } from "@/components/work/InterestThread";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatBudget, formatPence } from "@/lib/format";
import { relativeTime } from "@/lib/time";
import { useSession } from "@/session/SessionProvider";
import { spacing, typography, useTheme } from "@/theme";

/**
 * Brief detail, with the interest thread (Decision 17).
 *
 * Who sees which interests is decided by what the API will actually give the
 * viewer, not by what would look good: the brief's owner sees every applicant
 * (`/api/interests/client/:id` filtered to this brief), a creative sees their
 * own application only (`/api/interests/freelancer/:id`), and anyone else sees
 * none. There is no per-brief applicant endpoint, so nothing broader is
 * improvised.
 *
 * Negotiation messages are read here, in Brief context, never in the Messages
 * inbox. They are read-only in V1 — see `InterestThread`.
 *
 * Expressing interest, accepting and counter-offering are not in this release;
 * the screen points at the web rather than shipping a button that half-works.
 */

export default function BriefDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { briefId } = useLocalSearchParams<{ briefId: string }>();

  const id = Number(briefId);
  const valid = Number.isInteger(id) && id > 0;

  const viewerId = user?.id ?? 0;
  const viewerRole = user?.role ?? "client";

  const [openInterestId, setOpenInterestId] = useState<number | null>(null);

  const loader = useCallback(
    (signal: AbortSignal) =>
      loadBriefDetail(id, { id: viewerId, role: viewerRole }, signal),
    [id, viewerId, viewerRole],
  );

  const { resource, refreshing, refresh, reload } = useAsyncResource<BriefDetailSnapshot>(
    loader,
    { enabled: valid && Boolean(user), deps: [id, viewerId, viewerRole] },
  );

  if (!valid) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <AppHeader title="Brief" back />
        <ErrorState
          title="Brief not found"
          message="That brief reference isn't valid. Open the brief from your Briefs list or a notification."
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
      <AppHeader title="Brief" back />

      <DataState resource={resource} onRetry={reload} skeleton="dashboard">
        {({ brief, interests, interestsFailed }) => {
          const owner = brief.clientId === viewerId;
          const budget = formatBudget(brief.budgetMin, brief.budgetMax, brief.budgetType);
          const posted = relativeTime(brief.createdAt);

          return (
            <View style={styles.body}>
              {/* ── The brief ────────────────────────────────────────── */}
              <Card>
                <Text style={[styles.title, { color: colors.foreground }]}>{brief.title}</Text>

                <View style={styles.badges}>
                  <StatusBadge status={brief.status} />
                  {brief.category ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      {brief.category}
                    </Text>
                  ) : null}
                </View>

                <Text style={[styles.copy, { color: colors.mutedForeground }]}>
                  {brief.description}
                </Text>

                <View style={styles.metaRow}>
                  {budget ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{budget}</Text>
                  ) : null}
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {brief.remote === 1 ? "Remote" : brief.location || "Location not set"}
                  </Text>
                  {posted ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                      Posted {posted}
                    </Text>
                  ) : null}
                </View>
              </Card>

              {/* ── Who posted it ────────────────────────────────────── */}
              <Card>
                <CardLabel>Posted by</CardLabel>
                <ListRow
                  title={brief.clientName}
                  subtitle={owner ? "You" : "Client"}
                  leading={
                    <Avatar name={brief.clientName} uri={brief.clientAvatar} size="md" />
                  }
                />
              </Card>

              {/* ── Interests ────────────────────────────────────────── */}
              <Card>
                <CardLabel>
                  {owner
                    ? `Interest (${brief.applicationCount})`
                    : "Your interest"}
                </CardLabel>

                {interestsFailed ? (
                  <ErrorState
                    title="Couldn't load interest"
                    message="The applications on this brief didn't load. Pull down to try again."
                    onRetry={reload}
                    inline
                  />
                ) : interests.length === 0 ? (
                  <EmptyState
                    title={owner ? "No applicants yet" : "You haven't applied"}
                    body={
                      owner
                        ? "When creatives express interest, they'll be listed here with their proposals."
                        : "Expressing interest is on the Viewrr website for now. Once you've applied, your proposal and messages appear here."
                    }
                    inline
                  />
                ) : (
                  <View style={styles.interests}>
                    {interests.map((interest) => {
                      const expanded = openInterestId === interest.id;

                      return (
                        <View
                          key={interest.id}
                          style={[styles.interest, { borderColor: colors.border }]}
                        >
                          <ListRow
                            title={interest.freelancerName}
                            subtitle={proposalFor(interest)}
                            leading={
                              <Avatar
                                name={interest.freelancerName}
                                uri={interest.freelancerAvatar}
                                size="md"
                              />
                            }
                            trailing={<StatusBadge status={interest.status} />}
                            onPress={
                              owner
                                ? () =>
                                    router.push({
                                      pathname: "/(app)/discover/[profileId]",
                                      params: { profileId: String(interest.freelancerId) },
                                    })
                                : undefined
                            }
                          />

                          <Pressable
                            onPress={() =>
                              setOpenInterestId(expanded ? null : interest.id)
                            }
                            accessibilityRole="button"
                            accessibilityState={{ expanded }}
                            accessibilityLabel={
                              expanded
                                ? "Hide the messages on this interest"
                                : "Show the messages on this interest"
                            }
                            style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
                          >
                            <Text style={[styles.toggleLabel, { color: colors.primary }]}>
                              {expanded ? "Hide messages" : "Messages"}
                            </Text>
                          </Pressable>

                          {expanded ? (
                            <InterestThread
                              briefId={brief.id}
                              interestId={interest.id}
                              viewerId={viewerId}
                            />
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )}
              </Card>
            </View>
          );
        }}
      </DataState>
    </Screen>
  );
}

/** Proposal line built only from fields the interest row actually carries. */
function proposalFor(interest: BriefInterest): string {
  const parts: string[] = [];

  const proposed = formatPence(interest.proposedPricePence);
  if (proposed) parts.push(`Proposed ${proposed}`);

  const counter = formatPence(interest.counterOfferPence);
  if (counter) parts.push(`Counter ${counter}`);

  const age = relativeTime(interest.createdAt);
  if (age) parts.push(age);

  return parts.join(" · ");
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
  interests: {
    gap: spacing[3],
  },
  interest: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[2],
    gap: spacing[2],
  },
  toggle: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
  },
  toggleLabel: {
    ...typography.smallBold,
  },
  pressed: {
    opacity: 0.7,
  },
});
