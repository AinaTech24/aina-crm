/**
 * People and places (§9–11, §25, §28): branch-wise, RM-wise, the insurance
 * team, meetings and insurers. Every row is a projection of the same business
 * rows (business.ts), so each table's columns sum to the figures above it.
 *
 *   · Branch — the client's branch. RM — the business owner (book.ts): the
 *     seller when they sell, else the client's RM. Operations is never
 *     credited with a sale.
 *   · The insurance team table is by the SELLER, restricted to users holding
 *     the insurance_team role — who keyed or sold the policy is what the CRM
 *     records for them. There is no insurance-executive field on a policy.
 *   · An insurance MEETING is one held by an insurance-team member, or with a
 *     lead on the insurance pipeline. The meeting record has no product field.
 *   · Insurers are grouped case-insensitively on the name as keyed; the most
 *     common spelling labels the row. No ranking, no judgement.
 */

import { sql } from "drizzle-orm";
import { inList, STATUS_IN_FORCE, STATUS_PENDING } from "@/lib/insurance/book";
import { branchNames, byDim, loadBiz, userNames, type Money } from "./business";
import { loadNewClients } from "./clients";
import { loadLost } from "./lost";
import { loadRetention, retentionOf } from "./renewals";
import { leadBase, leadWhere, num, polBase, polWhere, str, type InsWindow, type Row, type Tx } from "./window";

export type PeopleRow = {
  key: string | null;
  name: string;
  branch: string | null;
  money: Money;
  newClients: number;
  renewalPct: number | null;
  lostPremium: number;
  synthetic?: boolean;
};

const ZERO: Money = { newAmt: 0, renAmt: 0, total: 0, newN: 0, renN: 0, policies: 0, unpriced: 0 };

/** §9 by branch · §10 by RM. */
export async function loadPeople(tx: Tx, w: InsWindow): Promise<{ branches: PeopleRow[]; rms: PeopleRow[] }> {
  const [biz, nc, lost, retB, retO, bnames] = [
    await loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }], ["branch", "owner"]),
    await loadNewClients(tx, w, w.from, w.to),
    await loadLost(tx, w, w.from, w.to, 0),
    await loadRetention(tx, w, w.fyStart, w.to, "branch"),
    await loadRetention(tx, w, w.fyStart, w.to, "owner"),
    await branchNames(tx, w),
  ];
  const byBranch = byDim(biz, "cur", "branch");
  const byOwner = byDim(biz, "cur", "owner");
  const lostB = new Map(lost.byBranch.map((x) => [x.key, x.premium]));
  const lostO = new Map(lost.byOwner.map((x) => [x.key, x.premium]));
  const users = await userNames(tx, [...byOwner.keys(), ...nc.byOwner.keys(), ...lostO.keys()]);

  const branchKeys = new Set<string | null>([...byBranch.keys(), ...nc.byBranch.keys(), ...lostB.keys()]);
  const branches: PeopleRow[] = [...branchKeys].map((k) => ({
    key: k,
    name: k ? bnames.get(k) ?? "Branch" : "No branch recorded",
    branch: null,
    money: byBranch.get(k) ?? ZERO,
    newClients: nc.byBranch.get(k) ?? 0,
    renewalPct: retentionOf(retB, k)?.policyPct ?? null,
    lostPremium: lostB.get(k) ?? 0,
    synthetic: k == null,
  })).sort((a, b) => Number(!!a.synthetic) - Number(!!b.synthetic) || b.money.total - a.money.total);

  const ownerKeys = new Set<string | null>([...byOwner.keys(), ...nc.byOwner.keys(), ...lostO.keys()]);
  const rms: PeopleRow[] = [...ownerKeys].map((k) => {
    const u = k ? users.get(k) : undefined;
    return {
      key: k,
      name: k ? u?.name ?? "Former user" : "No owner recorded",
      branch: u?.branchId ? bnames.get(u.branchId) ?? null : null,
      money: byOwner.get(k) ?? ZERO,
      newClients: nc.byOwner.get(k) ?? 0,
      renewalPct: retentionOf(retO, k)?.policyPct ?? null,
      lostPremium: lostO.get(k) ?? 0,
      synthetic: k == null,
    };
  }).sort((a, b) => Number(!!a.synthetic) - Number(!!b.synthetic) || b.money.total - a.money.total);
  return { branches, rms };
}

/* ───────────────────────── §11 the insurance team ───────────────────────── */

export type ExecRow = {
  userId: string; name: string; handled: number; newAmt: number; renAmt: number; pending: number; renewalDue: number; lost: number;
};

export async function loadInsuranceTeam(tx: Tx, w: InsWindow): Promise<ExecRow[]> {
  const team = (await tx.execute(sql`
    SELECT id::text AS id, name FROM users
     WHERE tenant_id = ${w.tenantId}::uuid AND 'insurance_team' = ANY(roles) AND status <> 'offboarded'
       ${w.scope.kind === "branch" ? sql`AND branch_id = ${w.scope.branchId}::uuid` : sql``}
       ${w.scope.kind === "self" ? sql`AND id = ${w.scope.userId}::uuid` : sql``}
     ORDER BY name
  `)).rows as Row[];
  if (!team.length) return [];
  const biz = byDim(await loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }], ["seller"]), "cur", "seller");
  const lost = await loadLost(tx, w, w.from, w.to, 100_000);
  const counts = (await tx.execute(sql`
    WITH pol AS (${polBase(w)})
    SELECT seller_id::text AS seller_id,
           COUNT(*) FILTER (WHERE status IN (${inList(STATUS_PENDING)}))::int AS pending,
           COUNT(*) FILTER (WHERE status IN (${inList(STATUS_IN_FORCE)}) AND freq <> 'single' AND due IS NOT NULL
                              AND due <= ${w.today}::date + 30)::int AS due30
      FROM pol WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND seller_ins
     GROUP BY 1
  `)).rows as Row[];
  const leadsOpen = (await tx.execute(sql`
    WITH ld AS (${leadBase(w)})
    SELECT owner_id::text AS owner_id, COUNT(*)::int AS n FROM ld
     WHERE ${leadWhere(w, "ld")} AND stage NOT IN ('issued', 'lost') GROUP BY 1
  `)).rows as Row[];
  const c = new Map(counts.map((r) => [String(r.seller_id), r]));
  const l = new Map(leadsOpen.map((r) => [String(r.owner_id), num(r.n)]));
  return team.map((u) => {
    const id = String(u.id);
    const m = biz.get(id) ?? ZERO;
    return {
      userId: id, name: String(u.name ?? "—"),
      handled: m.policies,
      newAmt: m.newAmt, renAmt: m.renAmt,
      pending: num(c.get(id)?.pending) + (l.get(id) ?? 0),
      renewalDue: num(c.get(id)?.due30),
      lost: lost.rows.filter((x) => x.sellerId === id).length,
    };
  });
}

/* ───────────────────────── §25 meetings ───────────────────────── */

export type MeetingRow = { ownerId: string | null; name: string; newN: number; review: number; corporate: number; total: number; followUp: number };
export type Meetings = { newN: number; review: number; corporate: number; total: number; followUp: number; rows: MeetingRow[] };

export async function loadMeetings(tx: Tx, w: InsWindow): Promise<Meetings> {
  const scope = w.scope.kind === "firm" ? sql`TRUE`
    : w.scope.kind === "branch" ? sql`u.branch_id = ${w.scope.branchId}::uuid`
    : sql`m.rm_id = ${w.scope.userId}::uuid`;
  const rows = (await tx.execute(sql`
    SELECT m.rm_id::text AS owner_id, COALESCE(u.name, 'No owner recorded') AS name,
           COUNT(*) FILTER (WHERE m.category = 'new')::int AS new_n,
           COUNT(*) FILTER (WHERE m.category = 'review')::int AS review_n,
           COUNT(*) FILTER (WHERE i.investor_category IN ('corporate', 'company', 'llp', 'partnership', 'aop_boi') OR l.lead_type = 'corporate')::int AS corp_n,
           COUNT(*)::int AS total_n,
           COUNT(*) FILTER (WHERE m.status = 'completed' AND COALESCE(m.follow_up_task_created, 'false') IN ('false', ''))::int AS fu_n
      FROM review_meetings m
      LEFT JOIN users u ON u.id = m.rm_id
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l ON l.id = m.lead_id
     WHERE m.tenant_id = ${w.tenantId}::uuid
       AND m.status NOT IN ('cancelled', 'no_show')
       AND (m.meeting_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${w.from}::date AND ${w.to}::date
       AND ('insurance_team' = ANY(COALESCE(u.roles, ARRAY[]::text[])) OR l.pipeline = 'insurance'
            OR EXISTS (SELECT 1 FROM lead_blueprint_instances b WHERE b.lead_id = m.lead_id AND b.current_stage_key LIKE 'insurance_%'))
       AND ${scope}
       ${w.filter.ownerId ? sql`AND m.rm_id = ${w.filter.ownerId}::uuid` : sql``}
     GROUP BY 1, 2
     ORDER BY total_n DESC
  `)).rows as Row[];
  const mapped: MeetingRow[] = rows.map((r) => ({
    ownerId: str(r.owner_id), name: String(r.name), newN: num(r.new_n), review: num(r.review_n), corporate: num(r.corp_n),
    total: num(r.total_n), followUp: num(r.fu_n),
  }));
  const sum = (k: keyof Omit<MeetingRow, "ownerId" | "name">) => mapped.reduce((a, r) => a + r[k], 0);
  return { newN: sum("newN"), review: sum("review"), corporate: sum("corporate"), total: sum("total"), followUp: sum("followUp"), rows: mapped };
}

/* ───────────────────────── §28 insurers ───────────────────────── */

export type InsurerRow = { key: string; name: string; money: Money; renewalPct: number | null; claimsOpen: number };

export async function loadInsurers(tx: Tx, w: InsWindow, openClaims: Map<string, number>): Promise<InsurerRow[]> {
  const biz = await loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }], ["insurer"]);
  const ret = await loadRetention(tx, w, w.fyStart, w.to, "insurer");
  // The commonest spelling across every policy, so an insurer with only an open claim still reads as keyed.
  const names = new Map<string, string>(((await tx.execute(sql`
    SELECT lower(btrim(insurer)) AS k, mode() WITHIN GROUP (ORDER BY btrim(insurer)) AS name
      FROM insurance_policies WHERE tenant_id = ${w.tenantId}::uuid AND NULLIF(btrim(insurer), '') IS NOT NULL GROUP BY 1
  `)).rows as Row[]).map((r) => [String(r.k), String(r.name)]));
  const m = byDim(biz, "cur", "insurer");
  const keys = new Set<string>([...m.keys()].filter((k): k is string => !!k));
  for (const k of openClaims.keys()) if (k) keys.add(k);
  return [...keys].map((k) => ({
    key: k,
    name: names.get(k) ?? k.replace(/\b\w/g, (c) => c.toUpperCase()),
    money: m.get(k) ?? ZERO,
    renewalPct: retentionOf(ret, k)?.policyPct ?? null,
    claimsOpen: openClaims.get(k) ?? 0,
  })).sort((a, b) => b.money.total - a.money.total || b.claimsOpen - a.claimsOpen);
}
