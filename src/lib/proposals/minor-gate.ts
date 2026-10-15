/**
 * Mutual fund proposals and minors (G-1, 2026-10-15): every minor a proposal
 * covers needs (1) a verified guardian — a linked CRM client, never a typed
 * PAN that linked nobody — and (2) a confirmed assessment of the MINOR'S OWN
 * account (signed, not provisional, under 12 months), never the guardian's
 * profile or the 0234 copy.
 *
 * Who a proposal covers: an individual proposal, that client; a family
 * proposal, the family head and EVERY live member — the recommendation lines
 * carry no member, so the proposal cannot be shown to leave a minor out, and
 * a family proposal is judged on the head's profile alone (loadProposalSnapshot),
 * which is exactly how a minor used to slip through.
 *
 * Used by the send route and by the status change that marks a proposal sent /
 * accepted in the CRM — both must refuse the same way.
 */
import { sql } from "drizzle-orm";
import { guardianMinorSql, guardianVerification, GUARDIAN_PENDING_MESSAGE } from "@/lib/investors/guardian-verification";
import { suitabilityProfile, suitabilityStatus } from "@/lib/risk-profile/own-assessment";
import { checkAlignment } from "@/lib/proposal/risk-alignment";

export type MinorGateRefusal =
  | { kind: "guardian"; error: string; field: "guardian" }
  | { kind: "risk"; error: string; field: "riskProfile" }
  | { kind: "alignment"; error: string; field: "suitabilityOverrideReason"; alignment: unknown };

export const hasMfLines = (products: unknown): boolean =>
  Array.isArray(products) && (products as any[]).some((it) => it?.kind === "mf");

/** The live minors a proposal covers (individual client, or family head + members). */
export async function minorsCovered(
  tx: any, tenantId: string, p: { investorId?: string | null; familyId?: string | null },
): Promise<string[]> {
  const ids = new Set<string>();
  if (p.investorId) ids.add(p.investorId);
  if (p.familyId) {
    const rows = (await tx.execute(sql`
      SELECT i.id::text AS id FROM investors i
       WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
         AND (i.family_id = ${p.familyId}::uuid
              OR i.id = (SELECT primary_investor_id FROM families WHERE id = ${p.familyId}::uuid AND tenant_id = ${tenantId}::uuid))
    `)).rows as Array<{ id: string }>;
    for (const r of rows) ids.add(r.id);
  }
  if (!ids.size) return [];
  const list = [...ids];
  const minors = (await tx.execute(sql`
    SELECT i.id::text AS id FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid AND i.id IN (${sql.join(list.map((x) => sql`${x}::uuid`), sql`, `)})
       AND ${guardianMinorSql("i")}
  `)).rows as Array<{ id: string }>;
  return minors.map((m) => m.id);
}

/**
 * The first reason a proposal with MF lines cannot go to (or be recorded as
 * shared with) the minors it covers, or null. Alignment is judged against each
 * minor's OWN category; the caller applies the owner-override rule to it.
 */
export async function minorProposalGate(
  tx: any, tenantId: string,
  p: { investorId?: string | null; familyId?: string | null; products?: unknown },
): Promise<MinorGateRefusal | null> {
  if (!hasMfLines(p.products)) return null;
  const minors = await minorsCovered(tx, tenantId, p);
  const lines = ((p.products ?? []) as any[])
    .filter((it) => it?.kind === "mf")
    .map((it) => ({ name: it.schemeName ?? "Scheme", riskRating: it.riskRating ?? null }));
  let alignment: MinorGateRefusal | null = null;
  for (const id of minors) {
    if ((await guardianVerification(tx, tenantId, id)) === "pending") {
      return { kind: "guardian", error: GUARDIAN_PENDING_MESSAGE, field: "guardian" };
    }
  }
  for (const id of minors) {
    const own = await suitabilityProfile(tx, tenantId, id);
    if (suitabilityStatus(own) !== "Completed") {
      return {
        kind: "risk", field: "riskProfile",
        error: "A mutual fund proposal that covers a minor needs that minor's own confirmed risk assessment (signed, not provisional, under 12 months). The guardian's profile does not count. Record it for the minor's account first.",
      };
    }
    const a = checkAlignment(own.category as any, lines);
    if (a.overall === "block" && !alignment) {
      alignment = {
        kind: "alignment", field: "suitabilityOverrideReason", alignment: a,
        error: `Suitability block for a minor — ${a.summary} This recommendation cannot be sent: re-assess the minor's risk appetite or pick lower-risk funds. An owner may override with a documented reason.`,
      };
    }
  }
  return alignment;
}
