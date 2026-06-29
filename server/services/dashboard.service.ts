import { db } from "../storage";
import * as schema from "../../shared/schema";
import { eq } from "drizzle-orm";

export async function getDashboardData() {
  // ── Marketplace snapshot ──────────────────────────────────────────────────
  const allUsers = await db.select({
    id: schema.users.id,
    role: schema.users.role,
    createdAt: schema.users.createdAt,
  }).from(schema.users);

  const totalFreelancers = allUsers.filter(u => u.role === "freelancer").length;
  const totalClients = allUsers.filter(u => u.role === "client").length;

  // Projects
  const allProjects = await db.select({
    id: schema.projects.id,
    status: schema.projects.status,
    clientId: schema.projects.clientId,
    createdAt: schema.projects.createdAt,
    title: schema.projects.title,
    clientName: schema.projects.clientName,
    freelancerName: schema.projects.freelancerName,
  }).from(schema.projects);

  const activeProjects = allProjects.filter(p => p.status === "active").length;
  const completedProjects = allProjects.filter(p => p.status === "completed").length;

  // Pending applications (brief interests awaiting response)
  const pendingApplications = await db
    .select({ id: schema.briefInterests.id })
    .from(schema.briefInterests)
    .where(eq(schema.briefInterests.status, "pending"));

  // Repeat clients — clients with more than 1 completed project
  const completedByClient: Record<number, number> = {};
  allProjects
    .filter(p => p.status === "completed")
    .forEach(p => { completedByClient[p.clientId] = (completedByClient[p.clientId] || 0) + 1; });
  const repeatClients = Object.values(completedByClient).filter(c => c > 1).length;

  // ── Alerts ─────────────────────────────────────────────────────────────────
  // Overdue: active projects older than 90 days with no completion
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const overdueProjects = allProjects.filter(
    p => p.status === "active" && p.createdAt < ninetyDaysAgo
  );

  // Awaiting freelancer: briefs with 0 interests
  const allBriefs = await db.select({
    id: schema.briefs.id,
    title: schema.briefs.title,
    applicationCount: schema.briefs.applicationCount,
    createdAt: schema.briefs.createdAt,
  }).from(schema.briefs).where(eq(schema.briefs.status, "open"));

  const awaitingFreelancer = allBriefs.filter(b => b.applicationCount === 0);

  // Awaiting client: interests accepted but no project created yet
  const acceptedInterests = await db
    .select({ id: schema.briefInterests.id, briefTitle: schema.briefInterests.briefTitle })
    .from(schema.briefInterests)
    .where(eq(schema.briefInterests.status, "accepted"));

  // Payment issues: invoices sent but not paid older than 14 days
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const allInvoices = await db.select({
    id: schema.invoices.id,
    status: schema.invoices.status,
    issuedAt: schema.invoices.issuedAt,
    clientName: schema.invoices.clientName,
    projectTitle: schema.invoices.projectTitle,
    totalPence: schema.invoices.totalPence,
  }).from(schema.invoices);
  const paymentIssues = allInvoices.filter(
    i => i.status === "sent" && i.issuedAt < fourteenDaysAgo
  );

  // Pending approvals: interests pending for > 3 days
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const pendingApprovals = await db
    .select({
      id: schema.briefInterests.id,
      briefTitle: schema.briefInterests.briefTitle,
      freelancerName: schema.briefInterests.freelancerName,
      createdAt: schema.briefInterests.createdAt,
    })
    .from(schema.briefInterests)
    .where(eq(schema.briefInterests.status, "pending"));
  const stalePendingApprovals = pendingApprovals.filter(i => i.createdAt < threeDaysAgo);

  // ── Recent activity ────────────────────────────────────────────────────────
  const recentFreelancers = allUsers
    .filter(u => u.role === "freelancer")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recentClients = allUsers
    .filter(u => u.role === "client")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recentProjects = [...allProjects]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recentCompletedProjects = allProjects
    .filter(p => p.status === "completed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  // ── Marketplace health signals ─────────────────────────────────────────────
  // Simple trend: compare last 30 days vs previous 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const recentCompleted = allProjects.filter(p => p.status === "completed" && p.createdAt > thirtyDaysAgo).length;
  const prevCompleted = allProjects.filter(p => p.status === "completed" && p.createdAt > sixtyDaysAgo && p.createdAt <= thirtyDaysAgo).length;

  const recentRegistrations = allUsers.filter(u => u.createdAt > thirtyDaysAgo).length;
  const prevRegistrations = allUsers.filter(u => u.createdAt > sixtyDaysAgo && u.createdAt <= thirtyDaysAgo).length;

  const healthSignals = {
    completedProjectsTrend: recentCompleted >= prevCompleted ? "up" : "down",
    registrationsTrend: recentRegistrations >= prevRegistrations ? "up" : "down",
    pendingApprovalsCount: stalePendingApprovals.length,
    overdueCount: overdueProjects.length,
    paymentIssuesCount: paymentIssues.length,
    repeatClientsCount: repeatClients,
  };

  // Overall health score: healthy if no overdue, no payment issues, approvals are low
  const healthScore =
    overdueProjects.length === 0 && paymentIssues.length === 0 && stalePendingApprovals.length < 3
      ? "healthy"
      : overdueProjects.length > 3 || paymentIssues.length > 3
      ? "needs_attention"
      : "watch";

  return {
    marketplace: {
      totalFreelancers,
      totalClients,
      activeProjects,
      completedProjects,
      repeatClients,
      pendingApplications: pendingApplications.length,
    },
    activity: {
      recentProjects,
      recentFreelancers,
      recentClients,
      recentCompletedProjects,
    },
    alerts: {
      overdueProjects: overdueProjects.map(p => ({
        id: p.id,
        title: p.title,
        clientName: p.clientName,
        freelancerName: p.freelancerName,
        createdAt: p.createdAt,
      })),
      awaitingFreelancer: awaitingFreelancer.map(b => ({
        id: b.id,
        title: b.title,
        createdAt: b.createdAt,
      })),
      awaitingClient: acceptedInterests.slice(0, 5).map(i => ({
        id: i.id,
        briefTitle: i.briefTitle,
      })),
      paymentIssues: paymentIssues.map(i => ({
        id: i.id,
        clientName: i.clientName,
        projectTitle: i.projectTitle,
        totalPence: i.totalPence,
        issuedAt: i.issuedAt,
      })),
      pendingApprovals: stalePendingApprovals.map(i => ({
        id: i.id,
        briefTitle: i.briefTitle,
        freelancerName: i.freelancerName,
        createdAt: i.createdAt,
      })),
    },
    health: {
      score: healthScore,
      signals: healthSignals,
    },
  };
}
