import { Moon, Sun } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card, CardBody, CardLabel } from "@/components/Card";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { Screen } from "@/components/Screen";
import { radii, spacing, typography, useTheme } from "@/theme";

export default function Profile() {
  const { colors, scheme, isSystem, toggle, useSystem } = useTheme();

  return (
    <Screen scroll edges={["top", "left", "right"]}>
      <PlaceholderPanel
        title="Your profile"
        body="Your Viewrr profile, accreditation and settings will live here."
      />

      {/* Appearance control mirrors the Sun/Moon toggle in the web navbar. */}
      <Card style={styles.card}>
        <CardLabel>Appearance</CardLabel>
        <CardBody>
          {isSystem
            ? `Following your device setting (${scheme}).`
            : `Set to ${scheme} for this session.`}
        </CardBody>
        <View style={styles.row}>
          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            style={[styles.toggle, { borderColor: colors.border, backgroundColor: colors.secondary }]}
          >
            {scheme === "dark" ? (
              <Sun size={18} color={colors.foreground} strokeWidth={2.2} />
            ) : (
              <Moon size={18} color={colors.foreground} strokeWidth={2.2} />
            )}
            <Text style={[styles.toggleLabel, { color: colors.foreground }]}>
              {scheme === "dark" ? "Light" : "Dark"}
            </Text>
          </Pressable>
          {isSystem ? null : (
            <Pressable
              onPress={useSystem}
              accessibilityRole="button"
              accessibilityLabel="Follow device appearance"
              style={[styles.toggle, { borderColor: colors.border }]}
            >
              <Text style={[styles.toggleLabel, { color: colors.mutedForeground }]}>
                Use device
              </Text>
            </Pressable>
          )}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing[4],
  },
  row: {
    flexDirection: "row",
    gap: spacing[2],
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minHeight: 44,
    paddingHorizontal: spacing[4],
    borderRadius: radii.full,
    borderWidth: 1,
  },
  toggleLabel: {
    ...typography.smallMedium,
  },
});
