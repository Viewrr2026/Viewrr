import { useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import type { StageAction, StageActionKind } from "@/components/work/gating";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * The action strip under a stage.
 *
 * This component renders decisions; it does not make them. What may be shown is
 * decided by `gateStage` in `components/work/gating.ts`, which is the single
 * place that encodes role, stage status, `approvalRequired`, `revisionAllowance`
 * and the legacy/retainer exclusions. If `actions` is empty, nothing is drawn
 * but the note — never a disabled button implying an action exists elsewhere.
 *
 * "Request changes" requires a message, because the server does
 * (`400 message required`). The composer is inline and the submit stays
 * disabled until there is something to send, so the request cannot 400 for a
 * reason the user could not see.
 */

type StageActionsProps = {
  actions: StageAction[];
  note: string | null;
  /** In-flight action, so only the pressed button spins. */
  pending: StageActionKind | null;
  /** Failure copy from the last attempt, already user-safe. */
  error: string | null;
  onApprove: () => void;
  onComplete: () => void;
  onRequestChanges: (message: string) => void;
};

const MESSAGE_LIMIT = 1000;

export function StageActions({
  actions,
  note,
  pending,
  error,
  onApprove,
  onComplete,
  onRequestChanges,
}: StageActionsProps) {
  const { colors } = useTheme();
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState("");

  const hint = actions.find((action) => action.hint)?.hint;

  if (actions.length === 0 && !note && !error) return null;

  return (
    <View style={styles.wrap}>
      {note ? (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{note}</Text>
      ) : null}

      {composing ? (
        <View style={styles.composer}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            WHAT NEEDS CHANGING?
          </Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Describe the changes you need on this stage"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={MESSAGE_LIMIT}
            accessibilityLabel="Describe the changes you need"
            style={[
              styles.input,
              Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
              { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.input },
            ]}
          />
          <View style={styles.row}>
            <Button
              label="Send request"
              onPress={() => onRequestChanges(message.trim())}
              disabled={message.trim().length === 0}
              loading={pending === "request-changes"}
              size="compact"
              block={false}
              style={styles.grow}
            />
            <Button
              label="Cancel"
              variant="ghost"
              size="compact"
              block={false}
              onPress={() => {
                setComposing(false);
                setMessage("");
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          {actions.map((action) => (
            <Button
              key={action.kind}
              label={action.label}
              variant={action.emphasis === "primary" ? "primary" : "secondary"}
              size="compact"
              block={false}
              loading={pending === action.kind}
              disabled={pending !== null && pending !== action.kind}
              style={styles.grow}
              onPress={() => {
                if (action.kind === "approve") return onApprove();
                if (action.kind === "complete") return onComplete();
                setComposing(true);
              }}
            />
          ))}
        </View>
      )}

      {hint && !composing ? (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text>
      ) : null}

      {error ? (
        <Text style={[styles.error, { color: colors.destructive }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing[2],
  },
  grow: {
    flexGrow: 1,
    flexBasis: 140,
  },
  note: {
    ...typography.caption,
  },
  hint: {
    ...typography.caption,
  },
  error: {
    ...typography.caption,
  },
  composer: {
    gap: spacing[2],
  },
  label: {
    ...typography.eyebrow,
  },
  input: {
    ...typography.small,
    minHeight: 84,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing[3],
    textAlignVertical: "top",
  },
});
