/**
 * The branch command centre's own sections — the ones with no personal
 * counterpart. SERVER-ONLY.
 *
 * Everything that IS shared with the personal cockpit (KPIs, reviews, funnel,
 * proposals, SIP health, queries, data quality…) runs the SAME loaders from
 * src/lib/dashboard/my/* with a branch scope. Everything per-RM comes from the
 * RM ledger. This file holds only what a branch head needs that an RM does not:
 *
 *   §6  SIP performance (fixed MTD / previous month / FYTD windows, by RM)
 *   §8  investment flow by product, from Business Entries
 *   §10 new-client acquisition, by source
 *   §20 insurance snapshot
 *   §24 operations snapshot
 *   §25 management attention centre
 *   §27/§28 weekly and monthly review modes
 *   §30 FY scorecard
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { formatDate, humanise } from "@/lib/format";
import type { DashboardThresholds } from "@/lib/dashboard/thresholds";
import {
  asInList, clientIds, clientsWhere, clientsWhereOn, clientRecordsWhereOn, FINANCIAL_TASK_TYPES, GROSS_TYPES, leadsMatch, num,
  onboardedInSql,
  premiumMatch, PROPOSAL_LIVE, REDEMPTION_TYPES, SIP_STOP_TYPES, SR_OPEN_ON_US, staffMatch,
  TASK_DEAD, type MyWindow, type TargetKey,
  taskIsAbout,
} from "../my/window";
import { phaseFraction } from "../my/kpis";
import { NO_RM, OTHER_BRANCH, type RmLedgerRow } from "./rm-ledger";
import { inOrder } from "@/lib/metrics/in-order";

// Every loader here runs inside ONE transaction: queries go one after
// another (inOrder, lib/metrics/in-order.ts), never Promise.all.

const GROSS_IN = asInList(GROSS_TYPES);
const RED_IN = asInList(REDEMPTION_TYPES);
const STOP_IN = asInList(SIP_STOP_TYPES);

/** yyyy-mm-dd helpers on LOCAL dates — see build-window.ts on why not UTC. */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parse(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/* ─────────────────────────── windowed metrics ─────────────────────────── */

/**
 * The branch's headline flows over ANY window, in one round trip. §6, §27 and
 * §28 all compare a figure across two windows; defining the figure once here
 * means the weekly review, the monthly review and the SIP section cannot give
 * three answers to "what was net SIP last week".
 */
export type WindowMetrics = {
  grossSip: number; sipStop: number; netSip: number;
  grossInvestment: number; redemption: number; netBusiness: number;
  newClients: number; newMeetings: number; reviewMeetings: number; meetings: number;
  newLeads: number; riskProfiles: number;
  lifePremium: number; healthPremium: number; generalPremium: number; insurance: number;
  tasksCompleted: number; tasksPending: number;
  /** Tasks where money moves (FINANCIAL_TASK_TYPES), completed in the window. */
  finTasksCompleted: number;
  proposalsCreated: number;
  sipRejections: number; queriesReceived: number; queriesSolved: number;
};

const LIFE = asInList(["term", "ulip", "endowment", "money_back", "life_other"]);
const FIN_TYPES = asInList(FINANCIAL_TASK_TYPES);
const HEALTH = asInList(["health", "critical_illness", "group_health"]);

export async function loadWindowMetrics(
  tx: Tx, w: MyWindow, from: string, to: string,
): Promise<WindowMetrics> {
  const MINE = clientIds(w.scope);
  const DEAD = asInList(TASK_DEAD);
  const r = (await tx.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(amount::numeric), 0) FROM sips
        WHERE investor_id IN ${MINE} AND start_date BETWEEN ${from}::date AND ${to}::date) AS gross_sip,
      (SELECT COALESCE(SUM(amount::numeric), 0) FROM transactions
        WHERE investor_id IN ${MINE} AND type IN (${STOP_IN}) AND status IN ('processed','successful')
          AND order_date BETWEEN ${from}::date AND ${to}::date) AS sip_stop,
      (SELECT COALESCE(SUM(amount::numeric), 0) FROM transactions
        WHERE investor_id IN ${MINE} AND type IN (${GROSS_IN}) AND status IN ('processed','successful')
          AND order_date BETWEEN ${from}::date AND ${to}::date) AS gross,
      (SELECT COALESCE(SUM(amount::numeric), 0) FROM transactions
        WHERE investor_id IN ${MINE} AND type IN (${RED_IN}) AND status IN ('processed','successful')
          AND order_date BETWEEN ${from}::date AND ${to}::date) AS redemption,
      (SELECT COUNT(*)::int FROM investors i
        WHERE ${clientRecordsWhereOn("i", w.scope)} AND ${onboardedInSql({ from, to }, "i")}) AS new_clients,
      (SELECT COUNT(*) FILTER (WHERE category = 'new')::int FROM review_meetings
        WHERE ${staffMatch("rm_id", w)} AND status = 'completed'
          AND meeting_date >= ${from}::date AND meeting_date < (${to}::date + 1)) AS new_meetings,
      (SELECT COUNT(*) FILTER (WHERE category = 'review')::int FROM review_meetings
        WHERE ${staffMatch("rm_id", w)} AND status = 'completed'
          AND meeting_date >= ${from}::date AND meeting_date < (${to}::date + 1)) AS review_meetings,
      (SELECT COUNT(*)::int FROM review_meetings
        WHERE ${staffMatch("rm_id", w)} AND status = 'completed'
          AND meeting_date >= ${from}::date AND meeting_date < (${to}::date + 1)) AS meetings,
      (SELECT COUNT(*)::int FROM leads
        WHERE ${leadsMatch(w)} AND created_at >= ${from}::date AND created_at < (${to}::date + 1)) AS new_leads,
      (SELECT COUNT(*)::int FROM investors
        WHERE ${clientsWhere(w.scope)} AND COALESCE(risk_profile_provisional, false) = false
          AND risk_profile_signed_at >= ${from}::date AND risk_profile_signed_at < (${to}::date + 1)) AS risk_profiles,
      (SELECT COALESCE(SUM(annual_premium::numeric) FILTER (WHERE policy_type IN (${LIFE})), 0)
         FROM insurance_policies WHERE ${premiumMatch(w)} AND status NOT IN ('lapsed','surrendered','cancelled')
          AND policy_start_date BETWEEN ${from}::date AND ${to}::date) AS life,
      (SELECT COALESCE(SUM(annual_premium::numeric) FILTER (WHERE policy_type IN (${HEALTH})), 0)
         FROM insurance_policies WHERE ${premiumMatch(w)} AND status NOT IN ('lapsed','surrendered','cancelled')
          AND policy_start_date BETWEEN ${from}::date AND ${to}::date) AS health,
      (SELECT COALESCE(SUM(annual_premium::numeric) FILTER (WHERE policy_type NOT IN (${LIFE}) AND policy_type NOT IN (${HEALTH})), 0)
         FROM insurance_policies WHERE ${premiumMatch(w)} AND status NOT IN ('lapsed','surrendered','cancelled')
          AND policy_start_date BETWEEN ${from}::date AND ${to}::date) AS general,
      (SELECT COUNT(*)::int FROM tasks
        WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL AND status = 'completed'
          AND completed_at >= ${from}::date AND completed_at < (${to}::date + 1)) AS tasks_done,
      (SELECT COUNT(*)::int FROM tasks
        WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL AND status NOT IN (${DEAD})
          AND created_at < (${to}::date + 1)) AS tasks_pending,
      (SELECT COUNT(*)::int FROM tasks
        WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL AND status = 'completed'
          AND type IN (${FIN_TYPES})
          AND completed_at >= ${from}::date AND completed_at < (${to}::date + 1)) AS fin_tasks_done,
      (SELECT COUNT(*)::int FROM proposals
        WHERE ${staffMatch("prepared_by_user_id", w)}
          AND created_at >= ${from}::date AND created_at < (${to}::date + 1)) AS proposals_created,
      (SELECT COUNT(*)::int FROM transactions
        WHERE investor_id IN ${MINE} AND status = 'rejected' AND type IN ('sip','sip_topup')
          AND order_date BETWEEN ${from}::date AND ${to}::date) AS sip_rejections,
      (SELECT COUNT(*)::int FROM service_requests
        WHERE investor_id IN ${MINE} AND created_at >= ${from}::date AND created_at < (${to}::date + 1)) AS q_in,
      (SELECT COUNT(*)::int FROM service_requests
        WHERE investor_id IN ${MINE} AND resolved_at >= ${from}::date AND resolved_at < (${to}::date + 1)) AS q_out
  `)).rows[0] as Record<string, unknown>;

  const life = num(r?.life), health = num(r?.health), general = num(r?.general);
  return {
    grossSip: num(r?.gross_sip),
    sipStop: num(r?.sip_stop),
    netSip: num(r?.gross_sip) - num(r?.sip_stop),
    grossInvestment: num(r?.gross),
    redemption: num(r?.redemption),
    netBusiness: num(r?.gross) - num(r?.redemption),
    newClients: num(r?.new_clients),
    newMeetings: num(r?.new_meetings),
    reviewMeetings: num(r?.review_meetings),
    meetings: num(r?.meetings),
    newLeads: num(r?.new_leads),
    riskProfiles: num(r?.risk_profiles),
    lifePremium: life,
    healthPremium: health,
    generalPremium: general,
    insurance: life + health + general,
    tasksCompleted: num(r?.tasks_done),
    tasksPending: num(r?.tasks_pending),
    finTasksCompleted: num(r?.fin_tasks_done),
    proposalsCreated: num(r?.proposals_created),
    sipRejections: num(r?.sip_rejections),
    queriesReceived: num(r?.q_in),
    queriesSolved: num(r?.q_out),
  };
}

/* ───────────────────────── §6 SIP performance ───────────────────────── */

export type SipPerformance = {
  windows: Array<{ key: "mtd" | "prev_month" | "fytd"; label: string; gross: number; stop: number; net: number }>;
  /** FY net-SIP target, and what FY-to-date should be by now under the
   *  firm's phasing (null when phasing is off or no target is set). */
  target: number | null;
  targetToDate: number | null;
  /** Net SIP by RM for the selected period, and SIP-book growth where a
   *  month-old snapshot exists for the RM. */
  byRm: Array<{ id: string; name: string; net: number; bookNow: number; bookGrowth: number | null }>;
};

export async function loadSipPerformance(
  tx: Tx, w: MyWindow, ledger: RmLedgerRow[], target: number | null, phasing: "linear" | "none",
): Promise<SipPerformance> {
  const monthStart = `${w.today.slice(0, 8)}01`;
  const prevMonthStart = (() => {
    const d = parse(monthStart); d.setMonth(d.getMonth() - 1); return ymd(d);
  })();
  const prevMonthEnd = addDays(monthStart, -1);
  const [mtd, prev, fytd] = await inOrder(
    () => loadWindowMetrics(tx, w, monthStart, w.today),
    () => loadWindowMetrics(tx, w, prevMonthStart, prevMonthEnd),
    () => loadWindowMetrics(tx, w, w.fyStart, w.today),
  );

  // SIP book growth needs a recorded balance from about a month ago. RMs
  // without one get null — "not recorded yet", never "no growth".
  const people = ledger.filter((r) => r.kind === "person" && r.isRm);
  const snaps = people.length
    ? ((await tx.execute(sql`
        SELECT DISTINCT ON (rm_id) rm_id::text AS id, monthly_sip::numeric AS sip
          FROM rm_snapshots
         WHERE ${staffMatch("rm_id", w)}
           AND snapshot_date BETWEEN (${w.today}::date - 42) AND (${w.today}::date - 18)
         ORDER BY rm_id, abs(${w.today}::date - 30 - snapshot_date)
      `)).rows as Array<{ id: string; sip: string }>)
    : [];
  const past = new Map(snaps.map((s) => [s.id, num(s.sip)]));

  const phase = phaseFraction(w.fyStart, w.today, w.fyStart, phasing);
  return {
    windows: [
      { key: "mtd", label: "This month", gross: mtd.grossSip, stop: mtd.sipStop, net: mtd.netSip },
      { key: "prev_month", label: "Previous month", gross: prev.grossSip, stop: prev.sipStop, net: prev.netSip },
      { key: "fytd", label: "FY to date", gross: fytd.grossSip, stop: fytd.sipStop, net: fytd.netSip },
    ],
    target,
    targetToDate: target != null && phase != null ? target * phase : null,
    byRm: ledger
      .filter((r) => r.isRm && (r.grossSip !== 0 || r.sipStop !== 0 || r.sipBook !== 0))
      .map((r) => ({
        id: r.id,
        name: r.name,
        net: r.grossSip - r.sipStop,
        bookNow: r.sipBook,
        bookGrowth: past.has(r.id) ? r.sipBook - (past.get(r.id) ?? 0) : null,
      }))
      .sort((a, b) => b.net - a.net),
  };
}

/* ───────────────────────── §8 investment flow ───────────────────────── */

export type FlowBucket = { key: string; label: string; purchase: number; redemption: number; net: number };
export type InvestmentFlow = {
  /** null when the branch has never recorded a business entry. */
  buckets: FlowBucket[] | null;
  byRm: Array<{ id: string; name: string; purchase: number; redemption: number; net: number }>;
  horizon: "mtd" | "fytd";
};

/**
 * Split by PRODUCT, from Business Entries — the Results MIS source.
 *
 * The transaction ledger cannot answer this: it has no SIF, AIF or PMS rows at
 * all, and its scheme category is often blank, so a split built from it would
 * put most of the money under "Other". Business Entries record the product and
 * the asset class explicitly. The consequence is stated on the page: these
 * totals come from a different source from the KPI strip (which reads the RTA
 * ledger) and can differ by timing and coverage. Current AUM never appears
 * here — the brief is explicit that flows and balances must not be mixed.
 *
 * Amounts, asset class and transaction type live on business_entry_LINES (one
 * row per scheme); the header carries only the product and the date. The
 * gross/redemption rule is the Results MIS's (src/lib/business/mis.ts):
 * switch and STP COUNT as gross here, because a business entry records the
 * target asset class explicitly — unlike the RTA ledger, where both legs of a
 * switch arrive as one inflow row and are therefore excluded.
 */
export async function loadInvestmentFlow(
  tx: Tx, w: MyWindow, horizon: "mtd" | "fytd",
): Promise<InvestmentFlow> {
  if (w.scope.kind !== "branch") throw new Error("branch only");
  const from = horizon === "mtd" ? `${w.today.slice(0, 8)}01` : w.fyStart;
  const branchId = w.scope.branchId;
  const oneRm = w.scope.rmId ? sql`AND be.rm_id = ${w.scope.rmId}::uuid` : sql``;
  // A business entry belongs to the branch of its CLIENT when it has one, and
  // otherwise to the branch of the RM who booked it.
  const inBranch = sql`COALESCE(i.branch_id, u.branch_id) = ${branchId}::uuid ${oneRm}`;
  const bucket: SQL = sql`CASE
      WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'equity' THEN 'equity_mf'
      WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'liquid' THEN 'liquid'
      WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'debt'   THEN 'debt'
      WHEN be.product_type = 'mutual_fund'                               THEN 'other_mf'
      WHEN be.product_type IN ('sif','aif','pms')                        THEN be.product_type
      ELSE 'other' END`;

  const ever = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM business_entries be
      LEFT JOIN investors i ON i.id = be.investor_id
      LEFT JOIN users u ON u.id = be.rm_id
     WHERE ${inBranch}
  `)).rows[0] as { n: number } | undefined;

  const rows = (await tx.execute(sql`
    SELECT ${bucket} AS bucket, be.rm_id::text AS rm_id,
           COALESCE(SUM(bel.amount::numeric) FILTER (
             WHERE bel.txn_type IN ('lumpsum','additional_purchase','sip','sip_topup','switch','stp')), 0) AS purchase,
           COALESCE(SUM(bel.amount::numeric) FILTER (WHERE bel.txn_type IN ('redemption','swp')), 0) AS redemption
      FROM business_entries be
      JOIN business_entry_lines bel ON bel.entry_id = be.id
      LEFT JOIN investors i ON i.id = be.investor_id
      LEFT JOIN users u ON u.id = be.rm_id
     WHERE ${inBranch}
       AND be.status IN ('confirmed','emailed')
       AND be.business_date >= ${from}::date AND be.business_date <= ${w.today}::date
     GROUP BY 1, 2
  `)).rows as Array<{ bucket: string; rm_id: string | null; purchase: string; redemption: string }>;

  const names = new Map(
    ((await tx.execute(sql`SELECT id::text AS id, name FROM users WHERE ${staffMatch("id", w)}`))
      .rows as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]),
  );

  const LABELS: Array<[string, string]> = [
    ["equity_mf", "Equity MF"], ["liquid", "Liquid"], ["debt", "Debt"], ["other_mf", "Other MF"],
    ["sif", "SIF"], ["aif", "AIF"], ["pms", "PMS"], ["other", "Other products"],
  ];
  const agg = new Map<string, { p: number; r: number }>();
  const rm = new Map<string, { p: number; r: number }>();
  for (const x of rows) {
    const a = agg.get(x.bucket) ?? { p: 0, r: 0 };
    a.p += num(x.purchase); a.r += num(x.redemption); agg.set(x.bucket, a);
    const key = x.rm_id && names.has(x.rm_id) ? x.rm_id : x.rm_id ? OTHER_BRANCH : NO_RM;
    const b = rm.get(key) ?? { p: 0, r: 0 };
    b.p += num(x.purchase); b.r += num(x.redemption); rm.set(key, b);
  }
  return {
    horizon,
    buckets: num(ever?.n) > 0
      ? LABELS.map(([key, label]) => {
          const a = agg.get(key) ?? { p: 0, r: 0 };
          return { key, label, purchase: a.p, redemption: a.r, net: a.p - a.r };
        })
      : null,
    byRm: [...rm.entries()]
      .map(([id, v]) => ({
        id,
        name: id === OTHER_BRANCH ? "Booked outside the branch" : id === NO_RM ? "No RM recorded" : names.get(id) ?? "—",
        purchase: v.p, redemption: v.r, net: v.p - v.r,
      }))
      .sort((a, b) => b.net - a.net),
  };
}

/* ─────────────────────── §10 new-client acquisition ─────────────────────── */

export type Acquisition = {
  actual: number;
  previousMonth: number;
  fytd: number;
  /** FY target, and the share of it the selected period should carry. */
  fyTarget: number | null;
  periodTarget: number | null;
  /** Where the period's new clients came from — only sources that occur. */
  sources: Array<{ source: string; label: string; clients: number }>;
  byRm: Array<{ id: string; name: string; actual: number; target: number | null }>;
};

/**
 * Source comes from the LEAD a client was converted from (`leads.source`,
 * joined by `converted_investor_id`), because a client record carries no
 * source of its own. A client added directly — an RTA import, a walk-in keyed
 * straight in as a client — has no lead, and is counted as "Not recorded"
 * rather than guessed into a bucket. Only source values the CRM actually holds
 * are shown, as the brief asks.
 */
export async function loadAcquisition(
  tx: Tx, w: MyWindow, ledger: RmLedgerRow[], fyTarget: number | null, phasing: "linear" | "none",
): Promise<Acquisition> {
  const monthStart = `${w.today.slice(0, 8)}01`;
  const prevStart = (() => { const d = parse(monthStart); d.setMonth(d.getMonth() - 1); return ymd(d); })();
  const prevEnd = addDays(monthStart, -1);
  const r = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= ${w.from}::date AND created_at < (${w.to}::date + 1))::int AS cur,
      COUNT(*) FILTER (WHERE created_at >= ${prevStart}::date AND created_at < (${prevEnd}::date + 1))::int AS prev,
      COUNT(*) FILTER (WHERE created_at >= ${w.fyStart}::date AND created_at < (${w.today}::date + 1))::int AS fy
      FROM investors WHERE ${clientsWhere(w.scope)}
  `)).rows[0] as Record<string, unknown>;

  const src = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(btrim(l.source), ''), '__none__') AS source, COUNT(*)::int AS n
      FROM investors i
      LEFT JOIN LATERAL (
        SELECT source FROM leads WHERE converted_investor_id = i.id ORDER BY converted_at DESC NULLS LAST LIMIT 1
      ) l ON TRUE
     WHERE ${clientsWhereOn("i", w.scope)}
       AND i.created_at >= ${w.from}::date AND i.created_at < (${w.to}::date + 1)
     GROUP BY 1 ORDER BY 2 DESC
  `)).rows as Array<{ source: string; n: number }>;

  const phase = phaseFraction(w.from, w.to, w.fyStart, phasing);
  return {
    actual: num(r?.cur),
    previousMonth: num(r?.prev),
    fytd: num(r?.fy),
    fyTarget,
    periodTarget: fyTarget != null && phase != null ? fyTarget * phase : null,
    sources: src.map((s) => ({
      source: s.source,
      label: s.source === "__none__" ? "Not recorded" : humanise(s.source),
      clients: num(s.n),
    })),
    byRm: ledger
      .filter((x) => x.kind === "person" && x.isRm)
      .map((x) => ({
        id: x.id,
        name: x.name,
        actual: x.newClients,
        target: x.targets.new_clients != null && phase != null ? x.targets.new_clients * phase : null,
      })),
  };
}

/* ─────────────────────── §20 insurance snapshot ─────────────────────── */

export type InsuranceSnapshot = {
  /** null when the branch has no policy on record at all. */
  newPremium: number | null;
  renewalPremium: number | null;
  totalPremium: number | null;
  policies: number;
  renewalsDue30: number;
  openClaims: number;
  byLine: Array<{ key: string; label: string; premium: number; policies: number }>;
  byMarket: Array<{ key: string; label: string; premium: number }>;
};

const COMMERCIAL = asInList([
  "fire", "marine", "burglary", "workmen_comp", "group_personal_accident", "group_health",
]);

/**
 * NEW premium is cover that STARTED in the period; RENEWAL premium is premium
 * COLLECTED in the period (`last_premium_date`) on cover that started before
 * it. The firm pulse's first version defined renewal as "started in the
 * period AND started before this FY" — two conditions that cannot both hold
 * inside the current year, so renewal premium always read ₹0.
 */
export async function loadInsuranceSnapshot(tx: Tx, w: MyWindow): Promise<InsuranceSnapshot> {
  const MINE = clientIds(w.scope);
  const t = (await tx.execute(sql`
    SELECT
      COALESCE(SUM(annual_premium::numeric) FILTER (
        WHERE policy_start_date BETWEEN ${w.from}::date AND ${w.to}::date), 0)            AS new_p,
      COALESCE(SUM(annual_premium::numeric) FILTER (
        WHERE policy_start_date < ${w.from}::date
          AND last_premium_date BETWEEN ${w.from}::date AND ${w.to}::date), 0)            AS renew_p,
      COUNT(*) FILTER (WHERE status = 'active')::int                                       AS policies,
      COUNT(*) FILTER (WHERE status = 'active' AND next_premium_due_date
                         BETWEEN ${w.today}::date AND (${w.today}::date + 30))::int        AS due30,
      COUNT(*)::int                                                                        AS any_ever
      FROM insurance_policies
     WHERE ${premiumMatch(w)} AND status NOT IN ('lapsed','surrendered','cancelled')
  `)).rows[0] as Record<string, unknown>;

  const claims = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM insurance_claims
     WHERE investor_id IN ${MINE}
       AND claim_status NOT IN ('settled_fully','settled_partially','rejected','withdrawn')
  `)).rows[0] as Record<string, unknown>;

  const lines = (await tx.execute(sql`
    SELECT CASE WHEN policy_type IN (${LIFE}) THEN 'life'
                WHEN policy_type IN (${HEALTH}) THEN 'health'
                ELSE 'general' END AS line,
           (policy_type IN (${COMMERCIAL})) AS commercial,
           COALESCE(SUM(annual_premium::numeric) FILTER (
             WHERE policy_start_date BETWEEN ${w.from}::date AND ${w.to}::date), 0) AS premium,
           COUNT(*) FILTER (WHERE status = 'active')::int AS policies
      FROM insurance_policies
     WHERE ${premiumMatch(w)} AND status NOT IN ('lapsed','surrendered','cancelled')
     GROUP BY 1, 2
  `)).rows as Array<{ line: string; commercial: boolean; premium: string; policies: number }>;

  const ever = num(t?.any_ever) > 0;
  const sumLine = (k: string) => lines.filter((l) => l.line === k);
  return {
    newPremium: ever ? num(t?.new_p) : null,
    renewalPremium: ever ? num(t?.renew_p) : null,
    totalPremium: ever ? num(t?.new_p) + num(t?.renew_p) : null,
    policies: num(t?.policies),
    renewalsDue30: num(t?.due30),
    openClaims: num(claims?.n),
    byLine: [
      ["life", "Life"], ["health", "Health"], ["general", "General / other"],
    ].map(([key, label]) => ({
      key, label,
      premium: sumLine(key).reduce((s, l) => s + num(l.premium), 0),
      policies: sumLine(key).reduce((s, l) => s + num(l.policies), 0),
    })),
    // Personal vs commercial lines only means something when commercial cover
    // is actually on the book; with none, the split is omitted.
    byMarket: lines.some((l) => l.commercial)
      ? [
          { key: "personal", label: "Personal lines", premium: lines.filter((l) => !l.commercial).reduce((s, l) => s + num(l.premium), 0) },
          { key: "commercial", label: "Commercial lines", premium: lines.filter((l) => l.commercial).reduce((s, l) => s + num(l.premium), 0) },
        ]
      : [],
  };
}

/* ─────────────────────── §24 operations snapshot ─────────────────────── */

export type OpsSnapshot = {
  transactionsPending: number;
  transactionsRejected: number;
  casesBeyondSla: number;
  documentsPending: number;
  queriesPending: number;
  /** Age in days of the oldest open case of any kind; null when none is open. */
  oldestPendingDays: number | null;
};

/**
 * The branch-relevant slice of operations — not the operations dashboard.
 * "Cases beyond SLA" counts client queries past their resolution SLA plus the
 * branch's tasks past their SLA — or past their due date where no SLA is set,
 * the same rule as the attention centre's "Tasks beyond SLA" card, so the two
 * cannot disagree. To a branch head both are work that has kept a client
 * waiting too long. Documents pending are open
 * document-collection tasks; the CRM has no separate document queue.
 */
export async function loadOpsSnapshot(tx: Tx, w: MyWindow): Promise<OpsSnapshot> {
  const MINE = clientIds(w.scope);
  const OPEN = asInList(SR_OPEN_ON_US);
  const DEAD = asInList(TASK_DEAD);
  const r = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM transactions
        WHERE investor_id IN ${MINE} AND status = 'pending')                       AS txn_pending,
      (SELECT COUNT(*)::int FROM transactions
        WHERE investor_id IN ${MINE} AND status = 'rejected'
          AND order_date BETWEEN ${w.from}::date AND ${w.to}::date)                 AS txn_rejected,
      (SELECT COUNT(*)::int FROM service_requests
        WHERE investor_id IN ${MINE} AND status IN (${OPEN})
          AND sla_resolution_at IS NOT NULL AND sla_resolution_at < now())          AS sr_sla,
      (SELECT COUNT(*)::int FROM tasks
        WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
          AND status NOT IN (${DEAD}) AND COALESCE(sla_due_at, due_at) < now()) AS task_sla,
      (SELECT COUNT(*)::int FROM tasks
        WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
          AND status NOT IN (${DEAD}) AND type IN ('collect_document','document','documents')) AS docs,
      (SELECT COUNT(*)::int FROM service_requests
        WHERE investor_id IN ${MINE} AND status NOT IN ('resolved','closed'))       AS sr_open,
      GREATEST(
        (SELECT MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0) FROM service_requests
          WHERE investor_id IN ${MINE} AND status NOT IN ('resolved','closed')),
        (SELECT MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0) FROM tasks
          WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL AND status NOT IN (${DEAD})),
        (SELECT MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0) FROM transactions
          WHERE investor_id IN ${MINE} AND status = 'pending')
      ) AS oldest
  `)).rows[0] as Record<string, unknown>;
  return {
    transactionsPending: num(r?.txn_pending),
    transactionsRejected: num(r?.txn_rejected),
    casesBeyondSla: num(r?.sr_sla) + num(r?.task_sla),
    documentsPending: num(r?.docs),
    queriesPending: num(r?.sr_open),
    oldestPendingDays: r?.oldest == null ? null : Math.floor(num(r.oldest)),
  };
}

/* ─────────────────────── §25 management attention centre ─────────────────────── */

export type AttentionItem = {
  key: string;
  label: string;
  severity: "critical" | "attention";
  count: number;
  /** Rupees where the item has a value. */
  value: number | null;
  /** The person with the most of these, and how many — "who do I call". */
  owner: { id: string; name: string; count: number } | null;
  /** Days, where age is meaningful. */
  oldestDays: number | null;
  /** Words for `oldestDays` — "oldest", "longest overdue", "soonest due". */
  ageLabel: string | null;
  href: string;
};

/**
 * "Needs branch head attention" — one card per exception type, each with a
 * count, the money involved, WHO has most of it, and how old the worst one is.
 * Those four are what turn a count into a conversation.
 *
 * Severity follows the brief: CRITICAL for SLA breaches, unresolved major
 * rejections, large redemptions nobody has followed up, A/B reviews badly
 * overdue, renewals past due and claims past their service window; ATTENTION
 * for target gaps and ageing. Cards with nothing in them are dropped — an
 * all-clear card is not an exception.
 */
export async function loadAttention(
  tx: Tx, w: MyWindow, ledger: RmLedgerRow[], t: DashboardThresholds,
  opts: { highValue: number; phase: number | null },
): Promise<AttentionItem[]> {
  const MINE = clientIds(w.scope);
  const OPEN = asInList(SR_OPEN_ON_US);
  const DEAD = asInList(TASK_DEAD);
  const LIVE = asInList(PROPOSAL_LIVE);

  /** Top owner from rows of (owner id, owner name). */
  const topOwner = (rows: Array<{ oid: string | null; oname: string | null }>) => {
    const m = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      if (!r.oid) continue;
      const e = m.get(r.oid) ?? { name: r.oname ?? "—", count: 0 };
      e.count += 1; m.set(r.oid, e);
    }
    const best = [...m.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    return best ? { id: best[0], name: best[1].name, count: best[1].count } : null;
  };

  type Row = { oid: string | null; oname: string | null; v: string | null; d: number | null };
  const q = async (s: SQL) => (await tx.execute(s)).rows as Row[];

  const [largeRed, rejUnworked, rejRepurchase, oldProposals, abReviews, sla, tasksSla, incomplete, renewals, claims] =
    await inOrder(
      () => q(sql`
        SELECT i.rm_id::text AS oid, u.name AS oname, t.amount AS v,
               (${w.today}::date - t.order_date) AS d
          FROM transactions t JOIN investors i ON i.id = t.investor_id LEFT JOIN users u ON u.id = i.rm_id
         WHERE t.investor_id IN ${MINE} AND t.status IN ('processed','successful') AND t.type IN (${RED_IN})
           AND t.amount::numeric >= ${opts.highValue}
           AND t.order_date BETWEEN ${w.from}::date AND ${w.to}::date
           AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE ${taskIsAbout("tk", sql`i.id`)}
                            AND tk.deleted_at IS NULL AND tk.created_at >= t.order_date::timestamptz)`),
      // Not yet WORKED: no recovery record, or still at "pending".
      () => q(sql`
        SELECT i.rm_id::text AS oid, u.name AS oname, t.amount AS v, (${w.today}::date - t.order_date) AS d
          FROM transactions t JOIN investors i ON i.id = t.investor_id LEFT JOIN users u ON u.id = i.rm_id
          LEFT JOIN sip_rejections r ON r.transaction_id = t.id
         WHERE t.investor_id IN ${MINE} AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
           AND t.order_date >= (${w.today}::date - 90)
           AND (r.recovery_status IS NULL OR r.recovery_status = 'pending')`),
      // Worked but not yet re-processed: the client has been contacted, or a
      // bank / mandate issue is being chased.
      () => q(sql`
        SELECT i.rm_id::text AS oid, u.name AS oname, t.amount AS v, (${w.today}::date - t.order_date) AS d
          FROM transactions t JOIN investors i ON i.id = t.investor_id LEFT JOIN users u ON u.id = i.rm_id
          JOIN sip_rejections r ON r.transaction_id = t.id
         WHERE t.investor_id IN ${MINE} AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
           AND r.recovery_status IN ('client_contacted','bank_issue','mandate_issue')`),
      () => q(sql`
        SELECT p.prepared_by_user_id::text AS oid, u.name AS oname, p.total_investment AS v,
               (EXTRACT(EPOCH FROM (now() - COALESCE(p.sent_at, p.created_at))) / 86400)::int AS d
          FROM proposals p LEFT JOIN users u ON u.id = p.prepared_by_user_id
         WHERE ${staffMatch("prepared_by_user_id", w, "p")} AND p.status IN (${LIVE})
           AND COALESCE(p.sent_at, p.created_at) < now() - (${t.proposalAgeingDays} || ' days')::interval`),
      () => q(sql`
        SELECT i.rm_id::text AS oid, u.name AS oname, i.aum AS v, (${w.today}::date - i.next_review_at::date) AS d
          FROM investors i LEFT JOIN users u ON u.id = i.rm_id
         WHERE ${clientsWhereOn("i", w.scope)}
           AND upper(COALESCE(i.client_category, '')) IN ('A','B')
           AND i.next_review_at::date < ${w.today}::date`),
      () => q(sql`
        SELECT i.rm_id::text AS oid, u.name AS oname, NULL AS v,
               (EXTRACT(EPOCH FROM (now() - sr.created_at)) / 86400)::int AS d
          FROM service_requests sr JOIN investors i ON i.id = sr.investor_id LEFT JOIN users u ON u.id = i.rm_id
         WHERE sr.investor_id IN ${MINE} AND sr.status IN (${OPEN})
           AND sr.sla_resolution_at IS NOT NULL AND sr.sla_resolution_at < now()`),
      () => q(sql`
        SELECT t.assignee_id::text AS oid, u.name AS oname, NULL AS v,
               (EXTRACT(EPOCH FROM (now() - COALESCE(t.sla_due_at, t.due_at))) / 86400)::int AS d
          FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
         WHERE ${staffMatch("assignee_id", w, "t")} AND t.deleted_at IS NULL AND t.status NOT IN (${DEAD})
           AND COALESCE(t.sla_due_at, t.due_at) < now()`),
      () => q(sql`
        SELECT i.rm_id::text AS oid, u.name AS oname, NULL AS v, NULL::int AS d
          FROM investors i LEFT JOIN users u ON u.id = i.rm_id
         WHERE ${clientsWhereOn("i", w.scope)}
           AND NOT ((i.pan IS NOT NULL AND btrim(i.pan) <> '') AND i.dob IS NOT NULL
                AND (i.email IS NOT NULL AND btrim(i.email) <> '')
                AND (i.phone IS NOT NULL AND btrim(i.phone) <> '')
                AND (i.client_category IS NOT NULL AND btrim(i.client_category) <> ''))`),
      // Due in the next 30 days, or already past due and still active.
      () => q(sql`
        SELECT COALESCE(p.sold_by_user_id, i.rm_id)::text AS oid, u.name AS oname, p.annual_premium AS v,
               (p.next_premium_due_date - ${w.today}::date) AS d
          FROM insurance_policies p
          LEFT JOIN investors i ON i.id = p.investor_id
          LEFT JOIN users u ON u.id = COALESCE(p.sold_by_user_id, i.rm_id)
         WHERE p.investor_id IN ${MINE} AND p.status = 'active'
           AND p.next_premium_due_date IS NOT NULL
           AND p.next_premium_due_date <= (${w.today}::date + 30)`),
      () => q(sql`
        SELECT c.rm_id::text AS oid, u.name AS oname, c.claimed_amount AS v,
               (${w.today}::date - COALESCE(c.intimation_date, c.created_at::date)) AS d
          FROM insurance_claims c LEFT JOIN users u ON u.id = c.rm_id
         WHERE c.investor_id IN ${MINE}
           AND c.claim_status NOT IN ('settled_fully','settled_partially','rejected','withdrawn')
           AND COALESCE(c.intimation_date, c.created_at::date) < ${w.today}::date - ${t.claimSlaDays}::int`),
    );

  const sumV = (rows: Row[]) => rows.reduce((s, r) => s + num(r.v), 0);
  const maxD = (rows: Row[]) => (rows.length ? Math.max(...rows.map((r) => num(r.d))) : null);
  const minD = (rows: Row[]) => (rows.length ? Math.min(...rows.map((r) => num(r.d))) : null);

  // Target gaps, from the ledger: an RM is "below target" when any metric with
  // a phased target is under the firm's near band. Phasing off means there is
  // no shorter-period expectation to be below, so the card is not built.
  const below: Array<{ id: string; name: string; worst: number }> = [];
  if (opts.phase != null) {
    for (const r of ledger) {
      if (r.kind !== "person" || !r.isRm) continue;
      const pairs: Array<[TargetKey, number]> = [
        ["net_sip", r.grossSip - r.sipStop], ["net_business", r.grossInvestment - r.redemption],
        ["new_clients", r.newClients], ["meetings", r.meetingsHeld ?? 0], ["insurance", r.insurance],
      ];
      let worst = Infinity;
      for (const [k, actual] of pairs) {
        const annual = r.targets[k];
        if (annual == null) continue;
        worst = Math.min(worst, actual / (annual * opts.phase));
      }
      if (worst < t.targetNearFraction) below.push({ id: r.id, name: r.name, worst });
    }
  }
  const negative = ledger.filter((r) => r.kind === "person" && r.isRm && r.grossSip - r.sipStop < 0);

  const item = (
    key: string, label: string, severity: AttentionItem["severity"], rows: Row[],
    href: string, opt: { value?: boolean; age?: "max" | "min"; ageLabel?: string } = {},
  ): AttentionItem => ({
    key, label, severity, count: rows.length,
    value: opt.value ? sumV(rows) : null,
    owner: topOwner(rows),
    oldestDays: opt.age === "min" ? minD(rows) : opt.age === "max" ? maxD(rows) : null,
    ageLabel: opt.ageLabel ?? null,
    href,
  });

  const severeAb = abReviews.filter((r) => num(r.d) >= t.reviewSevereOverdueDays);
  // d is days UNTIL due, so past-due rows are negative; flip them to days
  // overdue so the card reads "most overdue 12 days", not "-12 days".
  const renewalsPastDue = renewals.filter((r) => num(r.d) < 0).map((r) => ({ ...r, d: -num(r.d) }));

  const cards: AttentionItem[] = [
    item("sla_queries", "Service requests beyond SLA", "critical", sla, "/dashboard/service-requests?breached=1",
      { age: "max", ageLabel: "oldest" }),
    item("large_redemption", "Large redemptions, no follow-up", "critical", largeRed, "/dashboard/reports/redemption",
      { value: true, age: "max", ageLabel: "days since" }),
    item("sip_unworked", "SIP rejections not yet worked", "critical", rejUnworked, "/dashboard/sip-rejections?recovery=pending",
      { value: true, age: "max", ageLabel: "oldest" }),
    item("sip_repurchase", "SIP repurchase pending", "attention", rejRepurchase,
      "/dashboard/sip-rejections?recovery=client_contacted,bank_issue,mandate_issue",
      { value: true, age: "max", ageLabel: "oldest" }),
    item("ab_reviews", `A/B reviews ${t.reviewSevereOverdueDays}+ days overdue`, "critical", severeAb,
      "/dashboard/investors?sort=review&dir=asc", { value: true, age: "max", ageLabel: "worst" }),
    item("ab_reviews_due", "A/B reviews overdue", "attention",
      abReviews.filter((r) => num(r.d) < t.reviewSevereOverdueDays), "/dashboard/investors?sort=review&dir=asc",
      { value: true, age: "max", ageLabel: "worst" }),
    item("tasks_sla", "Tasks beyond SLA", "critical", tasksSla, `/dashboard/tasks?due=overdue`,
      { age: "max", ageLabel: "oldest" }),
    item("renewals_past_due", "Insurance renewals past due", "critical", renewalsPastDue, "/dashboard/insurance?due=1",
      { value: true, age: "max", ageLabel: "most overdue" }),
    item("renewals_due", "Insurance renewals due in 30 days", "attention",
      renewals.filter((r) => num(r.d) >= 0), "/dashboard/insurance?due=1",
      { value: true, age: "min", ageLabel: "soonest in" }),
    item("claims", `Claims open ${t.claimSlaDays}+ days`, "critical", claims, "/dashboard/insurance-claims",
      { value: true, age: "max", ageLabel: "oldest" }),
    item("proposals", `Proposals waiting ${t.proposalAgeingDays}+ days`, "attention", oldProposals,
      "/dashboard/proposals?status=sent,viewed", { value: true, age: "max", ageLabel: "oldest" }),
    item("data", "Client records incomplete", "attention", incomplete, "/dashboard/investors"),
    {
      key: "below_target", label: "RMs below target", severity: "attention", count: below.length, value: null,
      owner: below.length ? (() => {
        const w0 = below.sort((a, b) => a.worst - b.worst)[0];
        return { id: w0.id, name: w0.name, count: 1 };
      })() : null,
      oldestDays: null, ageLabel: null, href: "#rm-targets",
    },
    {
      key: "negative_net_sip", label: "RMs with negative net SIP", severity: "attention", count: negative.length,
      value: negative.reduce((s, r) => s + (r.grossSip - r.sipStop), 0),
      owner: negative.length ? (() => {
        const n0 = [...negative].sort((a, b) => (a.grossSip - a.sipStop) - (b.grossSip - b.sipStop))[0];
        return { id: n0.id, name: n0.name, count: 1 };
      })() : null,
      oldestDays: null, ageLabel: null, href: "#sip-performance",
    },
  ];
  return cards
    .filter((c) => c.count > 0)
    .sort((a, b) => Number(a.severity !== "critical") - Number(b.severity !== "critical") || b.count - a.count);
}

/* ─────────────────────── §27/§28 review modes ─────────────────────── */

export type ReviewRow = {
  key: string;
  label: string;
  format: "currency" | "count";
  previous: number;
  current: number;
  /** Phased target for the current window, where one exists. */
  target: number | null;
  /** The full-year target it was phased from — the monthly review sets the
   *  month against the FY target as well as against the month's share. */
  annual: number | null;
  inverse?: boolean;
};

export type ReviewMode = {
  mode: "weekly" | "monthly";
  currentLabel: string;
  previousLabel: string;
  rows: ReviewRow[];
  /** Monthly only: business entries by product, current vs previous. */
  products: Array<{ key: string; label: string; previous: number; current: number }> | null;
};

/**
 * Weekly: this week (Monday to today) against the whole previous week.
 * Monthly: month to date against the same days of last month — the same
 * like-for-like rule as the month-on-month table, so the 3rd is compared with
 * the 3rd, never with a whole month.
 *
 * A weekly or monthly TARGET exists only under linear phasing: the annual
 * target spread over the year by days. With phasing off the column reads
 * "Not phased" — the CRM holds annual targets only, and inventing a weekly
 * one is exactly the forecast the brief forbids.
 */
export async function loadReviewMode(
  tx: Tx, w: MyWindow, mode: "weekly" | "monthly",
  targetOf: (k: TargetKey) => number | null, phasing: "linear" | "none",
): Promise<ReviewMode> {
  let curFrom: string, prevFrom: string, prevTo: string;
  const curTo = w.today;
  if (mode === "weekly") {
    const d = parse(w.today);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    curFrom = addDays(w.today, -dow);
    prevFrom = addDays(curFrom, -7);
    prevTo = addDays(curFrom, -1);
  } else {
    curFrom = `${w.today.slice(0, 8)}01`;
    const p = parse(curFrom); p.setMonth(p.getMonth() - 1);
    prevFrom = ymd(p);
    const dayIndex = Number(w.today.slice(8, 10)) - 1;
    const lastOfPrev = addDays(curFrom, -1);
    const sameDay = addDays(prevFrom, dayIndex);
    prevTo = sameDay < lastOfPrev ? sameDay : lastOfPrev;
  }
  const [cur, prev] = await inOrder(
    () => loadWindowMetrics(tx, w, curFrom, curTo),
    () => loadWindowMetrics(tx, w, prevFrom, prevTo),
  );
  const phase = phaseFraction(curFrom, curTo, w.fyStart, phasing);
  const tgt = (k: TargetKey | null) => {
    if (!k || phase == null) return null;
    const a = targetOf(k);
    return a == null ? null : a * phase;
  };

  const row = (
    key: keyof WindowMetrics, label: string, format: "currency" | "count",
    target: TargetKey | null = null, inverse = false,
  ): ReviewRow => ({
    key, label, format, previous: prev[key], current: cur[key], target: tgt(target),
    annual: target ? targetOf(target) : null, inverse,
  });

  const rows: ReviewRow[] = mode === "weekly"
    ? [
        row("newMeetings", "New meetings", "count"),
        row("reviewMeetings", "Review meetings", "count", "reviews"),
        row("newLeads", "Leads", "count"),
        row("newClients", "New clients", "count", "new_clients"),
        row("riskProfiles", "Risk profiles signed", "count"),
        row("lifePremium", "Life insurance", "currency"),
        row("generalPremium", "General insurance", "currency"),
        row("grossSip", "Gross SIP", "currency"),
        row("sipStop", "SIP stopped", "currency", null, true),
        row("netSip", "Net SIP", "currency", "net_sip"),
        row("grossInvestment", "Gross investment", "currency"),
        row("redemption", "Redemption", "currency", null, true),
        row("netBusiness", "Net business", "currency", "net_business"),
        ...(w.scope.kind === "rm"
          ? [row("finTasksCompleted", "Financial tasks completed", "count")]
          : [row("tasksCompleted", "Tasks completed", "count")]),
        row("tasksPending", "Tasks pending", "count", null, true),
      ]
    : [
        row("grossSip", "Gross SIP", "currency"),
        row("sipStop", "SIP stopped", "currency", null, true),
        row("netSip", "Net SIP", "currency", "net_sip"),
        row("grossInvestment", "Gross investment", "currency"),
        row("redemption", "Redemption", "currency", null, true),
        row("netBusiness", "Net business", "currency", "net_business"),
        row("insurance", "Insurance premium", "currency", "insurance"),
        row("newClients", "New clients", "count", "new_clients"),
        row("meetings", "Meetings held", "count", "meetings"),
        row("reviewMeetings", "Review meetings", "count", "reviews"),
        row("proposalsCreated", "Proposals", "count"),
        row("riskProfiles", "Risk profiles signed", "count"),
        row("sipRejections", "SIP rejections", "count", null, true),
        row("tasksCompleted", "Tasks completed", "count"),
        row("queriesReceived", "Service requests received", "count", null, true),
        row("queriesSolved", "Service requests solved", "count"),
      ];

  let products: ReviewMode["products"] = null;
  if (mode === "monthly" && w.scope.kind === "branch") {
    const [c, p] = await inOrder(
      () => loadInvestmentFlowWindow(tx, w, curFrom, curTo),
      () => loadInvestmentFlowWindow(tx, w, prevFrom, prevTo),
    );
    if (c || p) {
      products = (c ?? p ?? []).map((b, i) => ({
        key: b.key, label: b.label,
        current: c?.[i]?.purchase ?? 0,
        previous: p?.[i]?.purchase ?? 0,
      }));
    }
  }

  const fmt = (s: string) => formatDate(s, "dayMonth");
  return {
    mode,
    currentLabel: `${fmt(curFrom)} – ${fmt(curTo)}`,
    previousLabel: `${fmt(prevFrom)} – ${fmt(prevTo)}`,
    rows,
    products,
  };
}

/** Business-entry purchases by product over an explicit window. */
async function loadInvestmentFlowWindow(
  tx: Tx, w: MyWindow, from: string, to: string,
): Promise<FlowBucket[] | null> {
  if (w.scope.kind !== "branch") return null;
  const branchId = w.scope.branchId;
  const oneRm = w.scope.rmId ? sql`AND be.rm_id = ${w.scope.rmId}::uuid` : sql``;
  const rows = (await tx.execute(sql`
    SELECT CASE
             WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'equity' THEN 'equity_mf'
             WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'liquid' THEN 'liquid'
             WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'debt'   THEN 'debt'
             WHEN be.product_type = 'mutual_fund'                               THEN 'other_mf'
             WHEN be.product_type IN ('sif','aif','pms')                        THEN be.product_type
             ELSE 'other' END AS bucket,
           COALESCE(SUM(bel.amount::numeric) FILTER (
             WHERE bel.txn_type IN ('lumpsum','additional_purchase','sip','sip_topup','switch','stp')), 0) AS purchase,
           COALESCE(SUM(bel.amount::numeric) FILTER (WHERE bel.txn_type IN ('redemption','swp')), 0) AS redemption
      FROM business_entries be
      JOIN business_entry_lines bel ON bel.entry_id = be.id
      LEFT JOIN investors i ON i.id = be.investor_id
      LEFT JOIN users u ON u.id = be.rm_id
     WHERE COALESCE(i.branch_id, u.branch_id) = ${branchId}::uuid ${oneRm}
       AND be.status IN ('confirmed','emailed')
       AND be.business_date BETWEEN ${from}::date AND ${to}::date
     GROUP BY 1
  `)).rows as Array<{ bucket: string; purchase: string; redemption: string }>;
  if (!rows.length) return null;
  const LABELS: Array<[string, string]> = [
    ["equity_mf", "Equity MF"], ["liquid", "Liquid"], ["debt", "Debt"], ["other_mf", "Other MF"],
    ["sif", "SIF"], ["aif", "AIF"], ["pms", "PMS"], ["other", "Other products"],
  ];
  const by = new Map(rows.map((r) => [r.bucket, r]));
  return LABELS.map(([key, label]) => {
    const r = by.get(key);
    return { key, label, purchase: num(r?.purchase), redemption: num(r?.redemption), net: num(r?.purchase) - num(r?.redemption) };
  });
}

/* ─────────────────────── §30 FY branch scorecard ─────────────────────── */

export type ScorecardRow = {
  key: TargetKey;
  label: string;
  format: "currency" | "count";
  annual: number | null;
  actual: number;
  remaining: number | null;
  pct: number | null;
  /** Where the metric should be by today under linear phasing — null when the
   *  firm has phasing off, the metric has no target, or it is a balance. */
  expected: number | null;
  stock: boolean;
};

export function buildFyScorecard(
  actuals: Partial<Record<TargetKey, number>>,
  targetOf: (k: TargetKey) => number | null,
  phase: number | null,
): ScorecardRow[] {
  const defs: Array<[TargetKey, string, "currency" | "count", boolean]> = [
    ["aum", "AUM", "currency", true],
    ["sip_book", "SIP book", "currency", true],
    ["net_sip", "Net SIP added", "currency", false],
    ["net_business", "Net business", "currency", false],
    ["new_clients", "New clients", "count", false],
    ["meetings", "Meetings", "count", false],
    ["reviews", "Review meetings", "count", false],
    ["insurance", "Insurance business", "currency", false],
  ];
  return defs.map(([key, label, format, stock]) => {
    const annual = targetOf(key);
    const actual = actuals[key] ?? 0;
    return {
      key, label, format, stock, annual, actual,
      remaining: annual != null ? Math.max(0, annual - actual) : null,
      pct: annual != null ? actual / annual : null,
      expected: !stock && annual != null && phase != null ? annual * phase : null,
    };
  });
}

