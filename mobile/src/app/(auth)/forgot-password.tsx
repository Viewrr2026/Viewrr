import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { requestPasswordReset } from "@/api/auth";
import { ApiError } from "@/api/errors";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { spacing, typography, useTheme } from "@/theme";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Enter the email address linked to your Viewrr account.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await requestPasswordReset(cleanEmail);
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.serverMessage ?? cause.userMessage)
          : "We couldn't send the reset email. Please try again shortly.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll keyboard>
      <View style={styles.body}>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {sent ? "Check your email" : "Forgot your password?"}
          </Text>

          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
            {sent
              ? "We've sent a secure password-reset link if that email belongs to a Viewrr account. Open the link, choose a new password, then return to Viewrr and sign in."
              : "Enter the email address linked to your Viewrr account and we'll send you a secure password-reset link."}
          </Text>
        </View>

        {!sent ? (
          <>
            <TextField
              label="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!submitting}
            />

            {error ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                {error}
              </Text>
            ) : null}

            <Button
              label={submitting ? "Sending" : "Send reset link"}
              loading={submitting}
              disabled={submitting}
              onPress={() => void submit()}
            />
          </>
        ) : null}

        <Button
          label="Back to sign in"
          variant="ghost"
          onPress={() => router.replace("/(auth)/sign-in")}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing[4],
    paddingTop: spacing[8],
  },
  copy: {
    gap: spacing[2],
  },
  title: {
    ...typography.h2,
  },
  bodyText: {
    ...typography.body,
  },
  error: {
    ...typography.small,
  },
});
