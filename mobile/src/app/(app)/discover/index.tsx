import { useRouter } from "expo-router";
import { Search, SlidersHorizontal, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { loadTalent } from "@/api/talent";
import type { TalentItem } from "@/api/types";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Screen } from "@/components/Screen";
import { SkeletonCard } from "@/components/Skeleton";
import { TalentCard } from "@/components/talent/TalentCard";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { control, gutter, hitSlop, radii, spacing, typography, useTheme } from "@/theme";

/**
 * Discover — Browse Talent.
 *
 * The native form of the website's /marketplace. Same endpoint, same three
 * server-side filters, same sort options, rebuilt as a single-column list.
 *
 * ── Filters: exactly the ones that exist ──────────────────────────────────
 * `GET /api/profiles` reads `specialism`, `availability` and `search` and
 * nothing else (`server/routes.ts:949`), so those three are what this screen
 * sends. Sort is applied client-side, as on web, because there is no sort
 * parameter.
 *
 * The web page also carries location, day-rate, minimum-rating, Pro-only and
 * remote-only controls, all filtered in the browser over the full downloaded
 * set — plus an equipment filter whose ten options set state that is never read
 * and which has no database column behind it at all. None of those are ported
 * as if they were server capabilities, and the inert one is not ported at all.
 *
 * ── Pagination: none, and not faked ───────────────────────────────────────
 * There is no `limit`, `offset` or cursor on this endpoint, and
 * `storage.getProfiles` does an unbounded `SELECT *` over profiles and users
 * before filtering in Node (`storage.ts:391-393`). One request returns every
 * matching creative. This screen therefore has no "Load more" and no infinite
 * scroll: slicing the array locally and calling it paging would misrepresent
 * the backend. FlatList still only renders what is near the viewport, so long
 * lists stay smooth — but the payload is whole-table, and that is a backend fix.
 * Flagged in the Stage 2 report as BLOCKED — BACKEND HARDENING REQUIRED.
 */

/** Mirrors SPECIALISMS in client/src/pages/Marketplace.tsx:12. */
const SPECIALISMS = ["all", "Videographer", "Video Editor", "Photographer", "Marketer"] as const;

const AVAILABILITY = [
  { value: "all", label: "Any availability" },
  { value: "available", label: "Available" },
  { value: "busy", label: "Busy" },
] as const;

/** Mirrors SORT_OPTIONS in Marketplace.tsx:13, minus "Newest". */
const SORTS = [
  { value: "rating", label: "Top rated" },
  { value: "projects", label: "Most projects" },
  { value: "rate_asc", label: "Day rate: low to high" },
  { value: "rate_desc", label: "Day rate: high to low" },
] as const;

type SortValue = (typeof SORTS)[number]["value"];

const SEARCH_DEBOUNCE_MS = 350;

export default function DiscoverScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [specialism, setSpecialism] = useState<string>("all");
  const [availability, setAvailability] = useState<string>("all");
  const [sort, setSort] = useState<SortValue>("rating");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Debounced so a typed query is one request, not one per keystroke — the
  // handler scans the whole profiles table on every call.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [search]);

  const loader = useCallback(
    (signal: AbortSignal) => loadTalent({ specialism, availability, search: debounced, signal }),
    [availability, debounced, specialism],
  );

  const { resource, refreshing, refresh, reload } = useAsyncResource<TalentItem[]>(loader, {
    deps: [specialism, availability, debounced],
  });

  const rows = resource.phase === "ready" ? resource.data : [];

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sort) {
        case "projects":
          return (b.profile.projectCount ?? 0) - (a.profile.projectCount ?? 0);
        case "rate_asc":
          return (a.profile.dayRate ?? Number.POSITIVE_INFINITY) - (b.profile.dayRate ?? Number.POSITIVE_INFINITY);
        case "rate_desc":
          return (b.profile.dayRate ?? 0) - (a.profile.dayRate ?? 0);
        default:
          return (b.profile.rating ?? 0) - (a.profile.rating ?? 0);
      }
    });
    return copy;
  }, [rows, sort]);

  const filtered = specialism !== "all" || availability !== "all" || debounced.trim().length > 0;

  const activeSort = SORTS.find((option) => option.value === sort);

  const controls = (
    <View style={styles.controls}>
      <View
        style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.input }]}
      >
        <Search size={17} color={colors.mutedForeground} strokeWidth={2.2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, skill or location"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search creatives"
          style={[
            styles.searchInput,
            Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
            { color: colors.foreground },
          ]}
        />
        {search.length > 0 ? (
          <Pressable
            onPress={() => setSearch("")}
            hitSlop={hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <X size={16} color={colors.mutedForeground} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {SPECIALISMS.map((value) => {
          const active = specialism === value;
          return (
            <Pressable
              key={value}
              onPress={() => setSpecialism(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={value === "all" ? "All creatives" : value}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.secondary,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipLabel,
                  { color: active ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {value === "all" ? "All creatives" : `${value}s`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={() => setFiltersOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel="Availability and sorting"
        accessibilityState={{ expanded: filtersOpen }}
        style={({ pressed }) => [styles.filterToggle, pressed && styles.pressed]}
      >
        <SlidersHorizontal size={15} color={colors.primary} strokeWidth={2.2} />
        <Text style={[styles.filterToggleLabel, { color: colors.primary }]}>
          {activeSort?.label}
          {availability !== "all"
            ? ` · ${AVAILABILITY.find((option) => option.value === availability)?.label}`
            : ""}
        </Text>
      </Pressable>

      {filtersOpen ? (
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.panelLabel, { color: colors.mutedForeground }]}>AVAILABILITY</Text>
          <View style={styles.panelRow}>
            {AVAILABILITY.map((option) => {
              const active = availability === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setAvailability(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.option,
                    {
                      backgroundColor: active ? colors.primaryWash : colors.background,
                      borderColor: active ? colors.primaryWashBorder : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: active ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.panelLabel, { color: colors.mutedForeground }]}>SORT BY</Text>
          <View style={styles.panelRow}>
            {SORTS.map((option) => {
              const active = sort === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setSort(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.option,
                    {
                      backgroundColor: active ? colors.primaryWash : colors.background,
                      borderColor: active ? colors.primaryWashBorder : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: active ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {resource.phase === "ready" ? (
        <Text style={[styles.count, { color: colors.mutedForeground }]}>
          {sorted.length === 1 ? "1 creative" : `${sorted.length} creatives`}
          {filtered ? " matching" : ""}
        </Text>
      ) : null}
    </View>
  );

  if (resource.phase === "loading") {
    return (
      <Screen edges={["top", "left", "right"]} flush>
        <View style={styles.gutter}>
          <AppHeader title="Discover" brand />
          {controls}
        </View>
        <View style={styles.skeletons}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </View>
      </Screen>
    );
  }

  if (resource.phase === "error") {
    const offline = resource.failure.kind === "offline";
    return (
      <Screen edges={["top", "left", "right"]}>
        <AppHeader title="Discover" brand />
        <ErrorState
          title={offline ? "You're offline" : "Creatives didn't load"}
          message={
            offline
              ? "Viewrr can't reach the network right now. Check your connection and try again."
              : resource.failure.message
          }
          onRetry={reload}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]} flush>
      <View style={styles.gutter}>
        <AppHeader title="Discover" brand />
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => String(item.profile.id ?? item.user.id)}
        renderItem={({ item }) => (
          <View style={styles.gutter}>
            <TalentCard
              item={item}
              onPress={() =>
                router.push(`/(app)/discover/${item.profile.id ?? item.user.id}`)
              }
            />
          </View>
        )}
        ListHeaderComponent={<View style={styles.gutter}>{controls}</View>}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.mutedForeground}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.gutter}>
            <EmptyState
              icon={Users}
              title={filtered ? "No creatives match" : "No creatives yet"}
              body={
                filtered
                  ? "Try a broader search, or clear the specialism and availability filters."
                  : "Verified creatives appear here as they join Viewrr."
              }
              {...(filtered
                ? {
                    actionLabel: "Clear filters",
                    onAction: () => {
                      setSearch("");
                      setSpecialism("all");
                      setAvailability("all");
                    },
                  }
                : {})}
              inline
            />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gutter: {
    paddingHorizontal: gutter,
  },
  controls: {
    gap: spacing[3],
    paddingBottom: spacing[3],
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    height: control.height,
    borderRadius: radii.full,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
  },
  searchInput: {
    flex: 1,
    ...typography.small,
  },
  chips: {
    gap: spacing[2],
    paddingRight: spacing[4],
  },
  chip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: {
    ...typography.caption,
  },
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    alignSelf: "flex-start",
    minHeight: 28,
  },
  filterToggleLabel: {
    ...typography.smallMedium,
  },
  pressed: {
    opacity: 0.7,
  },
  panel: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    gap: spacing[2],
  },
  panelLabel: {
    ...typography.eyebrow,
    marginTop: spacing[1],
  },
  panelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  option: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: {
    ...typography.caption,
  },
  count: {
    ...typography.caption,
  },
  list: {
    paddingBottom: spacing[8],
  },
  separator: {
    height: spacing[3],
  },
  skeletons: {
    paddingHorizontal: gutter,
    gap: spacing[3],
  },
});
