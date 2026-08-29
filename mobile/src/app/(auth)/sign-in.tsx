import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Card, CardBody, CardTitle } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { useSession } from "@/session/SessionProvider";
import { hitSlop, spacing, typography, useTheme } from "@/theme";

/**
 * Sign-in PLACEHOLDER.
 *
 * The form is real UI; the submit path is not wired to any endpoint. Native
 * sign-in waits on a separate reviewed native-auth endpoint with a Bearer
 * credential. The existing web POST /api/auth/login is untouched and keeps its
 * HttpOnly-cookie model.
 */
export default function SignIn() {
  const router = useRouter();
  const { signInPlaceholder } = useSession();
  const { colors } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = email.trim().length > 3 && password.length >= 8;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backRow}
          >
            <ChevronLeft size={20} color={colors.mutedForeground} strokeWidth={2.2} />
            <Text style={[styles.back, { color: colors.mutedForeground }]}>Back</Text>
          </Pressable>
          <Logo size={26} />
        </View>

        <View style={styles.intro}>
          <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Sign in to pick up where you left off.
          </Text>
        </View>

        <View style={styles.form}>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@studio.co.uk"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
            helperText="Minimum 8 characters."
          />
        </View>

        <Card tone="brand" style={styles.notice}>
          <CardTitle>Native sign-in pending review</CardTitle>
          <CardBody>
            Credentials are not sent anywhere yet. Native authentication ships against its own
            reviewed endpoint — web cookie sign-in is unchanged.
          </CardBody>
        </Card>

        <View style={styles.actions}>
          <Button
            label="Sign in"
            disabled
            accessibilityHint="Disabled until the native auth endpoint is approved"
          />
          <Button
            label="Preview the home shell"
            variant="outline"
            onPress={() => signInPlaceholder()}
            accessibilityHint="Opens the authenticated shell with placeholder data"
          />
          {canSubmit ? (
            <Text style={[styles.ready, { color: colors.mutedForeground }]}>
              Form validation passes — submit path intentionally off.
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing[3],
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginLeft: -spacing[1],
  },
  back: {
    ...typography.smallMedium,
  },
  intro: {
    marginTop: spacing[8],
    gap: spacing[2],
  },
  title: {
    ...typography.h1,
  },
  subtitle: {
    ...typography.body,
  },
  form: {
    marginTop: spacing[8],
    gap: spacing[4],
  },
  notice: {
    marginTop: spacing[6],
  },
  actions: {
    marginTop: "auto",
    paddingBottom: spacing[4],
    gap: spacing[3],
  },
  ready: {
    ...typography.caption,
    textAlign: "center",
  },
});
