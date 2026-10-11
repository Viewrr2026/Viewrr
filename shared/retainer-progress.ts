export function retainerProgress(data: any, now = new Date()) {
  const cycles: any[] = data.cycles ?? [];
  const tasks: any[] = data.tasks ?? [];
  const date = (value: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
  const today = date(now.toISOString());
  const approved = tasks.filter(t => t.status === "complete").length;
  const completed = cycles.filter(c => c.accepted_at && c.paid_at);
  // Include overdue unaccepted cycles so missing work cannot inflate the rate.
  const measured = cycles.filter(c => c.accepted_at || c.period_end < today);
  const onTime = measured.filter(c => c.accepted_at && date(c.accepted_at) <= c.period_end);
  const ratings = (data.satisfaction ?? []).map((s: any) => Number(s.score))
    .filter((s: number) => Number.isFinite(s) && s >= 1 && s <= 5);
  const paid = cycles.filter(c => c.paid_at).reduce((n, c) => n + Number(c.amount_pence), 0);
  const refunded = (data.refundHistory ?? []).filter((r: any) => r.status === "succeeded")
    .reduce((n: number, r: any) => n + Number(r.amount_pence), 0);
  return {
    totalCycles: cycles.length, completedCycles: completed.length,
    totalTasks: tasks.length, approvedTasks: approved,
    progress: tasks.length ? Math.round(approved / tasks.length * 100) : 0,
    onTimeRate: measured.length ? Math.round(onTime.length / measured.length * 100) : null,
    measuredCycles: measured.length, onTimeCycles: onTime.length,
    satisfaction: ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null,
    ratingCount: ratings.length,
    paid, refunded, total: cycles.reduce((n, c) => n + Number(c.amount_pence), 0),
    awaitingPayment: cycles.filter(c => c.accepted_at && !c.paid_at).length,
    nextCycle: cycles.find(c => !c.paid_at) ?? null,
  };
}
