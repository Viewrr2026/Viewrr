/**
 * Relative timestamps.
 *
 * Every Viewrr timestamp column is a text ISO string written by the server, so
 * parsing can fail on legacy or malformed rows — in which case this returns an
 * empty string and the caller simply shows nothing rather than "Invalid Date".
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";

  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";

  const delta = now - timestamp;
  if (delta < 0) return "Just now";
  if (delta < MINUTE) return "Just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** "Good morning" / "Good afternoon" / "Good evening" for the local clock. */
export function greetingFor(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
