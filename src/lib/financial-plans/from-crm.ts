/**
 * What the CRM already knows about a client → the Financial Health Check's
 * fields (the firm's request, 2026-10-17). SERVER-ONLY.
 *
 * Picking an existing client on a new health check fills, from records the
 * firm already keeps — never from guesses:
 *
 *   Profiling   age (date of birth); spouse's age and children (the family,
 *               when the client is its head or the head's spouse); the
 *               client's risk profile.
 *   Assets      mutual funds summed by asset class — the AMFI category
 *               (withSchemeCategories) read with the same rule as the
 *               suitability check (lib/reports/risk-drift classifyScheme);
 *               gold by name; hybrid funds as "other" — and live fixed
 *               deposits as debt.
 *   Protection  in-force life policies (term, endowment, money-back, ULIP,
 *               other life) and health policies (health, critical illness,
 *               group health): sum assured and annual premium, summed.
 *   Goals       the client's live goals, with their current value and
 *               existing SIP as the Goals module keeps them (refreshed
 *               nightly from linked folios and SIPs). A goal set in future
 *               rupees comes in at 0% inflation so it is not inflated twice
 *               (the same reading lib/financial-plans/from-fact-find uses).
 *
 * Absent data stays absent (undefined), never 0. Income, expenses and loans
 * are not in the CRM's records — they come from a fact-find or the RM.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withSchemeCategories } from "@/lib/investors/scheme-categories";
import { classifyScheme } from "@/lib/reports/risk-drift";

type AssetCategory = "equity" | "debt" | "gold" | "cash" | "real_estate" | "other";
export type CrmAsset = { category: AssetCategory; subCategory?: string; name: string; value: number };
export type CrmGoal = {
  category: string;
  name: string;
  targetAmount: number;
  targetYears: number;
  inflationRate: number;
  expectedReturn: number;
  currentValue?: number;
  existingMonthlySip?: number;
};

export type PlanFromCrm = {
  clientAge?: number;
  spouseAge?: number;
  children: Array<{ name: string; age: number }>;
  riskProfile?: string;
  assets: CrmAsset[];
  lifeInsuranceSumAssured?: number;
  lifeInsuranceAnnualPremium?: number;
  healthInsuranceSumAssured?: number;
  healthInsuranceAnnualPremium?: number;
  goals: CrmGoal[];
  /** What was found, for the "Filled from the CRM" note. */
  found: { mfValue: number; mfSchemes: number; fds: number; fdValue: number; lifePolicies: number; healthPolicies: number; goals: number; family: boolean };
};

const LIFE_TYPES = ["term", "endowment", "money_back", "ulip", "life_other"];
const HEALTH_TYPES = ["health", "critical_illness", "group_health"];
const IN_FORCE = ["active", "claim_filed", "claim_settled"];
const GOAL_ALIAS: Record<string, string> = { education: "child_education", vehicle: "car", emergency: "emergency_fund", wedding: "child_marriage", wealth: "wealth_creation" };
const DEFAULT_RETURN = 12;
const DEFAULT_INFLATION = 6;

const num = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
const ageOn = (dob: string | null | undefined, today = new Date()) => {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return undefined;
  let a = today.getFullYear() - d.getFullYear();
  if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : undefined;
};
/** Whole years until a date, at least 1 (a goal due this year still needs a horizon). */
const yearsUntil = (date: string, today = new Date()) => Math.max(1, Math.ceil((new Date(date).getTime() - today.getTime()) / (365.25 * 864e5)));

export async function planFromCrm(tx: Tx, tenantId: string, investorId: string): Promise<PlanFromCrm> {
  const T = sql`${tenantId}::uuid`;
  const inv = (await tx.execute(sql`
    SELECT id, dob::text AS dob, risk_profile, family_id, family_role
      FROM investors WHERE tenant_id = ${T} AND id = ${investorId}::uuid LIMIT 1
  `)).rows[0] as { id: string; dob: string | null; risk_profile: string | null; family_id: string | null; family_role: string | null } | undefined;
  const out: PlanFromCrm = {
    children: [],
    assets: [],
    goals: [],
    found: { mfValue: 0, mfSchemes: 0, fds: 0, fdValue: 0, lifePolicies: 0, healthPolicies: 0, goals: 0, family: false },
  };
  if (!inv) return out;

  out.clientAge = ageOn(inv.dob);
  if (inv.risk_profile) out.riskProfile = inv.risk_profile;

  // ── Family: spouse and children, read from the head's side.
  if (inv.family_id) {
    const fam = (await tx.execute(sql`
      SELECT i.id, i.name, i.dob::text AS dob, COALESCE(i.family_role, '') AS role, (f.primary_investor_id = i.id) AS head
        FROM investors i JOIN families f ON f.id = i.family_id AND f.tenant_id = i.tenant_id
       WHERE i.tenant_id = ${T} AND i.family_id = ${inv.family_id}::uuid
         AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.id <> ${investorId}::uuid
    `)).rows as Array<{ id: string; name: string; dob: string | null; role: string; head: boolean }>;
    const me = (await tx.execute(sql`SELECT (primary_investor_id = ${investorId}::uuid) AS head FROM families WHERE id = ${inv.family_id}::uuid AND tenant_id = ${T}`)).rows[0] as { head: boolean } | undefined;
    const iAmHead = !!me?.head;
    const iAmSpouse = inv.family_role === "spouse";
    if (iAmHead || iAmSpouse) {
      const spouse = fam.find((m) => (iAmHead ? m.role === "spouse" : m.head));
      if (spouse) out.spouseAge = ageOn(spouse.dob);
      out.children = fam
        .filter((m) => m.role === "son" || m.role === "daughter")
        .map((m) => ({ name: m.name, age: ageOn(m.dob) }))
        .filter((c): c is { name: string; age: number } => c.age !== undefined);
      out.found.family = !!spouse || out.children.length > 0;
    }
  }

  // ── Mutual funds, by asset class.
  const folios = (await tx.execute(sql`
    SELECT aum, schemes FROM folios WHERE tenant_id = ${T} AND investor_id = ${investorId}::uuid
  `)).rows as Array<{ aum: string | null; schemes: Array<{ schemeName?: string; schemeCode?: string; isin?: string; category?: string; value?: number }> | null }>;
  const classified = await withSchemeCategories(tx, folios.map((f) => ({ ...f, schemes: f.schemes ?? [] })));
  const byClass = new Map<string, { value: number; schemes: number }>();
  const add = (k: string, v: number) => {
    const cur = byClass.get(k) ?? { value: 0, schemes: 0 };
    byClass.set(k, { value: cur.value + v, schemes: cur.schemes + 1 });
  };
  for (const f of classified) {
    const legs = (f.schemes ?? []).filter((l) => Number(l.value ?? 0) > 0);
    if (!legs.length) {
      if (Number(f.aum ?? 0) > 0) add("other", Number(f.aum));
      continue;
    }
    for (const l of legs) {
      const name = String(l.schemeName ?? "");
      const cls = /\bgold\b/i.test(name) || /\bgold\b/i.test(String(l.category ?? "")) ? "gold" : classifyScheme(name, l.category);
      add(cls, Number(l.value));
    }
  }
  const MF_ROWS: Array<[string, AssetCategory, string]> = [
    ["equity", "equity", "Mutual funds — equity"],
    ["debt", "debt", "Mutual funds — debt"],
    ["gold", "gold", "Mutual funds — gold"],
    ["hybrid", "other", "Mutual funds — hybrid"],
    ["other", "other", "Mutual funds — other"],
  ];
  for (const [k, category, name] of MF_ROWS) {
    const b = byClass.get(k);
    if (!b || b.value <= 0) continue;
    out.assets.push({ category, subCategory: k === "hybrid" ? "Hybrid funds" : undefined, name: `${name} (${b.schemes} scheme${b.schemes === 1 ? "" : "s"})`, value: Math.round(b.value) });
    out.found.mfValue += b.value;
    out.found.mfSchemes += b.schemes;
  }

  // ── Fixed deposits still running.
  const fd = (await tx.execute(sql`
    SELECT count(*)::int AS n, COALESCE(sum(principal), 0)::numeric AS v FROM fixed_deposits
     WHERE tenant_id = ${T} AND investor_id = ${investorId}::uuid AND deleted_at IS NULL AND status = 'active'
  `)).rows[0] as { n: number; v: string };
  if (fd?.n) {
    out.assets.push({ category: "debt", subCategory: "Fixed deposits", name: `Fixed deposits (${fd.n})`, value: Math.round(Number(fd.v)) });
    out.found.fds = fd.n;
    out.found.fdValue = Number(fd.v);
  }

  // ── Insurance in force.
  const pols = (await tx.execute(sql`
    SELECT policy_type, sum_assured, annual_premium, premium_frequency FROM insurance_policies
     WHERE tenant_id = ${T} AND investor_id = ${investorId}::uuid
       AND policy_type IN (${sql.join([...LIFE_TYPES, ...HEALTH_TYPES].map((t) => sql`${t}`), sql`, `)})
       AND status IN (${sql.join(IN_FORCE.map((s) => sql`${s}`), sql`, `)})
  `)).rows as Array<{ policy_type: string; sum_assured: string | null; annual_premium: string | null; premium_frequency: string | null }>;
  const sumOf = (types: string[], pick: (p: (typeof pols)[number]) => number | undefined) => {
    const vals = pols.filter((p) => types.includes(p.policy_type)).map(pick).filter((v): v is number => v !== undefined && !isNaN(v));
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0)) : undefined;
  };
  // A single-premium policy has no yearly premium to carry.
  const yearly = (p: (typeof pols)[number]) => (p.premium_frequency === "single" ? undefined : num(p.annual_premium));
  out.lifeInsuranceSumAssured = sumOf(LIFE_TYPES, (p) => num(p.sum_assured));
  out.lifeInsuranceAnnualPremium = sumOf(LIFE_TYPES, yearly);
  out.healthInsuranceSumAssured = sumOf(HEALTH_TYPES, (p) => num(p.sum_assured));
  out.healthInsuranceAnnualPremium = sumOf(HEALTH_TYPES, yearly);
  out.found.lifePolicies = pols.filter((p) => LIFE_TYPES.includes(p.policy_type)).length;
  out.found.healthPolicies = pols.filter((p) => HEALTH_TYPES.includes(p.policy_type)).length;

  // ── Goals the client already has.
  const goals = (await tx.execute(sql`
    SELECT name, category, target_amount, target_date::text AS target_date, target_mode, present_target_amount,
           inflation_pct, expected_return, current_value, existing_monthly_sip, monthly_contribution
      FROM goals
     WHERE tenant_id = ${T} AND investor_id = ${investorId}::uuid
       AND status NOT IN ('achieved', 'abandoned') AND target_date >= current_date
     ORDER BY target_date
  `)).rows as Array<{
    name: string; category: string; target_amount: string; target_date: string; target_mode: string | null;
    present_target_amount: string | null; inflation_pct: string | null; expected_return: string | null;
    current_value: string | null; existing_monthly_sip: string | null; monthly_contribution: string | null;
  }>;
  for (const g of goals) {
    const today = g.target_mode === "today" && num(g.present_target_amount) !== undefined;
    out.goals.push({
      category: GOAL_ALIAS[g.category] ?? g.category,
      name: g.name,
      // The plan inflates a PRESENT cost: a goal kept in today's rupees comes
      // with its inflation; one already in future rupees comes at 0%.
      targetAmount: Math.round(today ? Number(g.present_target_amount) : Number(g.target_amount)),
      targetYears: yearsUntil(g.target_date),
      inflationRate: today ? num(g.inflation_pct) ?? DEFAULT_INFLATION : 0,
      expectedReturn: num(g.expected_return) ?? DEFAULT_RETURN,
      currentValue: num(g.current_value) || undefined,
      existingMonthlySip: num(g.existing_monthly_sip) ?? (num(g.monthly_contribution) || undefined),
    });
  }
  out.found.goals = out.goals.length;
  return out;
}
