/**
 * The insurance book's vocabulary — what a line, a product group, new vs
 * renewal, "issued", "in force", "lost" and a business owner ARE. Defined once
 * here so the Insurance Business Command Centre and the policy register it
 * drills into (/dashboard/insurance) can never disagree about what they count.
 *
 * The CRM stores none of these as a column, so each is a decision:
 *
 *  · LINE — from policy_type, on the firm's MIS taxonomy: the same split the
 *    Insurance Production report uses (lib/insurance/advisor-production.ts).
 *    Motor, home and "other general" are Commercial Lines. The picklist cannot
 *    tell a private car from a commercial vehicle, so motor sits on one side.
 *  · NATURE — details.businessType: renewal / portability is Renewal; anything
 *    else, blank included, is New. The form stores it as free text.
 *  · BOOKED ON — COALESCE(risk_cover_start_date, policy_start_date), the
 *    production report's date.
 *  · ISSUED — not proposed / in underwriting / cancelled (the team scorecard's
 *    and the targets' rule). IN FORCE — active, claim filed, claim settled: a
 *    claim moves an in-force policy OFF 'active'. LOST — lapsed, surrendered,
 *    cancelled.
 *  · BUSINESS OWNER — the seller when the seller holds a sales role, else the
 *    client's RM. sold_by_user_id defaults to whoever keyed the policy, often
 *    operations, and operations is not credited with sales.
 *  · BRANCH — the client's branch. A policy's own branch_id is the branch of
 *    whoever keyed it, which is usually head office.
 */

import { sql, type SQL } from "drizzle-orm";

export type Line = "personal" | "commercial";

export const LINE_LABEL: Record<string, string> = {
  personal: "Personal Lines",
  commercial: "Commercial Lines",
  unclassified: "Type not recognised",
};

export const PRODUCT_GROUPS = [
  { key: "health", label: "Health", line: "personal", types: ["health", "critical_illness"] },
  { key: "life", label: "Life", line: "personal", types: ["term", "endowment", "money_back", "life_other"] },
  { key: "ulip", label: "ULIP", line: "personal", types: ["ulip"] },
  { key: "pa", label: "Personal Accident", line: "personal", types: ["personal_accident"] },
  { key: "travel", label: "Travel", line: "personal", types: ["travel"] },
  { key: "marine", label: "Marine", line: "commercial", types: ["marine"] },
  { key: "fire", label: "Fire / Home / Burglary", line: "commercial", types: ["fire", "home", "burglary"] },
  { key: "wc", label: "Workmen Compensation", line: "commercial", types: ["workmen_comp"] },
  { key: "motor", label: "Motor / Vehicle", line: "commercial", types: ["motor"] },
  { key: "gpa", label: "Group Personal Accident", line: "commercial", types: ["group_personal_accident"] },
  { key: "ghi", label: "Group Health", line: "commercial", types: ["group_health"] },
  { key: "general", label: "Other General", line: "commercial", types: ["general_other"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; line: Line; types: readonly string[] }>;

export type ProductGroupKey = (typeof PRODUCT_GROUPS)[number]["key"];
export const GROUP_LABEL: Record<string, string> = Object.fromEntries(PRODUCT_GROUPS.map((g) => [g.key, g.label]));
GROUP_LABEL.unclassified = "Type not recognised";

export const typesOfLine = (line: Line): string[] => PRODUCT_GROUPS.filter((g) => g.line === line).flatMap((g) => [...g.types]);
export const typesOfGroups = (keys: readonly string[]): string[] =>
  PRODUCT_GROUPS.filter((g) => keys.includes(g.key)).flatMap((g) => [...g.types]);

/** The policy form's own labels (dashboard/insurance/new). */
export const POLICY_TYPE_LABEL: Record<string, string> = {
  term: "Term Life", ulip: "ULIP", endowment: "Endowment", money_back: "Money-back", health: "Health",
  critical_illness: "Critical Illness", personal_accident: "Personal Accident", motor: "Motor", travel: "Travel", home: "Home",
  life_other: "Life — Other", fire: "Fire / Property", marine: "Marine", burglary: "Burglary", workmen_comp: "Workmen Comp (WC)",
  group_personal_accident: "Group Personal Accident (GPA)", group_health: "Group Health (GHI)", general_other: "General — Other",
};
export const policyTypeLabel = (t: string | null | undefined) =>
  (t ? POLICY_TYPE_LABEL[t] ?? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Type not recorded");

export const STATUS_ISSUED_EXCLUDED = ["proposed", "in_underwriting", "cancelled"] as const;
export const STATUS_IN_FORCE = ["active", "claim_filed", "claim_settled"] as const;
export const STATUS_LOST = ["lapsed", "surrendered", "cancelled"] as const;
export const STATUS_PENDING = ["proposed", "in_underwriting"] as const;

export const POLICY_STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed", in_underwriting: "In underwriting", active: "Active", lapsed: "Lapsed", matured: "Matured",
  surrendered: "Surrendered", cancelled: "Cancelled", claim_filed: "Claim filed", claim_settled: "Claim settled",
};

/** Roles whose sale is a sale. Operations keying a policy is not selling it. */
export const SALES_ROLES = ["owner", "rm", "branch_head", "insurance_team"] as const;

const col = (alias: string, column: string) => sql.raw(`${alias}.${column}`);
export const inList = (xs: readonly string[]): SQL => sql.join(xs.map((x) => sql`${x}`), sql`, `);
export const textArray = (xs: readonly string[]): SQL => sql`ARRAY[${inList(xs)}]::text[]`;

/** 'personal' | 'commercial' | 'unclassified' for a policy row alias. */
export function lineSql(p = "p"): SQL {
  return sql`CASE WHEN ${col(p, "policy_type")} IN (${inList(typesOfLine("personal"))}) THEN 'personal'
                  WHEN ${col(p, "policy_type")} IN (${inList(typesOfLine("commercial"))}) THEN 'commercial'
                  ELSE 'unclassified' END`;
}

/** The product group key (PRODUCT_GROUPS), else 'unclassified'. */
export function groupSql(p = "p"): SQL {
  return sql`CASE ${sql.join(PRODUCT_GROUPS.map((g) => sql`WHEN ${col(p, "policy_type")} IN (${inList(g.types)}) THEN ${g.key}`), sql` `)}
                  ELSE 'unclassified' END`;
}

export function natureSql(p = "p"): SQL {
  return sql`CASE WHEN lower(btrim(COALESCE(${col(p, "details")}->>'businessType', ''))) IN ('renewal', 'portability')
                  THEN 'renewal' ELSE 'new' END`;
}

export function bookedOnSql(p = "p"): SQL {
  return sql`COALESCE(${col(p, "risk_cover_start_date")}, ${col(p, "policy_start_date")})`;
}

/**
 * One installment of the premium. `annual_premium` is annualised; a monthly
 * policy's "Mark renewed" collects a twelfth of it, not the whole year.
 */
export function installmentSql(p = "p"): SQL {
  return sql`(COALESCE(${col(p, "annual_premium")}, 0)::numeric / CASE ${col(p, "premium_frequency")}
                  WHEN 'semi_annual' THEN 2 WHEN 'quarterly' THEN 4 WHEN 'monthly' THEN 12 ELSE 1 END)`;
}

/** Sales credit: the seller if they sell, else the client's RM. `u` is the seller's users row. */
export function ownerSql(p = "p", i = "i", u = "su"): SQL {
  return sql`CASE WHEN ${col(u, "roles")} && ${textArray(SALES_ROLES)} THEN ${col(p, "sold_by_user_id")} ELSE ${col(i, "rm_id")} END`;
}

/** The client's branch, else the branch the policy was keyed in. */
export function branchSql(p = "p", i = "i"): SQL {
  return sql`COALESCE(${col(i, "branch_id")}, ${col(p, "branch_id")})`;
}

/* ───────────────────────────── claims ───────────────────────────── */

/** Still with the insurer or the firm. `empty` is a claim record with no status yet. */
export const CLAIM_OPEN = ["empty", "claim_intimated", "file_awaited", "file_received", "add_info_awaited", "query", "query_replied", "under_process"] as const;
/** File not received (the monthly claims summary's FNR). */
export const CLAIM_FNR = ["file_awaited", "empty"] as const;
/** The insurer has asked for something. */
export const CLAIM_QUERY = ["add_info_awaited", "query", "query_replied"] as const;
export const CLAIM_SETTLED = ["settled_fully", "settled_partially"] as const;

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  empty: "Status not set", claim_intimated: "Intimated", file_awaited: "File awaited", file_received: "File received",
  add_info_awaited: "Info awaited", query: "Insurer query", query_replied: "Query replied", under_process: "Under process",
  settled_fully: "Settled", settled_partially: "Part settled", rejected: "Rejected", withdrawn: "Withdrawn",
};
export const CLAIM_TYPE_LABEL: Record<string, string> = {
  main_claim: "Main claim", supplementary: "Supplementary", pre_authorization: "Pre-authorisation", rider: "Rider", other: "Other",
};
