import { Flag, UserCheck, UserX } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/api/errors";
import { fetchBlockedUsers, unblockUser, type BlockedUser } from "@/api/trust";
import { ActionSheet } from "@/components/ActionSheet";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ListRow } from "@/components/ListRow";
import { ReportDialog } from "@/components/ReportDialog";
import { Screen } from "@/components/Screen";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { relativeTime } from "@/lib/time";
import { spacing, typography, useTheme } from "@/theme";

/**
 * Blocked accounts.
 *
 * `GET /api/me/blocks` is hydrated with name, avatar and headline, so a block
 * can be recognised and undone. Where the server cannot hydrate a row (or an
 * older deployment still returns bare ids), the row shows the account id — it
 * does not invent a name.
 *
 * Each row opens the ActionSheet with the two actions that genuinely exist:
 * unblock (`DELETE /api/me/block/:userId`) and report (`POST /api/reports`).
 */
export default function BlockedAccounts() {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<BlockedUser | null>(null);
  const [reporting, setReporting] = useState<BlockedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal: AbortSignal) => fetchBlockedUsers(signal), []);
  const { resource, reload, refreshing, refresh, mutate } =
    useAsyncResource<BlockedUser[]>(load);

  const onUnblock = useCallback(
    async (row: BlockedUser) => {
      setBusy(true);
      setError(null);
      try {
        await unblockUser(row.userId);
        mutate((current) => current.filter((entry) => entry.userId !== row.userId));
        setSelected(null);
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? (cause.serverMessage ?? cause.userMessage)
            : "Couldn't unblock that account. Try again.",
        );
        setSelected(null);
      } finally {
        setBusy(false);
      }
    },
    [mutate],
  );

  const nameFor = (row: BlockedUser) => row.name ?? `Account #${row.userId}`;

  return (
    <Screen
      scroll
      edges={["top", "left", "right"]}
      refreshing={refreshing}
      onRefresh={resource.phase === "ready" ? refresh : undefined}
    >
      <AppHeader title="Blocked accounts" back bell={false} />

      <DataState resource={resource} onRetry={reload} skeleton="list">
        {(rows) => (
          <View style={styles.body}>
            <Card>
              <CardLabel>What blocking does</CardLabel>
              <CardBody>
                A blocked account can&apos;t see your posts or profile, message you, or interact
                with your work — and you won&apos;t see theirs. Projects you already share keep
                working, so a block never breaks a job in progress.
              </CardBody>
            </Card>

            {rows.length === 0 ? (
              <EmptyState
                inline
                icon={UserCheck}
                title="No blocked accounts"
                body="Anyone you block from a profile or a post appears here, so you can undo it."
              />
            ) : (
              <View>
                {rows.map((row, index) => (
                  <View key={row.userId}>
                    {index > 0 ? (
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    ) : null}
                    <ListRow
                      title={nameFor(row)}
                      subtitle={row.headline ?? "Blocked"}
                      meta={row.blockedAt ? `Blocked ${relativeTime(row.blockedAt)}` : undefined}
                      leading={<Avatar name={nameFor(row)} uri={row.avatar} size="md" />}
                      onPress={() => {
                        setError(null);
                        setSelected(row);
                      }}
                      accessibilityHint="Opens unblock and report options"
                    />
                  </View>
                ))}
              </View>
            )}

            {error ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                {error}
              </Text>
            ) : null}
          </View>
        )}
      </DataState>

      <ActionSheet
        visible={selected !== null}
        title={selected ? nameFor(selected) : ""}
        message="Blocked accounts can't message you or see your work."
        onClose={() => setSelected(null)}
        actions={[
          {
            label: "Unblock",
            icon: UserX,
            description: "They'll be able to see and message you again",
            disabled: busy,
            onPress: () => {
              if (selected) void onUnblock(selected);
            },
          },
          {
            label: "Report to Viewrr",
            icon: Flag,
            tone: "destructive",
            description: "Blocking is private; a report goes to the moderation team",
            disabled: busy,
            onPress: () => {
              setReporting(selected);
              setSelected(null);
            },
          },
        ]}
      />

      {reporting ? (
        <ReportDialog
          visible
          subjectType="user"
          subjectId={reporting.userId}
          subjectLabel={nameFor(reporting)}
          onClose={() => setReporting(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  error: {
    ...typography.small,
  },
});
