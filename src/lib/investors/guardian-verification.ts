/**
 * Has a minor's guardian been verified? (G-1, incomplete onboarding, 2026-10-15)
 *
 * A typed guardian PAN that links nobody still saves the minor — the guardian
 * may simply not be a client, and refusing the save would tell the user why
 * (shared PAN, another RM's client). What it must not do is leave the account
 * looking complete. The status is DERIVED from what the record and its history
 * already say, so no table or migration is needed:
 *
 *  - linked       the minor points at a guardian client (`guardian_investor_id`),
 *                 which `resolveGuardian` vetted when the link was made.
 *  - confirmed    an authorised person verified the guardian outside the CRM
 *                 (`investor.guardian_verified`, with a note) after the last
 *                 refusal or removal.
 *  - pending      the latest guardian event is a refused typed PAN
 *                 (`investor.guardian_not_linked`), a removed link
 *                 (`investor.guardian_unlinked`), or a link the record no
 *                 longer carries (a purged guardian).
 *  - not_recorded no guardian event at all — a minor saved before this rule.
 *                 Reported, not blocked: blocking every older minor is a policy
 *                 decision for the firm (docs/security/G1_GUARDIAN_HOTFIX.md §10).
 *  - not_applicable not a minor.
 *
 * `pending` blocks an MF proposal (journey gate + the send route). Nothing here
 * ever reads or copies a guardian's risk profile.
 */
import { sql } from "drizzle-orm";

export type GuardianVerification = "linked" | "confirmed" | "pending" | "not_recorded" | "not_applicable";

export const GUARDIAN_EVENTS = [
  "investor.guardian_linked",
  "investor.guardian_unlinked",
  "investor.guardian_not_linked",
  "investor.guardian_verified",
] as const;

/** One fixed sentence for every place that refuses on a pending guardian. */
export const GUARDIAN_PENDING_MESSAGE =
  "This minor's guardian has not been verified. Link the guardian's client record in the Guardian section, or ask the owner or compliance to confirm the guardian, before a mutual fund proposal.";

/** Pure: the status from the record and its latest guardian event. */
export function guardianVerificationFrom(
  row: { isMinor: boolean; guardianInvestorId: string | null },
  latestEvent: string | null,
): GuardianVerification {
  if (!row.isMinor) return "not_applicable";
  if (row.guardianInvestorId) return "linked";
  switch (latestEvent) {
    case "investor.guardian_verified": return "confirmed";
    case "investor.guardian_not_linked":
    case "investor.guardian_unlinked":
    case "investor.guardian_linked": // the link it recorded is gone
      return "pending";
    default:
      return "not_recorded";
  }
}

export async function guardianVerification(tx: any, tenantId: string, investorId: string): Promise<GuardianVerification> {
  const r = (await tx.execute(sql`
    SELECT (i.investor_category = 'minor' OR COALESCE(i.is_minor, false)) AS is_minor,
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
    case "confirmed": return "Guardian verified";
    case "pending": return "Guardian not verified";
    case "not_recorded": return "Guardian verification not recorded";
    default: return null;
  }
}
