import { api } from "@/api/client";
import type { Brief } from "@/api/types";
import { gbpToPence, isCalendarDate } from "@/lib/workInputs";

export const BRIEF_CATEGORIES = [
  "Videography",
  "Video Editing",
  "Photography",
  "Marketing",
  "Other",
] as const;
export const DURATIONS = [
  "Half day",
  "1 day",
  "2–3 days",
  "1 week",
  "2–4 weeks",
  "1–3 months",
  "Ongoing",
] as const;
export const BUDGET_TYPES = [
  "Total project budget",
  "Per day rate",
  "Per hour rate",
] as const;
const budgetKeys = ["project", "day", "hour"];

/** Fetch before filtering: the existing endpoint applies filters after pagination. */
export async function loadBriefBoard(signal?: AbortSignal): Promise<Brief[]> {
  const briefs = new Map<number, Brief>();
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const page = await api.get<Brief[]>("/api/briefs", {
      query: { limit, offset },
      signal,
    });
    const previousSize = briefs.size;
    for (const brief of page) briefs.set(brief.id, brief);
    if (page.length < limit || signal?.aborted) break;
    if (briefs.size === previousSize)
      throw new Error(
        "The briefs could not be loaded completely. Please retry.",
      );
  }
  return [...briefs.values()].filter(
    (brief) => brief.isActive !== false && brief.status === "open",
  );
}

export function filterBriefBoard(
  briefs: Brief[],
  search: string,
  category: string,
  ownerId?: number,
) {
  const term = search.trim().toLowerCase();
  return briefs.filter(
    (brief) =>
      (ownerId === undefined || brief.clientId === ownerId) &&
      (category === "All" ||
        brief.category
          .split(",")
          .map((part) => part.trim())
          .includes(category)) &&
      [
        brief.title,
        brief.clientName,
        brief.location,
        brief.description,
        brief.category,
      ].some((value) => value?.toLowerCase().includes(term)),
  );
}

export const emptyBrief = {
  title: "",
  categories: [] as string[],
  description: "",
  location: "",
  remote: false,
  startDate: "",
  duration: "",
  budgetType: "Total project budget",
  budgetMin: "",
  budgetMax: "",
  requirements: "",
};
export type BriefDraft = typeof emptyBrief;

export async function createBrief(form: BriefDraft): Promise<Brief> {
  if (!form.title.trim()) throw new Error("Please add a title.");
  if (!form.categories.length) throw new Error("Choose at least one category.");
  if (form.description.trim().length < 50)
    throw new Error("Describe the brief in at least 50 characters.");
  if (!form.location.trim()) throw new Error("Please enter a location.");
  if (form.startDate && !isCalendarDate(form.startDate))
    throw new Error("Enter a valid start date as YYYY-MM-DD.");
  const min = form.budgetMin.trim() ? gbpToPence(form.budgetMin) / 100 : null;
  const max = form.budgetMax.trim() ? gbpToPence(form.budgetMax) / 100 : null;
  if (min !== null && max !== null && min > max)
    throw new Error("The maximum budget must be at least the minimum.");
  return api.post<Brief>("/api/briefs", {
    title: form.title.trim(),
    description: form.description.trim(),
    category: form.categories.join(", "),
    location: form.location.trim(),
    remote: form.remote ? 1 : 0,
    startDate: form.startDate || null,
    duration: form.duration || null,
    budgetType:
      budgetKeys[
        BUDGET_TYPES.indexOf(form.budgetType as (typeof BUDGET_TYPES)[number])
      ] ?? "project",
    budgetMin: min,
    budgetMax: max,
    requirements: form.requirements.trim(),
  });
}

export const emptyInterest = {
  coverNote: "",
  rate: "",
  availability: "",
  price: "",
  priceBreakdown: "",
};
export async function expressInterest(
  briefId: number,
  form: typeof emptyInterest,
) {
  if (!form.coverNote.trim())
    throw new Error("Add a short note about why you're a good fit.");
  return api.post("/api/interests", {
    briefId,
    coverNote: form.coverNote.trim(),
    rate: form.rate.trim() || null,
    availability: form.availability.trim() || null,
    priceBreakdown: form.priceBreakdown.trim() || null,
    proposedPricePence: form.price.trim() ? gbpToPence(form.price) : null,
  });
}
