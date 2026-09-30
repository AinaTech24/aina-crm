/**
 * Business before the policy (§12–13, §26, §31–32): insurance leads, insurance
 * proposals and policies awaiting issue.
 *
 *   · Stages are the CRM's own insurance pipeline (lib/pipelines/config.ts):
 *     inquiry → needs analysis → quoted → proposal → underwriting → issued,
 *     or lost. The lead workflow's insurance stages map onto the same seven.
 *   · Days in stage is known only where the lead workflow stamped the stage;
 *     otherwise the lead's age (days since it was created) is shown, and said.
 *   · Potential premium is the lead's expected business amount, blank when not
 *     keyed — never 0.
 *   · Personal / Commercial: a Corporate lead is Commercial Lines; any other
 *     lead is Personal. A lead carries no policy type before the policy exists.
 *   · Issuance: the policy statuses the CRM has are proposed, in underwriting,
 *     issued and cancelled. Documents pending, payment pending and insurer
 *     rejection are not recorded on a policy.
 */

import { sql } from "drizzle-orm";
import { inList, STATUS_PENDING } from "@/lib/insurance/book";
import { leadBase, leadWhere, num, numOrNull, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

export const LEAD_STAGES = [
  { key: "inquiry", label: "Inquiry" },
  { key: "needs_analysis", label: "Needs analysis" },
  { key: "quoted", label: "Quote shared" },
  { key: "proposal", label: "Proposal" },
  { key: "underwriting", label: "Underwriting" },
  { key: "issued", label: "Policy issued" },
  { key: "lost", label: "Lost" },
] as const;
export const LEAD_STAGE_LABEL: Record<string, string> = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s.label]));

export type StageRow = { key: string; label: string; count: number; potential: number | null; avgDays: number | null; personal: number; commercial: number };
export type PipeRow = {
  id: string; name: string; corporate: boolean; product: string | null; potential: number | null; stage: string;
  days: number; daysBasis: "stage" | "age"; ownerId: string | null; nextAction: string | null; occupation: string | null;
};
export type Pipeline = {
  stages: StageRow[];
  open: { count: number; potential: number | null };
  ageing: Array<{ key: string; label: string; count: number; potential: number | null }>;
  rows: PipeRow[];
  more: number;
  corporate: { stages: StageRow[]; meetings: number; rows: PipeRow[] };
  lostInPeriod: { count: number; potential: number | null };
};

const AGE_BUCKETS = [
  { key: "a1", label: "0–3 days", min: 0, max: 3 },
  { key: "a2", label: "4–7 days", min: 4, max: 7 },
  { key: "a3", label: "8–15 days", min: 8, max: 15 },
  { key: "a4", label: "16–30 days", min: 16, max: 30 },
  { key: "a5", label: "30+ days", min: 31, max: 100000 },
];

export async function loadPipeline(tx: Tx, w: InsWindow, limit = 25): Promise<Pipeline> {
  const rows = (await tx.execute(sql`
    WITH ld AS (${leadBase(w)})
    SELECT ld.id, ld.name, (ld.lead_type = 'corporate') AS corporate, ld.stage, ld.potential, ld.owner_id::text AS owner_id,
           ld.next_follow_up_at::text AS next_action, ld.occupation, ld.lost_at,
           (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(ld.interest_products) = 'array' THEN ld.interest_products ELSE '[]'::jsonb END) x) AS product,
           CASE WHEN ld.stage_since IS NOT NULL THEN ${w.today}::date - (ld.stage_since AT TIME ZONE 'Asia/Kolkata')::date END AS in_stage,
           ${w.today}::date - (ld.created_at AT TIME ZONE 'Asia/Kolkata')::date AS age
      FROM ld WHERE ${leadWhere(w, "ld")}
  `)).rows as Row[];

  const meetings = (await tx.execute(sql`
    WITH ld AS (${leadBase(w)})
    SELECT COUNT(*)::int AS n FROM review_meetings m JOIN ld ON ld.id = m.lead_id
     WHERE m.tenant_id = ${w.tenantId}::uuid AND m.status = 'completed' AND ld.lead_type = 'corporate'
       AND ${leadWhere(w, "ld")} AND (m.meeting_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${w.fyStart}::date AND ${w.today}::date
  `)).rows[0] as Row | undefined;

  const mapped: PipeRow[] = rows.map((r) => {
    const inStage = numOrNull(r.in_stage);
    return {
      id: String(r.id), name: String(r.name ?? "—"), corporate: r.corporate === true, product: str(r.product),
      potential: numOrNull(r.potential), stage: String(r.stage), days: inStage ?? num(r.age), daysBasis: inStage != null ? "stage" : "age",
      ownerId: str(r.owner_id), nextAction: str(r.next_action), occupation: str(r.occupation),
    };
  });
  const stagesOf = (xs: PipeRow[]): StageRow[] => LEAD_STAGES.map((s) => {
    const inS = xs.filter((x) => x.stage === s.key);
    const known = inS.filter((x) => x.potential != null);
    return {
      key: s.key, label: s.label, count: inS.length,
      potential: known.length ? known.reduce((a, x) => a + (x.potential ?? 0), 0) : null,
      avgDays: inS.length ? Math.round(inS.reduce((a, x) => a + x.days, 0) / inS.length) : null,
      personal: inS.filter((x) => !x.corporate).length,
      commercial: inS.filter((x) => x.corporate).length,
    };
  });
  const open = mapped.filter((x) => x.stage !== "issued" && x.stage !== "lost");
  const knownOpen = open.filter((x) => x.potential != null);
  const lostIn = rows.filter((r) => r.stage === "lost" && r.lost_at && String(r.lost_at).slice(0, 10) >= w.from && String(r.lost_at).slice(0, 10) <= w.to);
  const lostKnown = lostIn.filter((r) => r.potential != null);
  const sorted = [...open].sort((a, b) => b.days - a.days || (b.potential ?? 0) - (a.potential ?? 0));
  const corp = mapped.filter((x) => x.corporate);
  return {
    stages: stagesOf(mapped),
    open: { count: open.length, potential: knownOpen.length ? knownOpen.reduce((a, x) => a + (x.potential ?? 0), 0) : null },
    ageing: AGE_BUCKETS.map((b) => {
      const inB = open.filter((x) => x.days >= b.min && x.days <= b.max);
      const k = inB.filter((x) => x.potential != null);
      return { key: b.key, label: b.label, count: inB.length, potential: k.length ? k.reduce((a, x) => a + (x.potential ?? 0), 0) : null };
    }),
    rows: sorted.slice(0, limit),
    more: Math.max(0, sorted.length - limit),
    corporate: {
      stages: stagesOf(corp),
      meetings: num(meetings?.n),
      rows: corp.filter((x) => x.stage !== "issued").sort((a, b) => (b.potential ?? 0) - (a.potential ?? 0)).slice(0, limit),
    },
    lostInPeriod: { count: lostIn.length, potential: lostKnown.length ? lostKnown.reduce((a, r) => a + num(r.potential), 0) : null },
  };
}

/* ───────────────────────── §31–32 issuance ───────────────────────── */

export type PendingPolicy = {
  policyId: string; investorId: string; client: string; policyType: string; plan: string; premium: number; insurer: string | null;
  status: string; ownerId: string | null; opsId: string | null; ageDays: number; highPremium: boolean; slaBreached: boolean;
};
export type Issuance = {
  proposed: { count: number; premium: number };
  underwriting: { count: number; premium: number };
  breached: number;
  rows: PendingPolicy[];
  more: number;
};

export async function loadIssuance(tx: Tx, w: InsWindow, limit = 25): Promise<Issuance> {
  const rows = (await tx.execute(sql`
    WITH pol AS (${polBase(w)})
    SELECT id, investor_id, client, policy_type, plan_name, premium, insurer, status, owner_id::text AS owner_id,
           CASE WHEN seller_id IS DISTINCT FROM owner_id THEN seller_id::text END AS ops_id,
           ${w.today}::date - (created_at AT TIME ZONE 'Asia/Kolkata')::date AS age
      FROM pol
     WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND status IN (${inList(STATUS_PENDING)})
     ORDER BY created_at ASC
  `)).rows as Row[];
  const mapped: PendingPolicy[] = rows.map((r) => ({
    policyId: String(r.id), investorId: String(r.investor_id), client: String(r.client ?? "—"), policyType: String(r.policy_type ?? ""),
    plan: String(r.plan_name ?? ""), premium: num(r.premium), insurer: str(r.insurer), status: String(r.status),
    ownerId: str(r.owner_id), opsId: str(r.ops_id), ageDays: num(r.age),
    highPremium: num(r.premium) >= w.t.insHighPremium,
    slaBreached: num(r.age) > w.t.insIssuanceSlaDays,
  }));
  const pair = (s: string) => {
    const xs = mapped.filter((x) => x.status === s);
    return { count: xs.length, premium: xs.reduce((a, x) => a + x.premium, 0) };
  };
  // Oldest first, but an SLA breach or a high premium rises to the top.
  const sorted = [...mapped].sort((a, b) =>
    Number(b.slaBreached) - Number(a.slaBreached) || Number(b.highPremium) - Number(a.highPremium) || b.ageDays - a.ageDays);
  return {
    proposed: pair("proposed"), underwriting: pair("in_underwriting"),
    breached: mapped.filter((x) => x.slaBreached).length,
    rows: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit),
  };
}

/* ───────────────────────── insurance proposals ───────────────────────── */

export type ProposalDesk = { open: number; premium: number; aged: number; agedPremium: number; large: number; largePremium: number; oldestDays: number | null };

/** Open insurance proposals: sent, viewed, ready or draft, not past their valid-till date. */
export async function loadInsuranceProposals(tx: Tx, w: InsWindow): Promise<ProposalDesk> {
  const scope = w.scope.kind === "firm" ? sql`TRUE`
    : w.scope.kind === "branch" ? sql`pr.branch_id = ${w.scope.branchId}::uuid`
    : sql`pr.prepared_by_user_id = ${w.scope.userId}::uuid`;
  const r = (await tx.execute(sql`
    WITH pr AS (
      SELECT pr.*, COALESCE(pr.total_investment, 0)::numeric AS amt,
             ${w.today}::date - (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date AS age
        FROM proposals pr
       WHERE pr.tenant_id = ${w.tenantId}::uuid
         AND (pr.type = 'insurance' OR pr.products @> '[{"kind": "insurance"}]'::jsonb)
         AND pr.status IN ('draft', 'ready', 'sent', 'viewed')
         AND (pr.valid_until IS NULL OR (pr.valid_until AT TIME ZONE 'Asia/Kolkata')::date >= ${w.today}::date)
    )
    SELECT COUNT(*)::int AS n, COALESCE(SUM(amt), 0) AS p,
           COUNT(*) FILTER (WHERE age > ${w.t.proposalAgeingDays})::int AS aged_n,
           COALESCE(SUM(amt) FILTER (WHERE age > ${w.t.proposalAgeingDays}), 0) AS aged_p,
           COUNT(*) FILTER (WHERE amt >= ${w.t.insHighPremium})::int AS large_n,
           COALESCE(SUM(amt) FILTER (WHERE amt >= ${w.t.insHighPremium}), 0) AS large_p,
           MAX(age) AS oldest
      FROM pr WHERE ${scope}
  `)).rows[0] as Row | undefined;
  return {
    open: num(r?.n), premium: num(r?.p), aged: num(r?.aged_n), agedPremium: num(r?.aged_p),
    large: num(r?.large_n), largePremium: num(r?.large_p), oldestDays: numOrNull(r?.oldest),
  };
}
