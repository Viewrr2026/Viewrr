import { SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { control, hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Compact conversation composer.
 *
 * The field starts as a single, low-profile messaging bar and grows only as
 * the message grows. Return inserts a newline; Send remains an explicit action
 * so a user cannot accidentally submit half a message.
 *
 * Failed sends deliberately retain the draft.
 */
const MIN_INPUT_HEIGHT = 36;
const MAX_INPUT_HEIGHT = 92;
const MAX_LENGTH = 4000;

type MessageComposerProps = {
  onSend: (body: string) => Promise<boolean>;
  error?: string | null;
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
  const [height, setHeight] = useState(MIN_INPUT_HEIGHT);
  const [sending, setSending] = useState(false);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !sending && !disabled;

  const submit = async () => {
    if (!canSend) return;

    setSending(true);

    try {
      const sent = await onSend(trimmed);

      if (sent) {
        setValue("");
        setHeight(MIN_INPUT_HEIGHT);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        },
      ]}
    >
      {error ? (
        <Text
          style={[styles.error, { color: colors.destructive }]}
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}

      <View style={styles.row}>
        <View
          style={[
            styles.inputShell,
            {
              backgroundColor: colors.card,
            },
          ]}
        >
          <TextInput
            value={value}
            onChangeText={setValue}
            onContentSizeChange={(event) =>
              setHeight(
                Math.min(
                  MAX_INPUT_HEIGHT,
                  Math.max(
                    MIN_INPUT_HEIGHT,
                    Math.ceil(event.nativeEvent.contentSize.height),
                  ),
                ),
              )
            }
            editable={!disabled}
            multiline
            scrollEnabled={height >= MAX_INPUT_HEIGHT}
            maxLength={MAX_LENGTH}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Message"
            submitBehavior="newline"
            style={[
              styles.input,
              Platform.OS === "web"
                ? ({ outlineStyle: "none" } as object)
                : null,
              {
                height,
                color: colors.foreground,
              },
            ]}
          />
        </View>

        <Pressable
          onPress={() => void submit()}
          disabled={!canSend}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => [
            styles.send,
            pressed && canSend && styles.pressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <SendHorizontal
              size={25}
              color={canSend ? colors.primary : colors.mutedForeground}
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
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  inputShell: {
    flex: 1,
    minHeight: control.minTouchTarget,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    ...typography.body,
  },
  send: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  error: {
    ...typography.caption,
    paddingHorizontal: spacing[1],
  },
});
