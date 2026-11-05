import { useRouter } from "expo-router";
import { Linking } from "react-native";
import { retainerConfig, sendRetainer } from "@/api/retainerProposals";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { DataState } from "@/components/DataState";
import { Screen } from "@/components/Screen";
import { FormMessage } from "@/components/work/FormControls";
import { RetainerEditor } from "@/components/work/RetainerEditor";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { PUBLIC_SITE_URL } from "@/config/env";

export default function NewRetainer() {
  const router = useRouter();
  const data = useAsyncResource(retainerConfig);
  return (
    <Screen scroll keyboard>
      <AppHeader title="Create retainer" back />
      <DataState
        resource={data.resource}
        onRetry={data.reload}
        skeleton="dashboard"
      >
        {(config) =>
          config.enabled ? (
            <RetainerEditor
              onCancel={() => router.back()}
              onSubmit={async (plan, recipientId) => {
                if (!recipientId) throw new Error("Choose a connection.");
                await sendRetainer(plan, recipientId);
                router.dismissTo({
                  pathname: "/(app)/work",
                  params: { invitations: "sent" },
                });
              }}
            />
          ) : (
            <>
              <FormMessage text="The custom retainer builder is not enabled for this service yet. Existing retainer creation is available on the website." />
              <Button
                label="Open retainer builder"
                onPress={() =>
                  void Linking.openURL(PUBLIC_SITE_URL + "/#/retainer/new")
                }
              />
            </>
          )
        }
      </DataState>
    </Screen>
  );
}
