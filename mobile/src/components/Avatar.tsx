import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { fontFamily, radii, useTheme } from "@/theme";

/**
 * Avatar with an initials fallback.
 *
 * Viewrr user rows arrive with `avatar: string | null`, and a broken or missing
 * image is common enough that the fallback is the default path, not the error
 * path. Initials come from the display name so a row never renders a hole.
 */

type AvatarSize = "sm" | "md" | "lg";

const DIMENSIONS: Record<AvatarSize, { box: number; text: number }> = {
  sm: { box: 32, text: 12 },
  md: { box: 44, text: 15 },
  lg: { box: 64, text: 22 },
};

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "V";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "V";
}

type AvatarProps = {
  name: string;
  uri?: string | null;
  size?: AvatarSize;
  /** Brand ring — used for the signed-in user in the header. */
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Avatar({ name, uri, size = "md", ring = false, style }: AvatarProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const { box, text } = DIMENSIONS[size];

  const showImage = Boolean(uri) && !failed;

  return (
    <View
      style={[
        styles.base,
        {
          width: box,
          height: box,
          borderRadius: radii.full,
          backgroundColor: colors.secondary,
          borderColor: ring ? colors.primaryWashBorder : colors.border,
          borderWidth: ring ? 2 : StyleSheet.hairlineWidth,
        },
        style,
      ]}
      accessibilityLabel={`${name}'s avatar`}
    >
      {showImage ? (
        <Image
          source={{ uri: uri as string }}
          style={styles.image}
          contentFit="cover"
          transition={140}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.initials, { fontSize: text, color: colors.mutedForeground }]}>
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  initials: {
    fontFamily: fontFamily.bodyBold,
    letterSpacing: 0.4,
  },
});
