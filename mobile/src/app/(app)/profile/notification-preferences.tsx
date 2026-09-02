import { Mail, Smartphone } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import {
  fetchEmailPreferences,
  fetchPushPreferences,
  updateEmailPreferences,
  updatePushPreferences,
  type EmailNotificationPreferences,
  type EmailPreferenceKey,
  type PushPreferenceKey,
  type PushPreferences,
} from "@/api/account";
import { ApiError } from "@/api/errors";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { Screen } from "@/components/Screen";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useSession } from "@/session/SessionProvider";
import { spacing, typography, useTheme } from "@/theme";

/**
 * Notification preferences — Decision 15.
 *
 * Two stores, two sections, no pretence that one controls the other:
 *
 *   EMAIL — GET|PATCH /api/notifications/preferences/:userId, the eight
 *   `notification_preferences` columns. These gate EMAILS only, which is why
 *   every label in that section says so.
 *
 *   PUSH  — GET|PATCH /api/me/push-preferences, five keys, a separate table.
 *
 * `emailProductUpdates` is included and honestly labelled: the column exists
 * and is stored, but nothing in the backend reads it yet (no product-update
 * email path exists), so the row says exactly that instead of implying a
 * mailing list that would arrive.
 *
 * Each switch writes immediately and reverts on failure — an optimistic toggle
 * that silently failed would leave the user believing they had opted out.
 */

type Snapshot = {
  email: EmailNotificationPreferences;
  /** Null when the push endpoint is not reachable for this account yet. */
  push: PushPreferences | null;
  pushError: string | null;
};

const EMAIL_ROWS: { key: EmailPreferenceKey; label: string; description: string }[] = [
  {
    key: "emailProjectInvitations",
    label: "Project invitations",
    description: "Email me when a client invites me to a project",
  },
  {
    key: "emailNewOffers",
    label: "New offers",
    description: "Email me when a creative expresses interest in my brief",
  },
  {
    key: "emailCounterOffers",
    label: "Counter offers",
    description: "Email me when someone counters a price",
  },
  {
    key: "emailMessages",
    label: "Messages",
    description: "Email me when I receive a direct message",
  },
  {
    key: "emailStageUpdates",
    label: "Stage updates",
    description: "Email me when a project stage is submitted or approved",
  },
  {
    key: "emailPaymentUpdates",
    label: "Payment updates",
    description: "Email me about payment requests, receipts and confirmations",
  },
  {
    key: "emailReviewRequests",
    label: "Review requests",
    description: "Email me when I'm asked to leave a review",
  },
  {
    key: "emailProductUpdates",
    label: "Product updates",
    description:
      "Stored for later — Viewrr doesn't send product-update emails yet, so this changes nothing today",
  },
];

const PUSH_ROWS: { key: PushPreferenceKey; label: string; description: string }[] = [
  {
    key: "pushMessages",
    label: "Messages",
    description: "Push me when I receive a direct message",
  },
  {
    key: "pushProjectUpdates",
    label: "Project updates",
    description: "Push me when a project or stage moves",
  },
  {
    key: "pushInterests",
    label: "Briefs and interest",
    description: "Push me about interest in my briefs and responses to mine",
  },
  {
    key: "pushPayments",
    label: "Payments",
    description: "Push me about payment requests and confirmations",
  },
  {
    key: "pushSocial",
    label: "Likes and comments",
    description: "Push me when someone reacts to my posts",
  },
];

export default function NotificationPreferences() {
  const { user } = useSession();
  const { colors } = useTheme();
  const userId = user?.id ?? null;

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal): Promise<Snapshot> => {
      if (userId === null) throw new Error("No session");
      const email = await fetchEmailPreferences(userId, signal);
      // Push preferences are a new endpoint. If it is not live for this
      // account, the email section must still work, and the push section says
      // why it is unavailable rather than showing dead switches.
      try {
        const push = await fetchPushPreferences(signal);
        return { email, push, pushError: null };
      } catch (cause) {
        return {
          email,
          push: null,
          pushError:
            cause instanceof ApiError
              ? (cause.serverMessage ?? cause.userMessage)
              : "Push preferences couldn't be loaded.",
        };
      }
    },
    [userId],
  );

  const { resource, reload, mutate, refreshing, refresh } = useAsyncResource<Snapshot>(load, {
    enabled: userId !== null,
  });

  const describe = (cause: unknown): string =>
    cause instanceof ApiError
      ? (cause.serverMessage ?? cause.userMessage)
      : "That didn't save. Try again.";

  const setEmail = useCallback(
    async (key: EmailPreferenceKey, value: boolean) => {
      if (userId === null) return;
      setPending(key);
      setError(null);
      mutate((current) => ({ ...current, email: { ...current.email, [key]: value } }));
      try {
        const saved = await updateEmailPreferences(userId, { [key]: value });
        mutate((current) => ({ ...current, email: saved }));
      } catch (cause) {
        // Revert: the server is the authority on what it will actually send.
        mutate((current) => ({ ...current, email: { ...current.email, [key]: !value } }));
        setError(describe(cause));
      } finally {
        setPending(null);
      }
    },
    [mutate, userId],
  );

  const setPush = useCallback(
    async (key: PushPreferenceKey, value: boolean) => {
      setPending(key);
      setError(null);
      mutate((current) =>
        current.push ? { ...current, push: { ...current.push, [key]: value } } : current,
      );
      try {
        const saved = await updatePushPreferences({ [key]: value });
        mutate((current) => ({ ...current, push: saved }));
      } catch (cause) {
        mutate((current) =>
          current.push ? { ...current, push: { ...current.push, [key]: !value } } : current,
        );
        setError(describe(cause));
      } finally {
        setPending(null);
      }
    },
    [mutate],
  );

  return (
    <Screen
      scroll
      edges={["top", "left", "right"]}
      refreshing={refreshing}
      onRefresh={resource.phase === "ready" ? refresh : undefined}
    >
      <AppHeader title="Notifications" back bell={false} />

      <DataState resource={resource} onRetry={reload} skeleton="list">
        {(snapshot) => (
          <View style={styles.body}>
            <Card>
              <View style={styles.headRow}>
                <Mail size={18} color={colors.primary} strokeWidth={2.2} />
                <CardLabel>Email</CardLabel>
              </View>
              <CardBody>
                These control the emails Viewrr sends to your address. They do not affect push
                notifications on this phone.
              </CardBody>
              <View style={styles.rows}>
                {EMAIL_ROWS.map((row) => (
                  <ToggleRow
                    key={row.key}
                    label={row.label}
                    description={row.description}
                    value={snapshot.email[row.key]}
                    busy={pending === row.key}
                    onChange={(value) => void setEmail(row.key, value)}
                  />
                ))}
              </View>
            </Card>

            <Card>
              <View style={styles.headRow}>
                <Smartphone size={18} color={colors.primary} strokeWidth={2.2} />
                <CardLabel>Push</CardLabel>
              </View>
              <CardBody>
                These control push notifications on your devices. They are stored separately from
                your email settings above.
              </CardBody>

              {snapshot.push ? (
                <View style={styles.rows}>
                  {PUSH_ROWS.map((row) => {
                    const push = snapshot.push;
                    if (!push) return null;
                    return (
                      <ToggleRow
                        key={row.key}
                        label={row.label}
                        description={row.description}
                        value={push[row.key]}
                        busy={pending === row.key}
                        onChange={(value) => void setPush(row.key, value)}
                      />
                    );
                  })}
                </View>
              ) : (
                <Text style={[styles.notice, { color: colors.mutedForeground }]}>
                  {snapshot.pushError ??
                    "Push preferences couldn't be loaded."}{" "}
                  Pull down to try again — your email settings above are unaffected.
                </Text>
              )}
            </Card>

            {error ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                {error}
              </Text>
            ) : null}
          </View>
        )}
      </DataState>
    </Screen>
  );
}

function ToggleRow({
  label,
  description,
  value,
  busy,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy}
        accessibilityLabel={label}
        accessibilityHint={description}
        trackColor={{ true: colors.primaryWashBorder, false: colors.muted }}
        thumbColor={value ? colors.primary : colors.card}
        ios_backgroundColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  rows: {
    gap: spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
    minHeight: 56,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...typography.smallBold,
  },
  rowBody: {
    ...typography.caption,
  },
  notice: {
    ...typography.small,
  },
  error: {
    ...typography.small,
  },
});
