import { CheckCircle2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError } from "@/api/errors";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  submitReport,
  type ReportReason,
  type ReportSubjectType,
} from "@/api/trust";
import { Button } from "@/components/Button";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { Pill } from "@/components/Pill";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Report dialog — the single reporting surface in the app.
 *
 * The five reasons are the server's enum exactly (spam, harassment, fake,
 * inappropriate, other); nothing is offered here that `POST /api/reports` would
 * reject, and nothing the server accepts is hidden.
 *
 * It owns its own submission because a report is a one-shot action with three
 * outcomes the caller should not have to re-implement: sent, rejected (the
 * server's own copy is shown, including the report rate limit) and cancelled.
 * The dialog never claims a report was filed unless the request returned 2xx.
 */

const DESCRIPTION_LIMIT = 1000;

type ReportDialogProps = {
  visible: boolean;
  subjectType: ReportSubjectType;
  subjectId: number;
  /** What is being reported, in the user's words — e.g. a name or post title. */
  subjectLabel?: string;
  onClose: () => void;
  /** Fired after a genuinely successful submission, with the server's id. */
  onSubmitted?: (reportId: number | null) => void;
};

export function ReportDialog({
  visible,
  subjectType,
  subjectId,
  subjectLabel,
  onClose,
  onSubmitted,
}: ReportDialogProps) {
  const { colors, shadows } = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Each opening is a fresh report; a stale reason from last time would be a
  // quiet way to file the wrong one.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setDescription("");
      setError(null);
      setSent(false);
      setSubmitting(false);
    }
  }, [visible]);

  const send = useCallback(async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitReport({ subjectType, subjectId, reason, description });
      setSent(true);
      onSubmitted?.(typeof result?.reportId === "number" ? result.reportId : null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.serverMessage ?? cause.userMessage)
          : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [description, onSubmitted, reason, subjectId, subjectType]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          onPress={submitting ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.scrim, { backgroundColor: colors.overlay }]}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.centre}
          pointerEvents="box-none"
        >
          <View accessibilityViewIsModal style={[styles.holder, shadows.lg]}>
            <Card size="feature">
              {sent ? (
                <View style={styles.done}>
                  <CheckCircle2 size={26} color={colors.primary} strokeWidth={2.2} />
                  <Text style={[styles.title, { color: colors.foreground }]}>Report sent</Text>
                  <CardBody>
                    Viewrr&apos;s team reviews every report. We won&apos;t tell the other person
                    who reported them.
                  </CardBody>
                  <Button label="Done" onPress={onClose} />
                </View>
              ) : (
                <>
                  <CardLabel>Report</CardLabel>
                  <Text style={[styles.title, { color: colors.foreground }]}>
                    {subjectLabel ? `Report ${subjectLabel}` : "Report this"}
                  </Text>
                  <CardBody>
                    Tell us what&apos;s wrong. Reports go to Viewrr&apos;s team, not to the person
                    you&apos;re reporting.
                  </CardBody>

                  <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    <View style={styles.reasons}>
                      {REPORT_REASONS.map((value) => {
                        const selected = reason === value;
                        return (
                          <Pressable
                            key={value}
                            onPress={() => setReason(value)}
                            disabled={submitting}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            accessibilityLabel={REPORT_REASON_LABELS[value]}
                          >
                            <Pill
                              label={REPORT_REASON_LABELS[value]}
                              tone={selected ? "brand" : "neutral"}
                            />
                          </Pressable>
                        );
                      })}
                    </View>

                    <View style={styles.field}>
                      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                        DETAILS (OPTIONAL)
                      </Text>
                      <TextInput
                        value={description}
                        onChangeText={setDescription}
                        editable={!submitting}
                        multiline
                        maxLength={DESCRIPTION_LIMIT}
                        placeholder="What happened?"
                        placeholderTextColor={colors.mutedForeground}
                        accessibilityLabel="Report details"
                        style={[
                          styles.input,
                          {
                            backgroundColor: colors.background,
                            color: colors.foreground,
                            borderColor: colors.input,
                          },
                        ]}
                      />
                      <Text style={[styles.counter, { color: colors.mutedForeground }]}>
                        {description.length}/{DESCRIPTION_LIMIT}
                      </Text>
                    </View>

                    {error ? (
                      <Text
                        accessibilityRole="alert"
                        style={[styles.error, { color: colors.destructive }]}
                      >
                        {error}
                      </Text>
                    ) : null}
                  </ScrollView>

                  <View style={styles.actions}>
                    <Button
                      label="Send report"
                      onPress={() => void send()}
                      loading={submitting}
                      disabled={!reason}
                      accessibilityHint="Sends this report to Viewrr's moderation team"
                    />
                    <Button
                      label="Cancel"
                      variant="ghost"
                      onPress={onClose}
                      disabled={submitting}
                    />
                  </View>
                </>
              )}
            </Card>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  centre: {
    flex: 1,
    justifyContent: "center",
    padding: spacing[4],
  },
  holder: {
    maxHeight: "88%",
  },
  title: {
    ...typography.h3,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: spacing[4],
    paddingTop: spacing[1],
  },
  reasons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  field: {
    gap: spacing[2],
  },
  fieldLabel: {
    ...typography.eyebrow,
  },
  input: {
    minHeight: 96,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    textAlignVertical: "top",
    ...typography.small,
  },
  counter: {
    ...typography.caption,
    alignSelf: "flex-end",
  },
  error: {
    ...typography.small,
  },
  actions: {
    gap: spacing[2],
  },
  done: {
    alignItems: "center",
    gap: spacing[3],
  },
});
