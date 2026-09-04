import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { describeAuthFailure, type AuthFailure } from "@/session/authErrors";
import { useSession } from "@/session/SessionProvider";
import { hitSlop, spacing, typography, useTheme } from "@/theme";

/**
 * Native sign-in — PRD-019.
 *
 * Submits to POST /api/auth/mobile/login through SessionProvider, which stores
 * the returned Bearer token in the Keychain / Keystore. The web platform's
 * HttpOnly cookie login (POST /api/auth/login) is untouched.
 *
 * Failure copy comes from describeAuthFailure, which never surfaces a raw
 * response body, URL or credential.
 */
export default function SignIn() {
  const router = useRouter();
  const { signIn } = useSession();
  const { colors } = useTheme();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  const canSubmit = email.trim().length > 3 && password.length >= 8 && !submitting;

  const submit = useCallback(async () => {
    if (email.trim().length < 4 || password.length < 8 || submitting) return;
    setFailure(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      // On success the auth-stack guard redirects into (app); no imperative nav.
    } catch (error) {
      setFailure(describeAuthFailure(error));
    } finally {
      setSubmitting(false);
    }
  }, [email, password, signIn, submitting]);

  const bannerFailure = failure && !failure.fieldLevel ? failure : null;
  const fieldError = failure?.fieldLevel ? failure.message : undefined;

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
            onChangeText={(next) => {
              setEmail(next);
              if (failure) setFailure(null);
            }}
            placeholder="you@studio.co.uk"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            editable={!submitting}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextField
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={(next) => {
              setPassword(next);
              if (failure) setFailure(null);
            }}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            editable={!submitting}
            onSubmitEditing={() => void submit()}
            helperText="Minimum 8 characters."
            errorText={fieldError}
          />

          <Button
            label="Forgot password?"
            variant="ghost"
            onPress={() => router.push("/(auth)/forgot-password")}
          />
        </View>

        {bannerFailure ? (
          <View style={styles.notice}>
            <ErrorState
              inline
              title={bannerFailure.title}
              message={bannerFailure.message}
              onRetry={bannerFailure.reason === "credentials" ? undefined : () => void submit()}
              retryLabel="Try again"
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={submitting ? "Signing in" : "Sign in"}
            loading={submitting}
            disabled={!canSubmit}
            onPress={() => void submit()}
            accessibilityHint="Signs in to your Viewrr account"
          />
          <Pressable
            onPress={() => router.replace("/(auth)/sign-up")}
            hitSlop={hitSlop}
            accessibilityRole="link"
            accessibilityLabel="New to Viewrr? Create an account"
            style={({ pressed }) => [styles.switchRow, pressed && styles.pressed]}
          >
            <Text style={[styles.switchText, { color: colors.mutedForeground }]}>
              New to Viewrr? <Text style={{ color: colors.primary }}>Create an account</Text>
            </Text>
          </Pressable>
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
  switchRow: {
    alignSelf: "center",
    paddingVertical: spacing[1],
  },
  switchText: {
    ...typography.small,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.8,
  },
});
