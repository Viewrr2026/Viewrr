import { useState } from "react";
import { View } from "react-native";
import { emptyInterest, expressInterest } from "@/api/briefBoard";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { FormMessage, formStyles } from "@/components/work/FormControls";
import { useFormAction } from "@/hooks/useFormAction";

export function ApplyToBrief({
  briefId,
  onSent,
}: {
  briefId: number;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState(emptyInterest);
  const { busy, error, run } = useFormAction();
  if (sent)
    return <FormMessage text="Your interest has been sent to the client." />;
  if (!open)
    return <Button label="Express Interest" onPress={() => setOpen(true)} />;
  return (
    <View style={formStyles.body}>
      <FormMessage text="Your profile and proposal will be shared with the client." />
      {(
        [
          ["coverNote", "Cover note"],
          ["rate", "Rate (optional)"],
          ["availability", "Availability (optional)"],
          ["price", "Proposed price (£, optional)"],
          ["priceBreakdown", "What's included (optional)"],
        ] as const
      ).map(([field, label]) => (
        <TextField
          key={field}
          label={label}
          value={form[field]}
          multiline={field === "coverNote" || field === "priceBreakdown"}
          keyboardType={field === "price" ? "decimal-pad" : "default"}
          onChangeText={(value) =>
            setForm((current) => ({ ...current, [field]: value }))
          }
        />
      ))}
      {error ? <FormMessage error text={error} /> : null}
      <Button
        label="Send interest"
        loading={busy}
        onPress={() =>
          void run(async () => {
            await expressInterest(briefId, form);
            setSent(true);
            onSent();
          })
        }
      />
      <Button
        label="Cancel"
        variant="ghost"
        disabled={busy}
        onPress={() => setOpen(false)}
      />
    </View>
  );
}
