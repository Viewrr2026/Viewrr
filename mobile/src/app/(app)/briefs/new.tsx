import { useRouter } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import {
  BRIEF_CATEGORIES,
  BUDGET_TYPES,
  DURATIONS,
  createBrief,
  emptyBrief,
} from "@/api/briefBoard";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import {
  ChoiceChips,
  FormMessage,
  formStyles,
} from "@/components/work/FormControls";
import { useFormAction } from "@/hooks/useFormAction";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

export default function NewBrief() {
  const router = useRouter();
  const { user } = useSession();
  const { colors } = useTheme();
  const [form, setForm] = useState(emptyBrief);
  const { busy, error, run } = useFormAction();
  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  return (
    <Screen scroll keyboard>
      <AppHeader title="Post a Brief" back />
      {user?.role !== "client" ? (
        <FormMessage text="Sign in with a client account to post a brief." />
      ) : (
        <View style={formStyles.body}>
          <FormMessage text="Tell creatives what you need. Your brief will appear on the app and the website." />
          <TextField
            label="Brief title"
            value={form.title}
            onChangeText={(value) => set("title", value)}
          />
          <ChoiceChips
            label="Categories"
            options={BRIEF_CATEGORIES}
            selected={form.categories}
            onSelect={(value) =>
              set(
                "categories",
                form.categories.includes(value)
                  ? form.categories.filter((item) => item !== value)
                  : [...form.categories, value],
              )
            }
          />
          <TextField
            label="Description"
            helperText="At least 50 characters"
            multiline
            style={formStyles.multi}
            value={form.description}
            onChangeText={(value) => set("description", value)}
          />
          <TextField
            label="Location"
            placeholder="City or Remote"
            value={form.location}
            onChangeText={(value) => set("location", value)}
          />
          <View style={formStyles.row}>
            <FormMessage text="Remote work is welcome" />
            <Switch
              accessibilityLabel="Remote work is welcome"
              value={form.remote}
              onValueChange={(value) => set("remote", value)}
              trackColor={{ true: colors.primary }}
            />
          </View>
          <TextField
            label="Start date (optional)"
            placeholder="YYYY-MM-DD"
            value={form.startDate}
            onChangeText={(value) => set("startDate", value)}
          />
          <ChoiceChips
            label="Duration (optional)"
            options={DURATIONS}
            selected={form.duration}
            onSelect={(value) =>
              set("duration", value === form.duration ? "" : value)
            }
          />
          <ChoiceChips
            label="Budget type"
            options={BUDGET_TYPES}
            selected={form.budgetType}
            onSelect={(value) => set("budgetType", value)}
          />
          <TextField
            label="Minimum budget (£, optional)"
            keyboardType="decimal-pad"
            value={form.budgetMin}
            onChangeText={(value) => set("budgetMin", value)}
          />
          <TextField
            label="Maximum budget (£, optional)"
            keyboardType="decimal-pad"
            value={form.budgetMax}
            onChangeText={(value) => set("budgetMax", value)}
          />
          <TextField
            label="Requirements (optional)"
            multiline
            style={formStyles.multi}
            value={form.requirements}
            onChangeText={(value) => set("requirements", value)}
          />
          {error ? <FormMessage error text={error} /> : null}
          <Button
            label="Post a Brief"
            loading={busy}
            onPress={() =>
              void run(async () => {
                const brief = await createBrief(form);
                router.replace({
                  pathname: "/(app)/briefs/[briefId]",
                  params: { briefId: String(brief.id) },
                });
              })
            }
          />
        </View>
      )}
    </Screen>
  );
}
