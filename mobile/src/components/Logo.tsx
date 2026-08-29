import Svg, {
  Defs,
  LinearGradient,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { brand, gradients, radii, spacing } from "@/theme";

/**
 * Viewrr identity, ported from production web rather than redrawn.
 *
 * MARK — client/public/icon-192.png is the live web app icon: a #FF5A1F
 * rounded square with a white "V". There is no SVG source in the repo, so the
 * glyph geometry was traced off that PNG (white pixel runs per row) and is
 * reproduced here as an exact polygon in the icon's own 192×192 coordinate
 * space. Same outline, resolution-independent. scripts/generate-icons.py uses
 * the identical numbers to render the launcher/splash PNGs.
 *
 * WORDMARK — the navbar renders `Viewrr` with the .gradient-text class:
 * linear-gradient(135deg, #FF5A1F 0%, #F59E0B 100%) clipped to the text, in
 * bold Satoshi. Reproduced with an SVG gradient fill, so the mobile wordmark is
 * the same word, case, face and gradient as the website.
 */

/** Traced from client/public/icon-192.png — see scripts/generate-icons.py. */
const V_POINTS = "42,48 66,48 96,115.8 126,48 150,48 107.1,145 84.9,145";
const ICON_CORNER_RADIUS = 42; // in 192-space

type MarkProps = {
  size?: number;
  /** "square" = full app-icon treatment; "glyph" = bare V, inherits colour. */
  variant?: "square" | "glyph";
  /** Glyph colour when variant="glyph". */
  color?: string;
};

export function ViewrrMark({ size = 32, variant = "square", color = brand.orange }: MarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 192 192" accessibilityLabel="Viewrr">
      {variant === "square" ? (
        <>
          <Rect
            x={0}
            y={0}
            width={192}
            height={192}
            rx={ICON_CORNER_RADIUS}
            ry={ICON_CORNER_RADIUS}
            fill={brand.orange}
          />
          <Polygon points={V_POINTS} fill="#FFFFFF" />
        </>
      ) : (
        <Polygon points={V_POINTS} fill={color} />
      )}
    </Svg>
  );
}

type WordmarkProps = {
  /** Cap height target in points. Web navbar uses text-2xl (24pt) bold. */
  fontSize?: number;
};

/** "Viewrr" in the web's brand gradient — .gradient-text equivalent. */
export function ViewrrWordmark({ fontSize = 24 }: WordmarkProps) {
  const width = fontSize * 4.1;
  const height = fontSize * 1.32;

  return (
    <Svg width={width} height={height} accessibilityLabel="Viewrr">
      <Defs>
        {/* 135deg, matching .gradient-text */}
        <LinearGradient id="viewrrWordmark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradients.wordmark[0]} />
          <Stop offset="1" stopColor={gradients.wordmark[1]} />
        </LinearGradient>
      </Defs>
      <SvgText
        x={0}
        y={fontSize}
        fill="url(#viewrrWordmark)"
        fontSize={fontSize}
        fontFamily="Satoshi-900"
        letterSpacing={-0.4}
      >
        Viewrr
      </SvgText>
    </Svg>
  );
}

type LogoProps = {
  /** Mark size in points. */
  size?: number;
  /** Show the gradient "Viewrr" wordmark beside the mark. */
  wordmark?: boolean;
  markVariant?: MarkProps["variant"];
  markColor?: string;
  style?: StyleProp<ViewStyle>;
};

/** Lockup: app-icon mark + gradient wordmark, as the web navbar reads. */
export function Logo({
  size = 32,
  wordmark = false,
  markVariant = "square",
  markColor,
  style,
}: LogoProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.mark, markVariant === "square" && { borderRadius: radii.lg }]}>
        <ViewrrMark size={size} variant={markVariant} color={markColor} />
      </View>
      {wordmark ? <ViewrrWordmark fontSize={size * 0.72} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  mark: {
    overflow: "hidden",
  },
});
