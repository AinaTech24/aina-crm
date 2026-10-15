/**
 * Is a minor's guardian a verified CRM client? (G-1, 2026-10-15)
 *
 * A typed guardian PAN that links nobody still saves the minor — refusing
 * would tell the user why (shared PAN, another RM's client). What it must not
 * do is leave the account looking complete. The status is DERIVED from the
 * record and its audit trail, so no table or migration is needed:
 *
 *  - linked       the minor points at a guardian client (`guardian_investor_id`),
 *                 which `resolveGuardian` vetted when the link was made: a live,
 *                 non-merged adult individual, the only holder of its PAN, in the
 *                 user's book.
 *  - pending      the latest guardian event is a refused typed PAN or no PAN at
 *                 all on create (`investor.guardian_not_linked`), a removed link
 *                 (`investor.guardian_unlinked`), or a link the row no longer
 *                 carries (a purged or merged guardian).
 *  - not_recorded no guardian event at all — a minor saved before this rule.
 *                 Reported, not blocked: blocking every older minor is a policy
 *                 decision for the firm (docs/security/G1_GUARDIAN_HOTFIX.md §12).
 *  - not_applicable not a minor.
 *
 * There is deliberately NO way to mark a guardian "verified" without linking a
 * CRM client: a note typed by one person is not identity evidence (owner
 * decision, 2026-10-15). A guardian who is not a CRM client stays pending until
 * a verified-identity-evidence workflow exists. Resolution is the normal link:
 * Edit client → Guardian's client record (or a typed PAN that resolves to
 * exactly one eligible client the user can open). Duplicate-PAN clients are
 * never merged automatically; Merge Clients is a person's decision.
 *
 * `pending` blocks an MF proposal (journey gates, the proposal send route and
 * the proposal status change). Nothing here reads or copies a guardian's risk.
 */
import { sql } from "drizzle-orm";

export type GuardianVerification = "linked" | "pending" | "not_recorded" | "not_applicable";

export const GUARDIAN_EVENTS = [
  "investor.guardian_linked",
  "investor.guardian_unlinked",
  "investor.guardian_not_linked",
] as const;

/** One fixed sentence for every place that refuses on a pending guardian. */
export const GUARDIAN_PENDING_MESSAGE =
  "This minor's guardian has not been verified. Link the guardian's client record (Edit client → Guardian's client record) before a mutual fund proposal.";

/** Pure: the status from the record and its latest guardian event. */
export function guardianVerificationFrom(
  row: { isMinor: boolean; guardianInvestorId: string | null },
  latestEvent: string | null,
): GuardianVerification {
  if (!row.isMinor) return "not_applicable";
  if (row.guardianInvestorId) return "linked";
  switch (latestEvent) {
    case "investor.guardian_not_linked":
    case "investor.guardian_unlinked":
    case "investor.guardian_linked": // the link it recorded is gone
      return "pending";
    default:
      return "not_recorded";
  }
}

/** SQL: the row under `alias` is a minor for this rule — by type, flag or date of birth. */
export function guardianMinorSql(alias: string) {
  const a = (c: string) => sql.raw(`${alias}.${c}`);
  return sql`(${a("investor_category")} = 'minor' OR COALESCE(${a("is_minor")}, false)
              OR (${a("dob")} IS NOT NULL AND ${a("dob")} > (current_date - interval '18 years')))`;
}

export async function guardianVerification(tx: any, tenantId: string, investorId: string): Promise<GuardianVerification> {
  const r = (await tx.execute(sql`
    SELECT ${guardianMinorSql("i")} AS is_minor,
           i.guardian_investor_id,
           (SELECT a.action FROM audit_log a
             WHERE a.tenant_id = i.tenant_id AND a.entity_type = 'investor' AND a.entity_id = i.id
               AND a.action IN (${sql.join(GUARDIAN_EVENTS.map((e) => sql`${e}`), sql`, `)})
             ORDER BY a.at DESC, a.id DESC LIMIT 1) AS latest
      FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid AND i.id = ${investorId}::uuid
  `)).rows[0] as { is_minor: boolean; guardian_investor_id: string | null; latest: string | null } | undefined;
  if (!r) return "not_applicable";
  return guardianVerificationFrom({ isMinor: !!r.is_minor, guardianInvestorId: r.guardian_investor_id }, r.latest);
}

/** Human label, shared by the client page and the API. */
export function guardianVerificationLabel(v: GuardianVerification): string | null {
  switch (v) {
    case "linked": return "Guardian linked";
    case "pending": return "Guardian not verified";
    case "not_recorded": return "Guardian verification not recorded";
    default: return null;
  }
}
