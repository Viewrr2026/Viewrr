import { api } from "@/api/client";
export type DeliverableGroup = {
  id: string;
  name: string;
  quantity: number;
  brief: string;
  itemBriefs?: string[];
};
export type RetainerCycle = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  amountPence: number;
  revisionAllowance: number;
  paymentDays: number;
  earlyStart?: boolean;
  deliverables: DeliverableGroup[];
};
export type RetainerPlan = {
  title: string;
  startDate: string;
  endDate: string;
  gapsAcknowledged: boolean;
  cycles: RetainerCycle[];
};
export type Proposal = {
  status: string;
  latestVersion: number;
  latestPlan: RetainerPlan;
  plan: RetainerPlan;
  feedback: string | null;
  clientId: number;
  freelancerId: number;
  hasAcceptedAgreement: boolean;
  pending: { plan: RetainerPlan; version: number; proposedBy: number } | null;
};
export const retainerConfig = (signal?: AbortSignal) =>
  api.get<{ enabled: boolean }>("/api/custom-retainers/config", { signal });
export const loadProposal = (id: string, signal?: AbortSignal) =>
  api.get<Proposal>(`/api/custom-retainers/${encodeURIComponent(id)}`, {
    signal,
  });
export const sendRetainer = (plan: RetainerPlan, recipientId: number) =>
  api.post("/api/custom-retainers", { plan, recipientId });
export const reviseRetainer = (
  id: string,
  plan: RetainerPlan,
  expectedVersion: number,
) =>
  api.post(`/api/custom-retainers/${encodeURIComponent(id)}/propose`, {
    plan,
    expectedVersion,
  });
export const reviewRetainer = (
  id: string,
  version: number,
  action: "accept" | "request_changes" | "decline",
  feedback: string,
) =>
  api.post(`/api/custom-retainers/${encodeURIComponent(id)}/review`, {
    version,
    action,
    feedback,
  });
