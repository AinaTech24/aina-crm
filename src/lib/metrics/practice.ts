/**
 * The Owner Dashboard's view of the book as a practice — how it has moved,
 * how healthy the SIP book is, where the money sits, what the book is made
 * of, what it earns and what the automations did. SERVER-ONLY.
 *
 *   getStockHistory      AUM and SIP book month by month, as RECORDED
 *   getSipHealth         persistency, SIPs started / stopped, rejections
 *   getAumMix            AUM by fund house and by client tier
 *   getClientMix         live clients by state, and exits
 *   getBrokerage         brokerage by month and by fund house
 *   getAutomationMonth   what the workflows did this month
 *
 * Same rules as every file here: an explicit tenant predicate, the scope's
 * client spine (investors.rm_id / branch_id and the client filters), and a
 * figure that was never recorded is null, not zero.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cleanIds, clientRecordWhere, clientWhere, hasClientFilter, uuidList, type MetricScope, type MetricPeriod } from "./scope";
import { getSipBook } from "./sip";
import { getStockMonthAgo } from "./history";
import { getEntrySipFlow } from "./entries";
import { getActiveClients } from "./clients";
import { getNewClients } from "./new-clients";
import { inOrder } from "./in-order";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ───────────────────────────── stock history ───────────────────────────── */

export type StockPoint = { month: string; aum: number; sip: number };

/**
 * AUM and the SIP book at the end of each of the last `months` months — the
 * last recorded day of each month from the nightly snapshots (firm, branch or
 * RM, as lib/metrics/history.ts). A balance cannot be recomputed for a past
 * date, so a month with no snapshot is simply missing, and a slice that was
 * never recorded (a segment, an RM inside a branch) returns no history.
 */
export async function getStockHistory(tx: Tx, scope: MetricScope, months = 12): Promise<StockPoint[]> {
  if (hasClientFilter(scope) || scope.amcs?.length) return [];
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  let rows: Array<{ month: string; aum: string; sip: string }>;
  const since = sql`(date_trunc('month', current_date) - make_interval(months => ${months - 1}::int))::date`;
  if (!rms.length && !branches.length) {
    rows = (await tx.execute(sql`
      WITH last AS (
        SELECT DISTINCT ON (date_trunc('month', snapshot_date)) snapshot_date, total_aum, monthly_sip
          FROM firm_snapshots
         WHERE tenant_id = ${scope.tenantId}::uuid AND snapshot_date >= ${since}
         ORDER BY date_trunc('month', snapshot_date), snapshot_date DESC
      )
      SELECT to_char(snapshot_date, 'YYYY-MM') AS month, total_aum AS aum, monthly_sip AS sip FROM last ORDER BY 1
    `)).rows as typeof rows;
  } else if ((rms.length > 0) !== (branches.length > 0)) {
    const [table, key, ids] = rms.length
      ? [sql`rm_snapshots`, sql`rm_id`, rms]
      : [sql`branch_snapshots`, sql`branch_id`, branches];
    // Every RM / branch of the slice must have a row that day, or the sum is partial.
    rows = (await tx.execute(sql`
      WITH days AS (
        SELECT snapshot_date, SUM(aum) AS aum, SUM(monthly_sip) AS sip, COUNT(*) AS n
          FROM ${table}
         WHERE tenant_id = ${scope.tenantId}::uuid AND ${key} IN (${uuidList(ids)}) AND snapshot_date >= ${since}
         GROUP BY snapshot_date
      ), whole AS (
        SELECT * FROM days WHERE n >= ${ids.length}
      ), last AS (
        SELECT DISTINCT ON (date_trunc('month', snapshot_date)) snapshot_date, aum, sip
          FROM whole ORDER BY date_trunc('month', snapshot_date), snapshot_date DESC
      )
      SELECT to_char(snapshot_date, 'YYYY-MM') AS month, aum, sip FROM last ORDER BY 1
    `)).rows as typeof rows;
  } else {
    return [];
  }
  return rows.map((r) => ({ month: r.month, aum: num(r.aum), sip: num(r.sip) }));
}

/* ─────────────────────────────── SIP health ─────────────────────────────── */

export type SipHealth = {
  /** The SIP book now (getSipBook). */
  monthly: number;
  sips: number;
  /** The book recorded about a month ago; null when it was not recorded. */
  monthAgo: number | null;
  /** SIPs registered / stopped in the period. */
  started: number;
  stopped: number;
  rejections: number;
  topReasons: Array<{ reason: string; count: number }>;
  /** % of the SIPs started 12–15 / 36–39 months ago that still run; null with no cohort. */
  persistency1y: number | null;
  persistency3y: number | null;
  cohort1y: number;
  cohort3y: number;
};

/**
 * Persistency is the share of SIPs that started N months ago and are still
 * active: the 12–15-month cohort (1 year) and the 36–39-month cohort (3
 * years), SIPs of client records not deleted or merged. Started / stopped are
 * BOOKED in the period — SIP and SIP-stop lines on Business Entries
 * (lib/metrics/entries.ts), like every dashboard's business figures.
 */
export async function getSipHealth(tx: Tx, scope: MetricScope, period: MetricPeriod): Promise<SipHealth> {
  const [book, then, booked, p, reasons] = await inOrder(
    () => getSipBook(tx, scope),
    () => getStockMonthAgo(tx, scope),
    () => getEntrySipFlow(tx, scope, period),
    () => tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE s.start_date BETWEEN current_date - interval '15 months' AND current_date - interval '12 months')::int AS c1,
        COUNT(*) FILTER (WHERE s.start_date BETWEEN current_date - interval '15 months' AND current_date - interval '12 months'
                           AND s.status = 'active')::int AS a1,
        COUNT(*) FILTER (WHERE s.start_date BETWEEN current_date - interval '39 months' AND current_date - interval '36 months')::int AS c3,
        COUNT(*) FILTER (WHERE s.start_date BETWEEN current_date - interval '39 months' AND current_date - interval '36 months'
                           AND s.status = 'active')::int AS a3
        FROM sips s JOIN investors i ON i.id = s.investor_id
       WHERE s.tenant_id = ${scope.tenantId}::uuid AND ${clientRecordWhere(scope, "i")}
    `),
    () => tx.execute(sql`
      SELECT COALESCE(NULLIF(btrim(r.rejection_reason), ''), 'Reason not recorded') AS reason, COUNT(*)::int AS c
        FROM sip_rejections r JOIN investors i ON i.id = r.investor_id
       WHERE r.tenant_id = ${scope.tenantId}::uuid AND ${clientRecordWhere(scope, "i")}
         AND r.rejection_date BETWEEN ${period.from}::date AND ${period.to}::date
       GROUP BY 1 ORDER BY c DESC
    `),
  );
  const x = p.rows[0] as Record<string, unknown> | undefined;
  const c1 = num(x?.c1);
  const c3 = num(x?.c3);
  const rs = reasons.rows as Array<{ reason: string; c: unknown }>;
  return {
    monthly: book.monthly,
    sips: book.sips,
    monthAgo: then ? then.sip : null,
    started: booked.addedCount,
    stopped: booked.stoppedCount,
    rejections: rs.reduce((a, r) => a + num(r.c), 0),
    topReasons: rs.slice(0, 3).map((r) => ({ reason: r.reason, count: num(r.c) })),
    persistency1y: c1 > 0 ? (num(x?.a1) / c1) * 100 : null,
    persistency3y: c3 > 0 ? (num(x?.a3) / c3) * 100 : null,
    cohort1y: c1,
    cohort3y: c3,
  };
}

/* ──────────────────────────────── AUM mix ──────────────────────────────── */

export type AumShare = { key: string; label: string; aum: number; pct: number; count: number };
export type AumMix = { byAmc: AumShare[]; amcBook: number; byTier: AumShare[]; tierBook: number };

/**
 * Where the money sits. By fund house: the five largest AMCs by folio AUM of
 * live clients in scope, each as a share of the WHOLE folio book (not of the
 * five), plus the rest. By client tier: investors.aum by client category
 * A–D (a blank category is "Not tiered").
 */
export async function getAumMix(tx: Tx, scope: MetricScope): Promise<AumMix> {
  const [amc, tier] = await inOrder(
    () => tx.execute(sql`
      SELECT COALESCE(NULLIF(btrim(f.amc_name), ''), 'Fund house not recorded') AS name,
             SUM(f.aum)::numeric AS aum, COUNT(*)::int AS folios
        FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${scope.tenantId}::uuid AND f.aum > 0 AND ${clientWhere(scope, "i")}
         ${scope.amcs?.length ? sql`AND f.amc_name IN (${sql.join(scope.amcs.map((a) => sql`${a}`), sql`, `)})` : sql``}
       GROUP BY 1 ORDER BY aum DESC
    `),
    () => tx.execute(sql`
      SELECT COALESCE(NULLIF(upper(btrim(i.client_category)), ''), 'NONE') AS tier,
             COALESCE(SUM(i.aum), 0)::numeric AS aum, COUNT(*)::int AS clients
        FROM investors i
       WHERE ${clientWhere(scope, "i")} AND COALESCE(i.aum, 0) > 0
       GROUP BY 1 ORDER BY 1
    `),
  );
  const amcRows = amc.rows as Array<{ name: string; aum: unknown; folios: unknown }>;
  const amcBook = amcRows.reduce((a, r) => a + num(r.aum), 0);
  const top = amcRows.slice(0, 5).map((r) => ({
    key: r.name, label: r.name, aum: num(r.aum), count: num(r.folios), pct: amcBook > 0 ? (num(r.aum) / amcBook) * 100 : 0,
  }));
  const restRows = amcRows.slice(5);
  if (restRows.length) {
    const aum = restRows.reduce((a, r) => a + num(r.aum), 0);
    top.push({
      key: "__rest", label: `${restRows.length} other fund house${restRows.length === 1 ? "" : "s"}`, aum,
      count: restRows.reduce((a, r) => a + num(r.folios), 0), pct: amcBook > 0 ? (aum / amcBook) * 100 : 0,
    });
  }
  const tierRows = tier.rows as Array<{ tier: string; aum: unknown; clients: unknown }>;
  const tierBook = tierRows.reduce((a, r) => a + num(r.aum), 0);
  const order = ["A", "B", "C", "D"];
  const byTier = tierRows
    .map((r) => ({
      key: r.tier,
      label: r.tier === "NONE" ? "Not tiered" : order.includes(r.tier) ? `Category ${r.tier}` : r.tier,
      aum: num(r.aum), count: num(r.clients), pct: tierBook > 0 ? (num(r.aum) / tierBook) * 100 : 0,
    }))
    .sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
  return { byAmc: top, amcBook, byTier, tierBook };
}

/* ─────────────────────────────── client mix ─────────────────────────────── */

export type ClientMix = {
  clients: number;
  active: number;
  funded: number;
  newInPeriod: number;
  inFamily: number;
  dormant: number;
  atRisk: number;
  /** Clients who left (closed / exited) in the period, and what they had put in, net. */
  exits: number;
  exitNetInflow: number;
};

/**
 * The live book by state (lib/metrics getActiveClients: active = active or
 * redemption risk; funded = AUM above zero), new clients by onboarding date
 * (getNewClients), and the clients who left in the period — their lifetime
 * inflow minus outflow, never below zero, as the money the book lost with them.
 */
export async function getClientMix(tx: Tx, scope: MetricScope, period: MetricPeriod): Promise<ClientMix> {
  const [counts, fresh, r, gone] = await inOrder(
    () => getActiveClients(tx, scope),
    () => getNewClients(tx, scope, period),
    () => tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE i.status IN ('dormant', 'inactive'))::int AS dormant,
             COUNT(*) FILTER (WHERE i.status = 'redemption_risk')::int       AS at_risk,
             COUNT(*) FILTER (WHERE i.family_id IS NOT NULL)::int            AS in_family
        FROM investors i
       WHERE ${clientWhere(scope, "i")}
    `),
    () => tx.execute(sql`
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(GREATEST(COALESCE(i.lifetime_inflow, 0) - COALESCE(i.lifetime_outflow, 0), 0)), 0)::numeric AS net
        FROM investors i
       WHERE ${clientRecordWhere(scope, "i")}
         AND i.status IN ('closed', 'exited')
         AND (i.exited_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${period.from}::date AND ${period.to}::date
    `),
  );
  const x = r.rows[0] as Record<string, unknown> | undefined;
  const g = gone.rows[0] as Record<string, unknown> | undefined;
  return {
    clients: counts.clients,
    active: counts.active,
    funded: counts.funded,
    newInPeriod: fresh,
    inFamily: num(x?.in_family),
    dormant: num(x?.dormant),
    atRisk: num(x?.at_risk),
    exits: num(g?.n),
    exitNetInflow: num(g?.net),
  };
}

/* ─────────────────────────────── brokerage ─────────────────────────────── */

export type Brokerage = {
  /** Brokerage by statement month (the month its period ends), oldest first. */
  byMonth: Array<{ month: string; amount: number }>;
  /** The latest statement month's brokerage by fund house, largest first. */
  byAmc: Array<{ amc: string; amount: number }>;
  latestMonth: string | null;
  /** Σ brokerage for statements ending inside the period. */
  inPeriod: number;
  /** A statement covers the period (else the period's brokerage is unknown, not zero). */
  hasData: boolean;
};

/**
 * What the practice earned, from the imported Monthly Brokerage Statements
 * (commission_rows; lib/rta/process.ts). Firm-wide by construction: a
 * statement is the ARN's, and its rows are not tied to an RM.
 */
export async function getBrokerage(tx: Tx, tenantId: string, period: MetricPeriod, months = 12): Promise<Brokerage> {
  const [m, a] = await inOrder(
    () => tx.execute(sql`
      SELECT to_char(date_trunc('month', period_end), 'YYYY-MM') AS month, COALESCE(SUM(brokerage_amount), 0)::numeric AS amount
        FROM commission_rows
       WHERE tenant_id = ${tenantId}::uuid
         AND period_end >= (date_trunc('month', current_date) - make_interval(months => ${months - 1}::int))::date
       GROUP BY 1 ORDER BY 1
    `),
    () => tx.execute(sql`
      WITH latest AS (SELECT MAX(date_trunc('month', period_end)) AS m FROM commission_rows WHERE tenant_id = ${tenantId}::uuid)
      SELECT upper(btrim(c.amc_code)) AS amc, COALESCE(SUM(c.brokerage_amount), 0)::numeric AS amount
        FROM commission_rows c, latest
       WHERE c.tenant_id = ${tenantId}::uuid AND date_trunc('month', c.period_end) = latest.m
       GROUP BY 1 ORDER BY amount DESC
    `),
  );
  const byMonth = (m.rows as Array<{ month: string; amount: unknown }>).map((r) => ({ month: r.month, amount: num(r.amount) }));
  const latestMonth = byMonth.length ? byMonth[byMonth.length - 1].month : null;
  const inRange = byMonth.filter((x) => x.month >= period.from.slice(0, 7) && x.month <= period.to.slice(0, 7));
  return {
    byMonth,
    byAmc: (a.rows as Array<{ amc: string; amount: unknown }>).map((r) => ({ amc: r.amc, amount: num(r.amount) })),
    latestMonth,
    inPeriod: inRange.reduce((s, x) => s + x.amount, 0),
    hasData: inRange.length > 0,
  };
}

/* ──────────────────────────── automation month ──────────────────────────── */

export type AutomationMonth = {
  runs: number;
  sent: number;
  tasks: number;
  complianceBlocks: number;
  /** An estimate: 2 minutes per message, 5 per run, 3 per task. */
  hoursSaved: number;
};

/**
 * What the automations did this India calendar month: workflow runs
 * completed, messages they sent, tasks they created, and sends the compliance
 * gate stopped. Firm-wide.
 */
export async function getAutomationMonth(tx: Tx, tenantId: string): Promise<AutomationMonth> {
  const monthStart = sql`(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  const r = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM workflow_runs
        WHERE tenant_id = ${tenantId}::uuid AND status = 'completed' AND completed_at >= ${monthStart}) AS runs,
      (SELECT COUNT(*)::int FROM communications
        WHERE tenant_id = ${tenantId}::uuid AND workflow_run_id IS NOT NULL AND sent_at >= ${monthStart}) AS sent,
      (SELECT COUNT(*)::int FROM communications
        WHERE tenant_id = ${tenantId}::uuid AND status = 'skipped_compliance' AND created_at >= ${monthStart}) AS blocks,
      (SELECT COUNT(*)::int FROM tasks
        WHERE tenant_id = ${tenantId}::uuid AND workflow_run_id IS NOT NULL AND created_at >= ${monthStart}) AS tasks
  `)).rows[0] as Record<string, unknown> | undefined;
  const runs = num(r?.runs);
  const sent = num(r?.sent);
  const tasks = num(r?.tasks);
  return { runs, sent, tasks, complianceBlocks: num(r?.blocks), hoursSaved: (sent * 2 + runs * 5 + tasks * 3) / 60 };
}
