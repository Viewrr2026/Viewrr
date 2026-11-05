import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  loadProposal,
  reviseRetainer,
  reviewRetainer,
} from "@/api/retainerProposals";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { DataState } from "@/components/DataState";
import { Screen } from "@/components/Screen";
import { StatusBadge } from "@/components/StatusBadge";
import { TextField } from "@/components/TextField";
import { FormMessage, formStyles } from "@/components/work/FormControls";
import { PlanSummary, RetainerEditor } from "@/components/work/RetainerEditor";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useFormAction } from "@/hooks/useFormAction";
import { useSession } from "@/session/SessionProvider";

export default function RetainerProposal() {
  const { agreementId } = useLocalSearchParams<{ agreementId: string }>();
  const { user } = useSession();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const { busy, error, run } = useFormAction();
  const data = useAsyncResource((signal) => loadProposal(agreementId, signal), {
    enabled: Boolean(agreementId && user),
    deps: [agreementId, user?.id],
  });
  return (
    <Screen
      scroll
      keyboard
      refreshing={data.refreshing}
      onRefresh={editing ? undefined : data.refresh}
    >
      <AppHeader title="Retainer proposal" back />
      <DataState
        resource={data.resource}
        onRetry={data.reload}
        skeleton="dashboard"
      >
        {(proposal) =>
          editing ? (
            <RetainerEditor
              initialPlan={proposal.latestPlan}
              onCancel={() => setEditing(false)}
              onSubmit={async (plan) => {
                await reviseRetainer(agreementId, plan, proposal.latestVersion);
                router.dismissTo({
                  pathname: "/(app)/work",
                  params: { invitations: "sent" },
                });
              }}
            />
          ) : (
            <View style={formStyles.body}>
              <StatusBadge status={proposal.status} />
              <FormMessage text={`Version ${proposal.latestVersion}`} />
              {proposal.feedback ? (
                <FormMessage text={`Feedback · ${proposal.feedback}`} />
              ) : null}
              <PlanSummary
                plan={proposal.pending?.plan ?? proposal.latestPlan}
              />
              {proposal.pending && proposal.pending.proposedBy !== user?.id ? (
                <>
                  <TextField
                    label="Feedback (for changes or declining)"
                    multiline
                    style={formStyles.multi}
                    maxLength={5000}
                    value={feedback}
                    onChangeText={setFeedback}
                  />
                  {(
                    [
                      ["accept", "Accept this version"],
                      ["request_changes", "Request changes"],
                      ["decline", "Decline proposal"],
                    ] as const
                  ).map(([action, label]) => (
                    <Button
                      key={action}
                      label={label}
                      loading={busy}
                      variant={action === "accept" ? "primary" : "outline"}
                      onPress={() =>
                        void run(async () => {
                          if (action === "request_changes" && !feedback.trim())
                            throw new Error("Explain the changes you need.");
                          await reviewRetainer(
                            agreementId,
                            proposal.pending!.version,
                            action,
                            feedback.trim(),
                          );
                          router.dismissTo("/(app)/work");
                        })
                      }
                    />
                  ))}
                </>
              ) : proposal.pending ? (
                <FormMessage text="Waiting for your connection to review this version." />
              ) : null}
              {[
                "active",
                "paused",
                "awaiting_client_acceptance",
                "changes_requested",
              ].includes(proposal.status) ? (
                <Button
                  label="Revise proposal"
                  variant="outline"
                  disabled={busy}
                  onPress={() => setEditing(true)}
                />
              ) : null}
              {error ? <FormMessage error text={error} /> : null}
            </View>
          )
        }
      </DataState>
    </Screen>
  );
}
