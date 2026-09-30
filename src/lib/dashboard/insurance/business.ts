/**
 * Business generated — premium and policies, new vs renewal, in any number of
 * windows and along any of a fixed set of dimensions. Every premium figure on
 * the command centre comes out of `loadBiz`, so the KPI strip, the trend, the
 * product mix and the branch table are cuts of one set of rows and add up.
 *
 * A window's business is:
 *   · NEW / RENEWAL booked — an issued policy whose booked-on date falls in the
 *     window, at its annual premium, new or renewal by its business type (a
 *     general-insurance renewal is usually keyed as a fresh policy row);
 *   · RENEWAL collected — "Mark renewed" events in the window, at one
 *     installment each, from the policy's second year (renewEvents).
 */

import { sql, type SQL } from "drizzle-orm";
import { PRODUCT_GROUPS } from "@/lib/insurance/book";
import {
  num, polBase, polWhere, renewEvents, SECOND_YEAR, str, type InsWindow, type Row, type Tx,
} from "./window";

export type Win = { k: string; from: string; to: string };

const DIM_SQL = {
  line: "b.line",
  grp: "b.grp",
  branch: "b.branch_id::text",
  owner: "b.owner_id::text",
  seller: "b.seller_id::text",
  insurer: "b.insurer_key",
  source: "b.source",
  cat: "b.cat",
  ctype: "b.ctype",
  investor: "b.investor_id::text",
  month: "to_char(b.on_date, 'YYYY-MM')",
  band: `CASE WHEN b.pm THEN 'none' WHEN b.basis < 10000 THEN 'b1' WHEN b.basis < 25000 THEN 'b2' WHEN b.basis < 50000 THEN 'b3'
              WHEN b.basis < 100000 THEN 'b4' ELSE 'b5' END`,
} as const;
export type Dim = keyof typeof DIM_SQL;

export type BizRow = {
  k: string;
  d: Partial<Record<Dim, string | null>>;
  newAmt: number;
  renAmt: number;
  newN: number;
  renN: number;
  policies: number;
  /** Policies in the row with no premium recorded — their ₹0 is unknown, not zero. */
  unpriced: number;
  clients: number;
  /** A display name for the insurer dimension (the commonest spelling). */
  insurerName?: string | null;
};

export async function loadBiz(tx: Tx, w: InsWindow, wins: Win[], dims: Dim[] = []): Promise<BizRow[]> {
  if (!wins.length) return [];
  const lo = wins.reduce((m, x) => (x.from < m ? x.from : m), wins[0].from);
  const hi = wins.reduce((m, x) => (x.to > m ? x.to : m), wins[0].to);
  const values = sql.join(wins.map((x) => sql`(${x.k}, ${x.from}::date, ${x.to}::date)`), sql`, `);
  const dimSel = dims.map((d) => sql`${sql.raw(DIM_SQL[d])} AS ${sql.identifier(`d_${d}`)}`);
  const groupBy = dims.map((d) => sql.raw(DIM_SQL[d]));
  const natureCut = w.filter.nature ? sql`b.kind = ${w.filter.nature}` : sql`TRUE`;
  const rows = (await tx.execute(sql`
    WITH win(k, wf, wt) AS (VALUES ${values}),
         pol AS (${polBase(w)}),
         f AS (SELECT * FROM pol WHERE ${polWhere(w, { nature: false }, "pol")}),
         ev AS (${renewEvents(w, lo, hi)}),
         b AS (
           SELECT win.k, f.id, f.investor_id, f.line, f.grp, f.branch_id, f.owner_id, f.seller_id, f.insurer_key, f.insurer,
                  f.source, f.cat, f.ctype, f.nature AS kind, f.premium AS amt, f.booked_on AS on_date, f.premium AS basis, f.premium_missing AS pm
             FROM f JOIN win ON f.booked_on BETWEEN win.wf AND win.wt
            WHERE f.status NOT IN ('proposed', 'in_underwriting', 'cancelled')
           UNION ALL
           SELECT win.k, f.id, f.investor_id, f.line, f.grp, f.branch_id, f.owner_id, f.seller_id, f.insurer_key, f.insurer,
                  f.source, f.cat, f.ctype, 'renewal', f.inst, ev.renewed_on, f.premium, f.premium_missing
             FROM ev JOIN f ON f.id = ev.policy_id JOIN win ON ev.renewed_on BETWEEN win.wf AND win.wt
            WHERE ${SECOND_YEAR("ev", "f")}
         )
    SELECT b.k ${dimSel.length ? sql`, ${sql.join(dimSel, sql`, `)}` : sql``},
           COALESCE(SUM(b.amt) FILTER (WHERE b.kind = 'new'), 0) AS new_amt,
           COALESCE(SUM(b.amt) FILTER (WHERE b.kind = 'renewal'), 0) AS ren_amt,
           COUNT(DISTINCT b.id) FILTER (WHERE b.kind = 'new')::int AS new_n,
           COUNT(DISTINCT b.id) FILTER (WHERE b.kind = 'renewal')::int AS ren_n,
           COUNT(DISTINCT b.id)::int AS policies,
           COUNT(DISTINCT b.id) FILTER (WHERE b.pm)::int AS unpriced,
           COUNT(DISTINCT b.investor_id)::int AS clients,
           mode() WITHIN GROUP (ORDER BY b.insurer) AS insurer_name
      FROM b
     WHERE ${natureCut}
     GROUP BY b.k ${groupBy.length ? sql`, ${sql.join(groupBy, sql`, `)}` : sql``}
  `)).rows as Row[];
  return rows.map((r) => ({
    k: String(r.k),
    d: Object.fromEntries(dims.map((d) => [d, str(r[`d_${d}`])])),
    newAmt: num(r.new_amt),
    renAmt: num(r.ren_amt),
    newN: num(r.new_n),
    renN: num(r.ren_n),
    policies: num(r.policies),
    unpriced: num(r.unpriced),
    clients: num(r.clients),
    insurerName: str(r.insurer_name),
  }));
}

export type Money = { newAmt: number; renAmt: number; total: number; newN: number; renN: number; policies: number; unpriced: number };
export const EMPTY: Money = { newAmt: 0, renAmt: 0, total: 0, newN: 0, renN: 0, policies: 0, unpriced: 0 };

/** Sum the rows of one window (optionally one dimension value). */
export function pick(rows: BizRow[], k: string, match?: (r: BizRow) => boolean): Money {
  const m = { ...EMPTY };
  for (const r of rows) {
    if (r.k !== k || (match && !match(r))) continue;
    m.newAmt += r.newAmt;
    m.renAmt += r.renAmt;
    m.newN += r.newN;
    m.renN += r.renN;
    m.policies += r.policies;
    m.unpriced += r.unpriced;
  }
  m.total = m.newAmt + m.renAmt;
  return m;
}

/** A change as a fraction — null when the base is zero or unknown (the brief's N/A, never ÷0). */
export const change = (cur: number | null, prev: number | null): number | null =>
  cur == null || prev == null || prev === 0 ? null : (cur - prev) / prev;

/* ───────────────────────── §2 trend ───────────────────────── */

export type TrendPoint = { month: string; label: string; cur: Record<"personal" | "commercial" | "all", { newAmt: number; renAmt: number }>; prevTotal: Record<"personal" | "commercial" | "all", number> };

/** April to March of the FY containing `to`, against the same month of the previous FY. */
export async function loadTrend(tx: Tx, w: InsWindow): Promise<TrendPoint[]> {
  const fy0 = w.fyStart;
  const y = Number(fy0.slice(0, 4));
  const fyEnd = `${y + 1}-03-31`;
  const pyStart = `${y - 1}-04-01`;
  const pyEnd = `${y}-03-31`;
  const rows = await loadBiz(tx, w, [
    { k: "cur", from: fy0, to: w.today < fyEnd ? w.today : fyEnd },
    { k: "prev", from: pyStart, to: pyEnd },
  ], ["month", "line"]);
  const out: TrendPoint[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, 3 + i, 1));
    const key = d.toISOString().slice(0, 7);
    const pkey = new Date(Date.UTC(y - 1, 3 + i, 1)).toISOString().slice(0, 7);
    const zero = () => ({ newAmt: 0, renAmt: 0 });
    const p: TrendPoint = {
      month: key,
      label: d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
      cur: { personal: zero(), commercial: zero(), all: zero() },
      prevTotal: { personal: 0, commercial: 0, all: 0 },
    };
    for (const r of rows) {
      const line = r.d.line === "personal" || r.d.line === "commercial" ? r.d.line : null;
      if (r.k === "cur" && r.d.month === key) {
        p.cur.all.newAmt += r.newAmt;
        p.cur.all.renAmt += r.renAmt;
        if (line) {
          p.cur[line].newAmt += r.newAmt;
          p.cur[line].renAmt += r.renAmt;
        }
      }
      if (r.k === "prev" && r.d.month === pkey) {
        p.prevTotal.all += r.newAmt + r.renAmt;
        if (line) p.prevTotal[line] += r.newAmt + r.renAmt;
      }
    }
    out.push(p);
  }
  return out;
}

/* ───────────────────────── §4 YoY by product ───────────────────────── */

export type YoyRow = { line: string; grp: string; label: string; prevAmt: number; curAmt: number; prevN: number; curN: number };

export async function loadYoY(tx: Tx, w: InsWindow): Promise<YoyRow[]> {
  const rows = await loadBiz(tx, w, [
    { k: "cur", from: w.fyStart, to: w.to },
    { k: "prev", from: w.pyFrom, to: w.pyTo },
  ], ["grp"]);
  return PRODUCT_GROUPS.map((g) => {
    const c = pick(rows, "cur", (r) => r.d.grp === g.key);
    const p = pick(rows, "prev", (r) => r.d.grp === g.key);
    return { line: g.line, grp: g.key, label: g.label, prevAmt: p.total, curAmt: c.total, prevN: p.policies, curN: c.policies };
  }).filter((r) => r.prevAmt || r.curAmt || r.prevN || r.curN);
}

/* ───────────────────────── §6–7 product mix ───────────────────────── */

export type MixRow = { grp: string; label: string; line: string; newAmt: number; renAmt: number; policies: number };

export async function loadMix(tx: Tx, w: InsWindow): Promise<MixRow[]> {
  const rows = await loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }], ["grp"]);
  const out: MixRow[] = PRODUCT_GROUPS.map((g) => {
    const m = pick(rows, "cur", (r) => r.d.grp === g.key);
    return { grp: g.key, label: g.label, line: g.line, newAmt: m.newAmt, renAmt: m.renAmt, policies: m.policies };
  });
  const un = pick(rows, "cur", (r) => r.d.grp === "unclassified");
  if (un.policies) out.push({ grp: "unclassified", label: "Type not recognised", line: "unclassified", newAmt: un.newAmt, renAmt: un.renAmt, policies: un.policies });
  return out.filter((r) => r.policies > 0);
}

/* ───────────────────────── names ───────────────────────── */

export async function userNames(tx: Tx, ids: Array<string | null | undefined>): Promise<Map<string, { name: string; branchId: string | null; roles: string[] }>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = (await tx.execute(sql`
    SELECT id::text AS id, name, branch_id::text AS branch_id, roles FROM users
     WHERE id IN (${sql.join(list.map((x) => sql`${x}::uuid`), sql`, `)})
  `)).rows as Row[];
  return new Map(rows.map((r) => [String(r.id), { name: String(r.name ?? "—"), branchId: str(r.branch_id), roles: (r.roles as string[]) ?? [] }]));
}

export async function branchNames(tx: Tx, w: InsWindow): Promise<Map<string, string>> {
  const rows = (await tx.execute(sql`SELECT id::text AS id, name FROM branches WHERE tenant_id = ${w.tenantId}::uuid`)).rows as Row[];
  return new Map(rows.map((r) => [String(r.id), String(r.name)]));
}

/** Rows `(k, dim)` → a map keyed by the dim value. */
export function byDim(rows: BizRow[], k: string, dim: Dim): Map<string | null, Money> {
  const m = new Map<string | null, Money>();
  for (const r of rows) {
    if (r.k !== k) continue;
    const key = r.d[dim] ?? null;
    const cur = m.get(key) ?? { ...EMPTY };
    cur.newAmt += r.newAmt;
    cur.renAmt += r.renAmt;
    cur.newN += r.newN;
    cur.renN += r.renN;
    cur.policies += r.policies;
    cur.total = cur.newAmt + cur.renAmt;
    m.set(key, cur);
  }
  return m;
}

export const sqlDims = DIM_SQL;
export type { SQL };
