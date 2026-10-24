import { useRouter } from "expo-router";
import { AlertTriangle, CalendarClock, Clock, ShieldCheck, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  confirmDeletion,
  fetchDeletionStatus,
  requestDeletion,
  type DeletionBlocker,
  type DeletionStatus,
  type RetentionEntry,
  type ProDeletionTiming,
} from "@/api/account";
import { ApiError } from "@/api/errors";
import { ActionSheet } from "@/components/ActionSheet";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Card, CardBody, CardLabel, CardTitle } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { SUPPORT_EMAIL } from "@/config/support";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useSession } from "@/session/SessionProvider";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Account deletion — Apple guideline 5.1.1(v), Decision 6.
 *
 * This is a real, native, two-step deletion. It is NOT a deactivation and the
 * copy never calls it one.
 *
 *   1. GET  /api/me/deletion-status   — what state the account is in, which
 *      legal/financial obligations currently defer erasure, and the published
 *      retention schedule.
 *   2. POST /api/me/request-deletion — records an unconfirmed request and
 *      previews any deferral. Billing and account access are unchanged.
 *   3. POST /api/me/confirm-deletion  — password re-authentication, then
 *      erasure/anonymisation. On success the session is signed out, because the
 *      account behind it no longer exists.
 *
 * The password is held in component state only for as long as the form is on
 * screen, is cleared on unmount of the flow and is never logged or persisted.
 */

type Step = "review" | "confirm";

export default function AccountDeletion() {
  const router = useRouter();
  const { colors } = useTheme();
  const { signOut } = useSession();

  const [step, setStep] = useState<Step>("review");
  const [password, setPassword] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Set once a request has been recorded in this session. */
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [confirmedScheduled, setConfirmedScheduled] = useState(false);
  const [proTiming, setProTiming] = useState<ProDeletionTiming | null>(null);

  const load = useCallback((signal: AbortSignal) => fetchDeletionStatus(signal), []);
  const { resource, reload, refreshing, refresh } = useAsyncResource<DeletionStatus>(load);
  const loadedStatus = resource.phase === "ready" ? resource.data : null;
  const selectedTiming = proTiming ?? loadedStatus?.proDeletionTiming ?? null;

  const describe = (cause: unknown): string =>
    cause instanceof ApiError
      ? (cause.serverMessage ?? cause.userMessage)
      : "Something went wrong. Try again.";

  const onRequest = useCallback(async () => {
    setRequesting(true);
    setActionError(null);
    setConfirmedScheduled(false);
    try {
      const result = await requestDeletion(selectedTiming);
      setScheduledFor(result.scheduledFor);
      setRequestNotice(result.message);
      setStep("confirm");
    } catch (cause) {
      setActionError(describe(cause));
    } finally {
      setRequesting(false);
    }
  }, [selectedTiming]);

  const onConfirm = useCallback(async () => {
    setConfirming(true);
    setActionError(null);
    try {
      const result = await confirmDeletion(password, selectedTiming);
      setPassword("");
      setSheetOpen(false);

      if (result.state === "scheduled") {
        setConfirmedScheduled(true);
        setScheduledFor(result.scheduledFor);
        setRequestNotice(
          result.message ??
            "Your deletion is confirmed and scheduled. It will complete automatically once the outstanding obligations clear.",
        );
        setStep("review");
        return;
      }

      if (result.state !== "anonymised") {
        setActionError(
          result.message ??
            "Viewrr could not confirm the final deletion state. Please try again.",
        );
        return;
      }

      // The account has actually been anonymised and the server session revoked.
      await signOut();
    } catch (cause) {
      setSheetOpen(false);
      setActionError(describe(cause));
    } finally {
      setConfirming(false);
    }
  }, [password, selectedTiming, signOut]);

  return (
    <Screen
      scroll
      keyboard
      edges={["top", "bottom", "left", "right"]}
      refreshing={refreshing}
      onRefresh={resource.phase === "ready" ? refresh : undefined}
    >
      <AppHeader title="Delete account" back bell={false} />

      <DataState resource={resource} onRetry={reload} skeleton="list">
        {(status) => {
          const blockers = selectedTiming ? status.blockers.filter(b => b.code !== "active_pro_subscription") : status.blockers;
          const waitingForPro = selectedTiming === "pro_period_end";
          const deferred = blockers.length > 0 || waitingForPro;
          const alreadyScheduled = status.state === "scheduled" || confirmedScheduled;
          const switchingToImmediate = alreadyScheduled && proTiming === "immediate" && status.proDeletionTiming !== "immediate";
          const scheduleDate = scheduledFor ?? status.scheduledFor;

          return (
            <View style={styles.body}>
              <Card tone="brand">
                <View style={styles.headRow}>
                  <Trash2 size={20} color={colors.primary} strokeWidth={2.2} />
                  <CardTitle>Permanent deletion</CardTitle>
                </View>
                <CardBody>
                  Deleting permanently removes your Viewrr account. It is not a pause or
                  deactivation. Once deletion is completed, you will no longer be able to sign in.
                  Your profile, posts, messages and saved work are removed or anonymised as set out below.
                </CardBody>
              </Card>

              {(status.pro || status.proDeletionTiming === "pro_period_end") && step === "review" ? (
                <DeletionTimingChoices
                  selected={selectedTiming}
                  onSelect={(value) => { setProTiming(value); setActionError(null); }}
                  periodEnd={status.proDeleteAfter ?? status.pro?.periodEnd ?? null}
                  canScheduleEnd={status.pro?.canScheduleEnd === true || status.proDeletionTiming === "pro_period_end"}
                  disabled={requesting || status.state === "blocked"}
                />
              ) : null}

              {status.state === "pending" && step === "review" ? (
                <Card>
                  <View style={styles.headRow}>
                    <CalendarClock size={18} color={colors.primary} strokeWidth={2.2} />
                    <CardLabel>Confirmation still required</CardLabel>
                  </View>
                  <CardBody>
                    Your deletion request is recorded, but it is not confirmed yet. Continue below
                    and enter your password before Viewrr can delete or schedule deletion of the account.
                  </CardBody>
                </Card>
              ) : null}

              {status.state === "scheduled" || confirmedScheduled ? (
                <Card>
                  <View style={styles.headRow}>
                    <CalendarClock size={18} color={colors.primary} strokeWidth={2.2} />
                    <CardLabel>Deletion confirmed</CardLabel>
                  </View>
                  <CardBody>
                    {confirmedScheduled && requestNotice
                      ? requestNotice
                      : status.scheduledFor
                        ? status.proDeletionTiming === "pro_period_end" && status.proDeleteAfter
                          ? `Your deletion is confirmed. Your account stays available until ${formatDate(status.proDeleteAfter)}, then deletion runs once any other obligations clear. You can choose immediate deletion below.`
                          : `Your deletion is confirmed and scheduled for ${formatDate(status.scheduledFor)}. Billing cancellation or other outstanding obligations may still be processing.`
                        : "Your deletion is confirmed and scheduled. It will complete automatically once the outstanding obligations clear."}
                  </CardBody>
                </Card>
              ) : null}

              {blockers.length > 0 ? (
                <Card>
                  <View style={styles.headRow}>
                    <Clock size={18} color={colors.primary} strokeWidth={2.2} />
                    <CardLabel>Why deletion may be delayed</CardLabel>
                  </View>
                  <CardBody>
                    You can submit your deletion request now. Viewrr still has obligations tied to
                    this account, so deletion may be delayed until the outstanding items below
                    are resolved. The request itself is not refused because of these obligations.
                  </CardBody>
                  <View style={styles.rows}>
                    {blockers.map((blocker) => (
                      <BlockerRow key={blocker.code} blocker={blocker} />
                    ))}
                  </View>
                  {scheduleDate ? (
                    <View
                      style={[
                        styles.notice,
                        {
                          backgroundColor: colors.secondary,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.noticeText, { color: colors.foreground }]}>
                        Scheduled deletion date: {formatDate(scheduleDate)}
                      </Text>
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {status.retention.length > 0 ? (
                <Card>
                  <View style={styles.headRow}>
                    <ShieldCheck size={18} color={colors.primary} strokeWidth={2.2} />
                    <CardLabel>What happens to your data</CardLabel>
                  </View>
                  <View style={styles.rows}>
                    {status.retention.map((entry) => (
                      <RetentionRow key={`${entry.category}-${entry.action}`} entry={entry} />
                    ))}
                  </View>
                </Card>
              ) : (
                <Card>
                  <CardLabel>What happens to your data</CardLabel>
                  <CardBody>
                    Viewrr hasn&apos;t returned a retention schedule for your account yet. Rather
                    than guess at it, this screen will show the real schedule once it loads —
                    pull to refresh, or email {SUPPORT_EMAIL} and the team will send it to you.
                  </CardBody>
                </Card>
              )}

              {step === "review" ? (
                <View style={styles.actions}>
                  {actionError ? <ErrorLine message={actionError} /> : null}
                  {(!alreadyScheduled || switchingToImmediate) && status.state !== "blocked" ? (
                    <Button
                      label={
                        switchingToImmediate
                          ? "Change to immediate deletion"
                          : status.state === "pending"
                          ? "Continue to confirmation"
                          : deferred
                            ? "Request deletion"
                            : "Continue to delete"
                      }
                      variant="destructive"
                      loading={requesting}
                      disabled={Boolean(status.pro) && !selectedTiming}
                      onPress={() => void onRequest()}
                      accessibilityHint={
                        status.state === "pending"
                          ? "Continue to password confirmation."
                          : "Records your deletion request. You will confirm with your password on the next step."
                      }
                    />
                  ) : null}
                  <Button
                    label={alreadyScheduled ? "Back to account" : "Keep my account"}
                    variant="ghost"
                    onPress={() => router.back()}
                    accessibilityHint="Leaves this screen without changing any confirmed deletion request"
                  />
                </View>
              ) : (
                <View style={styles.actions}>
                  <Card>
                    <CardLabel>Step 2 of 2 — confirm it&apos;s you</CardLabel>
                    <CardBody>
                      {requestNotice ??
                        (scheduleDate
                          ? `Your request is recorded. If you confirm it, deletion will be scheduled for ${formatDate(scheduleDate)} unless the outstanding obligations clear sooner.`
                          : deferred
                            ? "Your request is recorded. Enter your password to confirm it. Because obligations remain, completion may be delayed until they are resolved."
                            : "Your request is recorded. Enter your password to delete the account.")}
                    </CardBody>
                    <TextField
                      label="Password"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoCapitalize="none"
                      autoComplete="current-password"
                      textContentType="password"
                      editable={!confirming}
                      helperText="Used once to re-authenticate. Never stored on this device."
                    />
                  </Card>

                  {actionError ? <ErrorLine message={actionError} /> : null}

                  <Button
                    label={deferred ? "Confirm deletion request" : "Delete my account"}
                    variant="destructive"
                    disabled={password.length === 0}
                    loading={confirming}
                    onPress={() => setSheetOpen(true)}
                  />
                  <Button
                    label="Back"
                    variant="ghost"
                    disabled={confirming}
                    onPress={() => {
                      setPassword("");
                      setActionError(null);
                      setStep("review");
                    }}
                  />
                </View>
              )}

              <ActionSheet
                visible={sheetOpen}
                title={deferred ? "Confirm deletion request?" : "Delete this account permanently?"}
                message={
                  waitingForPro
                    ? `Stop Pro renewal and delete the account at the end of your paid Pro period${status.pro?.periodEnd ? ` on ${formatDate(status.pro.periodEnd)}` : ""}. Your account stays available until then. Other outstanding obligations may delay final cleanup.`
                    : selectedTiming === "immediate"
                      ? `End Pro now and ${blockers.length ? "confirm account deletion once the other outstanding obligations clear" : "delete your account now"}. Unused Pro access ends. This does not automatically refund unused time.`
                      : deferred
                    ? scheduleDate
                      ? `Confirming makes this deletion request final. Because obligations remain, deletion is scheduled for ${formatDate(scheduleDate)} unless they clear sooner.`
                      : "Confirming makes this deletion request final. Because obligations remain, completion will be delayed and will run automatically once they clear."
                    : "Confirming deletes the account now. This cannot be undone."
                }
                onClose={() => setSheetOpen(false)}
                cancelLabel="Keep my account"
                actions={[
                  {
                    label: "Yes, delete my account",
                    description: deferred
                      ? "Deletion will run automatically when it can safely complete"
                      : "You will be signed out of this device",
                    tone: "destructive",
                    icon: Trash2,
                    disabled: confirming,
                    onPress: () => void onConfirm(),
                  },
                ]}
              />
            </View>
          );
        }}
      </DataState>
    </Screen>
  );
}

function DeletionTimingChoices({ selected, onSelect, periodEnd, canScheduleEnd, disabled }: {
  selected: ProDeletionTiming | null;
  onSelect: (value: ProDeletionTiming) => void;
  periodEnd: string | null;
  canScheduleEnd: boolean;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  const choices: { value: ProDeletionTiming; title: string; detail: string; unavailable?: boolean }[] = [
    { value: "immediate", title: "Immediate account deletion",
      detail: "End Pro now and delete your account. Unused Pro access ends. This does not automatically refund unused time." },
    { value: "pro_period_end", title: "At the end of Pro Viewrr", unavailable: !canScheduleEnd,
      detail: canScheduleEnd && periodEnd
        ? `Stop renewal now. Keep your account and Pro access until ${formatDate(periodEnd)}, then delete automatically.`
        : "Your paid Pro expiry date is unavailable. Refresh to check it, or choose immediate deletion." },
  ];
  return (
    <Card>
      <CardLabel>When should your account be deleted?</CardLabel>
      <CardBody>Choose one option, then confirm with your password. Other outstanding obligations shown below may still delay account deletion.</CardBody>
      <View style={styles.rows} accessibilityRole="radiogroup">
        {choices.map(choice => (
          <Pressable key={choice.value} accessibilityRole="radio"
            accessibilityLabel={choice.title}
            accessibilityState={{ checked: selected === choice.value, disabled: disabled || Boolean(choice.unavailable) }}
            disabled={disabled || Boolean(choice.unavailable)}
            onPress={() => onSelect(choice.value)}
            style={[styles.notice, { gap: spacing[2], opacity: choice.unavailable ? 0.5 : 1,
              borderColor: selected === choice.value ? colors.primary : colors.border,
              backgroundColor: selected === choice.value ? colors.secondary : colors.card }]}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>{selected === choice.value ? "✓ " : ""}{choice.title}</Text>
            <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>{choice.detail}</Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function BlockerRow({ blocker }: { blocker: DeletionBlocker }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <AlertTriangle size={16} color={colors.mutedForeground} strokeWidth={2.1} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{blocker.label}</Text>
        {blocker.detail ? (
          <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>{blocker.detail}</Text>
        ) : null}
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
          {blocker.clearsAutomatically
            ? "Clears on its own — no action needed from you."
            : "Needs to be settled before erasure can run."}
        </Text>
      </View>
    </View>
  );
}

function RetentionRow({ entry }: { entry: RetentionEntry }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{entry.category}</Text>
        <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>
          {plainAction(entry)}
        </Text>
        {entry.detail ? (
          <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>{entry.detail}</Text>
        ) : null}
      </View>
    </View>
  );
}

function ErrorLine({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
      {message}
    </Text>
  );
}

/** Policy periods are review periods, not evidence of automatic expiry. */
function plainAction(entry: RetentionEntry): string {
  const action = entry.action.toLowerCase();
  const days = entry.periodDays;

  if (action === "deleted") {
    return days > 0 ? `Deleted within ${days} days.` : "Deleted when your account is removed.";
  }
  if (action === "anonymised" || action === "anonymized") {
    return days > 0
      ? `Account details removed within ${days} days.`
      : "Account details removed.";
  }
  if (action === "retained") {
    return days > 0
      ? `Retention review period: ${days} days.`
      : "Retained under Viewrr's retention policy.";
  }
  return days > 0 ? `${entry.action} — ${days} days.` : entry.action;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[4],
    paddingBottom: spacing[6],
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  rows: {
    gap: spacing[2],
  },
  row: {
    flexDirection: "row",
    gap: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[3],
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...typography.smallBold,
  },
  rowBody: {
    ...typography.small,
  },
  rowMeta: {
    ...typography.caption,
  },
  notice: {
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  noticeText: {
    ...typography.smallBold,
  },
  actions: {
    gap: spacing[3],
  },
  error: {
    ...typography.small,
  },
});
