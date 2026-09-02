import { useRouter } from "expo-router";
import { CheckCircle, Sparkles, Zap } from "lucide-react-native";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { Pill } from "@/components/Pill";
import { Screen } from "@/components/Screen";
import { APP_ENV, isProduction } from "@/config/env";
import { gradients, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Signed-out entry screen.
 *
 * Content and treatment come from the production landing page
 * (client/src/pages/Landing.tsx): the launch pill, the "Hire trusted UK creative
 * professionals in minutes." headline with `gradient-text` on the middle line,
 * the same subhead, and the three how-it-works steps with their lucide icons.
 * Layout is native — a single column with the CTA stack pinned to the bottom
 * instead of the site's video hero.
 */

const STEPS = [
  {
    icon: Sparkles,
    title: "Describe your project",
    body: "Tell us what you need in plain English — we read the brief.",
  },
  {
    icon: Zap,
    title: "Get matched instantly",
    body: "The right creatives by specialism, style, rate and availability.",
  },
  {
    icon: CheckCircle,
    title: "Review portfolios & hire",
    body: "Real work, real reviews, message and book in one place.",
  },
] as const;

/** "UK creative" in .gradient-text, exactly as the web headline renders it. */
function GradientHeadlineLine({ fontSize }: { fontSize: number }) {
  return (
    <Svg width={fontSize * 6.6} height={fontSize * 1.26}>
      <Defs>
        <LinearGradient id="heroGradient" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradients.wordmark[0]} />
          <Stop offset="1" stopColor={gradients.wordmark[1]} />
        </LinearGradient>
      </Defs>
      <SvgText
        x={0}
        y={fontSize}
        fill="url(#heroGradient)"
        fontSize={fontSize}
        fontFamily="ClashDisplay-600"
        letterSpacing={-0.8}
      >
        UK creative
      </SvgText>
    </Svg>
  );
}

export default function Welcome() {
  const router = useRouter();
  const { colors } = useTheme();
  const headlineSize = 30;

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Logo size={30} wordmark />
        {isProduction ? null : <Pill label={APP_ENV} tone="neutral" />}
      </View>

      <View style={styles.hero}>
        <View style={[styles.launchPill, { backgroundColor: colors.primaryWash, borderColor: colors.primaryWashBorder }]}>
          <View style={[styles.launchDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.launchText, { color: colors.primary }]}>
            NOW OPEN — UK CREATIVE TALENT
          </Text>
        </View>

        <View style={styles.headlineBlock}>
          <Text style={[styles.headline, { color: colors.foreground, fontSize: headlineSize }]}>
            Hire trusted
          </Text>
          <GradientHeadlineLine fontSize={headlineSize} />
          <Text style={[styles.headline, { color: colors.foreground, fontSize: headlineSize }]}>
            professionals in minutes.
          </Text>
        </View>

        <Text style={[styles.subhead, { color: colors.mutedForeground }]}>
          Videographers, photographers, editors and marketers — all vetted, all based in the UK.
          Post a brief and hear back today.
        </Text>
      </View>

      <View style={styles.steps}>
        {STEPS.map(({ icon: Icon, title, body }) => (
          <View key={title} style={styles.step}>
            <View
              style={[
                styles.stepIcon,
                { backgroundColor: colors.primaryWash, borderColor: colors.primaryWashBorder },
              ]}
            >
              <Icon size={20} color={colors.primary} strokeWidth={2.2} />
            </View>
            <View style={styles.stepCopy}>
              <Text style={[styles.stepTitle, { color: colors.foreground }]}>{title}</Text>
              <Text style={[styles.stepBody, { color: colors.mutedForeground }]}>{body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Button label="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
        <Button
          label="Create an account"
          variant="outline"
          onPress={() => router.push("/(auth)/sign-up")}
          accessibilityHint="Creates a new Viewrr account on this device"
        />
        <Text style={[styles.legal, { color: colors.mutedForeground }]}>
          Signing in or creating an account confirms you accept Viewrr's Terms and Privacy
          Policy.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing[3],
  },
  hero: {
    marginTop: spacing[10],
    gap: spacing[4],
  },
  launchPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing[2],
    borderRadius: radii.full,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1.5],
  },
  launchDot: {
    width: 6,
    height: 6,
    borderRadius: radii.full,
  },
  launchText: {
    ...typography.eyebrow,
  },
  headlineBlock: {
    gap: 0,
  },
  headline: {
    fontFamily: typography.display.fontFamily,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  subhead: {
    ...typography.body,
    maxWidth: 340,
  },
  steps: {
    marginTop: spacing[8],
    gap: spacing[5],
  },
  step: {
    flexDirection: "row",
    gap: spacing[3],
    alignItems: "flex-start",
  },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepCopy: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    ...typography.smallBold,
  },
  stepBody: {
    ...typography.small,
  },
  actions: {
    marginTop: "auto",
    paddingTop: spacing[10],
    gap: spacing[3],
  },
  legal: {
    ...typography.caption,
    textAlign: "center",
    marginTop: spacing[1],
  },
});
