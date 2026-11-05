import { Pressable, StyleSheet, Text, View } from "react-native";
import type { WorkSection } from "@/components/work/gating";
import { Button } from "@/components/Button";
import { radii, spacing, typography, useTheme } from "@/theme";

export type SectionCounts = Record<WorkSection, number>;

export function WorkSectionTabs({
  value,
  onChange,
  counts,
  role,
}: {
  value: WorkSection;
  onChange: (section: WorkSection) => void;
  counts: SectionCounts;
  role: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing[2] }}>
      <View style={{ flexDirection: "row", gap: spacing[2] }}>
        {(
          [
            ["active", "Active Projects"],
            ["completed", "Completed"],
            ["all", "Total Projects"],
          ] as const
        ).map(([section, label]) => (
          <Pressable
            key={section}
            onPress={() => onChange(section)}
            accessibilityRole="tab"
            accessibilityState={{ selected: value === section }}
            accessibilityLabel={`${label}, ${counts[section]}`}
            style={[
              styles.metric,
              {
                backgroundColor:
                  value === section ? colors.primaryWash : colors.card,
                borderColor: value === section ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                typography.h2,
                {
                  color: value === section ? colors.primary : colors.foreground,
                },
              ]}
            >
              {counts[section]}
            </Text>
            <Text
              style={[typography.caption, { color: colors.mutedForeground }]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Button
        label={`${role === "client" ? "To pay" : "Awaiting payment"} (${counts.awaiting_payment})`}
        variant={value === "awaiting_payment" ? "secondary" : "ghost"}
        onPress={() => onChange("awaiting_payment")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  metric: {
    flex: 1,
    minHeight: 92,
    padding: spacing[3],
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing[1],
    justifyContent: "center",
  },
});
