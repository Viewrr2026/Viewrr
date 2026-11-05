import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  emptyProject,
  projectTerms,
  sendProjectInvitation,
  PROJECT_CATEGORIES,
  TIMELINES,
  type Connection,
} from "@/api/projectInvitations";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Card, CardTitle } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { ConnectionPicker } from "@/components/work/ConnectionPicker";
import {
  ChoiceChips,
  FormMessage,
  formStyles,
} from "@/components/work/FormControls";
import { useFormAction } from "@/hooks/useFormAction";

export default function NewProject() {
  const router = useRouter();
  const [step, setStep] = useState<"type" | "details" | "recipient">("type");
  const [form, setForm] = useState(emptyProject);
  const [recipient, setRecipient] = useState<Connection | null>(null);
  const { busy, error, run } = useFormAction();
  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }
  return (
    <Screen scroll keyboard>
      <AppHeader title="Create Project" back />
      <View style={formStyles.body}>
        {step === "type" ? (
          <>
            <FormMessage text="Start a private project with one of your connections." />
            <Card>
              <CardTitle>One-off project</CardTitle>
              <FormMessage text="Agree a provisional estimate and plan for a single project." />
              <Button
                label="Create one-off project"
                onPress={() => setStep("details")}
              />
            </Card>
            <Card>
              <CardTitle>Retainer</CardTitle>
              <FormMessage text="Plan ongoing work with cycles, deliverables and payment terms." />
              <Button
                label="Create retainer"
                variant="outline"
                onPress={() => router.push("/(app)/work/new-retainer")}
              />
            </Card>
          </>
        ) : step === "details" ? (
          <>
            <TextField
              label="Project title"
              value={form.title}
              onChangeText={(value) => set("title", value)}
              maxLength={500}
            />
            <TextField
              label="Description (optional)"
              value={form.description}
              onChangeText={(value) => set("description", value)}
              multiline
              style={formStyles.multi}
            />
            <TextField
              label="Provisional estimate (£)"
              value={form.budget}
              onChangeText={(value) => set("budget", value)}
              keyboardType="decimal-pad"
            />
            <FormMessage text="This is the total estimate agreed with the invitation. Later changes to price or scope need approval before invoicing." />
            <ChoiceChips
              label="Categories (optional)"
              options={PROJECT_CATEGORIES}
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
              label="Other category (optional)"
              value={form.customCategory}
              onChangeText={(value) => set("customCategory", value)}
            />
            <ChoiceChips
              label="Timeline (optional)"
              options={TIMELINES}
              selected={form.timeline}
              onSelect={(value) => set("timeline", value)}
            />
            <FormMessage text="After the invitation is accepted, the project starts with planning so both sides can agree the stages." />
            <Button
              label="Choose connection"
              onPress={() =>
                void run(async () => {
                  projectTerms(form);
                  setStep("recipient");
                })
              }
            />
            <Button
              label="Back"
              variant="ghost"
              onPress={() => setStep("type")}
            />
          </>
        ) : (
          <>
            <Card>
              <CardTitle>{form.title.trim()}</CardTitle>
              <FormMessage
                text={`Provisional estimate · £${projectTerms(form).budget}`}
              />
              {form.description.trim() ? (
                <FormMessage text={form.description.trim()} />
              ) : null}
              {form.timeline ? <FormMessage text={form.timeline} /> : null}
            </Card>
            <ConnectionPicker selected={recipient} onSelect={setRecipient} />
            <Button
              label="Send invitation"
              loading={busy}
              disabled={!recipient}
              onPress={() =>
                void run(async () => {
                  if (!recipient) return;
                  await sendProjectInvitation(form, recipient.id);
                  router.dismissTo({
                    pathname: "/(app)/work",
                    params: { invitations: "sent" },
                  });
                })
              }
            />
            <Button
              label="Edit details"
              variant="ghost"
              disabled={busy}
              onPress={() => setStep("details")}
            />
          </>
        )}
        {error ? <FormMessage error text={error} /> : null}
      </View>
    </Screen>
  );
}
