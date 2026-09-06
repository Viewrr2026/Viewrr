import { Maximize2, SendHorizontal, X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { control, hitSlop, radii, spacing, typography, useTheme } from "@/theme";

const MIN_INPUT_HEIGHT = 44;
const MAX_INPUT_HEIGHT = 164;
const EXPAND_AFTER_HEIGHT = 92;
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
  const [contentHeight, setContentHeight] = useState(MIN_INPUT_HEIGHT);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !sending && !disabled;
  const scrollEnabled = contentHeight > MAX_INPUT_HEIGHT;
  const showExpand = contentHeight > EXPAND_AFTER_HEIGHT;

  const handleContentSizeChange = (measuredHeight: number) => {
    const measured = Math.ceil(measuredHeight);
    const nextHeight = Math.min(
      MAX_INPUT_HEIGHT,
      Math.max(MIN_INPUT_HEIGHT, measured),
    );

    // Updating height causes iOS to emit content-size again. Ignore sub-pixel /
    // 1pt noise so typing does not create a render loop.
    if (Math.abs(nextHeight - height) >= 1) {
      setHeight(nextHeight);
    }

    if (Math.abs(measured - contentHeight) >= 1) {
      setContentHeight(measured);
    }
  };

  const submit = async (): Promise<boolean> => {
    if (!canSend) return false;

    setSending(true);

    try {
      const sent = await onSend(trimmed);

      if (sent) {
        setValue("");
        setHeight(MIN_INPUT_HEIGHT);
        setContentHeight(MIN_INPUT_HEIGHT);
      }

      return sent;
    } finally {
      setSending(false);
    }
  };

  const submitExpanded = async () => {
    const sent = await submit();

    if (sent) {
      setExpanded(false);
    }
  };

  return (
    <>
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
                backgroundColor: colors.secondary,
              },
            ]}
          >
            <TextInput
              value={value}
              onChangeText={setValue}
              onContentSizeChange={(event) =>
                handleContentSizeChange(
                  event.nativeEvent.contentSize.height,
                )
              }
              editable={!disabled}
              multiline
              scrollEnabled={scrollEnabled}
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
                  paddingRight: showExpand ? control.minTouchTarget : spacing[3],
                },
              ]}
            />

            {showExpand ? (
              <Pressable
                onPress={() => setExpanded(true)}
                hitSlop={hitSlop}
                accessibilityRole="button"
                accessibilityLabel="Expand message editor"
                style={({ pressed }) => [
                  styles.expand,
                  pressed && styles.pressed,
                ]}
              >
                <Maximize2
                  size={18}
                  color={colors.mutedForeground}
                  strokeWidth={2}
                />
              </Pressable>
            ) : null}
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

      <Modal
        visible={expanded}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setExpanded(false)}
      >
        <SafeAreaView
          style={[styles.expandedScreen, { backgroundColor: colors.background }]}
          edges={["top", "bottom"]}
        >
          <View
            style={[
              styles.expandedHeader,
              { borderBottomColor: colors.border },
            ]}
          >
            <Pressable
              onPress={() => setExpanded(false)}
              hitSlop={hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Close expanded message editor"
              style={({ pressed }) => [
                styles.expandedHeaderButton,
                pressed && styles.pressed,
              ]}
            >
              <X size={23} color={colors.foreground} strokeWidth={2.1} />
            </Pressable>

            <Text style={[styles.expandedTitle, { color: colors.foreground }]}>
              Write message
            </Text>

            <View style={styles.expandedHeaderSpacer} />
          </View>

          <KeyboardAvoidingView
            style={styles.expandedBody}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={0}
          >
            <TextInput
              value={value}
              onChangeText={setValue}
              editable={!disabled}
              multiline
              maxLength={MAX_LENGTH}
              autoFocus
              placeholder={placeholder}
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel="Expanded message"
              submitBehavior="newline"
              style={[
                styles.expandedInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.secondary,
                },
              ]}
            />

            {error ? (
              <Text
                style={[styles.expandedError, { color: colors.destructive }]}
                accessibilityRole="alert"
              >
                {error}
              </Text>
            ) : null}

            <View
              style={[
                styles.expandedFooter,
                { borderTopColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.characterCount,
                  { color: colors.mutedForeground },
                ]}
              >
                {value.length}/{MAX_LENGTH}
              </Text>

              <Pressable
                onPress={() => void submitExpanded()}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: !canSend }}
                style={({ pressed }) => [
                  styles.expandedSend,
                  {
                    backgroundColor: canSend
                      ? colors.primary
                      : colors.secondary,
                  },
                  pressed && canSend && styles.pressed,
                ]}
              >
                {sending ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primaryForeground}
                  />
                ) : (
                  <SendHorizontal
                    size={20}
                    color={
                      canSend
                        ? colors.primaryForeground
                        : colors.mutedForeground
                    }
                    strokeWidth={2.2}
                  />
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
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
  inputShell: {
    flex: 1,
    minHeight: MIN_INPUT_HEIGHT,
    borderRadius: radii.lg,
    position: "relative",
    overflow: "hidden",
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingLeft: spacing[3],
    paddingVertical: spacing[2],
    ...typography.body,
  },
  expand: {
    position: "absolute",
    top: spacing[1],
    right: spacing[1],
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
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
  expandedScreen: {
    flex: 1,
  },
  expandedHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[2],
  },
  expandedHeaderButton: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  expandedHeaderSpacer: {
    width: control.minTouchTarget,
  },
  expandedTitle: {
    flex: 1,
    textAlign: "center",
    ...typography.body,
    fontWeight: "700",
  },
  expandedBody: {
    flex: 1,
    minHeight: 0,
  },
  expandedInput: {
    flex: 1,
    margin: spacing[4],
    borderRadius: radii.lg,
    padding: spacing[4],
    textAlignVertical: "top",
    ...typography.body,
  },
  expandedError: {
    ...typography.caption,
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  expandedFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  characterCount: {
    ...typography.caption,
  },
  expandedSend: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
