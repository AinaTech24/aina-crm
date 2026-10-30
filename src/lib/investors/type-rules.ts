/**
 * What a client of each TYPE can be "missing" — one rule for every count,
 * score, list filter and report (lib/investors/client-types.ts decides the
 * type; this file turns it into SQL).
 *
 * The firm's rule of 14 Oct 2026: every client sees only their own type's
 * fields. Until then the gap counts treated every client as an adult
 * individual, so an HUF, a minor or a company was always "missing" things it
 * can never have:
 *   - a NOMINEE — only an individual nominates (SEBI), and an individual who
 *     chose not to has a recorded opt-out (`type_details.nominationOptOut`);
 *   - a DATE OF BIRTH — an HUF or an entity has a formation date instead
 *     (`type_details.entity.formedOn`);
 *   - a PAN–AADHAAR LINK, an OCCUPATION, an EMPLOYER — an adult person's.
 * They showed on the client's health score, the Owner Dashboard's compliance
 * gaps, the RM / Branch / Ops data-quality cards, the client KPI strip and
 * quick filters, family filters, the data-hygiene report and the assistant.
 *
 * Every function takes the investors table alias ("i"), or "" for an
 * unaliased query.
 */

import { sql, type SQL } from "drizzle-orm";
import { CLIENT_TYPE_KEYS, canNominate, clientTypeDef, hasAdultDetails, type ClientTypeDetails } from "@/lib/investors/client-types";

/** Individual-holder types: individual, NRI, sole proprietor, other. */
export const PERSON_TYPES: readonly string[] = CLIENT_TYPE_KEYS.filter((k) => clientTypeDef(k).kind === "person");
/** The types that can nominate (the same list, by canNominate). */
export const NOMINATING_TYPES: readonly string[] = CLIENT_TYPE_KEYS.filter((k) => canNominate(k));
/** The types with a date of birth: a person or a minor. */
export const DOB_TYPES: readonly string[] = CLIENT_TYPE_KEYS.filter((k) => ["person", "minor"].includes(clientTypeDef(k).kind));

const colOf = (alias: string) => (col: string) => sql.raw(alias ? `${alias}.${col}` : col);
const inTypes = (alias: string, types: readonly string[]) =>
  sql`COALESCE(${colOf(alias)("investor_category")}, 'individual') IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})`;

/** An adult individual holder. */
export function adultPersonSql(alias = "i"): SQL {
  return sql`(${inTypes(alias, PERSON_TYPES)})`;
}

/** Needs a nominee and has none on file (nominee_name or the nominees list). */
export function needsNomineeSql(alias = "i"): SQL {
  const c = colOf(alias);
  return sql`(${inTypes(alias, NOMINATING_TYPES)}
    AND COALESCE(btrim(${c("nominee_name")}), '') = ''
    AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(${c("nominees")}) = 'array' THEN ${c("nominees")} END), 0) = 0
    AND COALESCE(${c("type_details")}->>'nominationOptOut', 'false') <> 'true')`;
}

/** Has a date of birth to record (a person or a minor) and none is recorded. */
export function missingDobSql(alias = "i"): SQL {
  return sql`(${inTypes(alias, DOB_TYPES)} AND ${colOf(alias)("dob")} IS NULL)`;
}

/** An adult individual whose PAN is not (known to be) linked to Aadhaar. */
export function panAadhaarGapSql(alias = "i"): SQL {
  const c = colOf(alias)("pan_aadhaar_link_status");
  return sql`(${inTypes(alias, PERSON_TYPES)} AND (${c} = 'not_linked' OR ${c} IS NULL))`;
}

/** An adult individual with this text column blank (occupation, employer_name). */
export function missingAdultTextSql(alias: string, column: "occupation" | "employer_name"): SQL {
  return sql`(${inTypes(alias, PERSON_TYPES)} AND COALESCE(btrim(${colOf(alias)(column)}), '') = '')`;
}

/** needsNomineeSql for a loaded record. */
export function needsNominee(inv: {
  investorCategory?: string | null;
  nomineeName?: string | null;
  nominees?: unknown;
  typeDetails?: ClientTypeDetails | null;
}): boolean {
  if (!canNominate(inv.investorCategory)) return false;
  if (inv.typeDetails?.nominationOptOut) return false;
  if ((inv.nomineeName ?? "").trim()) return false;
  return !(Array.isArray(inv.nominees) && inv.nominees.length > 0);
}

/**
 * A minor needs no risk profile of their own (the firm's rule of 2026-10-30):
 * a mutual fund proposal and an MF opportunity go ahead without one. Only a
 * minor — every other client type still needs a confirmed profile. The client
 * type is the source of truth; `is_minor` is set with it, so either says so.
 */
export function isMinorClient(inv: { investorCategory?: string | null; isMinor?: boolean | null }): boolean {
  return inv.investorCategory === "minor" || inv.isMinor === true;
}

/** Whether a loaded record of this type has a date of birth / PAN–Aadhaar link / occupation at all. */
export const typeHas = {
  dob: (type: string | null | undefined) => DOB_TYPES.includes(clientTypeDef(type).key),
  adultFields: (type: string | null | undefined) => hasAdultDetails(type),
};
