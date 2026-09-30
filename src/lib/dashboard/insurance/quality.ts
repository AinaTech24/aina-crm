/**
 * Insurance data quality (§38–39), over in-force and pending policies.
 *
 * The CRM has no mandatory-field configuration for policies, so the fields
 * counted are fixed here, in one list: what a policy needs for this dashboard
 * to be right. Status is not in it — it can never be blank. Completion % is
 * checks passed over checks that APPLY: a renewal date is required only of a
 * renewable in-force policy, a policy number only of an issued one.
 */

import { sql } from "drizzle-orm";
import { inList, PRODUCT_GROUPS, STATUS_IN_FORCE, STATUS_PENDING } from "@/lib/insurance/book";
import { num, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

const KNOWN_TYPES = PRODUCT_GROUPS.flatMap((g) => [...g.types]);

export const QUALITY_CHECKS = [
  { key: "cat", label: "Client category missing", gap: "cat" },
  { key: "due", label: "Renewal date missing", gap: "due" },
  { key: "type", label: "Policy type not recognised", gap: "type" },
  { key: "insurer", label: "Insurer missing", gap: "insurer" },
  { key: "premium", label: "Premium missing", gap: "premium" },
  { key: "number", label: "Policy number missing", gap: "number" },
  { key: "owner", label: "RM / owner missing", gap: "owner" },
  { key: "branch", label: "Branch missing", gap: "branch" },
  { key: "contact", label: "Client contact missing", gap: "contact" },
] as const;

export type QualityCounts = Record<(typeof QUALITY_CHECKS)[number]["key"], number>;
export type QualityCut = { key: string | null; policies: number; applicable: number; passed: number; pct: number | null; gaps: number };
export type Quality = { policies: number; counts: QualityCounts; applicable: number; passed: number; pct: number | null; byBranch: QualityCut[]; byOwner: QualityCut[] };

export async function loadQuality(tx: Tx, w: InsWindow): Promise<Quality> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         p AS (
           SELECT pol.*,
                  (pol.status IN (${inList(STATUS_IN_FORCE)})) AS in_force,
                  (pol.status IN (${inList(STATUS_IN_FORCE)}) AND pol.freq <> 'single') AS renewable
             FROM pol
            WHERE ${polWhere(w, { nature: false, status: false }, "pol")}
              AND pol.status IN (${inList(STATUS_IN_FORCE)}, ${inList(STATUS_PENDING)})
         ),
         g AS (
           SELECT p.branch_id::text AS branch_id, p.owner_id::text AS owner_id,
                  (p.cat = '')::int AS g_cat,
                  (p.renewable AND p.due IS NULL)::int AS g_due, p.renewable::int AS a_due,
                  (p.policy_type IS NULL OR p.policy_type NOT IN (${inList(KNOWN_TYPES)}))::int AS g_type,
                  (p.insurer IS NULL)::int AS g_insurer,
                  p.premium_missing::int AS g_premium,
                  (p.in_force AND p.policy_number IS NULL)::int AS g_number, p.in_force::int AS a_number,
                  (p.owner_id IS NULL)::int AS g_owner,
                  (p.branch_id IS NULL)::int AS g_branch,
                  (NULLIF(btrim(COALESCE(p.client_phone, '')), '') IS NULL AND NULLIF(btrim(COALESCE(p.client_email, '')), '') IS NULL)::int AS g_contact
             FROM p
         )
    SELECT branch_id, owner_id, COUNT(*)::int AS n,
           SUM(g_cat)::int AS cat, SUM(g_due)::int AS due, SUM(a_due)::int AS a_due, SUM(g_type)::int AS type,
           SUM(g_insurer)::int AS insurer, SUM(g_premium)::int AS premium, SUM(g_number)::int AS number, SUM(a_number)::int AS a_number,
           SUM(g_owner)::int AS owner, SUM(g_branch)::int AS branch, SUM(g_contact)::int AS contact
      FROM g GROUP BY 1, 2
  `)).rows as Row[];

  // Seven checks apply to every policy; the renewal date and the policy number only where they can exist.
  const ALWAYS = 7;
  const cut = (xs: Row[], key: string | null): QualityCut => {
    const policies = xs.reduce((a, r) => a + num(r.n), 0);
    const applicable = xs.reduce((a, r) => a + num(r.n) * ALWAYS + num(r.a_due) + num(r.a_number), 0);
    const gaps = xs.reduce((a, r) => a + num(r.cat) + num(r.due) + num(r.type) + num(r.insurer) + num(r.premium) + num(r.number) + num(r.owner) + num(r.branch) + num(r.contact), 0);
    return { key, policies, applicable, passed: applicable - gaps, pct: applicable > 0 ? (applicable - gaps) / applicable : null, gaps };
  };
  const counts = Object.fromEntries(QUALITY_CHECKS.map((c) => [c.key, rows.reduce((a, r) => a + num(r[c.key]), 0)])) as QualityCounts;
  const total = cut(rows, null);
  const groupBy = (field: "branch_id" | "owner_id") => {
    const m = new Map<string | null, Row[]>();
    for (const r of rows) {
      const k = str(r[field]);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].map(([k, xs]) => cut(xs, k)).sort((a, b) => (a.pct ?? 1) - (b.pct ?? 1) || b.gaps - a.gaps);
  };
  return { policies: total.policies, counts, applicable: total.applicable, passed: total.passed, pct: total.pct, byBranch: groupBy("branch_id"), byOwner: groupBy("owner_id") };
}
