/**
 * Comparisons (§3, §42, §43). Always like for like: a month to date against
 * the same days of the previous month and of the same month last year, a week
 * to date against the same weekdays last week — a part-month against a whole
 * one is how a healthy month is made to look like a collapse. A change on a
 * zero base is N/A, never ÷0 and never "+∞%".
 */

import { sql } from "drizzle-orm";
import { formatDate } from "@/lib/format";
import { CLAIM_OPEN, CLAIM_SETTLED, inList } from "@/lib/insurance/book";
import { loadBiz, pick } from "./business";
import { loadNewClients } from "./clients";
import { loadLost } from "./lost";
import { loadRetention, retentionOf } from "./renewals";
import { claimBase, claimWhere, num, yearBefore, type InsWindow, type Row, type Tx } from "./window";

export type CompareRow = {
  key: string; label: string; format: "currency" | "count" | "percent";
  values: Array<number | null>;
  /** When lower is better (lost business). */
  inverse?: boolean;
  /** A figure that is a snapshot NOW, not a flow in each window. */
  snapshot?: boolean;
};
export type Compare = { labels: string[]; spans: Array<{ from: string; to: string }>; rows: CompareRow[] };

/**
 * With the dashboard filtered to one line, the other line's row is not ₹0 —
 * it was filtered out. Drop it rather than print a zero that reads as a fact.
 */
function forLine(w: InsWindow, rows: CompareRow[]): CompareRow[] {
  const line = w.filter.line;
  return line ? rows.filter((r) => (r.key !== "personal" && r.key !== "commercial") || r.key === line) : rows;
}

const fmt = (iso: string) => formatDate(iso, "dayMonth");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The same day-of-month a month earlier, clamped (31 Mar → 28 Feb). */
function monthBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

async function claimsIn(tx: Tx, w: InsWindow, from: string, to: string) {
  const r = (await tx.execute(sql`
    WITH cl AS (${claimBase(w)})
    SELECT COUNT(*) FILTER (WHERE intimation_date BETWEEN ${from}::date AND ${to}::date)::int AS logged,
           COUNT(*) FILTER (WHERE status IN (${inList(CLAIM_SETTLED)}) AND settlement_date BETWEEN ${from}::date AND ${to}::date)::int AS settled
      FROM cl WHERE ${claimWhere(w, "cl")}
  `)).rows[0] as Row | undefined;
  return { logged: num(r?.logged), settled: num(r?.settled) };
}

async function meetingsIn(tx: Tx, w: InsWindow, from: string, to: string): Promise<number> {
  const scope = w.scope.kind === "firm" ? sql`TRUE`
    : w.scope.kind === "branch" ? sql`u.branch_id = ${w.scope.branchId}::uuid`
    : sql`m.rm_id = ${w.scope.userId}::uuid`;
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM review_meetings m
      LEFT JOIN users u ON u.id = m.rm_id LEFT JOIN leads l ON l.id = m.lead_id
     WHERE m.tenant_id = ${w.tenantId}::uuid AND m.status NOT IN ('cancelled', 'no_show')
       AND (m.meeting_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
       AND ('insurance_team' = ANY(COALESCE(u.roles, ARRAY[]::text[])) OR l.pipeline = 'insurance'
            OR EXISTS (SELECT 1 FROM lead_blueprint_instances b WHERE b.lead_id = m.lead_id AND b.current_stage_key LIKE 'insurance_%'))
       AND ${scope}
  `)).rows[0] as Row | undefined;
  return num(r?.n);
}

/** One set of figures for a span — shared by all three comparisons. */
async function figures(tx: Tx, w: InsWindow, from: string, to: string) {
  const biz = await loadBiz(tx, w, [{ k: "s", from, to }], ["line"]);
  const all = pick(biz, "s");
  const [nc, lost, ret, claims, meetings] = [
    await loadNewClients(tx, w, from, to),
    await loadLost(tx, w, from, to, 0),
    await loadRetention(tx, w, from, to),
    await claimsIn(tx, w, from, to),
    await meetingsIn(tx, w, from, to),
  ];
  return {
    personal: pick(biz, "s", (r) => r.d.line === "personal").total,
    commercial: pick(biz, "s", (r) => r.d.line === "commercial").total,
    newAmt: all.newAmt, renAmt: all.renAmt, total: all.total,
    newN: all.newN, renN: all.renN, policies: all.policies,
    newClients: nc.total, lost: lost.premium, lostN: lost.count,
    retention: retentionOf(ret)?.policyPct ?? null,
    claimsLogged: claims.logged, claimsSettled: claims.settled, meetings,
    // Renewed + still due, in the window up to today (renewals.ts).
    renewalsDue: retentionOf(ret)?.due ?? 0,
  };
}

/** §3 — the selected period against its previous slice. */
export async function loadMoM(tx: Tx, w: InsWindow): Promise<Compare> {
  const [cur, prev] = [await figures(tx, w, w.from, w.to), await figures(tx, w, w.prevFrom, w.prevTo)];
  const row = (key: string, label: string, get: (f: typeof cur) => number | null, format: CompareRow["format"] = "currency", inverse = false): CompareRow =>
    ({ key, label, format, values: [get(prev), get(cur)], inverse });
  return {
    labels: [w.prevLabel, w.periodLabel],
    spans: [{ from: w.prevFrom, to: w.prevTo }, { from: w.from, to: w.to }],
    rows: forLine(w, [
      row("personal", "Personal Lines premium", (f) => f.personal),
      row("commercial", "Commercial Lines premium", (f) => f.commercial),
      row("new", "New business", (f) => f.newAmt),
      row("renewal", "Renewal business", (f) => f.renAmt),
      row("total", "Total premium", (f) => f.total),
      row("new_n", "New policies", (f) => f.newN, "count"),
      row("ren_n", "Renewals", (f) => f.renN, "count"),
      row("clients", "New clients", (f) => f.newClients, "count"),
      row("lost", "Lost premium", (f) => f.lost, "currency", true),
      row("claims", "Claims logged", (f) => f.claimsLogged, "count", true),
    ]),
  };
}

/** §42 — month to date vs the same days of last month vs the same days last year. */
export async function loadMonthly(tx: Tx, w: InsWindow): Promise<Compare> {
  const to = w.today;
  const from = `${to.slice(0, 8)}01`;
  const pFrom = monthBefore(from);
  const pTo = monthBefore(to);
  const yFrom = yearBefore(from);
  const yTo = yearBefore(to);
  const [cur, prev, ly] = [await figures(tx, w, from, to), await figures(tx, w, pFrom, pTo), await figures(tx, w, yFrom, yTo)];
  const row = (key: string, label: string, get: (f: typeof cur) => number | null, format: CompareRow["format"] = "currency", inverse = false): CompareRow =>
    ({ key, label, format, values: [get(ly), get(prev), get(cur)], inverse });
  return {
    labels: [`${fmt(yFrom)} – ${fmt(yTo)} ${yFrom.slice(0, 4)}`, `${fmt(pFrom)} – ${fmt(pTo)}`, `${fmt(from)} – ${fmt(to)}`],
    spans: [{ from: yFrom, to: yTo }, { from: pFrom, to: pTo }, { from, to }],
    rows: forLine(w, [
      row("personal", "Personal Lines business", (f) => f.personal),
      row("commercial", "Commercial Lines business", (f) => f.commercial),
      row("new", "New business", (f) => f.newAmt),
      row("renewal", "Renewal business", (f) => f.renAmt),
      row("policies", "Policies issued", (f) => f.policies, "count"),
      row("retention", "Renewal % (policies)", (f) => f.retention, "percent"),
      row("clients", "New clients", (f) => f.newClients, "count"),
      row("lost", "Lost business", (f) => f.lost, "currency", true),
      row("meetings", "Insurance meetings", (f) => f.meetings, "count"),
      row("claims", "Claims logged", (f) => f.claimsLogged, "count", true),
    ]),
  };
}

/** §43 — this week (Monday to today) against the same weekdays last week. */
export async function loadWeekly(tx: Tx, w: InsWindow, pending: { proposals: number; claims: number }): Promise<Compare> {
  const to = w.today;
  const dow = (new Date(`${to}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(to, -dow);
  const [cur, prev] = [await figures(tx, w, from, to), await figures(tx, w, addDays(from, -7), addDays(to, -7))];
  const row = (key: string, label: string, get: (f: typeof cur) => number | null, format: CompareRow["format"] = "currency", inverse = false): CompareRow =>
    ({ key, label, format, values: [get(prev), get(cur)], inverse });
  return {
    labels: [`${fmt(addDays(from, -7))} – ${fmt(addDays(to, -7))}`, `${fmt(from)} – ${fmt(to)}`],
    spans: [{ from: addDays(from, -7), to: addDays(to, -7) }, { from, to }],
    rows: [
      row("new", "New premium", (f) => f.newAmt),
      row("renewal", "Renewal premium", (f) => f.renAmt),
      row("new_n", "New policies", (f) => f.newN, "count"),
      row("ren_n", "Renewals completed", (f) => f.renN, "count"),
      row("due", "Renewals due", (f) => f.renewalsDue, "count"),
      row("clients", "New clients", (f) => f.newClients, "count"),
      row("meetings", "Meetings", (f) => f.meetings, "count"),
      { key: "proposals", label: "Pending proposals (now)", format: "count", values: [null, pending.proposals], snapshot: true },
      row("lost", "Lost business", (f) => f.lost, "currency", true),
      row("logged", "Claims logged", (f) => f.claimsLogged, "count", true),
      row("settled", "Claims settled", (f) => f.claimsSettled, "count"),
      { key: "claims_open", label: "Claims pending (now)", format: "count", values: [null, pending.claims], snapshot: true },
    ],
  };
}

export { CLAIM_OPEN };
