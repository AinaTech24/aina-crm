/**
 * Financial Discovery — prefill from what the CRM already knows.
 *
 * A fact-find for an existing client used to start blank apart from name,
 * email and mobile, so the client (or the RM) re-typed their PAN, date of
 * birth, city, nominee, goals and insurance — all already on their record —
 * and answered a second risk questionnaire that could disagree with the one
 * in the Risk Profiles module.
 *
 * `loadDiscoveryPrefill` reads the subject's record; `mergeDiscoveryPrefill`
 * fills ONLY what is still blank (a value someone typed always wins, and a
 * list that already has rows is left alone), and always refreshes
 * `recordedRisk` — the risk profile on record is the source of truth, so the
 * discovery shows it instead of asking again. `syncDiscoveryPrefill` does both
 * and saves the result when anything changed, so the client's share link sees
 * the same prefilled form the RM does.
 */

import { eq, sql } from "drizzle-orm";
import type { withTenant } from "@/db/client";
import { financialDiscoveries } from "@/db/schema";
import { computeDiscovery, type DiscoveryData, type RecordedRisk } from "./calc";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Row = Record<string, any>;

export type DiscoveryPrefill = {
  identification: Record<string, string>;
  goals: NonNullable<DiscoveryData["goals"]>;
  lifeInsurance: NonNullable<DiscoveryData["lifeInsurance"]>;
  healthInsurance: NonNullable<DiscoveryData["healthInsurance"]>;
  assets: NonNullable<DiscoveryData["assets"]>;
  recordedRisk: RecordedRisk | null;
};

const str = (v: unknown) => (v == null ? "" : String(v).trim());
/** 'YYYY-MM-DD'. A Date from the driver is a local midnight (a `date` column)
 *  or an instant: read its LOCAL calendar day — toISOString() would move a
 *  date of birth back a day on an India-time server. */
const isoDay = (v: unknown) => {
  if (!v) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** investors.residency_status → the form's residency list. */
const RESIDENCY: Record<string, string> = {
  indian_resident: "Resident Indian",
  resident: "Resident Indian",
  nri: "NRI – Other",
  oci: "PIO / OCI",
  pio: "PIO / OCI",
  foreign_national: "Foreign National",
};

/** A free-text nominee relation → the form's relation list. */
function relation(v: unknown): string {
  const s = str(v).toLowerCase();
  if (!s) return "";
  const map: Array<[RegExp, string]> = [
    [/^self$/, "Self"], [/spouse|wife|husband/, "Spouse"], [/father/, "Father"], [/mother/, "Mother"],
    [/son/, "Son"], [/daughter/, "Daughter"],
  ];
  return map.find(([re]) => re.test(s))?.[1] ?? "Other";
}

/** goals.category → the form's goal types. */
const GOAL_TYPE: Record<string, string> = {
  retirement: "Retirement",
  child_education: "Child Education", education: "Child Education",
  child_marriage: "Child Marriage", wedding: "Child Marriage",
  house: "Home Purchase",
  vacation: "Foreign Travel",
  emergency_fund: "Emergency Fund", emergency: "Emergency Fund",
  wealth_creation: "Wealth Creation", wealth: "Wealth Creation",
};

const LIFE_TYPE: Record<string, string> = {
  term: "Term Life", ulip: "ULIP", endowment: "Endowment", money_back: "Money Back", life_other: "Whole Life",
};
const HEALTH_TYPE: Record<string, string> = {
  health: "Health – Individual", critical_illness: "Critical Illness", personal_accident: "Accidental",
};

export async function loadDiscoveryPrefill(
  tx: Tx,
  tenantId: string,
  subjectType: string,
  subjectId: string,
): Promise<DiscoveryPrefill> {
  const empty: DiscoveryPrefill = { identification: {}, goals: [], lifeInsurance: [], healthInsurance: [], assets: [], recordedRisk: null };

  if (subjectType === "lead") {
    const l = (await tx.execute(sql`
      SELECT name, email, phone, pan, city FROM leads
       WHERE id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `)).rows[0] as Row | undefined;
    if (!l) return empty;
    return {
      ...empty,
      identification: { fullName: str(l.name), email: str(l.email), mobile: str(l.phone), pan: str(l.pan).toUpperCase(), city: str(l.city) },
      // A lead's risk questionnaire is filed under the lead's id.
      recordedRisk: await latestRisk(tx, tenantId, subjectId, null),
    };
  }

  const i = (await tx.execute(sql`
    SELECT name, name_as_per_pan, dob, pan, phone, email, address, residency_status,
           occupation, nominee_name, nominee_relation, nominees,
           risk_profile, risk_profile_signed_at, COALESCE(risk_profile_provisional, false) AS provisional,
           aum::numeric AS aum
      FROM investors
     WHERE id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `)).rows[0] as Row | undefined;
  if (!i) return empty;

  const firstNominee = Array.isArray(i.nominees) && i.nominees.length ? i.nominees[0] : null;
  const identification: Record<string, string> = {
    fullName: str(i.name_as_per_pan) || str(i.name),
    dob: isoDay(i.dob),
    pan: str(i.pan).toUpperCase(),
    mobile: str(i.phone),
    email: str(i.email),
    city: str(i.address?.city),
    residency: RESIDENCY[str(i.residency_status)] ?? "",
    occupation: str(i.occupation),
    nomineeName: str(i.nominee_name) || str(firstNominee?.name),
    nomineeRelation: relation(i.nominee_relation || firstNominee?.relation),
  };

  const goalRows = (await tx.execute(sql`
    SELECT name, category, target_date, target_amount::numeric AS target, current_value::numeric AS saved
      FROM goals WHERE investor_id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid
     ORDER BY target_date ASC LIMIT 20
  `)).rows as Row[];
  const goals = goalRows.map((g) => ({
    description: str(g.name),
    type: GOAL_TYPE[str(g.category)] ?? "Other",
    targetYear: isoDay(g.target_date).slice(0, 4),
    targetCorpus: num(g.target) || "",
    alreadySaved: num(g.saved) || "",
  }));

  // Policies still protecting the client (a lapsed or matured one is no cover).
  const policies = (await tx.execute(sql`
    SELECT insurer, plan_name, policy_type, sum_assured::numeric AS sa, annual_premium::numeric AS premium
      FROM insurance_policies
     WHERE investor_id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid
       AND status IN ('active', 'claim_filed', 'claim_settled')
     ORDER BY created_at ASC LIMIT 30
  `).catch(() => ({ rows: [] as Row[] }))).rows as Row[];
  const lifeInsurance = policies
    .filter((p) => LIFE_TYPE[str(p.policy_type)])
    .map((p) => ({
      policy: [str(p.insurer), str(p.plan_name)].filter(Boolean).join(" — "),
      type: LIFE_TYPE[str(p.policy_type)],
      sumAssured: num(p.sa) || "",
      premium: num(p.premium) || "",
    }));
  const healthInsurance = policies
    .filter((p) => HEALTH_TYPE[str(p.policy_type)])
    .map((p) => ({
      insurer: [str(p.insurer), str(p.plan_name)].filter(Boolean).join(" — "),
      type: HEALTH_TYPE[str(p.policy_type)],
      sumInsured: num(p.sa) || "",
      premium: num(p.premium) || "",
    }));

  // Mutual funds already held through the firm — one row at today's AUM. The
  // type is left for the RM to pick (the book is usually a mix).
  const aum = num(i.aum);
  const assets = aum > 0
    ? [{ description: "Mutual funds held with us", category: "", currentValue: Math.round(aum), invested: "", liquid: "Yes" }]
    : [];

  return {
    identification,
    goals,
    lifeInsurance,
    healthInsurance,
    assets,
    recordedRisk: await latestRisk(tx, tenantId, subjectId, i),
  };
}

/**
 * The risk profile on record: the latest completed questionnaire, else the
 * category on the client record (bulk-suggested ones are marked provisional).
 */
async function latestRisk(tx: Tx, tenantId: string, subjectId: string, inv: Row | null): Promise<RecordedRisk | null> {
  const r = (await tx.execute(sql`
    SELECT id, final_category, total_score, COALESCE(signed_at::date, profile_date) AS on_date
      FROM risk_profile_responses
     WHERE investor_id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid
     ORDER BY COALESCE(signed_at, profile_date::timestamptz) DESC NULLS LAST, created_at DESC
     LIMIT 1
  `).catch(() => ({ rows: [] as Row[] }))).rows[0] as Row | undefined;
  if (r?.final_category) {
    return {
      category: str(r.final_category),
      score: r.total_score != null ? Number(r.total_score) : null,
      date: isoDay(r.on_date) || null,
      provisional: false,
      responseId: str(r.id),
    };
  }
  if (inv?.risk_profile) {
    return {
      category: str(inv.risk_profile),
      score: null,
      date: isoDay(inv.risk_profile_signed_at) || null,
      provisional: inv.provisional === true,
      responseId: null,
    };
  }
  return null;
}

/** Fill blanks only; refresh the recorded risk. Returns the new data and whether it changed. */
export function mergeDiscoveryPrefill(data: DiscoveryData, p: DiscoveryPrefill): { data: DiscoveryData; changed: boolean } {
  const out: DiscoveryData = { ...data };
  const filled: string[] = [];

  const ident = { ...(data.identification ?? {}) };
  for (const [k, v] of Object.entries(p.identification)) {
    if (v && !str(ident[k])) {
      ident[k] = v;
      filled.push(`identification.${k}`);
    }
  }
  out.identification = ident;

  for (const key of ["goals", "lifeInsurance", "healthInsurance", "assets"] as const) {
    const cur = (data as any)[key] as unknown[] | undefined;
    if ((!cur || cur.length === 0) && p[key].length > 0) {
      (out as any)[key] = p[key];
      filled.push(key);
    }
  }

  const before = JSON.stringify(data.recordedRisk ?? null);
  out.recordedRisk = p.recordedRisk ?? undefined;
  const riskChanged = JSON.stringify(out.recordedRisk ?? null) !== before;

  if (filled.length) {
    out.prefilledFromRecord = Array.from(new Set([...(data.prefilledFromRecord ?? []), ...filled]));
  }
  return { data: out, changed: filled.length > 0 || riskChanged };
}

/** Load, merge and — when something changed — save the discovery. */
export async function syncDiscoveryPrefill(tx: Tx, disc: { id: string; tenantId: string; subjectType: string; subjectId: string; data: unknown; status: string }) {
  // A submitted or reviewed fact-find is a record of what was said then.
  if (disc.status === "submitted" || disc.status === "reviewed") return (disc.data ?? {}) as DiscoveryData;
  const prefill = await loadDiscoveryPrefill(tx, disc.tenantId, disc.subjectType, disc.subjectId);
  const { data, changed } = mergeDiscoveryPrefill((disc.data ?? {}) as DiscoveryData, prefill);
  if (changed) {
    const computed = computeDiscovery(data);
    await tx
      .update(financialDiscoveries)
      .set({ data: data as any, computed: computed as any, healthScore: computed.healthScore, updatedAt: new Date() } as any)
      .where(eq(financialDiscoveries.id, disc.id));
  }
  return data;
}
