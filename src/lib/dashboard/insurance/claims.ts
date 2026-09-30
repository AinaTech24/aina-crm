/**
 * Claims, at management level only (§33–37). The processing view is the
 * claims register (/dashboard/insurance-claims) and its scorecard.
 *
 *   · Logged — intimated in the window. Settled — settled fully or in part with
 *     a settlement date in the window. Open — not settled / rejected /
 *     withdrawn (the monthly claims summary's sets, lib/insurance/claims-summary).
 *   · Outstanding — claimed less settled, on open claims. The CRM keeps no
 *     approved amount, so this is what was claimed and not yet paid.
 *   · Past SLA — open longer than the firm's claim SLA (claimSlaDays), counted
 *     from intimation (or the record's creation where intimation is blank).
 *   · Settlement % is two separate figures: by count (settled ÷ settled +
 *     rejected, decided in the window) and by amount (settled ÷ claimed, on
 *     claims settled in the window). A rejection has no date of its own, so its
 *     last update stands in for it. Neither is a verdict on an insurer.
 */

import { sql } from "drizzle-orm";
import { CLAIM_FNR, CLAIM_OPEN, CLAIM_QUERY, CLAIM_SETTLED, inList, STATUS_IN_FORCE } from "@/lib/insurance/book";
import { claimBase, claimWhere, num, numOrNull, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

const OPEN = inList(CLAIM_OPEN);

function groupCut(w: InsWindow) {
  switch (w.filter.claimGroup) {
    case "open": return sql`cl.status IN (${OPEN})`;
    case "fnr": return sql`cl.status IN (${inList(CLAIM_FNR)})`;
    case "query": return sql`cl.status IN (${inList(CLAIM_QUERY)})`;
    case "settled": return sql`cl.status IN (${inList(CLAIM_SETTLED)})`;
    case "rejected": return sql`cl.status = 'rejected'`;
    default: return sql`TRUE`;
  }
}

export type ClaimFigures = {
  logged: number; loggedAmount: number; settled: number; settledAmount: number; pending: number; fnr: number;
  open: number; outstanding: number; pastSla: number; query: number;
};
export type ClaimSnapshot = Record<"all" | "personal" | "commercial", ClaimFigures>;

export async function loadClaimSnapshot(tx: Tx, w: InsWindow, from: string, to: string): Promise<ClaimSnapshot> {
  const rows = (await tx.execute(sql`
    WITH cl AS (${claimBase(w)})
    SELECT COALESCE(cl.line, 'unclassified') AS line,
           COUNT(*) FILTER (WHERE cl.intimation_date BETWEEN ${from}::date AND ${to}::date)::int AS logged,
           COALESCE(SUM(cl.claimed) FILTER (WHERE cl.intimation_date BETWEEN ${from}::date AND ${to}::date), 0) AS logged_amt,
           COUNT(*) FILTER (WHERE cl.status IN (${inList(CLAIM_SETTLED)}) AND cl.settlement_date BETWEEN ${from}::date AND ${to}::date)::int AS settled,
           COALESCE(SUM(cl.settled) FILTER (WHERE cl.status IN (${inList(CLAIM_SETTLED)}) AND cl.settlement_date BETWEEN ${from}::date AND ${to}::date), 0) AS settled_amt,
           COUNT(*) FILTER (WHERE cl.status IN (${OPEN}) AND cl.status NOT IN (${inList(CLAIM_FNR)}))::int AS pending,
           COUNT(*) FILTER (WHERE cl.status IN (${inList(CLAIM_FNR)}))::int AS fnr,
           COUNT(*) FILTER (WHERE cl.status IN (${inList(CLAIM_QUERY)}))::int AS query,
           COUNT(*) FILTER (WHERE cl.status IN (${OPEN}))::int AS open,
           COALESCE(SUM(GREATEST(cl.claimed - cl.settled, 0)) FILTER (WHERE cl.status IN (${OPEN})), 0) AS outstanding,
           COUNT(*) FILTER (WHERE cl.status IN (${OPEN}) AND cl.opened_on < ${w.today}::date - ${w.t.claimSlaDays}::int)::int AS past_sla
      FROM cl WHERE ${claimWhere(w, "cl")} AND ${groupCut(w)}
     GROUP BY 1
  `)).rows as Row[];
  const zero = (): ClaimFigures => ({ logged: 0, loggedAmount: 0, settled: 0, settledAmount: 0, pending: 0, fnr: 0, open: 0, outstanding: 0, pastSla: 0, query: 0 });
  const out: ClaimSnapshot = { all: zero(), personal: zero(), commercial: zero() };
  for (const r of rows) {
    const f: ClaimFigures = {
      logged: num(r.logged), loggedAmount: num(r.logged_amt), settled: num(r.settled), settledAmount: num(r.settled_amt),
      pending: num(r.pending), fnr: num(r.fnr), open: num(r.open), outstanding: num(r.outstanding), pastSla: num(r.past_sla), query: num(r.query),
    };
    for (const k of Object.keys(f) as Array<keyof ClaimFigures>) {
      out.all[k] += f[k];
      if (r.line === "personal") out.personal[k] += f[k];
      if (r.line === "commercial") out.commercial[k] += f[k];
    }
  }
  return out;
}

export type Settlement = { decided: number; settled: number; rejected: number; countPct: number | null; claimedOnSettled: number; settledAmount: number; amountPct: number | null };

export async function loadSettlement(tx: Tx, w: InsWindow, from: string, to: string): Promise<Settlement> {
  const r = (await tx.execute(sql`
    WITH c AS (${claimBase(w)})
    SELECT COUNT(*) FILTER (WHERE status IN (${inList(CLAIM_SETTLED)}) AND settlement_date BETWEEN ${from}::date AND ${to}::date)::int AS settled,
           COUNT(*) FILTER (WHERE status = 'rejected' AND (upd AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS rejected,
           COALESCE(SUM(claimed) FILTER (WHERE status IN (${inList(CLAIM_SETTLED)}) AND settlement_date BETWEEN ${from}::date AND ${to}::date), 0) AS claimed,
           COALESCE(SUM(settled) FILTER (WHERE status IN (${inList(CLAIM_SETTLED)}) AND settlement_date BETWEEN ${from}::date AND ${to}::date), 0) AS paid
      FROM c WHERE ${claimWhere(w, "c")}
  `)).rows[0] as Row | undefined;
  const settled = num(r?.settled);
  const rejected = num(r?.rejected);
  const claimed = num(r?.claimed);
  const paid = num(r?.paid);
  return {
    decided: settled + rejected, settled, rejected,
    countPct: settled + rejected > 0 ? settled / (settled + rejected) : null,
    claimedOnSettled: claimed, settledAmount: paid, amountPct: claimed > 0 ? paid / claimed : null,
  };
}

export const CLAIM_AGE_BUCKETS = [
  { key: "c1", label: "0–7 days", min: 0, max: 7 },
  { key: "c2", label: "8–15 days", min: 8, max: 15 },
  { key: "c3", label: "16–30 days", min: 16, max: 30 },
  { key: "c4", label: "31–60 days", min: 31, max: 60 },
  { key: "c5", label: "61–90 days", min: 61, max: 90 },
  { key: "c6", label: "90+ days", min: 91, max: 100000 },
] as const;

export async function loadClaimAgeing(tx: Tx, w: InsWindow): Promise<Array<{ key: string; label: string; count: number; amount: number }>> {
  const rows = (await tx.execute(sql`
    WITH cl AS (${claimBase(w)})
    SELECT ${w.today}::date - opened_on AS age, GREATEST(claimed - settled, 0) AS amt
      FROM cl WHERE ${claimWhere(w, "cl")} AND status IN (${OPEN})
  `)).rows as Row[];
  return CLAIM_AGE_BUCKETS.map((b) => {
    const inB = rows.filter((r) => num(r.age) >= b.min && num(r.age) <= b.max);
    return { key: b.key, label: b.label, count: inB.length, amount: inB.reduce((a, r) => a + num(r.amt), 0) };
  });
}

export type Escalation = {
  claimId: string; investorId: string | null; client: string; claimType: string | null; insurer: string | null; amount: number;
  status: string; ageDays: number; handlerId: string | null; why: string[];
};

/** Only exceptions: past SLA, file not received, insurer query, a recent rejection, a high-value open claim. */
export async function loadEscalations(tx: Tx, w: InsWindow, limit = 25): Promise<{ rows: Escalation[]; total: number }> {
  const rows = (await tx.execute(sql`
    WITH cl AS (${claimBase(w)}),
         c AS (SELECT cl.* FROM cl WHERE ${claimWhere(w, "cl")})
    SELECT id, investor_id, client, claim_type, insurer, claimed, status, ${w.today}::date - opened_on AS age, handler_id::text AS handler_id,
           (status IN (${OPEN}) AND opened_on < ${w.today}::date - ${w.t.claimSlaDays}::int) AS past_sla,
           (status IN (${inList(CLAIM_FNR)})) AS fnr,
           (status IN (${inList(CLAIM_QUERY)})) AS query,
           (status = 'rejected' AND upd >= now() - interval '30 days') AS rejected_recent,
           (status IN (${OPEN}) AND claimed >= ${w.t.insHighClaim}) AS high_value
      FROM c
     WHERE (status IN (${OPEN}) AND (opened_on < ${w.today}::date - ${w.t.claimSlaDays}::int OR status IN (${inList(CLAIM_FNR)})
            OR status IN (${inList(CLAIM_QUERY)}) OR claimed >= ${w.t.insHighClaim}))
        OR (status = 'rejected' AND upd >= now() - interval '30 days')
     ORDER BY (status IN (${OPEN}) AND opened_on < ${w.today}::date - ${w.t.claimSlaDays}::int) DESC, claimed DESC
  `)).rows as Row[];
  const mapped: Escalation[] = rows.map((r) => ({
    claimId: String(r.id), investorId: str(r.investor_id), client: String(r.client ?? "—"), claimType: str(r.claim_type),
    insurer: str(r.insurer), amount: num(r.claimed), status: String(r.status), ageDays: num(r.age), handlerId: str(r.handler_id),
    why: [
      r.past_sla === true ? "Past SLA" : null,
      r.fnr === true ? "File not received" : null,
      r.query === true ? "Insurer query" : null,
      r.rejected_recent === true ? "Rejected — review" : null,
      r.high_value === true ? "High value" : null,
    ].filter((x): x is string => !!x),
  }));
  return { rows: mapped.slice(0, limit), total: mapped.length };
}

export type ServiceLink = { investorId: string; client: string; kind: "renewal_with_claim" | "claim_on_lapsed"; policy: string; due: string | null; claimStatus: string };

/**
 * §37 — where a claim and a renewal meet. A coordination list, not a
 * prediction: which renewals to handle knowing a claim is open, and which open
 * claims sit on a policy that is no longer in force.
 */
export async function loadRenewalVsClaims(tx: Tx, w: InsWindow, limit = 20): Promise<{ rows: ServiceLink[]; renewalWithClaim: number; claimOnLapsed: number }> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)}),
         p AS (SELECT * FROM pol WHERE ${polWhere(w, { nature: false, status: false }, "pol")}),
         c AS (SELECT * FROM insurance_claims WHERE tenant_id = ${w.tenantId}::uuid AND claim_status IN (${OPEN}))
    SELECT p.investor_id, p.client, p.plan_name, p.due::text AS due, c.claim_status,
           -- Past grace first: an overdue policy beyond its grace is no longer a renewal in hand.
           CASE WHEN p.status IN ('lapsed', 'surrendered', 'cancelled', 'matured')
                  OR (p.status IN (${inList(STATUS_IN_FORCE)}) AND p.due < ${w.today}::date - p.grace)
                THEN 'claim_on_lapsed' ELSE 'renewal_with_claim' END AS kind
      FROM c JOIN p ON p.id = c.policy_id
     WHERE (p.status IN (${inList(STATUS_IN_FORCE)}) AND p.due IS NOT NULL AND p.due <= ${w.today}::date + 60)
        OR p.status IN ('lapsed', 'surrendered', 'cancelled', 'matured')
        OR (p.status IN (${inList(STATUS_IN_FORCE)}) AND p.due < ${w.today}::date - p.grace)
     ORDER BY p.due ASC NULLS LAST
  `)).rows as Row[];
  const mapped: ServiceLink[] = rows.map((r) => ({
    investorId: String(r.investor_id), client: String(r.client ?? "—"), kind: r.kind === "renewal_with_claim" ? "renewal_with_claim" : "claim_on_lapsed",
    policy: String(r.plan_name ?? ""), due: str(r.due), claimStatus: String(r.claim_status),
  }));
  return {
    rows: mapped.slice(0, limit),
    renewalWithClaim: mapped.filter((x) => x.kind === "renewal_with_claim").length,
    claimOnLapsed: mapped.filter((x) => x.kind === "claim_on_lapsed").length,
  };
}

/** Open claims per insurer key (for the insurer table). */
export async function loadOpenClaimsByInsurer(tx: Tx, w: InsWindow): Promise<Map<string, number>> {
  const rows = (await tx.execute(sql`
    WITH cl AS (${claimBase(w)})
    SELECT insurer_key, COUNT(*)::int AS n FROM cl WHERE ${claimWhere(w, "cl")} AND status IN (${OPEN}) GROUP BY 1
  `)).rows as Row[];
  return new Map(rows.map((r) => [String(r.insurer_key), num(r.n)]));
}

export { numOrNull };
