/**
 * The client side of the insurance book (§20–24, §27, §40).
 *
 *   · A NEW insurance client is one whose FIRST issued policy — across all of
 *     their policies, not only the ones the filter shows — was booked in the
 *     window. The line and client type are those of that first policy.
 *   · An "insurance record" is any policy row that is not cancelled. The
 *     relationship views say "No insurance record in CRM", never "needs
 *     insurance": an empty column is a record gap, not a recommendation.
 *   · An MF client has a non-zero AUM on the CRM.
 *   · Industry is the corporate client's "Nature of business" as recorded on
 *     KYC (investors.occupation) — grouped as keyed, never mapped.
 */

import { sql } from "drizzle-orm";
import { leadSourceLabel } from "@/lib/leads/sources";
import { inList, STATUS_IN_FORCE } from "@/lib/insurance/book";
import { num, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

/** The source of the lead the client converted from; none is "Source not recorded". */
export const sourceLabel = (s: string | null) => (s ? leadSourceLabel(s) : "Source not recorded");

/* ───────────────────────── §20 new clients ───────────────────────── */

export type NewClients = {
  total: number; personal: number; commercial: number; individual: number; corporate: number;
  bySource: Array<{ source: string | null; count: number }>;
  byBranch: Map<string | null, number>;
  byOwner: Map<string | null, number>;
};

export async function loadNewClients(tx: Tx, w: InsWindow, from: string, to: string): Promise<NewClients> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         firsts AS (
           SELECT DISTINCT ON (pol.investor_id) pol.*
             FROM pol WHERE pol.status NOT IN ('proposed', 'in_underwriting', 'cancelled') AND pol.booked_on IS NOT NULL
            ORDER BY pol.investor_id, pol.booked_on ASC, pol.created_at ASC
         )
    SELECT line, ctype, source, branch_id::text AS branch_id, owner_id::text AS owner_id, COUNT(*)::int AS n
      FROM firsts
     WHERE booked_on BETWEEN ${from}::date AND ${to}::date AND ${polWhere(w, { nature: false }, "firsts")}
     GROUP BY 1, 2, 3, 4, 5
  `)).rows as Row[];
  const out: NewClients = { total: 0, personal: 0, commercial: 0, individual: 0, corporate: 0, bySource: [], byBranch: new Map(), byOwner: new Map() };
  const src = new Map<string | null, number>();
  for (const r of rows) {
    const n = num(r.n);
    out.total += n;
    if (r.line === "personal") out.personal += n;
    if (r.line === "commercial") out.commercial += n;
    if (r.ctype === "corporate") out.corporate += n;
    else out.individual += n;
    const s = str(r.source);
    src.set(s, (src.get(s) ?? 0) + n);
    out.byBranch.set(str(r.branch_id), (out.byBranch.get(str(r.branch_id)) ?? 0) + n);
    out.byOwner.set(str(r.owner_id), (out.byOwner.get(str(r.owner_id)) ?? 0) + n);
  }
  out.bySource = [...src.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
  return out;
}

/** Distinct corporate insurance clients with an issued policy booked up to `to` in the FY (for the corporate-clients target). */
export async function loadCorporateClients(tx: Tx, w: InsWindow, from: string, to: string): Promise<number> {
  const r = (await tx.execute(sql`
    WITH pol AS (${polBase(w)})
    SELECT COUNT(DISTINCT investor_id)::int AS n FROM pol
     WHERE ${polWhere(w, { nature: false }, "pol")} AND ctype = 'corporate'
       AND status NOT IN ('proposed', 'in_underwriting', 'cancelled') AND booked_on BETWEEN ${from}::date AND ${to}::date
  `)).rows[0] as Row | undefined;
  return num(r?.n);
}

/* ───────────────────────── §22 / §40 relationship coverage ───────────────────────── */

export type Coverage = {
  mfClients: number;
  mfWithInsurance: number;
  mfNoInsurance: number;
  insuranceOnly: number;
  abMfRenewalSoon: number;
  mfLife: number; mfHealth: number; mfGeneral: number; mfMultiple: number;
};

/** Clients in scope: the viewer's book (RM / branch) or everyone. */
function clientScope(w: InsWindow) {
  if (w.scope.kind === "firm") return sql`TRUE`;
  if (w.scope.kind === "branch") return sql`i.branch_id = ${w.scope.branchId}::uuid`;
  return sql`i.rm_id = ${w.scope.userId}::uuid`;
}

export async function loadCoverage(tx: Tx, w: InsWindow): Promise<Coverage> {
  const f = w.filter;
  const letters = (f.categories ?? []).filter((x) => x !== "none");
  const catCut = f.categories?.length
    ? sql`AND (${letters.length ? sql`upper(btrim(COALESCE(i.client_category, ''))) IN (${inList(letters)})` : sql`FALSE`}
              ${f.categories.includes("none") ? sql`OR COALESCE(btrim(i.client_category), '') = ''` : sql``})`
    : sql``;
  const r = (await tx.execute(sql`
    WITH c AS (
      SELECT i.id, (COALESCE(i.aum, 0)::numeric > 0) AS mf, upper(btrim(COALESCE(i.client_category, ''))) AS cat,
             EXISTS (SELECT 1 FROM insurance_policies p WHERE p.tenant_id = ${w.tenantId}::uuid AND p.investor_id = i.id AND p.status <> 'cancelled') AS ins,
             EXISTS (SELECT 1 FROM insurance_policies p WHERE p.tenant_id = ${w.tenantId}::uuid AND p.investor_id = i.id AND p.status <> 'cancelled'
                       AND p.policy_type IN ('term', 'ulip', 'endowment', 'money_back', 'life_other')) AS life,
             EXISTS (SELECT 1 FROM insurance_policies p WHERE p.tenant_id = ${w.tenantId}::uuid AND p.investor_id = i.id AND p.status <> 'cancelled'
                       AND p.policy_type IN ('health', 'critical_illness', 'group_health')) AS health,
             EXISTS (SELECT 1 FROM insurance_policies p WHERE p.tenant_id = ${w.tenantId}::uuid AND p.investor_id = i.id AND p.status <> 'cancelled'
                       AND p.policy_type NOT IN ('term', 'ulip', 'endowment', 'money_back', 'life_other', 'health', 'critical_illness', 'group_health')) AS general,
             EXISTS (SELECT 1 FROM insurance_policies p WHERE p.tenant_id = ${w.tenantId}::uuid AND p.investor_id = i.id
                       AND p.status IN (${inList(STATUS_IN_FORCE)}) AND p.next_premium_due_date BETWEEN ${w.today}::date AND ${w.today}::date + 60) AS soon
        FROM investors i
       WHERE i.tenant_id = ${w.tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status <> 'closed'
         AND ${clientScope(w)} ${catCut}
    )
    SELECT COUNT(*) FILTER (WHERE mf)::int AS mf_n,
           COUNT(*) FILTER (WHERE mf AND ins)::int AS mf_ins,
           COUNT(*) FILTER (WHERE mf AND NOT ins)::int AS mf_none,
           COUNT(*) FILTER (WHERE ins AND NOT mf)::int AS ins_only,
           COUNT(*) FILTER (WHERE mf AND cat IN ('A', 'B') AND soon)::int AS ab_soon,
           COUNT(*) FILTER (WHERE mf AND life)::int AS mf_life,
           COUNT(*) FILTER (WHERE mf AND health)::int AS mf_health,
           COUNT(*) FILTER (WHERE mf AND general)::int AS mf_general,
           COUNT(*) FILTER (WHERE mf AND (life::int + health::int + general::int) >= 2)::int AS mf_multi
      FROM c
  `)).rows[0] as Row | undefined;
  return {
    mfClients: num(r?.mf_n), mfWithInsurance: num(r?.mf_ins), mfNoInsurance: num(r?.mf_none), insuranceOnly: num(r?.ins_only),
    abMfRenewalSoon: num(r?.ab_soon), mfLife: num(r?.mf_life), mfHealth: num(r?.mf_health), mfGeneral: num(r?.mf_general),
    mfMultiple: num(r?.mf_multi),
  };
}

/* ───────────────────────── §23–24 category and type ───────────────────────── */

export type BookCut = { key: string; line: string; clients: number; premium: number; policies: number };

/** The in-force book by client category and by client type, per line. */
export async function loadBookCuts(tx: Tx, w: InsWindow): Promise<{ byCategory: BookCut[]; byType: BookCut[] }> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         x AS (
           SELECT CASE WHEN cat IN ('A', 'B', 'C', 'D') THEN cat ELSE 'none' END AS cat, ctype, line, investor_id, premium
             FROM pol
            WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND status IN (${inList(STATUS_IN_FORCE)})
         )
    SELECT cat, ctype, line,
           COUNT(DISTINCT investor_id)::int AS clients, COALESCE(SUM(premium), 0) AS premium, COUNT(*)::int AS policies
      FROM x
     GROUP BY GROUPING SETS ((cat, line), (ctype, line), (cat), (ctype))
  `)).rows as Row[];
  const byCategory: BookCut[] = [];
  const byType: BookCut[] = [];
  for (const r of rows) {
    const line = str(r.line) ?? "all";
    if (r.cat != null && r.ctype == null) byCategory.push({ key: String(r.cat), line, clients: num(r.clients), premium: num(r.premium), policies: num(r.policies) });
    if (r.ctype != null && r.cat == null) byType.push({ key: String(r.ctype), line, clients: num(r.clients), premium: num(r.premium), policies: num(r.policies) });
  }
  return { byCategory, byType };
}

/* ───────────────────────── §27 industry ───────────────────────── */

export type IndustryRow = { industry: string | null; clients: number; premium: number; policies: number };

export async function loadIndustry(tx: Tx, w: InsWindow): Promise<IndustryRow[]> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)})
    SELECT occupation, COUNT(DISTINCT investor_id)::int AS clients, COALESCE(SUM(premium), 0) AS premium, COUNT(*)::int AS policies
      FROM pol
     WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND status IN (${inList(STATUS_IN_FORCE)}) AND ctype = 'corporate'
     GROUP BY occupation ORDER BY premium DESC
  `)).rows as Row[];
  return rows.map((r) => ({ industry: str(r.occupation), clients: num(r.clients), premium: num(r.premium), policies: num(r.policies) }));
}
