import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Bookmark,
  Crown,
  ExternalLink,
  MapPin,
  Play,
  Star,
  UserRound,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { loadSavedProfiles, loadTalentDetail, toggleSaved } from "@/api/talent";
import type { PortfolioItem, Review, TalentDetail } from "@/api/types";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Pill } from "@/components/Pill";
import { Screen } from "@/components/Screen";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SectionHeader } from "@/components/SectionHeader";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { parseJsonArray } from "@/lib/format";
import { isHttpUrl, parseVideoUrl } from "@/lib/media";
import { relativeTime } from "@/lib/time";
import { useSession } from "@/session/SessionProvider";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * A creative's profile.
 *
 * Reachable from Discover (profile id) and from a Feed author (user id) — the
 * handler resolves either (`routes.ts:1058-1066`), which is why one route
 * serves both entry points.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * • **View tracking.** Web fires `POST /api/profile-views/:id` with a
 *   caller-supplied `{ viewerId }` on an unauthenticated endpoint, and that
 *   write generates a notification to the profile owner. Mobile does not call
 *   it: an app that can be made to forge "X viewed your profile" is worse than
 *   an app that undercounts. Flagged for hardening; once the endpoint derives
 *   the viewer from the session, it can be wired up in one line.
 * • **Connect / invite.** `POST /api/connections/request` and
 *   `POST /api/invitations` are properly authed, but the status read
 *   (`GET /api/connections/status`) trusts caller ids and the respond/withdraw
 *   handlers do not check the recipient. Without a trustworthy read there is no
 *   honest button state — a "Connect" that cannot tell you it is already
 *   pending is a bug generator. Deferred to the hardening stage.
 * • **Share and Follow.** Neither exists on the backend at all. Web's share is
 *   a clipboard write.
 *
 * ── What is here ─────────────────────────────────────────────────────────
 * Save (client-only, session-derived, correctly hardened) and Message, which
 * hands off to the existing conversation route rather than posting anything
 * from this screen.
 */
export default function TalentProfileScreen() {
  const { colors, shadows } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const params = useLocalSearchParams<{ profileId: string }>();
  const id = Number(params.profileId);

  const loader = useCallback(
    (signal: AbortSignal) => loadTalentDetail(id, signal),
    [id],
  );
  const { resource, refreshing, refresh, reload } = useAsyncResource<TalentDetail>(loader, {
    deps: [id],
  });

  if (!Number.isFinite(id)) {
    return (
      <Screen>
        <AppHeader title="Profile" back />
        <ErrorState
          title="Profile not found"
          message="That link doesn't point at a Viewrr profile."
          onRetry={() => router.back()}
          retryLabel="Go back"
        />
      </Screen>
    );
  }

  if (resource.phase === "loading") {
    return (
      <Screen>
        <AppHeader title="Profile" back />
        <ScreenSkeleton />
      </Screen>
    );
  }

  if (resource.phase === "error") {
    const offline = resource.failure.kind === "offline";
    return (
      <Screen>
        <AppHeader title="Profile" back />
        <ErrorState
          title={offline ? "You're offline" : "Profile didn't load"}
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

  const detail = resource.data;

  // The endpoint answers for clients too, with `isClientStub: true` and a null
  // profile id. Nothing on this screen applies, so say so plainly instead of
  // rendering a creative profile full of blanks.
  if (detail.isClientStub || detail.profile?.id == null) {
    return (
      <Screen>
        <AppHeader title="Profile" back />
        <EmptyState
          icon={UserRound}
          title={detail.user?.name ?? "Client account"}
          body="This is a client account, so there's no creative profile to show. You'll see clients on their briefs and in your projects."
        />
      </Screen>
    );
  }

  return (
    <ProfileBody
      detail={detail}
      refreshing={refreshing}
      onRefresh={refresh}
      viewerId={user?.id}
      viewerIsClient={user?.role === "client"}
      colors={colors}
      shadows={shadows}
      onMessage={() => router.push(`/(app)/messages/${detail.user.id}`)}
    />
  );
}

type ProfileBodyProps = {
  detail: TalentDetail;
  refreshing: boolean;
  onRefresh: () => void;
  viewerId: number | undefined;
  viewerIsClient: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
  shadows: ReturnType<typeof useTheme>["shadows"];
  onMessage: () => void;
};

function ProfileBody({
  detail,
  refreshing,
  onRefresh,
  viewerId,
  viewerIsClient,
  colors,
  shadows,
  onMessage,
}: ProfileBodyProps) {
  const { profile, user, reviews } = detail;
  const profileId = profile.id as number;
  const isSelf = viewerId != null && viewerId === user.id;

  const specialisms = useMemo(
    () =>
      parseJsonArray(profile.specialisms).filter(
        (value): value is string => typeof value === "string",
      ),
    [profile.specialisms],
  );

  const skills = useMemo(
    () =>
      parseJsonArray(profile.skills).filter(
        (value): value is string => typeof value === "string",
      ),
    [profile.skills],
  );

  const portfolio = useMemo<PortfolioItem[]>(() => {
    const items = parseJsonArray(profile.portfolioItems)
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        url: typeof entry.url === "string" ? entry.url : "",
        title: typeof entry.title === "string" ? entry.title : "Untitled",
        clientName: typeof entry.clientName === "string" ? entry.clientName : undefined,
        thumbnail: typeof entry.thumbnail === "string" ? entry.thumbnail : undefined,
      }))
      .filter((entry) => entry.url.length > 0);

    // Same fallback the web profile uses: a bare showreel counts as one item.
    if (items.length === 0 && profile.reelUrl) {
      return [{ url: profile.reelUrl, title: "Showreel" }];
    }
    return items;
  }, [profile.portfolioItems, profile.reelUrl]);

  const rating = profile.rating ?? 0;
  const reviewCount = profile.reviewCount ?? 0;
  const projectCount = profile.projectCount ?? 0;

  const rate =
    profile.dayRate != null
      ? `£${Math.round(profile.dayRate).toLocaleString("en-GB")} / day`
      : profile.hourlyRate != null
        ? `£${Math.round(profile.hourlyRate).toLocaleString("en-GB")} / hour`
        : null;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={onRefresh}>
      <AppHeader title="Profile" back />

      <View style={styles.hero}>
        <Avatar name={user.name} uri={user.avatar} size="lg" ring={profile.isPro === 1} />

        <View style={styles.heroCopy}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
              {user.name}
            </Text>
            {profile.isPro ? <Crown size={17} color={colors.primary} strokeWidth={2.4} /> : null}
          </View>

          {/* `headline` is the creative's own one-liner ("Videographer &
              Director · London"); specialisms are the taxonomy. Prefer their
              words when they wrote any. */}
          {user.headline ? (
            <Text style={[styles.specialisms, { color: colors.mutedForeground }]}>
              {user.headline}
            </Text>
          ) : specialisms.length ? (
            <Text style={[styles.specialisms, { color: colors.mutedForeground }]}>
              {specialisms.join(" · ")}
            </Text>
          ) : null}

          <View style={styles.heroMeta}>
            {user.location ? (
              <View style={styles.metaItem}>
                <MapPin size={13} color={colors.mutedForeground} strokeWidth={2} />
                <Text style={[styles.metaMuted, { color: colors.mutedForeground }]}>
                  {user.location}
                </Text>
              </View>
            ) : null}
            {profile.availability ? (
              <Pill
                label={
                  profile.availability === "available"
                    ? "Available"
                    : profile.availability === "busy"
                      ? "Busy"
                      : "Unavailable"
                }
                tone={
                  profile.availability === "available"
                    ? "available"
                    : profile.availability === "busy"
                      ? "busy"
                      : "unavailable"
                }
              />
            ) : null}
          </View>
        </View>
      </View>

      {/* Only counts that come from real columns. `projectCount` is overridden
          server-side by the authoritative completed-projects count, and reviews
          are the length of the inlined array — nothing here is decorative. */}
      {reviewCount > 0 || projectCount > 0 || rate ? (
        <View style={[styles.stats, { borderColor: colors.border }]}>
          {reviewCount > 0 ? (
            <View style={styles.stat}>
              <View style={styles.statValueRow}>
                <Star size={14} color={colors.primary} fill={colors.primary} strokeWidth={0} />
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {rating.toFixed(1)}
                </Text>
              </View>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                {reviewCount === 1 ? "1 review" : `${reviewCount} reviews`}
              </Text>
            </View>
          ) : null}

          {projectCount > 0 ? (
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{projectCount}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                {projectCount === 1 ? "project" : "projects"}
              </Text>
            </View>
          ) : null}

          {rate ? (
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {rate.split(" / ")[0]}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                per {rate.split(" / ")[1]}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {!isSelf ? (
        <ProfileActions
          profileId={profileId}
          viewerId={viewerId}
          viewerIsClient={viewerIsClient}
          onMessage={onMessage}
        />
      ) : null}

      {user.bio ? (
        <View style={styles.section}>
          <SectionHeader title="About" />
          <Text style={[styles.bio, { color: colors.mutedForeground }]}>{user.bio}</Text>
        </View>
      ) : null}

      {skills.length ? (
        <View style={styles.section}>
          <SectionHeader title="Skills" count={skills.length} />
          <View style={styles.skills}>
            {skills.map((skill) => (
              <View
                key={skill}
                style={[
                  styles.skill,
                  { backgroundColor: colors.secondary, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.skillLabel, { color: colors.secondaryForeground }]}>
                  {skill}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {portfolio.length ? (
        <View style={styles.section}>
          <SectionHeader title="Work" count={portfolio.length} />
          <View style={styles.portfolio}>
            {portfolio.map((item, index) => (
              <PortfolioTile
                key={`${item.url}-${index}`}
                item={item}
                colors={colors}
                shadows={shadows}
              />
            ))}
          </View>
        </View>
      ) : null}

      {reviews.length ? (
        <View style={styles.section}>
          <SectionHeader title="Reviews" count={reviews.length} />
          <View style={styles.reviews}>
            {reviews.map((review) => (
              <ReviewRow key={review.id} review={review} colors={colors} />
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * Save and Message.
 *
 * Save is client-only because that is how the backend models it — the saved
 * table is keyed by client — and the initial state is read from the signed-in
 * user's own saved list rather than assumed, so the icon never lies about
 * whether a tap will add or remove.
 */
function ProfileActions({
  profileId,
  viewerId,
  viewerIsClient,
  onMessage,
}: {
  profileId: number;
  viewerId: number | undefined;
  viewerIsClient: boolean;
  onMessage: () => void;
}) {
  const { colors } = useTheme();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const canSave = viewerIsClient && viewerId != null;

  const loadSaved = useCallback(
    (signal: AbortSignal) =>
      canSave ? loadSavedProfiles(viewerId, signal) : Promise.resolve([]),
    [canSave, viewerId],
  );

  const { resource } = useAsyncResource(loadSaved, { deps: [canSave, viewerId] });

  const initial =
    resource.phase === "ready"
      ? resource.data.some((entry) => entry.profile?.id === profileId)
      : false;
  const isSaved = saved ?? initial;

  const onToggle = useCallback(() => {
    if (busy) return;
    const next = !isSaved;
    setSaved(next);
    setBusy(true);

    void toggleSaved(profileId)
      .then((result) => setSaved(result.saved))
      .catch(() => {
        setSaved(!next);
        Alert.alert("Couldn't update", "We couldn't save that just now. Try again.");
      })
      .finally(() => setBusy(false));
  }, [busy, isSaved, profileId]);

  return (
    <View style={styles.actions}>
      <Button label="Message" onPress={onMessage} variant="primary" block={!canSave} />

      {canSave ? (
        <Pressable
          onPress={onToggle}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? "Remove from saved" : "Save creative"}
          accessibilityState={{ selected: isSaved, disabled: busy }}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: isSaved ? colors.primaryWash : colors.card,
              borderColor: isSaved ? colors.primaryWashBorder : colors.border,
            },
            pressed && styles.pressed,
          ]}
        >
          <Bookmark
            size={18}
            color={isSaved ? colors.primary : colors.mutedForeground}
            fill={isSaved ? colors.primary : "transparent"}
            strokeWidth={2.2}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One portfolio entry.
 *
 * Videos open in the system browser rather than an embedded player: adding a
 * webview dependency for a Vimeo iframe is not worth it in Alpha, and the
 * native share sheet and full-screen controls are better than anything we would
 * wrap. Vimeo and YouTube thumbnails come from the same helpers the web app
 * uses.
 */
function PortfolioTile({
  item,
  colors,
  shadows,
}: {
  item: PortfolioItem;
  colors: ReturnType<typeof useTheme>["colors"];
  shadows: ReturnType<typeof useTheme>["shadows"];
}) {
  const [failed, setFailed] = useState(false);
  const video = parseVideoUrl(item.url);
  // A portfolio entry is either a film (poster frame from Vimeo/YouTube) or a
  // still, in which case the image is its own preview.
  const thumbnail =
    item.thumbnail ?? (video ? video.thumbnailUrl : isHttpUrl(item.url) ? item.url : null);

  return (
    <Pressable
      onPress={() => void Linking.openURL(item.url).catch(() => undefined)}
      accessibilityRole="link"
      accessibilityLabel={`Open ${item.title}`}
      style={({ pressed }) => [
        styles.tile,
        shadows.sm,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.tileMedia, { backgroundColor: colors.muted }]}>
        {thumbnail && !failed ? (
          <Image
            source={{ uri: thumbnail }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={160}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <View style={styles.tileBadge}>
          {video ? (
            <Play size={16} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
          ) : (
            <ExternalLink size={15} color="#FFFFFF" strokeWidth={2.4} />
          )}
        </View>
      </View>

      <View style={styles.tileCopy}>
        <Text style={[styles.tileTitle, { color: colors.foreground }]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.clientName ? (
          <Text style={[styles.tileClient, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.clientName}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ReviewRow({
  review,
  colors,
}: {
  review: Review;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={[styles.review, { borderColor: colors.border }]}>
      <View style={styles.reviewHead}>
        <Avatar name={review.clientName ?? "Client"} uri={review.clientAvatar} size="sm" />
        <View style={styles.reviewWho}>
          <Text style={[styles.reviewName, { color: colors.foreground }]} numberOfLines={1}>
            {review.clientName ?? "Viewrr client"}
          </Text>
          <Text style={[styles.reviewMeta, { color: colors.mutedForeground }]}>
            {[review.projectType, relativeTime(review.createdAt)].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={styles.reviewStars}>
          {[1, 2, 3, 4, 5].map((step) => (
            <Star
              key={step}
              size={12}
              color={step <= review.rating ? colors.primary : colors.border}
              fill={step <= review.rating ? colors.primary : "transparent"}
              strokeWidth={step <= review.rating ? 0 : 2}
            />
          ))}
        </View>
      </View>

      {review.comment ? (
        <Text style={[styles.reviewBody, { color: colors.mutedForeground }]}>{review.comment}</Text>
      ) : null}

      {review.verifiedProjectReview ? (
        <Text style={[styles.verified, { color: colors.mutedForeground }]}>
          Verified Viewrr project
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    gap: spacing[4],
    alignItems: "center",
    paddingTop: spacing[2],
  },
  heroCopy: {
    flex: 1,
    gap: spacing[1],
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  name: {
    ...typography.h2,
    flexShrink: 1,
  },
  specialisms: {
    ...typography.small,
  },
  heroMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[1],
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  metaMuted: {
    ...typography.caption,
  },
  stats: {
    flexDirection: "row",
    gap: spacing[6],
    marginTop: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stat: {
    gap: 2,
  },
  statValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  statValue: {
    ...typography.h3,
  },
  statLabel: {
    ...typography.caption,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[5],
  },
  saveButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.85,
  },
  section: {
    marginTop: spacing[8],
    gap: spacing[3],
  },
  bio: {
    ...typography.small,
    lineHeight: 21,
  },
  skills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  skill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  skillLabel: {
    ...typography.caption,
  },
  portfolio: {
    gap: spacing[3],
  },
  tile: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  tileMedia: {
    width: "100%",
    aspectRatio: 16 / 9,
    alignItems: "center",
    justifyContent: "center",
  },
  tileBadge: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12, 12, 14, 0.62)",
  },
  tileCopy: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: 1,
  },
  tileTitle: {
    ...typography.smallBold,
  },
  tileClient: {
    ...typography.caption,
  },
  reviews: {
    gap: spacing[3],
  },
  review: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  reviewHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  reviewWho: {
    flex: 1,
    gap: 1,
  },
  reviewName: {
    ...typography.smallBold,
  },
  reviewMeta: {
    ...typography.caption,
  },
  reviewStars: {
    flexDirection: "row",
    gap: 1,
  },
  reviewBody: {
    ...typography.small,
    lineHeight: 20,
  },
  verified: {
    ...typography.caption,
  },
});
