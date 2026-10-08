/**
 * Firm targets vs actuals for a financial year.
 *
 * Lifted out of /dashboard/finances/progress, which has computed exactly this
 * since it shipped — it was simply buried on its own page, so nobody saw how the
 * firm was tracking against its own targets unless they went looking. A
 * competitor puts the same thing on the dashboard, which is the right place for
 * it. One definition, two consumers: that page and the dashboard panel.
 *
 * A note on direction. Every metric here is "higher is better", so a full bar is
 * unambiguously good. Do NOT add redemptions or stopped-SIPs to this list without
 * also giving metrics a direction — the competitor's version shows
 * "Redemptions ₹8.8L — 100% ✓" in green, celebrating money leaving the book.
 */
import { and, eq, sql } from "drizzle-orm";

import { businessTargets } from "@/db/schema";

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

export type MetricKey =
  | "new_clients"
  | "leads_generated"
  | "meetings_done"
  | "aum_addition"
  | "sip_book_addition"
  | "lumpsum_added";

export const PROGRESS_METRICS: Array<{
  key: MetricKey;
  label: string;
  kind: "count" | "currency";
}> = [
  { key: "new_clients", label: "New clients added", kind: "count" },
  { key: "leads_generated", label: "Leads / referrals generated", kind: "count" },
  { key: "meetings_done", label: "Meetings done", kind: "count" },
  { key: "aum_addition", label: "Total AUM addition (net)", kind: "currency" },
  { key: "sip_book_addition", label: "New SIP book addition", kind: "currency" },
  { key: "lumpsum_added", label: "Fresh lumpsum added", kind: "currency" },
];

/**
 * How far through the financial year we are, 0..1.
 *
 * A progress bar without this is misleading in both directions: 50% of target
 * in September is ON PACE, and 50% in February is a problem. Colouring both the
 * same is the flaw in every "X% achieved" panel — including the competitor's,
 * which shows a bare percentage and leaves the reader to do the arithmetic.
 */
export function fyElapsedFraction(fyStartYear: number, now = new Date()): number {
  const start = Date.UTC(fyStartYear, 3, 1); // 1 April
  const end = Date.UTC(fyStartYear + 1, 2, 31); // 31 March
  const t = now.getTime();
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / (end - start);
}

export type ProgressRow = {
  metric: MetricKey;
  label: string;
  kind: "count" | "currency";
  total: number;
  byMonth: Record<number, number>;
  target: number;
};

/** Rows of {m: calendar month 1-12, v} → {0..11 → value} plus a total. */
function bucket(rows: Array<Record<string, unknown>>): {
  byMonth: Record<number, number>;
  total: number;
} {
  const byMonth: Record<number, number> = {};
  let total = 0;
  for (const r of rows) {
    const month0 = Number(r.m) - 1;
    const v = Number(r.v) || 0;
    byMonth[month0] = (byMonth[month0] ?? 0) + v;
    total += v;
  }
  return { byMonth, total };
}

export async function loadTargetProgress(
  tx: Tx,
  tenantId: string,
  fy: string,
  fyStartYear: number
): Promise<ProgressRow[]> {
  const dateStart = `${fyStartYear}-04-01`;
  const dateEnd = `${fyStartYear + 1}-03-31`;

  // Every query names the tenant: the RLS policy alone (tenant OR platform
  // admin) cannot use the (tenant_id, …) indexes, so without it each scan read
  // every firm's rows for the year — 4 s a call in production.
  const [clients, leadsR, meetings, aum, sipBook, lumpsum, targets] = await Promise.all([
    tx.execute(sql`
      SELECT EXTRACT(MONTH FROM onboarded_at)::int AS m, COUNT(*)::numeric AS v
      FROM investors
      WHERE tenant_id = ${tenantId}::uuid AND onboarded_at >= ${dateStart}::date AND onboarded_at <= ${dateEnd}::date
      GROUP BY 1`),
    tx.execute(sql`
      SELECT EXTRACT(MONTH FROM created_at)::int AS m, COUNT(*)::numeric AS v
      FROM leads
      WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${dateStart}::date AND created_at <= ${dateEnd}::date
      GROUP BY 1`),
    tx.execute(sql`
      SELECT EXTRACT(MONTH FROM meeting_date)::int AS m, COUNT(*)::numeric AS v
      FROM review_meetings
      WHERE tenant_id = ${tenantId}::uuid AND status = 'completed' AND meeting_date >= ${dateStart}::date AND meeting_date <= ${dateEnd}::date
      GROUP BY 1`),
    tx.execute(sql`
      SELECT EXTRACT(MONTH FROM order_date)::int AS m,
        COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount::numeric ELSE -amount::numeric END), 0) AS v
      FROM transactions
      WHERE tenant_id = ${tenantId}::uuid AND status IN ('successful','processed') AND order_date >= ${dateStart}::date AND order_date <= ${dateEnd}::date
      GROUP BY 1`),
    tx.execute(sql`
      SELECT EXTRACT(MONTH FROM created_at)::int AS m, COALESCE(SUM(amount::numeric), 0) AS v
      FROM sips
      WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${dateStart}::date AND created_at <= ${dateEnd}::date
      GROUP BY 1`),
    tx.execute(sql`
      SELECT EXTRACT(MONTH FROM order_date)::int AS m, COALESCE(SUM(amount::numeric), 0) AS v
      FROM transactions
      WHERE tenant_id = ${tenantId}::uuid AND status IN ('successful','processed') AND direction = 'inflow'
        AND type IN ('lumpsum','purchase')
        AND order_date >= ${dateStart}::date AND order_date <= ${dateEnd}::date
      GROUP BY 1`),
    tx
      .select()
      .from(businessTargets)
      .where(and(eq(businessTargets.tenantId, tenantId), eq(businessTargets.fiscalYear, fy))),
  ]);

  const buckets: Record<MetricKey, { byMonth: Record<number, number>; total: number }> = {
    new_clients: bucket(clients.rows as Array<Record<string, unknown>>),
    leads_generated: bucket(leadsR.rows as Array<Record<string, unknown>>),
    meetings_done: bucket(meetings.rows as Array<Record<string, unknown>>),
    aum_addition: bucket(aum.rows as Array<Record<string, unknown>>),
    sip_book_addition: bucket(sipBook.rows as Array<Record<string, unknown>>),
    lumpsum_added: bucket(lumpsum.rows as Array<Record<string, unknown>>),
  };

  const targetByMetric: Record<string, number> = {};
  for (const t of targets as Array<{ metric: string; annualTarget: unknown }>) {
    targetByMetric[t.metric] = Number(t.annualTarget) || 0;
  }

  return PROGRESS_METRICS.map((m) => ({
    metric: m.key,
    label: m.label,
    kind: m.kind,
    total: buckets[m.key].total,
    byMonth: buckets[m.key].byMonth,
    target: targetByMetric[m.key] ?? 0,
  }));
}
