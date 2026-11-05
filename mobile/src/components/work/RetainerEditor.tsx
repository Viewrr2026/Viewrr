import { useState } from "react";
import { Switch, View } from "react-native";
import type { Connection } from "@/api/projectInvitations";
import type { RetainerPlan } from "@/api/retainerProposals";
import { Button } from "@/components/Button";
import { Card, CardTitle } from "@/components/Card";
import { TextField } from "@/components/TextField";
import { ConnectionPicker } from "@/components/work/ConnectionPicker";
import { FormMessage, formStyles } from "@/components/work/FormControls";
import { useFormAction } from "@/hooks/useFormAction";
import {
  draftFrom,
  newCycle,
  newGroup,
  planFrom,
  scheduleGaps,
  type DraftCycle,
  type DraftGroup,
} from "@/lib/retainerDraft";
import { formatPence } from "@/lib/format";
import { useSession } from "@/session/SessionProvider";
import { spacing, useTheme } from "@/theme";

export function RetainerEditor({
  initialPlan,
  onSubmit,
  onCancel,
}: {
  initialPlan?: RetainerPlan;
  onSubmit: (plan: RetainerPlan, recipientId?: number) => Promise<void>;
  onCancel: () => void;
}) {
  const { user } = useSession();
  const { colors } = useTheme();
  const [draft, setDraft] = useState(() => draftFrom(initialPlan));
  const [review, setReview] = useState<RetainerPlan | null>(null);
  const [recipient, setRecipient] = useState<Connection | null>(null);
  const { busy, error, run } = useFormAction();
  const gaps = scheduleGaps(draft);
  function updateCycle(id: string, patch: Partial<DraftCycle>) {
    setDraft((current) => ({
      ...current,
      cycles: current.cycles.map((cycle) =>
        cycle.id === id ? { ...cycle, ...patch } : cycle,
      ),
    }));
  }
  function updateGroup(
    cycle: DraftCycle,
    groupId: string,
    patch: Partial<DraftGroup>,
  ) {
    updateCycle(cycle.id, {
      deliverables: cycle.deliverables.map((group) =>
        group.id === groupId ? { ...group, ...patch } : group,
      ),
    });
  }
  return (
    <View style={formStyles.body}>
      {review ? (
        <>
          <PlanSummary plan={review} />
          {!initialPlan ? (
            <ConnectionPicker
              selected={recipient}
              onSelect={setRecipient}
              role={user?.role === "client" ? "freelancer" : "client"}
            />
          ) : null}
          <Button
            label="Send for review and acceptance"
            loading={busy}
            disabled={!initialPlan && !recipient}
            onPress={() => void run(() => onSubmit(review, recipient?.id))}
          />
          <Button
            label="Edit proposal"
            variant="ghost"
            disabled={busy}
            onPress={() => setReview(null)}
          />
        </>
      ) : (
        <>
          <FormMessage text="Agree the full schedule, deliverables and cycle prices with your connection." />
          {(["title", "startDate", "endDate"] as const).map((field) => (
            <TextField
              key={field}
              label={
                field === "title"
                  ? "Retainer title"
                  : field === "startDate"
                    ? "Start date"
                    : "End date"
              }
              placeholder={field === "title" ? undefined : "YYYY-MM-DD"}
              value={draft[field]}
              onChangeText={(value) =>
                setDraft((current) => ({ ...current, [field]: value }))
              }
            />
          ))}
          {draft.cycles.map((cycle, index) => (
            <Card key={cycle.id}>
              <CardTitle>Cycle {index + 1}</CardTitle>
              {(
                [
                  ["name", "Cycle name"],
                  ["startDate", "Cycle start date"],
                  ["endDate", "Cycle end date"],
                  ["price", "Cycle price (£)"],
                  ["revisions", "Revisions per item"],
                  ["days", "Payment days after approval"],
                ] as const
              ).map(([field, label]) => (
                <TextField
                  key={field}
                  label={label}
                  value={cycle[field]}
                  placeholder={
                    field === "startDate" || field === "endDate"
                      ? "YYYY-MM-DD"
                      : undefined
                  }
                  keyboardType={
                    field === "price"
                      ? "decimal-pad"
                      : field === "revisions" || field === "days"
                        ? "number-pad"
                        : "default"
                  }
                  onChangeText={(value) =>
                    updateCycle(cycle.id, { [field]: value })
                  }
                />
              ))}
              {cycle.deliverables.map((group, groupIndex) => (
                <View key={group.id} style={{ gap: spacing[3] }}>
                  <CardTitle>Deliverable group {groupIndex + 1}</CardTitle>
                  {(
                    [
                      ["name", "Deliverable name"],
                      ["quantity", "Quantity"],
                      ["brief", "Group brief (optional)"],
                      [
                        "itemBriefs",
                        "Individual briefs (optional, one per line)",
                      ],
                    ] as const
                  ).map(([field, label]) => (
                    <TextField
                      key={field}
                      label={label}
                      value={group[field]}
                      multiline={field === "brief" || field === "itemBriefs"}
                      keyboardType={
                        field === "quantity" ? "number-pad" : "default"
                      }
                      onChangeText={(value) =>
                        updateGroup(cycle, group.id, { [field]: value })
                      }
                    />
                  ))}
                  {cycle.deliverables.length > 1 ? (
                    <Button
                      label={`Remove deliverable group ${groupIndex + 1}`}
                      variant="ghost"
                      onPress={() =>
                        updateCycle(cycle.id, {
                          deliverables: cycle.deliverables.filter(
                            (item) => item.id !== group.id,
                          ),
                        })
                      }
                    />
                  ) : null}
                </View>
              ))}
              <Button
                label="Add deliverable group"
                variant="outline"
                disabled={cycle.deliverables.length >= 50}
                onPress={() =>
                  updateCycle(cycle.id, {
                    deliverables: [...cycle.deliverables, newGroup()],
                  })
                }
              />
              {draft.cycles.length > 1 ? (
                <Button
                  label={`Remove cycle ${index + 1}`}
                  variant="ghost"
                  onPress={() =>
                    setDraft((current) => ({
                      ...current,
                      cycles: current.cycles.filter(
                        (item) => item.id !== cycle.id,
                      ),
                    }))
                  }
                />
              ) : null}
            </Card>
          ))}
          <Button
            label="Add cycle"
            variant="outline"
            disabled={draft.cycles.length >= 52}
            onPress={() =>
              setDraft((current) => ({
                ...current,
                cycles: [...current.cycles, newCycle()],
              }))
            }
          />
          {gaps.length ? (
            <Card>
              <CardTitle>Unallocated dates</CardTitle>
              <FormMessage text={gaps.join("\n")} />
              <View style={formStyles.row}>
                <FormMessage text="These gaps are intentional" />
                <Switch
                  accessibilityLabel="These gaps are intentional"
                  value={draft.gapsAcknowledged}
                  trackColor={{ true: colors.primary }}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      gapsAcknowledged: value,
                    }))
                  }
                />
              </View>
            </Card>
          ) : null}
          <Button
            label="Review proposal"
            onPress={() => void run(async () => setReview(planFrom(draft)))}
          />
        </>
      )}
      {error ? <FormMessage error text={error} /> : null}
      <Button
        label="Cancel"
        variant="ghost"
        disabled={busy}
        onPress={onCancel}
      />
    </View>
  );
}

export function PlanSummary({ plan }: { plan: RetainerPlan }) {
  return (
    <View style={{ gap: spacing[3] }}>
      <CardTitle>{plan.title}</CardTitle>
      <FormMessage
        text={`${plan.startDate} to ${plan.endDate} · ${plan.cycles.length} cycles · ${formatPence(plan.cycles.reduce((total, cycle) => total + cycle.amountPence, 0))} total`}
      />
      {plan.cycles.map((cycle, index) => (
        <Card key={cycle.id}>
          <CardTitle>
            {index + 1}. {cycle.name}
          </CardTitle>
          <FormMessage
            text={`${cycle.startDate} to ${cycle.endDate} · ${formatPence(cycle.amountPence)} · ${cycle.revisionAllowance} revisions`}
          />
          <FormMessage
            text={`Payment ${cycle.paymentDays === 0 ? "immediately" : "within " + cycle.paymentDays + " calendar days"} after all items are approved.`}
          />
          {cycle.deliverables.map((group) => (
            <View key={group.id}>
              <CardTitle>
                {group.quantity} × {group.name}
              </CardTitle>
              {group.brief ? <FormMessage text={group.brief} /> : null}
              {group.itemBriefs?.map((brief, itemIndex) =>
                brief ? (
                  <FormMessage
                    key={itemIndex}
                    text={`${itemIndex + 1}. ${brief}`}
                  />
                ) : null,
              )}
            </View>
          ))}
        </Card>
      ))}
      {scheduleGaps(plan).length ? (
        <FormMessage
          text={`Agreed unallocated dates · ${scheduleGaps(plan).join(", ")}`}
        />
      ) : null}
      <FormMessage text="One invoice per cycle. Clean files unlock after verified payment. One subsequent cycle may proceed within payment terms. Overdue payment freezes subsequent work. Dates change only by mutual agreement." />
    </View>
  );
}
