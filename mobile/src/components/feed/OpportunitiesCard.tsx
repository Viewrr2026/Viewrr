import { ClipboardList } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api } from "@/api/client";
import type { Brief } from "@/api/types";
import { formatBudget } from "@/lib/format";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Open briefs, inside the Feed, for creatives.
 *
 * Why this exists: the five-tab bar is now fixed for every role, so creatives
 * no longer get a Briefs tab in slot 2. The website solves the same problem the
 * same way — the Feed's right rail carries a role-gated "Find your next brief"
 * card (`Feed.tsx:927-938`) — except that web card is static copy with no API
 * call behind it. This one shows the real, current briefs.
 *
 * Deliberately small. It reads the existing paginated, capped endpoint
 * (`GET /api/briefs?limit&offset`, max 200 — `routes.ts:2738`) for three rows,
 * and it is a summary, not a product: brief detail, filtering and applying are
 * the Briefs/Work stage, and rows are not tappable while the destination is
 * still a placeholder. It fails silently — an opportunities panel is not worth
 * an error state on top of someone's feed.
 */

const PREVIEW = 3;

export function OpportunitiesCard() {
  const { colors } = useTheme();
  const [briefs, setBriefs] = useState<Brief[] | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();

    api
      .get<Brief[]>("/api/briefs", { query: { limit: 10, offset: 0 }, signal: controller.signal })
      .then((rows) => {
        if (!mounted.current) return;
        setBriefs(rows.filter((brief) => brief.isActive !== false).slice(0, PREVIEW));
      })
      .catch(() => {
        if (mounted.current) setBriefs([]);
      });

    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);

  // Nothing loaded, or nothing open: show no module at all rather than an empty
  // frame. §13 — no placeholder counts, no invented activity.
  if (!briefs || briefs.length === 0) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.primaryWash, borderColor: colors.primaryWashBorder },
      ]}
    >
      <View style={styles.head}>
        <ClipboardList size={16} color={colors.primary} strokeWidth={2.2} />
        <Text style={[styles.title, { color: colors.primary }]}>OPEN BRIEFS</Text>
      </View>

      <View style={styles.rows}>
        {briefs.map((brief) => {
          const budget = formatBudget(brief.budgetMin, brief.budgetMax, brief.budgetType);
          const meta = [brief.category, brief.remote ? "Remote" : brief.location, budget]
            .filter(Boolean)
            .join(" · ");

          return (
            <View key={brief.id} style={styles.row}>
              <Text style={[styles.briefTitle, { color: colors.foreground }]} numberOfLines={1}>
                {brief.title}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {meta}
              </Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        Brief detail and applying arrive with Work.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  title: {
    ...typography.eyebrow,
  },
  rows: {
    gap: spacing[2],
  },
  row: {
    gap: 1,
  },
  briefTitle: {
    ...typography.smallBold,
  },
  meta: {
    ...typography.caption,
  },
  note: {
    ...typography.caption,
  },
});
