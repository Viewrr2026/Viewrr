import { SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { control, hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * The thread composer.
 *
 * Multiline and auto-growing up to a ceiling, so a long message is visible
 * while typing without the input eating the conversation. `blurOnSubmit` is off
 * and Enter inserts a newline: on a phone, a send key that fires on return is a
 * reliable way to send half a sentence.
 *
 * Send is disabled while the field is blank or a send is in flight, so a double
 * tap cannot post twice. Failures are surfaced here, immediately above the
 * input, because that is where the user is looking — a send that silently fails
 * is the one thing a messaging surface must never do (Decision 3: a block error
 * is told honestly rather than swallowed).
 */

const MAX_HEIGHT = 120;
const MAX_LENGTH = 4000;

type MessageComposerProps = {
  onSend: (body: string) => Promise<boolean>;
  /** Shown above the input. Cleared by the screen on the next attempt. */
  error?: string | null;
  /** Blocks input entirely — e.g. a thread that cannot accept messages. */
  disabled?: boolean;
  placeholder?: string;
};

export function MessageComposer({
  onSend,
  error = null,
  disabled = false,
  placeholder = "Write a message",
}: MessageComposerProps) {
  const { colors } = useTheme();
  const [value, setValue] = useState("");
  const [height, setHeight] = useState<number>(control.height);
  const [sending, setSending] = useState(false);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !sending && !disabled;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const sent = await onSend(trimmed);
      // The text is kept on failure so nothing the user wrote is thrown away.
      if (sent) {
        setValue("");
        setHeight(control.height);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.container, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
      {error ? (
        <Text style={[styles.error, { color: colors.destructive }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={setValue}
          onContentSizeChange={(event) =>
            setHeight(
              Math.min(MAX_HEIGHT, Math.max(control.height, event.nativeEvent.contentSize.height + spacing[3])),
            )
          }
          editable={!disabled}
          multiline
          maxLength={MAX_LENGTH}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Message"
          submitBehavior="newline"
          style={[
            styles.input,
            Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
            {
              height,
              backgroundColor: colors.card,
              borderColor: colors.input,
              color: colors.foreground,
            },
          ]}
        />

        <Pressable
          onPress={() => void submit()}
          disabled={!canSend}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? colors.primary : colors.muted },
            pressed && canSend && styles.pressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <SendHorizontal
              size={20}
              color={canSend ? colors.primaryForeground : colors.mutedForeground}
              strokeWidth={2.2}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.xl,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    ...typography.body,
  },
  send: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.75,
  },
  error: {
    ...typography.caption,
  },
});
