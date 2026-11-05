import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  invitationsFor,
  respondToInvitation,
  type Invitation,
  type RetainerInvitation,
} from "@/api/projectInvitations";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Card, CardTitle } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { ListRow } from "@/components/ListRow";
import { StatusBadge } from "@/components/StatusBadge";
import { ChoiceChips, FormMessage } from "@/components/work/FormControls";
import type { AsyncResource } from "@/hooks/useAsyncResource";
import { useFormAction } from "@/hooks/useFormAction";
import { spacing } from "@/theme";

export function ProjectInvitations({
  userId,
  tab,
  onTab,
  invitations,
  retainers,
  onRespond,
}: {
  userId: number;
  tab: "Received" | "Sent";
  onTab: (tab: "Received" | "Sent") => void;
  invitations: AsyncResource<Invitation[]>;
  retainers: AsyncResource<RetainerInvitation[]>;
  onRespond: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const normal =
    invitations.resource.phase === "ready"
      ? invitationsFor(
          invitations.resource.data.filter(
            (item) =>
              !["accepted", "declined", "withdrawn"].includes(item.status),
          ),
          userId,
          tab,
        )
      : [];
  const custom =
    retainers.resource.phase === "ready"
      ? invitationsFor(retainers.resource.data, userId, tab)
      : [];
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Project Invitations"
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <CardTitle>Project Invitations {open ? "⌃" : "⌄"}</CardTitle>
      </Pressable>
      {open ? (
        <>
          <ChoiceChips
            label="Invitations"
            options={["Received", "Sent"]}
            selected={tab}
            onSelect={(value) => onTab(value as typeof tab)}
          />
          <DataState
            resource={invitations.resource}
            onRetry={invitations.reload}
            skeleton="list"
            skeletonRows={1}
          >
            {() => (
              <View style={{ gap: spacing[3] }}>
                {normal.map((item) => (
                  <InvitationCard
                    key={item.id}
                    invitation={item}
                    received={tab === "Received"}
                    onRespond={onRespond}
                  />
                ))}
              </View>
            )}
          </DataState>
          <DataState
            resource={retainers.resource}
            onRetry={retainers.reload}
            skeleton="list"
            skeletonRows={1}
          >
            {() => (
              <View style={{ gap: spacing[3] }}>
                {custom.map((item) => (
                  <Card key={item.publicId}>
                    <CardTitle>{item.title}</CardTitle>
                    <FormMessage
                      text={`${tab === "Received" ? "From" : "To"} ${tab === "Received" ? item.senderName : item.recipientName}`}
                    />
                    <StatusBadge status={item.status} />
                    <FormMessage
                      text={`Retainer · Version ${item.version} · ${item.startDate} to ${item.endDate}`}
                    />
                    <Button
                      label="Review proposal"
                      variant="outline"
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/work/proposal/[agreementId]",
                          params: { agreementId: item.publicId },
                        })
                      }
                    />
                  </Card>
                ))}
              </View>
            )}
          </DataState>
          {invitations.resource.phase === "ready" &&
          retainers.resource.phase === "ready" &&
          !normal.length &&
          !custom.length ? (
            <FormMessage text={`No invitations ${tab.toLowerCase()} yet.`} />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function InvitationCard({
  invitation: item,
  received,
  onRespond,
}: {
  invitation: Invitation;
  received: boolean;
  onRespond: () => void;
}) {
  const { busy, error, run } = useFormAction();
  const [acted, setActed] = useState(false);
  const act = (action: "accept" | "decline") =>
    void run(async () => {
      await respondToInvitation(item.id, action);
      setActed(true);
      onRespond();
    });
  return (
    <Card>
      <CardTitle>{item.title}</CardTitle>
      <ListRow
        title={received ? item.senderName : item.recipientName}
        subtitle={received ? "From" : "To"}
        leading={
          <Avatar
            name={received ? item.senderName : item.recipientName}
            uri={received ? item.senderAvatar : item.recipientAvatar}
            size="sm"
          />
        }
      />
      <StatusBadge status={item.status} />
      {item.description ? <FormMessage text={item.description} /> : null}
      {item.budget ? (
        <FormMessage text={`Provisional estimate · £${item.budget}`} />
      ) : null}
      {item.category ? <FormMessage text={item.category} /> : null}
      {item.timeline ? (
        <FormMessage text={`Timeline · ${item.timeline}`} />
      ) : null}
      {item.isRetainer ? (
        <FormMessage
          text={[
            `Retainer · ${item.billingCycle ?? ""}`,
            item.deliverablesPerCycle,
            item.totalCycles ? `${item.totalCycles} cycles` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ) : null}
      {received && item.status === "pending" ? (
        <>
          {!item.isRetainer ? (
            <FormMessage text="Accepting agrees this provisional estimate and opens the project for planning." />
          ) : null}
          <Button
            label="Accept invitation"
            loading={busy}
            disabled={acted}
            onPress={() => act("accept")}
          />
          <Button
            label="Decline invitation"
            variant="outline"
            disabled={busy || acted}
            onPress={() => act("decline")}
          />
        </>
      ) : null}
      {error ? <FormMessage error text={error} /> : null}
    </Card>
  );
}
