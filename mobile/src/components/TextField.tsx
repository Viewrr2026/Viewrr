import { useState, type Ref } from "react";
import { Platform, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { control, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Input ported from client/src/components/ui/input.tsx:
 *   rounded-md, 1px border-input, bg-background, placeholder:text-muted-foreground,
 *   focus ring on --ring (brand orange), disabled:opacity-50.
 *
 * Mobile adaptations: 48pt height (web h-9 = 36pt) and a 2px focus border in
 * place of the web's outline ring, which has no native equivalent.
 */

type TextFieldProps = TextInputProps & {
  label: string;
  helperText?: string;
  errorText?: string;
  /**
   * Forwarded to the underlying TextInput so a form can move focus between
   * fields (React 19 passes `ref` to function components as a normal prop).
   */
  ref?: Ref<TextInput>;
};

export function TextField({ label, helperText, errorText, style, ref, ...inputProps }: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(errorText);

  const borderColor = hasError ? colors.destructive : focused ? colors.ring : colors.input;

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <TextInput
        ref={ref}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={label}
        style={[
          styles.input,
          // react-native-web draws the browser's own focus ring on top of the
          // themed border; the brand ring below is the intended treatment.
          Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
          {
            backgroundColor: colors.background,
            color: colors.foreground,
            borderColor,
            borderWidth: focused || hasError ? 2 : 1,
          },
          style,
        ]}
      />
      {hasError ? (
        <Text style={[styles.helper, { color: colors.destructive }]}>{errorText}</Text>
      ) : helperText ? (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing[2],
  },
  label: {
    ...typography.eyebrow,
  },
  input: {
    minHeight: control.height,
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    ...typography.body,
  },
  helper: {
    ...typography.caption,
  },
});
