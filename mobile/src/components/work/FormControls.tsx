import { Pressable, StyleSheet, Text, View } from "react-native";
import { radii, spacing, typography, useTheme } from "@/theme";

export function ChoiceChips({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  selected: string | string[];
  onSelect: (value: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={[typography.eyebrow, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <View style={formStyles.row}>
        {options.map((option) => {
          const active = Array.isArray(selected)
            ? selected.includes(option)
            : selected === option;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(option)}
              accessibilityRole="button"
              accessibilityLabel={option}
              accessibilityState={{ selected: active }}
              style={{
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: spacing[3],
                borderRadius: radii.full,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primaryWash : colors.card,
              }}
            >
              <Text
                style={[
                  typography.caption,
                  { color: active ? colors.primary : colors.foreground },
                ]}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FormMessage({
  text,
  error = false,
}: {
  text: string;
  error?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole={error ? "alert" : undefined}
      style={[
        typography.small,
        { color: error ? colors.destructive : colors.mutedForeground },
      ]}
    >
      {text}
    </Text>
  );
}

export const formStyles = StyleSheet.create({
  body: { gap: spacing[5], paddingBottom: spacing[10] },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    alignItems: "center",
  },
  multi: { minHeight: 120, textAlignVertical: "top" },
});
