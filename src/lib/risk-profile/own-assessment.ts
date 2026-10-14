/**
 * Which risk profile may SUITABILITY rely on for a client (G-1, 2026-10-14)?
 *
 * Migration 0234 copies a linked guardian's risk category, score, signed date
 * and provisional flag onto a minor's `investors` row. On that row the copy is
 * indistinguishable from an assessment of the minor's account: same columns,
 * `provisional` false, the guardian's signing date. No suitability policy in
 * the CRM says a guardian's own profile establishes the suitability of the
 * minor's investments, so until the firm confirms one, the copy is shown as the
 * guardian's but never satisfies a suitability gate on its own.
 *
 *  - Any client NOT a minor linked to a guardian: the `investors` row, exactly
 *    as before.
 *  - A minor linked to a guardian: only an assessment recorded FOR THE MINOR'S
 *    ACCOUNT — the latest `risk_profile_responses` row whose investor_id is the
 *    minor (the questionnaire or the RM's entry, answered by the guardian on
 *    the minor's behalf). None → not profiled.
 *
 * Read-only: nothing here writes a risk profile or an audit row.
 */
import { sql } from "drizzle-orm";

export type SuitabilityProfile = {
  category: string | null;
  score: number | null;
  signedAt: string | null;
  provisional: boolean;
  /** The `investors` row carries a guardian's copy this ignored. */
  inheritedIgnored: boolean;
};

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);

export async function suitabilityProfile(tx: any, tenantId: string, investorId: string): Promise<SuitabilityProfile> {
  const inv = (await tx.execute(sql`
    SELECT risk_profile, risk_profile_score, risk_profile_signed_at, COALESCE(risk_profile_provisional, false) AS provisional,
           guardian_investor_id, investor_category, is_minor
      FROM investors WHERE id = ${investorId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`)).rows[0] as Record<string, any> | undefined;
  if (!inv) return { category: null, score: null, signedAt: null, provisional: false, inheritedIgnored: false };
  const linkedMinor = !!inv.guardian_investor_id && (inv.investor_category === "minor" || inv.is_minor === true);
  if (!linkedMinor) {
    return {
      category: inv.risk_profile ?? null,
      score: inv.risk_profile_score == null ? null : Number(inv.risk_profile_score),
      signedAt: iso(inv.risk_profile_signed_at),
      provisional: inv.provisional === true,
      inheritedIgnored: false,
    };
  }
  const own = (await tx.execute(sql`
    SELECT final_category, total_score, signed_at, provisional FROM risk_profile_responses
     WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid
     ORDER BY COALESCE(signed_at, created_at) DESC LIMIT 1`)).rows[0] as Record<string, any> | undefined;
  return {
    category: own?.final_category ?? null,
    score: own?.total_score == null ? null : Number(own.total_score),
    signedAt: iso(own?.signed_at),
    provisional: own?.provisional === true,
    inheritedIgnored: true,
  };
}

/** The 12-month rule, for a profile `suitabilityProfile` took from the minor's
 *  own assessment (callers keep their existing rule for everyone else). */
export function suitabilityStatus(p: SuitabilityProfile, now = Date.now()): "Completed" | "Provisional" | "Due for review" | "Not completed" {
  if (!p.category) return "Not completed";
  if (p.provisional) return "Provisional";
  if (!p.signedAt) return "Not completed";
  return Date.parse(p.signedAt) < now - 365 * 864e5 ? "Due for review" : "Completed";
}
