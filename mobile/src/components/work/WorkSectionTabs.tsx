import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { WorkSection } from "@/components/work/gating";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * The three Work sections, as a segmented control.
 *
 * Counts are always real: they are the length of the caller's own grouped
 * arrays, so a section showing 0 genuinely holds nothing. A section with
 * nothing in it stays visible and selectable — hiding it would make the tab
 * strip jump around as work moves between states, and "0" is information.
 */

export type SectionCounts = Record<WorkSection, number>;

const ORDER: readonly WorkSection[] = ["active", "awaiting_payment", "completed"] as const;

/** Labels differ by role only where the role changes what the state means. */
function labelFor(section: WorkSection, role: "client" | "freelancer" | "admin"): string {
  switch (section) {
    case "active":
      return "Active";
    case "awaiting_payment":
      return role === "client" ? "To pay" : "Awaiting payment";
    case "completed":
      return "Completed";
  }
}

type WorkSectionTabsProps = {
  value: WorkSection;
  onChange: (section: WorkSection) => void;
  counts: SectionCounts;
  role: "client" | "freelancer" | "admin";
};

export function WorkSectionTabs({ value, onChange, counts, role }: WorkSectionTabsProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {ORDER.map((section) => {
        const active = value === section;
        const label = labelFor(section, role);
        const count = counts[section];

        return (
          <Pressable
            key={section}
            onPress={() => onChange(section)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}, ${count} ${count === 1 ? "project" : "projects"}`}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: active ? colors.primary : colors.secondary,
                borderColor: active ? colors.primary : colors.border,
              },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: active ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              {label}
            </Text>
            <View
              style={[
                styles.count,
                {
                  backgroundColor: active ? "rgba(255,255,255,0.22)" : colors.background,
                  borderColor: active ? "transparent" : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.countLabel,
                  { color: active ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {count}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing[2],
    paddingRight: spacing[4],
    paddingBottom: spacing[1],
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: 36,
    paddingHorizontal: spacing[4],
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    ...typography.caption,
  },
  count: {
    minWidth: 22,
    alignItems: "center",
    paddingHorizontal: spacing[1.5],
    paddingVertical: 1,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  countLabel: {
    ...typography.captionBold,
  },
  pressed: {
    opacity: 0.75,
  },
});
