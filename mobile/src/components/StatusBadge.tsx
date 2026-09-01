import { Pill } from "@/components/Pill";

/**
 * Maps backend status strings to the website's badge vocabulary.
 *
 * The values come from the real columns: projects.status, briefs.status and
 * briefInterests.status in shared/schema.ts. Anything unrecognised is shown
 * verbatim in the neutral tone rather than hidden — a status the app has not
 * been taught about is still information the user should see.
 */

type Tone = "brand" | "neutral" | "available" | "busy" | "unavailable";

const TONES: Record<string, Tone> = {
  // projects.status
  active: "available",
  completed: "brand",
  cancelled: "unavailable",
  paused: "busy",
  // briefs.status
  open: "available",
  closed: "unavailable",
  filled: "brand",
  // briefInterests.status
  pending: "busy",
  viewed: "neutral",
  accepted: "available",
  declined: "unavailable",
  counter_offered: "busy",
  // projects.paymentStatus
  paid: "available",
  unpaid: "busy",
};

const LABELS: Record<string, string> = {
  counter_offered: "Counter offered",
  in_progress: "In progress",
};

function humanise(value: string): string {
  const mapped = LABELS[value];
  if (mapped) return mapped;
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const key = status.toLowerCase();
  return <Pill label={humanise(key)} tone={TONES[key] ?? "neutral"} />;
}
