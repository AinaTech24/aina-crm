/**
 * What the CRM already knows about a proposal's recipient — so the builder
 * starts from it instead of a blank form.
 *
 * Every proposal used to begin with the RM retyping what the system had: the
 * risk profile, what the client already holds, how much they put in each
 * month. The suitability check only ran once products were entered, by which
 * point the RM had already built the wrong proposal.
 *
 * Nothing here is new arithmetic. It composes the helpers the rest of the CRM
 * already trusts:
 *   loadClientSummary        AUM, SIP book, risk status, family, RM
 *   assetClassExposure       how much of the book is equity
 *   assessSuitability        the risk profile's equity band (floor–ceiling)
 * so the builder can never disagree with the client page.
 *
 * A lead has no holdings and — in this data model — no risk profile (profiles
 * belong to investors). That is reported as such, never as zeros.
 */

import { loadExposureBook } from "@/lib/investors/exposure-book";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { folios, goals, investors, leads, families } from "@/db/schema";
import { loadClientSummary } from "@/lib/investors/summary";
import { assetClassExposure } from "@/lib/investors/asset-class";
import { assessSuitability } from "@/lib/investors/suitability";

type Tx = any;

export type ProposalSnapshot = {
  kind: "investor" | "lead";
  /** The record the numbers are about (for a family: the member or the head). */
  subjectId: string;
  name: string;
  family: string | null;
  rm: string | null;
  /** Can the proposal actually reach them? */
  hasEmail: boolean;
  hasPhone: boolean;
  risk: {
    /** conservative / moderate / aggressive / very_aggressive, or null. */
    category: string | null;
    score: number | null;
    signedAt: string | null;
    /** Completed / Provisional / Due for review / Not completed. */
    status: string;
  };
  /** Null for a lead — no holdings is not ₹0 of holdings. */
  holdings: null | {
    aum: number;
    sipBook: number;
    /** Equity share of what is classifiable, or null when too little is. */
    equityPct: number | null;
    /** Rupee value of the equity part, for the "equity after" estimate. */
    equityValue: number;
  };
  /** The risk profile's equity band, when there is a profile. */
  band: { floor: number; ceiling: number } | null;
  goals: Array<{ name: string; targetYear: number | null }>;
  /** Lead stage, for a lead. */
  stage: string | null;
};

export async function loadProposalSnapshot(
  tx: Tx,
  tenantId: string,
  who: { investorId?: string | null; familyId?: string | null; leadId?: string | null }
): Promise<ProposalSnapshot | null> {
  // A family proposal is about the chosen member, else the family head.
  let investorId = who.investorId ?? null;
  if (!investorId && who.familyId) {
    const [f] = await tx
      .select({ primary: families.primaryInvestorId })
      .from(families)
      .where(and(eq(families.id, who.familyId), eq(families.tenantId, tenantId)))
      .limit(1);
    investorId = f?.primary ?? null;
  }

  if (investorId) return investorSnapshot(tx, tenantId, investorId);
  if (who.leadId) return leadSnapshot(tx, tenantId, who.leadId);
  return null;
}

async function investorSnapshot(tx: Tx, tenantId: string, investorId: string): Promise<ProposalSnapshot | null> {
  const [inv] = await tx
    .select({
      id: investors.id,
      name: investors.name,
      email: investors.email,
      phone: investors.phone,
      riskProfile: investors.riskProfile,
      riskScore: investors.riskProfileScore,
      riskSignedAt: investors.riskProfileSignedAt,
    })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, tenantId), isNull(investors.deletedAt)))
    .limit(1);
  if (!inv) return null;

  const summary = await loadClientSummary(tx, tenantId, investorId);
  // Holdings stored without a category take it from the AMFI master, so the
  // equity share here matches the client page and the suitability email.
  const folioRows = await loadExposureBook(tx, tenantId, investorId);
  const exposure = assetClassExposure(folioRows as any);
  const suit = assessSuitability(inv.riskProfile ?? null, exposure.equityPct, exposure.classifiedPct);

  const goalRows = await tx
    .select({ name: goals.name, targetDate: goals.targetDate })
    .from(goals)
    .where(and(eq(goals.tenantId, tenantId), eq(goals.investorId, investorId)))
    .orderBy(asc(goals.targetDate))
    .limit(5);

  const aum = summary?.aum ?? 0;
  return {
    kind: "investor",
    subjectId: investorId,
    name: inv.name,
    family: summary?.family ?? null,
    rm: summary?.rm ?? null,
    hasEmail: !!inv.email,
    hasPhone: !!inv.phone,
    risk: {
      category: inv.riskProfile ?? null,
      score: inv.riskScore != null ? Number(inv.riskScore) : null,
      signedAt: inv.riskSignedAt ? new Date(inv.riskSignedAt).toISOString() : null,
      status: summary?.risk ?? "Not completed",
    },
    holdings: {
      aum,
      sipBook: summary?.sipBook ?? 0,
      equityPct: exposure.equityPct,
      equityValue: exposure.equityPct != null ? (aum * exposure.equityPct) / 100 : 0,
    },
    band: suit.band ? { floor: suit.band.floor, ceiling: suit.band.ceiling } : null,
    goals: goalRows.map((g: any) => ({
      name: g.name,
      targetYear: g.targetDate ? new Date(g.targetDate).getFullYear() : null,
    })),
    stage: null,
  };
}

async function leadSnapshot(tx: Tx, tenantId: string, leadId: string): Promise<ProposalSnapshot | null> {
  const [l] = await tx
    .select({ id: leads.id, name: leads.name, email: leads.email, phone: leads.phone, stage: leads.stage, converted: leads.convertedInvestorId })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .limit(1);
  if (!l) return null;
  // A converted lead IS a client now — describe the client.
  if (l.converted) return investorSnapshot(tx, tenantId, l.converted);

  const owner = (
    await tx.execute(sql`
      SELECT u.name FROM leads l LEFT JOIN users u ON u.id = l.owner_id
       WHERE l.id = ${leadId}::uuid LIMIT 1
    `)
  ).rows[0] as { name?: string } | undefined;

  // A lead's questionnaire is filed against the lead id (the public risk-profile
  // form; carried to the client on conversion). Signed in the last year is
  // confirmed — the same 12-month rule as a client's (lib/investors/summary).
  const rp = (
    await tx.execute(sql`
      SELECT final_category, total_score, signed_at FROM risk_profile_responses
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${leadId}::uuid
       ORDER BY COALESCE(signed_at, created_at) DESC LIMIT 1
    `)
  ).rows[0] as { final_category?: string; total_score?: number; signed_at?: string | null } | undefined;
  const signedAt = rp?.signed_at ? new Date(rp.signed_at).toISOString() : null;
  const risk: ProposalSnapshot["risk"] = rp?.final_category
    ? {
        category: rp.final_category,
        score: rp.total_score != null ? Number(rp.total_score) : null,
        signedAt,
        status: !signedAt ? "Not completed" : Date.parse(signedAt) < Date.now() - 365 * 864e5 ? "Due for review" : "Completed",
      }
    : { category: null, score: null, signedAt: null, status: "Not completed" };

  return {
    kind: "lead",
    subjectId: leadId,
    name: l.name,
    family: null,
    rm: owner?.name ?? null,
    hasEmail: !!l.email,
    hasPhone: !!l.phone,
    risk,
    holdings: null,
    band: null,
    goals: [],
    stage: l.stage ?? null,
  };
}
