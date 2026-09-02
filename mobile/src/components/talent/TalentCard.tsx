import { Image } from "expo-image";
import { Crown, MapPin, Star } from "lucide-react-native";
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { TalentItem } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Pill } from "@/components/Pill";
import { parseJsonArray } from "@/lib/format";
import { isHttpUrl, parseVideoUrl } from "@/lib/media";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * One creative in Browse Talent.
 *
 * Ported from client/src/components/FreelancerCard.tsx, minus the two things
 * that card does per row and a phone list must not: a per-card
 * `GET /api/connections/status` request (an N+1 across the whole grid, and the
 * endpoint trusts caller-supplied ids anyway) and an inline connect/save
 * mutation. Both live on the profile screen instead, where there is one of
 * them, not fifty.
 *
 * Every value shown is a real column. There is no headline metric, no response
 * time and no "projects completed this month" — those columns do not exist.
 */

const AVAILABILITY_TONE = {
  available: "available",
  busy: "busy",
  unavailable: "unavailable",
} as const;

const AVAILABILITY_LABEL: Record<string, string> = {
  available: "Available",
  busy: "Busy",
  unavailable: "Unavailable",
};

function coverFor(item: TalentItem): string | null {
  if (item.profile.cardThumbnail) return item.profile.cardThumbnail;

  const first = parseJsonArray(item.profile.portfolioItems)[0];
  if (first && typeof first === "object") {
    const entry = first as { thumbnail?: unknown; url?: unknown };
    if (typeof entry.thumbnail === "string" && entry.thumbnail) return entry.thumbnail;
    if (typeof entry.url === "string") {
      const video = parseVideoUrl(entry.url);
      if (video) return video.thumbnailUrl;
      // A portfolio entry can be a still rather than a film, in which case the
      // image itself is the cover.
      if (isHttpUrl(entry.url)) return entry.url;
    }
  }

  const reel = parseVideoUrl(item.profile.reelUrl);
  return reel ? reel.thumbnailUrl : null;
}

function TalentCardBase({ item, onPress }: { item: TalentItem; onPress: () => void }) {
  const { colors, shadows } = useTheme();
  const [coverFailed, setCoverFailed] = useState(false);

  const { profile, user } = item;

  const specialisms = parseJsonArray(profile.specialisms).filter(
    (value): value is string => typeof value === "string",
  );
  const skills = parseJsonArray(profile.skills)
    .filter((value): value is string => typeof value === "string")
    .slice(0, 3);

  const cover = coverFor(item);
  const rating = profile.rating ?? 0;
  const reviewCount = profile.reviewCount ?? 0;
  const availability = profile.availability ?? undefined;
  const tone = availability
    ? AVAILABILITY_TONE[availability as keyof typeof AVAILABILITY_TONE]
    : undefined;

  const rate =
    profile.dayRate != null
      ? `£${Math.round(profile.dayRate).toLocaleString("en-GB")}/day`
      : profile.hourlyRate != null
        ? `£${Math.round(profile.hourlyRate).toLocaleString("en-GB")}/hr`
        : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${user.name}'s profile`}
      style={({ pressed }) => [
        styles.card,
        shadows.sm,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      {cover && !coverFailed ? (
        <Image
          source={{ uri: cover }}
          style={[styles.cover, { backgroundColor: colors.muted }]}
          contentFit="cover"
          transition={160}
          onError={() => setCoverFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={styles.body}>
        <View style={styles.identity}>
          <Avatar name={user.name} uri={user.avatar} size="md" />
          <View style={styles.identityCopy}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                {user.name}
              </Text>
              {profile.isPro ? <Crown size={14} color={colors.primary} strokeWidth={2.4} /> : null}
            </View>
            {specialisms[0] ? (
              <Text style={[styles.specialism, { color: colors.mutedForeground }]} numberOfLines={1}>
                {specialisms[0]}
              </Text>
            ) : null}
          </View>

          {availability && tone ? (
            <Pill label={AVAILABILITY_LABEL[availability] ?? availability} tone={tone} />
          ) : null}
        </View>

        <View style={styles.meta}>
          {reviewCount > 0 ? (
            <View style={styles.metaItem}>
              <Star size={13} color={colors.primary} fill={colors.primary} strokeWidth={0} />
              <Text style={[styles.metaText, { color: colors.foreground }]}>
                {rating.toFixed(1)}
              </Text>
              <Text style={[styles.metaMuted, { color: colors.mutedForeground }]}>
                ({reviewCount})
              </Text>
            </View>
          ) : null}

          {user.location ? (
            <View style={styles.metaItem}>
              <MapPin size={13} color={colors.mutedForeground} strokeWidth={2} />
              <Text style={[styles.metaMuted, { color: colors.mutedForeground }]} numberOfLines={1}>
                {user.location}
              </Text>
            </View>
          ) : null}

          {rate ? (
            <Text style={[styles.rate, { color: colors.foreground }]}>{rate}</Text>
          ) : null}
        </View>

        {skills.length ? (
          <View style={styles.skills}>
            {skills.map((skill) => (
              <View
                key={skill}
                style={[styles.skill, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              >
                <Text style={[styles.skillLabel, { color: colors.secondaryForeground }]}>
                  {skill}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export const TalentCard = memo(TalentCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  pressed: {
    opacity: 0.9,
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  body: {
    padding: spacing[4],
    gap: spacing[3],
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  identityCopy: {
    flex: 1,
    gap: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
  },
  name: {
    ...typography.bodyBold,
    flexShrink: 1,
  },
  specialism: {
    ...typography.caption,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    flexShrink: 1,
  },
  metaText: {
    ...typography.smallBold,
  },
  metaMuted: {
    ...typography.caption,
    flexShrink: 1,
  },
  rate: {
    ...typography.smallBold,
  },
  skills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1.5],
  },
  skill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  skillLabel: {
    ...typography.caption,
  },
});
