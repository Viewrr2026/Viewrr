import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import {
  BRIEF_CATEGORIES,
  filterBriefBoard,
  loadBriefBoard,
} from "@/api/briefBoard";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { DataState } from "@/components/DataState";
import { EmptyState } from "@/components/EmptyState";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { ChoiceChips, FormMessage } from "@/components/work/FormControls";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useRefreshOnReturn } from "@/hooks/useRefreshOnReturn";
import { formatBudget } from "@/lib/format";
import { useSession } from "@/session/SessionProvider";
import { gutter, spacing, useTheme } from "@/theme";

export default function BriefsIndex() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useSession();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [scope, setScope] = useState("All briefs");
  const data = useAsyncResource(loadBriefBoard, {
    enabled: Boolean(user),
    deps: [user?.id],
  });
  useRefreshOnReturn(data.refresh);
  const rows = useMemo(
    () =>
      data.resource.phase === "ready"
        ? filterBriefBoard(
            data.resource.data,
            search,
            category,
            scope === "My briefs" ? user?.id : undefined,
          )
        : [],
    [data.resource, search, category, scope, user?.id],
  );

  return (
    <Screen edges={["top", "left", "right"]} flush keyboard>
      <View style={{ paddingHorizontal: gutter }}>
        <AppHeader title="Briefs Board" back />
      </View>
      <DataState resource={data.resource} onRetry={data.reload} skeleton="list">
        {() => (
          <FlatList
            data={rows}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{
              paddingHorizontal: gutter,
              paddingBottom: spacing[10],
              gap: spacing[3],
            }}
            refreshControl={
              <RefreshControl
                refreshing={data.refreshing}
                onRefresh={data.refresh}
                tintColor={colors.primary}
              />
            }
            ListHeaderComponent={
              <View style={{ gap: spacing[4], paddingBottom: spacing[3] }}>
                {user?.role === "client" ? (
                  <>
                    <Button
                      label="Post a Brief"
                      onPress={() => router.push("/(app)/briefs/new")}
                    />
                    <ChoiceChips
                      label="Show"
                      options={["All briefs", "My briefs"]}
                      selected={scope}
                      onSelect={setScope}
                    />
                  </>
                ) : null}
                <TextField
                  label="Search briefs"
                  placeholder="Title, client, location…"
                  value={search}
                  onChangeText={setSearch}
                />
                <ChoiceChips
                  label="Category"
                  options={["All", ...BRIEF_CATEGORIES]}
                  selected={category}
                  onSelect={setCategory}
                />
                <FormMessage
                  text={`${rows.length} open ${rows.length === 1 ? "brief" : "briefs"}`}
                />
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                title="No briefs found"
                body={
                  search || category !== "All"
                    ? "Try another search or category."
                    : scope === "My briefs"
                      ? "Post a brief to find a creative for your project."
                      : "New open briefs will appear here."
                }
                inline
              />
            }
            renderItem={({ item }) => (
              <ListRow
                title={item.title}
                subtitle={`${item.clientName} · ${item.category}`}
                subtitleLines={2}
                leading={
                  <Avatar
                    name={item.clientName}
                    uri={item.clientAvatar}
                    size="md"
                  />
                }
                meta={[
                  item.location,
                  item.remote === 1 ? "Remote ok" : "",
                  item.duration,
                  formatBudget(item.budgetMin, item.budgetMax, item.budgetType),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                chevron
                onPress={() =>
                  router.push({
                    pathname: "/(app)/briefs/[briefId]",
                    params: { briefId: String(item.id) },
                  })
                }
              />
            )}
          />
        )}
      </DataState>
    </Screen>
  );
}
