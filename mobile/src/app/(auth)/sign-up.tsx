import { useRouter } from "expo-router";
import { Briefcase, Check, ChevronLeft, Sparkles } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  PASSWORD_MIN_LENGTH,
  describePasswordProblem,
  looksLikeEmail,
  type RegistrationRole,
} from "@/api/auth";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Logo } from "@/components/Logo";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { describeRegistrationFailure, type AuthFailure } from "@/session/authErrors";
import { useSession } from "@/session/SessionProvider";
import { hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Native registration — PRD 1, Decision 4.
 *
 * Submits POST /api/auth/mobile/register through SessionProvider.register(),
 * which reuses the same credential tail as sign-in: the returned Bearer token
 * is persisted in the Keychain / Keystore and nothing else is stored.
 *
 * Validation here MIRRORS the server policy (min 10 characters, not a common
 * password, plausible email) purely to save a round-trip. The server remains
 * authoritative, and its rejections are shown through
 * describeRegistrationFailure, which never surfaces a raw response body.
 *
 * Role is a two-way choice on purpose. Viewrr's account vocabulary is
 * client | freelancer | admin; admin is never self-service, so the form offers
 * Creative (freelancer) and Client (client) and nothing else.
 */

const ROLES: readonly {
  value: RegistrationRole;
  title: string;
  body: string;
  icon: typeof Sparkles;
}[] = [
  {
    value: "freelancer",
    title: "Creative",
    body: "I take on work — video, photo, editing, marketing.",
    icon: Sparkles,
  },
  {
    value: "client",
    title: "Client",
    body: "I'm hiring creatives for briefs and projects.",
    icon: Briefcase,
  },
];

export default function SignUp() {
  const router = useRouter();
  const { register } = useSession();
  const { colors } = useTheme();

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RegistrationRole | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  /** Local policy messages, shown only once the user has attempted a submit. */
  const [touched, setTouched] = useState(false);

  const trimmedName = name.trim();
  const nameProblem = trimmedName.length < 2 ? "Enter the name you work under." : null;
  const emailProblem = looksLikeEmail(email) ? null : "Enter a valid email address.";
  const passwordProblem = describePasswordProblem(password);
  const roleProblem = role === null ? "Choose how you'll use Viewrr." : null;

  const valid = !nameProblem && !emailProblem && !passwordProblem && !roleProblem;

  const clearFailure = useCallback(() => {
    setFailure((current) => (current ? null : current));
  }, []);

  const submit = useCallback(async () => {
    setTouched(true);
    if (!valid || role === null || submitting) return;

    setFailure(null);
    setSubmitting(true);
    try {
      await register({ name: trimmedName, email, password, role });
      // The account exists and the session is live. Verification is required for
      // every new account (Decision 4), so go straight to the code screen; the
      // auth-stack guard holds the user here until it is done.
      router.replace("/(auth)/verify-email");
    } catch (error) {
      setFailure(describeRegistrationFailure(error));
    } finally {
      setSubmitting(false);
    }
  }, [email, password, register, role, router, submitting, trimmedName, valid]);

  const emailError =
    (touched && emailProblem) || (failure?.reason === "conflict" ? failure.message : undefined) ||
    undefined;
  const bannerFailure = failure && !failure.fieldLevel ? failure : null;

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

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text style={[styles.title, { color: colors.foreground }]}>Create your account</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              One account, whether you're hiring or being hired.
            </Text>
          </View>

          <View style={styles.form}>
            <TextField
              label="Name"
              value={name}
              onChangeText={(next) => {
                setName(next);
                clearFailure();
              }}
              placeholder="Alex Morgan"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              editable={!submitting}
              onSubmitEditing={() => emailRef.current?.focus()}
              errorText={touched && nameProblem ? nameProblem : undefined}
            />

            <TextField
              ref={emailRef}
              label="Email"
              value={email}
              onChangeText={(next) => {
                setEmail(next);
                clearFailure();
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
              helperText="We'll send a verification code here."
              errorText={emailError}
            />

            <TextField
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={(next) => {
                setPassword(next);
                clearFailure();
              }}
              placeholder="••••••••••"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              editable={!submitting}
              onSubmitEditing={() => void submit()}
              helperText={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              errorText={touched && passwordProblem ? passwordProblem : undefined}
            />
          </View>

          <View style={styles.roles}>
            <Text style={[styles.roleHeading, { color: colors.mutedForeground }]}>
              HOW WILL YOU USE VIEWRR?
            </Text>
            {ROLES.map(({ value, title, body, icon: Icon }) => {
              const selected = role === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    setRole(value);
                    clearFailure();
                  }}
                  disabled={submitting}
                  accessibilityRole="radio"
                  accessibilityLabel={title}
                  accessibilityHint={body}
                  accessibilityState={{ selected, disabled: submitting }}
                  style={({ pressed }) => [
                    styles.role,
                    {
                      backgroundColor: selected ? colors.primaryWash : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.roleIcon,
                      {
                        backgroundColor: colors.primaryWash,
                        borderColor: colors.primaryWashBorder,
                      },
                    ]}
                  >
                    <Icon size={18} color={colors.primary} strokeWidth={2.2} />
                  </View>
                  <View style={styles.roleCopy}>
                    <Text style={[styles.roleTitle, { color: colors.foreground }]}>{title}</Text>
                    <Text style={[styles.roleBody, { color: colors.mutedForeground }]}>
                      {body}
                    </Text>
                  </View>
                  {selected ? (
                    <Check size={18} color={colors.primary} strokeWidth={2.4} />
                  ) : null}
                </Pressable>
              );
            })}
            {touched && roleProblem ? (
              <Text style={[styles.roleError, { color: colors.destructive }]}>{roleProblem}</Text>
            ) : null}
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
              label={submitting ? "Creating account" : "Create account"}
              loading={submitting}
              disabled={submitting}
              onPress={() => void submit()}
              accessibilityHint="Creates your Viewrr account"
            />
            <Pressable
              onPress={() => router.replace("/(auth)/sign-in")}
              hitSlop={hitSlop}
              accessibilityRole="link"
              accessibilityLabel="Already have an account? Sign in"
              style={({ pressed }) => [styles.switchRow, pressed && styles.pressed]}
            >
              <Text style={[styles.switchText, { color: colors.mutedForeground }]}>
                Already have an account?{" "}
                <Text style={{ color: colors.primary }}>Sign in</Text>
              </Text>
            </Pressable>
            <Text style={[styles.legal, { color: colors.mutedForeground }]}>
              Creating an account confirms you accept Viewrr's Terms and Privacy Policy.
            </Text>
          </View>
        </ScrollView>
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
  body: {
    paddingBottom: spacing[8],
  },
  intro: {
    marginTop: spacing[6],
    gap: spacing[2],
  },
  title: {
    ...typography.h1,
  },
  subtitle: {
    ...typography.body,
  },
  form: {
    marginTop: spacing[6],
    gap: spacing[4],
  },
  roles: {
    marginTop: spacing[6],
    gap: spacing[2],
  },
  roleHeading: {
    ...typography.eyebrow,
    marginBottom: spacing[1],
  },
  role: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing[4],
  },
  roleIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  roleCopy: {
    flex: 1,
    gap: 2,
  },
  roleTitle: {
    ...typography.smallBold,
  },
  roleBody: {
    ...typography.caption,
  },
  roleError: {
    ...typography.caption,
  },
  pressed: {
    opacity: 0.8,
  },
  notice: {
    marginTop: spacing[5],
  },
  actions: {
    marginTop: spacing[8],
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
  legal: {
    ...typography.caption,
    textAlign: "center",
  },
});
