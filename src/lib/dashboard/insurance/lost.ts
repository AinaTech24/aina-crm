/**
 * Lost / cancelled business (§18–19). A policy is lost in a window when the
 * audit trail shows it moving to lapsed, surrendered or cancelled inside it —
 * the policy row carries no lapse or cancellation date of its own.
 *
 *   · New business lost — cancelled before issue (from proposed / in
 *     underwriting).
 *   · Renewal lost — an issued policy that lapsed, was surrendered or cancelled.
 *   · Reason — the policy's lapse_reason as keyed, grouped case-insensitively;
 *     blank is "Reason not captured", never a guessed reason. (The policy form
 *     has no reason field today; it can only be set through the API.)
 *
 * Policies already marked lost with no audit entry (imported, or older than the
 * audit trail) have no date; they are counted separately, never slipped into a
 * period.
 */

import { sql } from "drizzle-orm";
import { inList, STATUS_LOST, STATUS_PENDING } from "@/lib/insurance/book";
import { lostEvents, num, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

export type LostRow = {
  policyId: string; investorId: string; client: string; grp: string; policyType: string; plan: string; premium: number;
  reason: string | null; ownerId: string | null; sellerId: string | null; insurer: string | null; lostOn: string; status: string; newBusiness: boolean;
};
export type LostSplit = { key: string | null; label: string | null; count: number; premium: number };
export type LostDesk = {
  count: number; premium: number;
  newBiz: { count: number; premium: number };
  renewal: { count: number; premium: number };
  byReason: LostSplit[]; byGroup: LostSplit[]; byBranch: LostSplit[]; byOwner: LostSplit[]; byInsurer: LostSplit[];
  rows: LostRow[]; more: number;
  undated: { count: number; premium: number };
};

export async function loadLost(tx: Tx, w: InsWindow, from: string, to: string, limit = 50): Promise<LostDesk> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         ev AS (${lostEvents(w, from, to)})
    SELECT pol.id, pol.investor_id, pol.client, pol.grp, pol.policy_type, pol.plan_name, pol.premium, pol.lapse_reason,
           pol.owner_id::text AS owner_id, pol.seller_id::text AS seller_id, pol.branch_id::text AS branch_id, pol.insurer, pol.insurer_key,
           ev.lost_on::text AS lost_on, ev.lost_status, ev.from_status
      FROM ev JOIN pol ON pol.id = ev.policy_id
     WHERE ${polWhere(w, { nature: false, status: false }, "pol")}
     ORDER BY ev.lost_on DESC, pol.premium DESC
  `)).rows as Row[];
  const undated = (await tx.execute(sql`
    WITH pol AS (${polBase(w)})
    SELECT COUNT(*)::int AS n, COALESCE(SUM(premium), 0) AS p FROM pol
     WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND pol.status IN (${inList(STATUS_LOST)})
       AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.tenant_id = ${w.tenantId}::uuid AND a.entity_type = 'insurance_policy'
                         AND a.entity_id = pol.id AND a.action IN ('insurance.update', 'insurance.delete'))
  `)).rows[0] as Row | undefined;

  const all: LostRow[] = rows.map((r) => ({
    policyId: String(r.id), investorId: String(r.investor_id), client: String(r.client ?? "—"), grp: String(r.grp),
    policyType: String(r.policy_type ?? ""), plan: String(r.plan_name ?? ""), premium: num(r.premium),
    reason: str(r.lapse_reason), ownerId: str(r.owner_id), sellerId: str(r.seller_id), insurer: str(r.insurer), lostOn: String(r.lost_on),
    status: String(r.lost_status ?? "cancelled"),
    newBusiness: (STATUS_PENDING as readonly string[]).includes(String(r.from_status ?? "")),
  }));
  const split = (keyOf: (r: Row) => string | null, labelOf?: (r: Row) => string | null): LostSplit[] => {
    const m = new Map<string | null, LostSplit>();
    for (const r of rows) {
      const k = keyOf(r);
      const cur = m.get(k) ?? { key: k, label: labelOf ? labelOf(r) : k, count: 0, premium: 0 };
      cur.count += 1;
      cur.premium += num(r.premium);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.premium - a.premium || b.count - a.count);
  };
  const sum = (xs: LostRow[]) => ({ count: xs.length, premium: xs.reduce((s, x) => s + x.premium, 0) });
  return {
    ...sum(all),
    newBiz: sum(all.filter((x) => x.newBusiness)),
    renewal: sum(all.filter((x) => !x.newBusiness)),
    // Grouped case-insensitively; the label is the first spelling seen.
    byReason: split((r) => (str(r.lapse_reason) ? String(r.lapse_reason).trim().toLowerCase() : null), (r) => str(r.lapse_reason)),
    byGroup: split((r) => String(r.grp)),
    byBranch: split((r) => str(r.branch_id)),
    byOwner: split((r) => str(r.owner_id)),
    byInsurer: split((r) => str(r.insurer_key) || null, (r) => str(r.insurer)),
    rows: all.slice(0, limit),
    more: Math.max(0, all.length - limit),
    undated: { count: num(undated?.n), premium: num(undated?.p) },
  };
}
