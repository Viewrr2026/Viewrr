import { Redirect, useRouter } from "expo-router";
import { MailCheck } from "lucide-react-native";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { resendVerification, verifyEmail } from "@/api/auth";
import { Button } from "@/components/Button";
import { Card, CardBody, CardTitle } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { describeVerificationFailure, type AuthFailure } from "@/session/authErrors";
import { useSession } from "@/session/SessionProvider";
import { hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Email verification — PRD 1, Decision 4.
 *
 *   POST /api/auth/mobile/verify-email   { code }  → { verified: true }
 *   POST /api/auth/mobile/resend-verification      → { sent: true }
 *
 * Both are authenticated: registration already returned a Bearer token, so the
 * account is identified by the credential and no email is ever put in the body.
 *
 * Reachability is deliberately narrow. This screen renders only while the
 * session carries `emailVerificationRequired`, which is set by register() and
 * by nothing else — never by cold-start restore. An existing, grandfathered
 * account therefore cannot land here, by construction rather than by a check
 * that could rot. Anyone arriving otherwise is redirected out immediately.
 *
 * The code length is NOT assumed: the contract fixes the body shape (`{ code }`)
 * but not the format, so the field accepts what the user was sent and the
 * server decides. Nothing is faked locally.
 */
export default function VerifyEmail() {
  const router = useRouter();
  const { status, emailVerificationRequired, markEmailVerified, signOut, signingOut } =
    useSession();
  const { colors } = useTheme();

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  const trimmed = code.trim();
  const canSubmit = trimmed.length >= 4 && !submitting;

  const submit = useCallback(async () => {
    if (trimmed.length < 4 || submitting) return;
    setFailure(null);
    setResent(false);
    setSubmitting(true);
    try {
      const result = await verifyEmail(trimmed);
      if (result?.verified !== true) {
        // Never claim success the server did not confirm.
        setFailure(describeVerificationFailure(null));
        return;
      }
      markEmailVerified();
      // The auth-stack guard now lets the session through to the app shell.
      router.replace("/(app)");
    } catch (error) {
      setFailure(describeVerificationFailure(error));
    } finally {
      setSubmitting(false);
    }
  }, [markEmailVerified, router, submitting, trimmed]);

  const resend = useCallback(async () => {
    if (resending) return;
    setFailure(null);
    setResent(false);
    setResending(true);
    try {
      const result = await resendVerification();
      // Only report a send the server actually acknowledged.
      if (result?.sent === true) setResent(true);
      else setFailure(describeVerificationFailure(null));
    } catch (error) {
      setFailure(describeVerificationFailure(error));
    } finally {
      setResending(false);
    }
  }, [resending]);

  // Signed out (or a session torn down mid-flow) — the endpoints need a Bearer.
  if (status !== "signed-in") {
    return <Redirect href="/(auth)/welcome" />;
  }

  // Already verified, or arrived here by deep link on an existing account.
  if (!emailVerificationRequired) {
    return <Redirect href="/(app)" />;
  }

  const fieldError = failure?.fieldLevel ? failure.message : undefined;
  const bannerFailure = failure && !failure.fieldLevel ? failure : null;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Logo size={26} />
        </View>

        <View style={styles.intro}>
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.primaryWash, borderColor: colors.primaryWashBorder },
            ]}
          >
            <MailCheck size={22} color={colors.primary} strokeWidth={2.2} />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Confirm your email</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            We've sent a verification code to the email you signed up with. Enter it to finish
            setting up your account.
          </Text>
        </View>

        <View style={styles.form}>
          <TextField
            label="Verification code"
            value={code}
            onChangeText={(next) => {
              setCode(next);
              if (failure) setFailure(null);
              if (resent) setResent(false);
            }}
            placeholder="Enter your code"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="go"
            editable={!submitting}
            onSubmitEditing={() => void submit()}
            errorText={fieldError}
          />
        </View>

        {resent ? (
          <Card style={styles.resentCard}>
            <CardTitle>New code sent</CardTitle>
            <CardBody>Check your inbox, and your spam folder if it isn't there.</CardBody>
          </Card>
        ) : null}

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
            label={submitting ? "Verifying" : "Verify email"}
            loading={submitting}
            disabled={!canSubmit}
            onPress={() => void submit()}
            accessibilityHint="Confirms your email address"
          />
          <Button
            label={resending ? "Sending" : "Send a new code"}
            variant="outline"
            loading={resending}
            disabled={resending || submitting}
            onPress={() => void resend()}
            accessibilityHint="Emails you another verification code"
          />
          <Pressable
            onPress={() => void signOut()}
            disabled={signingOut}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityState={{ disabled: signingOut }}
            style={({ pressed }) => [styles.signOutRow, pressed && styles.pressed]}
          >
            <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>
              Wrong email? Sign out and start again.
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
  intro: {
    marginTop: spacing[8],
    gap: spacing[3],
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radii.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
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
  resentCard: {
    marginTop: spacing[5],
  },
  notice: {
    marginTop: spacing[5],
  },
  actions: {
    marginTop: "auto",
    paddingBottom: spacing[4],
    gap: spacing[3],
  },
  signOutRow: {
    alignSelf: "center",
    paddingVertical: spacing[1],
  },
  signOutText: {
    ...typography.caption,
    textAlign: "center",
  },
  pressed: {
    opacity: 0.8,
  },
});
