import type { UserProfile } from "@/api/types";

/** Pence → "£1,250". Whole pounds unless the amount has real pence. */
export function formatPence(pence: number | null | undefined): string | null {
  if (pence === null || pence === undefined || !Number.isFinite(pence)) return null;
  const pounds = pence / 100;
  return pounds.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Budget range from a brief's two nullable columns. */
export function formatBudget(
  min: number | null | undefined,
  max: number | null | undefined,
  type: string | null | undefined,
): string | null {
  const suffix = type === "day" ? "/day" : type === "hour" ? "/hr" : "";
  const money = (value: number) =>
    value.toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    });

  if (min && max) return `${money(min)}–${money(max)}${suffix}`;
  if (min) return `From ${money(min)}${suffix}`;
  if (max) return `Up to ${money(max)}${suffix}`;
  return null;
}

/** Parse one of the JSON-encoded text columns without throwing. */
export function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type ProfileProgress = {
  /** 0–100, rounded. */
  percent: number;
  complete: number;
  total: number;
  /** The next unfinished item, for the call to action. */
  nextStep: string | null;
};

/**
 * Profile completeness, computed from fields that genuinely exist on the
 * profile row — not a decorative percentage. Each check is a real column the
 * user can fill in, so the number moves when they act on it.
 */
export function profileProgress(
  profile: UserProfile | null,
  user: { avatar?: string | null; headline?: string | null; bio?: string | null; location?: string | null } | null,
): ProfileProgress {
  const checks: { label: string; done: boolean }[] = [
    { label: "Add a profile photo", done: Boolean(user?.avatar) },
    { label: "Write a headline", done: Boolean(user?.headline) },
    { label: "Add a short bio", done: Boolean(user?.bio) },
    { label: "Set your location", done: Boolean(user?.location) },
    { label: "Choose your specialisms", done: parseJsonArray(profile?.specialisms).length > 0 },
    { label: "List your skills", done: parseJsonArray(profile?.skills).length > 0 },
    { label: "Add a showreel", done: Boolean(profile?.reelUrl) },
    { label: "Upload portfolio work", done: parseJsonArray(profile?.portfolioItems).length > 0 },
    { label: "Set your rate", done: Boolean(profile?.dayRate ?? profile?.hourlyRate) },
  ];

  const complete = checks.filter((check) => check.done).length;
  const nextStep = checks.find((check) => !check.done)?.label ?? null;

  return {
    percent: Math.round((complete / checks.length) * 100),
    complete,
    total: checks.length,
    nextStep,
  };
}
