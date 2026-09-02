import { Image } from "expo-image";
import { Camera, Check, Link2, Plus, Trash2, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  decodeJsonArray,
  updateProfileFields,
  updateUserFields,
  type ProfileFieldsPatch,
  type UserFieldsPatch,
} from "@/api/account";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import type { PublicUser, UserProfile } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { Pill } from "@/components/Pill";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { parseVideoUrl } from "@/lib/media";
import {
  IMAGE_LIMITS,
  ImageEncodeError,
  dataUrlBytes,
  encodeImageAsDataUrl,
  isDataUrl,
  isImageCompressionAvailable,
  isImagePickingAvailable,
  pickProfileImage,
  type ImageKind,
} from "@/lib/profileImage";
import { useSession } from "@/session/SessionProvider";
import { radii, spacing, typography, useTheme } from "@/theme";

/**
 * Edit profile — Decision 13.
 *
 * Every field on this screen is one the server actually accepts:
 *   PATCH /api/users/:id     → name, headline, bio, location, avatar, banner
 *   PATCH /api/profiles/:id  → skills, hourlyRate, dayRate, availability,
 *                              reelUrl, portfolioItems
 *
 * Deliberately absent:
 *   • `users.phone` — NOT in the server whitelist. Offering it would silently
 *     discard whatever the user typed.
 *   • `email` — in the whitelist, but changing an email address is deferred
 *     (Decision 16), so it is not editable here.
 *   • specialisms, yearsExperience, socialLinks, cardThumbnail — accepted by
 *     the server but out of this PRD's field list; left to the web app rather
 *     than half-modelled here.
 *
 * Images keep data-URL parity with web: they are compressed client-side and
 * stored in the same TEXT column. No object storage (Decision 13).
 */

const AVAILABILITY = ["available", "busy", "unavailable"] as const;
type Availability = (typeof AVAILABILITY)[number];

type PortfolioEntry = { url: string; title?: string };

type Snapshot = { account: PublicUser; profile: UserProfile | null };

type Form = {
  name: string;
  headline: string;
  bio: string;
  location: string;
  avatar: string | null;
  banner: string | null;
  skills: string[];
  hourlyRate: string;
  dayRate: string;
  availability: Availability;
  reelUrl: string;
  portfolio: PortfolioEntry[];
};

function toAvailability(value: string | null | undefined): Availability {
  return value === "busy" || value === "unavailable" ? value : "available";
}

function seed(snapshot: Snapshot): Form {
  const { account, profile } = snapshot;
  return {
    name: account.name ?? "",
    headline: account.headline ?? "",
    bio: account.bio ?? "",
    location: account.location ?? "",
    avatar: account.avatar ?? null,
    banner: (account as { banner?: string | null }).banner ?? null,
    skills: decodeJsonArray<string>(profile?.skills).filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    ),
    hourlyRate: profile?.hourlyRate != null ? String(profile.hourlyRate) : "",
    dayRate: profile?.dayRate != null ? String(profile.dayRate) : "",
    availability: toAvailability(profile?.availability),
    reelUrl: profile?.reelUrl ?? "",
    portfolio: decodeJsonArray<PortfolioEntry>(profile?.portfolioItems).filter(
      (entry): entry is PortfolioEntry =>
        Boolean(entry) && typeof (entry as PortfolioEntry).url === "string",
    ),
  };
}

/** "" → null so clearing a field really clears it; a number string → number. */
function toRate(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export default function EditProfile() {
  const { user } = useSession();
  const { colors } = useTheme();
  const userId = user?.id ?? null;

  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState("");
  const [videoDraft, setVideoDraft] = useState("");
  const [imageSheet, setImageSheet] = useState<ImageKind | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<ImageKind | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal): Promise<Snapshot> => {
      if (userId === null) throw new Error("No session");
      const [account, profile] = await Promise.all([
        api.get<PublicUser>(`/api/users/${userId}`, { signal }),
        api.get<UserProfile>(`/api/profile-by-user/${userId}`, { signal }).catch(() => null),
      ]);
      return { account, profile };
    },
    [userId],
  );

  const { resource, reload } = useAsyncResource<Snapshot>(load, { enabled: userId !== null });

  // Seed the form once the real values are on screen — never from defaults.
  if (resource.phase === "ready" && form === null) {
    setForm(seed(resource.data));
  }

  const patch = useCallback((update: Partial<Form>) => {
    setSaved(false);
    setForm((current) => (current ? { ...current, ...update } : current));
  }, []);

  const applyImage = useCallback(
    async (kind: ImageKind, run: () => Promise<{ dataUrl: string } | null>) => {
      setImageBusy(true);
      setImageError(null);
      try {
        const result = await run();
        if (result) patch(kind === "avatar" ? { avatar: result.dataUrl } : { banner: result.dataUrl });
        setImageSheet(null);
        setLinkPrompt(null);
        setLinkDraft("");
      } catch (cause) {
        setImageError(
          cause instanceof ImageEncodeError
            ? cause.message
            : "That image couldn't be used. Try another.",
        );
      } finally {
        setImageBusy(false);
      }
    },
    [patch],
  );

  const onSave = useCallback(async () => {
    if (!form || userId === null || resource.phase !== "ready") return;
    const original = seed(resource.data);

    const userPatch: UserFieldsPatch = {};
    if (form.name.trim() !== original.name) userPatch.name = form.name.trim();
    if (form.headline.trim() !== original.headline) userPatch.headline = form.headline.trim();
    if (form.bio.trim() !== original.bio) userPatch.bio = form.bio.trim();
    if (form.location.trim() !== original.location) userPatch.location = form.location.trim();
    if (form.avatar !== original.avatar) userPatch.avatar = form.avatar;
    if (form.banner !== original.banner) userPatch.banner = form.banner;

    const profilePatch: ProfileFieldsPatch = {};
    if (JSON.stringify(form.skills) !== JSON.stringify(original.skills)) {
      profilePatch.skills = form.skills;
    }
    if (form.hourlyRate !== original.hourlyRate) profilePatch.hourlyRate = toRate(form.hourlyRate);
    if (form.dayRate !== original.dayRate) profilePatch.dayRate = toRate(form.dayRate);
    if (form.availability !== original.availability) profilePatch.availability = form.availability;
    if (form.reelUrl.trim() !== original.reelUrl) {
      profilePatch.reelUrl = form.reelUrl.trim() || null;
    }
    if (JSON.stringify(form.portfolio) !== JSON.stringify(original.portfolio)) {
      profilePatch.portfolioItems = form.portfolio;
    }

    const profileId = resource.data.profile?.id ?? null;
    if (Object.keys(userPatch).length === 0 && Object.keys(profilePatch).length === 0) {
      setSaved(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (Object.keys(userPatch).length > 0) await updateUserFields(userId, userPatch);
      if (profileId !== null && Object.keys(profilePatch).length > 0) {
        await updateProfileFields(profileId, profilePatch);
      }
      setSaved(true);
      reload();
      setForm(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.serverMessage ?? cause.userMessage)
          : "Couldn't save your changes. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [form, reload, resource, userId]);

  return (
    <Screen scroll keyboard edges={["top", "left", "right"]}>
      <AppHeader title="Edit profile" back bell={false} />

      <DataState resource={resource} onRetry={reload} skeleton="dashboard">
        {(snapshot) => {
          if (!form) return null;
          const hasProfileRow = snapshot.profile?.id != null;

          return (
            <View style={styles.body}>
              {/* ── Photos ────────────────────────────────────────────── */}
              <Card>
                <CardLabel>Photos</CardLabel>
                <View style={styles.photoRow}>
                  <Avatar name={form.name || "Your account"} uri={form.avatar} size="lg" ring />
                  <View style={styles.photoCopy}>
                    <Text style={[styles.photoTitle, { color: colors.foreground }]}>
                      Profile photo
                    </Text>
                    <Text style={[styles.photoMeta, { color: colors.mutedForeground }]}>
                      {form.avatar
                        ? isDataUrl(form.avatar)
                          ? `Stored on Viewrr · ${Math.round(dataUrlBytes(form.avatar) / 1024)} KB`
                          : "Set from a link"
                        : `No photo yet · up to ${Math.round(IMAGE_LIMITS.avatar.maxBytes / 1024)} KB`}
                    </Text>
                    <Button
                      label="Change"
                      variant="secondary"
                      size="compact"
                      block={false}
                      onPress={() => {
                        setImageError(null);
                        setImageSheet("avatar");
                      }}
                    />
                  </View>
                </View>

                <View style={styles.bannerBlock}>
                  {form.banner ? (
                    <Image
                      source={{ uri: form.banner }}
                      style={[styles.banner, { borderColor: colors.border }]}
                      contentFit="cover"
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <View
                      style={[
                        styles.banner,
                        styles.bannerEmpty,
                        { borderColor: colors.border, backgroundColor: colors.secondary },
                      ]}
                    >
                      <Text style={[styles.photoMeta, { color: colors.mutedForeground }]}>
                        No banner yet
                      </Text>
                    </View>
                  )}
                  <Button
                    label={form.banner ? "Change banner" : "Add banner"}
                    variant="secondary"
                    size="compact"
                    block={false}
                    onPress={() => {
                      setImageError(null);
                      setImageSheet("banner");
                    }}
                  />
                </View>

                <CardBody>
                  Images are compressed on this device and stored with your profile, exactly as on
                  viewrr.co.uk. Limits: {Math.round(IMAGE_LIMITS.avatar.maxBytes / 1024)} KB for a
                  photo, {Math.round(IMAGE_LIMITS.banner.maxBytes / 1024)} KB for a banner.
                  {isImageCompressionAvailable()
                    ? ""
                    : " Larger files are rejected rather than quietly re-encoded."}
                </CardBody>
              </Card>

              {/* ── Basics ────────────────────────────────────────────── */}
              <Card>
                <CardLabel>Basics</CardLabel>
                <TextField
                  label="Name"
                  value={form.name}
                  onChangeText={(value) => patch({ name: value })}
                  autoCapitalize="words"
                  maxLength={80}
                />
                <TextField
                  label="Headline"
                  value={form.headline}
                  onChangeText={(value) => patch({ headline: value })}
                  placeholder="e.g. Documentary editor, London"
                  maxLength={120}
                  helperText="One line, shown under your name everywhere on Viewrr."
                />
                <TextField
                  label="Location"
                  value={form.location}
                  onChangeText={(value) => patch({ location: value })}
                  placeholder="City, country"
                  maxLength={80}
                />
                <TextField
                  label="Bio"
                  value={form.bio}
                  onChangeText={(value) => patch({ bio: value })}
                  multiline
                  maxLength={1200}
                  style={styles.multiline}
                  helperText={`${form.bio.length}/1200`}
                />
              </Card>

              {hasProfileRow ? (
                <>
                  {/* ── Rates and availability ─────────────────────────── */}
                  <Card>
                    <CardLabel>Rates and availability</CardLabel>
                    <TextField
                      label="Hourly rate (£)"
                      value={form.hourlyRate}
                      onChangeText={(value) => patch({ hourlyRate: value })}
                      keyboardType="numeric"
                      placeholder="e.g. 85"
                    />
                    <TextField
                      label="Day rate (£)"
                      value={form.dayRate}
                      onChangeText={(value) => patch({ dayRate: value })}
                      keyboardType="numeric"
                      placeholder="e.g. 450"
                      helperText="Leave either blank to hide it on your profile."
                    />
                    <View style={styles.chips}>
                      {AVAILABILITY.map((value) => (
                        <Pressable
                          key={value}
                          onPress={() => patch({ availability: value })}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: form.availability === value }}
                          accessibilityLabel={`Availability: ${value}`}
                        >
                          <Pill
                            label={value.charAt(0).toUpperCase() + value.slice(1)}
                            tone={form.availability === value ? value : "neutral"}
                          />
                        </Pressable>
                      ))}
                    </View>
                  </Card>

                  {/* ── Skills ─────────────────────────────────────────── */}
                  <Card>
                    <CardLabel>Skills</CardLabel>
                    {form.skills.length > 0 ? (
                      <View style={styles.chips}>
                        {form.skills.map((skill) => (
                          <Pressable
                            key={skill}
                            onPress={() =>
                              patch({ skills: form.skills.filter((item) => item !== skill) })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${skill}`}
                          >
                            <View style={styles.removable}>
                              <Pill label={skill} tone="brand" />
                              <X size={13} color={colors.mutedForeground} strokeWidth={2.4} />
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <CardBody>No skills yet. Add the ones clients search for.</CardBody>
                    )}
                    <View style={styles.inlineRow}>
                      <View style={styles.inlineField}>
                        <TextField
                          label="Add a skill"
                          value={skillDraft}
                          onChangeText={setSkillDraft}
                          placeholder="e.g. Colour grading"
                          maxLength={40}
                          onSubmitEditing={() => {
                            const value = skillDraft.trim();
                            if (value && !form.skills.includes(value)) {
                              patch({ skills: [...form.skills, value] });
                            }
                            setSkillDraft("");
                          }}
                        />
                      </View>
                      <Button
                        label="Add"
                        variant="secondary"
                        size="compact"
                        block={false}
                        disabled={skillDraft.trim().length === 0}
                        onPress={() => {
                          const value = skillDraft.trim();
                          if (value && !form.skills.includes(value)) {
                            patch({ skills: [...form.skills, value] });
                          }
                          setSkillDraft("");
                        }}
                      />
                    </View>
                  </Card>

                  {/* ── Portfolio video URLs ───────────────────────────── */}
                  <Card>
                    <CardLabel>Showreel and portfolio</CardLabel>
                    <TextField
                      label="Showreel URL"
                      value={form.reelUrl}
                      onChangeText={(value) => patch({ reelUrl: value })}
                      autoCapitalize="none"
                      keyboardType="url"
                      placeholder="https://vimeo.com/123456789"
                      errorText={
                        form.reelUrl.trim() && !parseVideoUrl(form.reelUrl)
                          ? "Use a Vimeo or YouTube link."
                          : undefined
                      }
                    />

                    {form.portfolio.length > 0 ? (
                      <View style={styles.videoList}>
                        {form.portfolio.map((item, index) => (
                          <View
                            key={`${item.url}-${index}`}
                            style={[styles.videoRow, { borderColor: colors.border }]}
                          >
                            <View style={styles.videoCopy}>
                              <Text
                                style={[styles.videoTitle, { color: colors.foreground }]}
                                numberOfLines={1}
                              >
                                {item.title?.trim() || parseVideoUrl(item.url)?.provider || "Video"}
                              </Text>
                              <Text
                                style={[styles.photoMeta, { color: colors.mutedForeground }]}
                                numberOfLines={1}
                              >
                                {item.url}
                              </Text>
                            </View>
                            <Pressable
                              onPress={() =>
                                patch({
                                  portfolio: form.portfolio.filter((_, i) => i !== index),
                                })
                              }
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${item.url}`}
                            >
                              <Trash2 size={16} color={colors.destructive} strokeWidth={2.1} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <CardBody>
                        Add Vimeo or YouTube links to the work you want clients to see first.
                      </CardBody>
                    )}

                    <View style={styles.inlineRow}>
                      <View style={styles.inlineField}>
                        <TextField
                          label="Add a video URL"
                          value={videoDraft}
                          onChangeText={setVideoDraft}
                          autoCapitalize="none"
                          keyboardType="url"
                          placeholder="https://vimeo.com/…"
                          errorText={
                            videoDraft.trim() && !parseVideoUrl(videoDraft)
                              ? "Vimeo or YouTube links only."
                              : undefined
                          }
                        />
                      </View>
                      <Button
                        label="Add"
                        variant="secondary"
                        size="compact"
                        block={false}
                        disabled={!parseVideoUrl(videoDraft)}
                        onPress={() => {
                          const parsed = parseVideoUrl(videoDraft);
                          if (!parsed) return;
                          patch({
                            portfolio: [...form.portfolio, { url: parsed.watchUrl }],
                          });
                          setVideoDraft("");
                        }}
                      />
                    </View>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardLabel>Creative profile</CardLabel>
                  <CardBody>
                    Rates, skills, availability and showreel live on a creative profile. This
                    account doesn&apos;t have one, so only the fields above apply.
                  </CardBody>
                </Card>
              )}

              {error ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                  {error}
                </Text>
              ) : null}
              {saved ? (
                <View style={styles.savedRow}>
                  <Check size={16} color={colors.primary} strokeWidth={2.4} />
                  <Text style={[styles.savedLabel, { color: colors.primary }]}>
                    Saved to your profile
                  </Text>
                </View>
              ) : null}

              <Button
                label="Save changes"
                loading={saving}
                onPress={() => void onSave()}
                accessibilityHint="Sends your changes to Viewrr"
              />

              {/* ── Image source sheet ─────────────────────────────────── */}
              <ActionSheet
                visible={imageSheet !== null}
                title={imageSheet === "banner" ? "Banner image" : "Profile photo"}
                message={imageError ?? undefined}
                onClose={() => {
                  setImageSheet(null);
                  setLinkPrompt(null);
                  setImageError(null);
                }}
                actions={[
                  {
                    label: "Choose from photo library",
                    icon: Camera,
                    description: isImagePickingAvailable()
                      ? "Compressed on this device before it's saved"
                      : "Not available in this build — use an image link instead",
                    disabled: !isImagePickingAvailable() || imageBusy,
                    onPress: () => {
                      const kind = imageSheet;
                      if (!kind) return;
                      void applyImage(kind, () => pickProfileImage(kind));
                    },
                  },
                  {
                    label: "Use an image link",
                    icon: Link2,
                    description: "Paste an https link — Viewrr stores a copy, not the link",
                    disabled: imageBusy,
                    onPress: () => {
                      setLinkPrompt(imageSheet);
                      setImageSheet(null);
                    },
                  },
                  ...((imageSheet === "banner" ? form.banner : form.avatar)
                    ? [
                        {
                          label: imageSheet === "banner" ? "Remove banner" : "Remove photo",
                          icon: Trash2,
                          tone: "destructive" as const,
                          disabled: imageBusy,
                          onPress: () => {
                            patch(imageSheet === "banner" ? { banner: null } : { avatar: null });
                            setImageSheet(null);
                          },
                        },
                      ]
                    : []),
                ]}
              />

              {/* ── Image link prompt ──────────────────────────────────── */}
              <ActionSheet
                visible={linkPrompt !== null}
                title="Paste an image link"
                message={
                  imageError ??
                  "Viewrr downloads the image and stores its own copy, so the link can disappear later without breaking your profile."
                }
                onClose={() => {
                  setLinkPrompt(null);
                  setLinkDraft("");
                  setImageError(null);
                }}
                actions={[
                  {
                    label: imageBusy ? "Fetching…" : "Use this image",
                    icon: Plus,
                    disabled: imageBusy || !/^https:\/\//i.test(linkDraft.trim()),
                    onPress: () => {
                      const kind = linkPrompt;
                      const uri = linkDraft.trim();
                      if (!kind || !uri) return;
                      void applyImage(kind, () => encodeImageAsDataUrl(uri, kind));
                    },
                  },
                ]}
              >
                <TextField
                  label="Image URL"
                  value={linkDraft}
                  onChangeText={setLinkDraft}
                  autoCapitalize="none"
                  keyboardType="url"
                  placeholder="https://…"
                  editable={!imageBusy}
                />
              </ActionSheet>
            </View>
          );
        }}
      </DataState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
  },
  photoCopy: {
    flex: 1,
    gap: spacing[1],
    alignItems: "flex-start",
  },
  photoTitle: {
    ...typography.smallBold,
  },
  photoMeta: {
    ...typography.caption,
  },
  bannerBlock: {
    gap: spacing[2],
    alignItems: "flex-start",
  },
  banner: {
    width: "100%",
    height: 96,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  multiline: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  removable: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing[2],
  },
  inlineField: {
    flex: 1,
  },
  videoList: {
    gap: spacing[2],
  },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[3],
  },
  videoCopy: {
    flex: 1,
    gap: 2,
  },
  videoTitle: {
    ...typography.smallBold,
  },
  error: {
    ...typography.small,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  savedLabel: {
    ...typography.smallBold,
  },
});
