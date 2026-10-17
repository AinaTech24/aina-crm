/**
 * Is a minor's guardian a verified CRM client? (G-1, 2026-10-15)
 *
 * A typed guardian PAN that links nobody still saves the minor — refusing
 * would tell the user why (shared PAN, another RM's client). What it must not
 * do is leave the account looking complete. The status is DERIVED from the
 * record and its audit trail, so no table or migration is needed:
 *
 *  - linked       the minor points at a guardian client (`guardian_investor_id`)
 *                 that is STILL a live, non-merged adult individual, the only live
 *                 holder of its PAN, and not the minor — re-checked on every read,
 *                 so a link made before these rules that fails them is pending.
 *  - pending      the latest guardian event is a refused typed PAN or no PAN at
 *                 all on create (`investor.guardian_not_linked`), a removed link
 *                 (`investor.guardian_unlinked`), or a link the row no longer
 *                 carries (a purged or merged guardian).
 *  - not_recorded no guardian event at all — a minor saved before this rule.
 *                 Blocked for MF like pending (owner's interim policy,
 *                 2026-10-15: `guardianVerifiedForMf`).
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
 * Anything but `linked` blocks an MF proposal for a minor (journey gates, the
 * proposal send route and the proposal status change). Nothing here reads or copies a guardian's risk.
 */
import { sql } from "drizzle-orm";
import { isEligibleGuardian, type GuardianCandidateRow } from "@/lib/investors/guardian-link";

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
  const status = guardianVerificationFrom({ isMinor: !!r.is_minor, guardianInvestorId: r.guardian_investor_id }, r.latest);
  if (status !== "linked") return status;
  // A link counts only while the guardian it points at is STILL a valid
  // guardian: a live, non-merged adult individual, the only live holder of its
  // PAN, and not the minor itself — the rules a link made today must pass. A
  // link made before those rules existed (the Client Master of 2026-10-13, the
  // registrar import) that fails them is not verified (pending).
  return (await linkIsValid(tx, tenantId, investorId, r.guardian_investor_id!)) ? "linked" : "pending";
}

async function linkIsValid(tx: any, tenantId: string, minorId: string, guardianId: string): Promise<boolean> {
  if (guardianId === minorId) return false;
  const g = (await tx.execute(sql`
    SELECT g.investor_category, g.is_minor, g.dob, g.pan, g.status, g.deleted_at, g.merged_into_id,
           (SELECT count(*) FROM investors o
             WHERE o.tenant_id = g.tenant_id AND g.pan IS NOT NULL AND upper(btrim(o.pan)) = upper(btrim(g.pan))
               AND o.deleted_at IS NULL AND o.merged_into_id IS NULL) AS holders
      FROM investors g WHERE g.tenant_id = ${tenantId}::uuid AND g.id = ${guardianId}::uuid
  `)).rows[0] as (GuardianCandidateRow & { holders: number | string }) | undefined;
  if (!g || !isEligibleGuardian(g)) return false;
  return !g.pan || Number(g.holders) === 1;
}

/**
 * The MF rule (owner's interim policy, 2026-10-15): a minor may be covered by a
 * mutual fund proposal only with a uniquely identified, eligible, linked
 * guardian. `not_recorded` (a minor saved before the rule) does NOT pass.
 */
export async function guardianVerifiedForMf(tx: any, tenantId: string, investorId: string): Promise<boolean> {
  const s = await guardianVerification(tx, tenantId, investorId);
  return s === "linked" || s === "not_applicable";
}

/** Human label, shared by the client page and the API. */
export function guardianVerificationLabel(v: GuardianVerification): string | null {
  switch (v) {
    case "linked": return "Guardian linked";
    case "pending": return "Guardian not verified";
    case "not_recorded": return "Guardian not verified (none on record)";
    default: return null;
  }
}
