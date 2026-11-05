import { api } from "@/api/client";
import { gbpToPence } from "@/lib/workInputs";

export type Connection = {
  id: number;
  name: string;
  avatar: string | null;
  role: string;
  headline?: string | null;
};
export type Invitation = {
  id: number;
  senderId: number;
  recipientId: number;
  senderName: string;
  recipientName: string;
  senderAvatar: string | null;
  recipientAvatar: string | null;
  title: string;
  status: string;
  description: string | null;
  category: string | null;
  budget: string | null;
  timeline: string | null;
  isRetainer: number;
  billingCycle?: string | null;
  deliverablesPerCycle?: string | null;
  totalCycles?: number | null;
};
export type RetainerInvitation = {
  publicId: string;
  projectId: number;
  status: string;
  senderId: number;
  recipientId: number;
  senderName: string;
  recipientName: string;
  version: number;
  title: string;
  startDate: string;
  endDate: string;
};
export const getInvitations = (signal?: AbortSignal) =>
  api.get<Invitation[]>("/api/invitations", { signal });
export const getRetainerInvitations = (signal?: AbortSignal) =>
  api.get<RetainerInvitation[]>("/api/custom-retainer-invitations", { signal });
export const searchConnections = (q: string, signal?: AbortSignal) =>
  api.get<Connection[]>("/api/users/search", {
    query: { q: q.trim() },
    signal,
  });
export const respondToInvitation = (id: number, action: "accept" | "decline") =>
  api.patch(`/api/invitations/${id}/${action}`, {});

export function invitationsFor<
  T extends { senderId: number; recipientId: number },
>(items: T[], userId: number, tab: "Received" | "Sent") {
  return items.filter(
    (item) =>
      (tab === "Received" ? item.recipientId : item.senderId) === userId,
  );
}

export const PROJECT_CATEGORIES = [
  "Video Production",
  "Photography",
  "Motion Graphics",
  "Editing",
  "Animation",
  "Social Media",
  "Brand Identity",
  "Podcast",
  "Music / Audio",
  "Drone",
  "Event Coverage",
  "Documentary",
];
export const TIMELINES = [
  "Less than 1 week",
  "1–2 weeks",
  "2–4 weeks",
  "1–2 months",
  "2–3 months",
  "3+ months",
];
export const emptyProject = {
  title: "",
  description: "",
  categories: [] as string[],
  customCategory: "",
  budget: "",
  timeline: "",
};
export type ProjectDraft = typeof emptyProject;

export function projectTerms(form: ProjectDraft) {
  if (form.title.trim().length < 3 || form.title.trim().length > 500)
    throw new Error("Enter a project title between 3 and 500 characters.");
  const pence = gbpToPence(form.budget);
  if (pence < 50 || pence > 10_000_000)
    throw new Error("Enter a provisional estimate between £0.50 and £100,000.");
  const category = [...form.categories, form.customCategory.trim()]
    .filter(Boolean)
    .join(", ");
  return {
    title: form.title.trim(),
    budget: (pence / 100).toFixed(2),
    isRetainer: 0,
    startStage: 0,
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    ...(category ? { category } : {}),
    ...(form.timeline ? { timeline: form.timeline } : {}),
  };
}
export function sendProjectInvitation(form: ProjectDraft, recipientId: number) {
  return api.post<Invitation>("/api/invitations", {
    ...projectTerms(form),
    recipientId,
  });
}
