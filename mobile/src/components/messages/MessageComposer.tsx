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

const MIN_INPUT_HEIGHT = 44;
const MAX_INPUT_HEIGHT = 116;
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
        <TextInput
            value={value}
            onChangeText={setValue}
            editable={!disabled}
            multiline
            scrollEnabled
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
                backgroundColor: colors.secondary,
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
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -spacing[4],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    borderRadius: radii.lg,
    textAlignVertical: "top",
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
