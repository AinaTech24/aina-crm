/**
 * A proposal's recommendations measured against the client's risk profile as
 * it stands now — for the proposal email, the client's approval page and the
 * acceptance it records. Server-only (it reads the snapshot); the verdict
 * itself is aboveAppetite in fit.ts.
 */

import { loadProposalSnapshot } from "./snapshot";
import { aboveAppetite, profileLabel, type AboveAppetite } from "./fit";

export type ProposalAppetite = {
  /** "Moderate", or null when no risk profile is on record. */
  profile: string | null;
  above: AboveAppetite[];
};

export async function loadProposalAppetite(
  tx: any,
  tenantId: string,
  p: { investorId?: string | null; familyId?: string | null; leadId?: string | null; products?: unknown }
): Promise<ProposalAppetite> {
  const items = Array.isArray(p.products) ? (p.products as any[]) : [];
  if (!items.some((it) => it?.kind === "mf")) return { profile: null, above: [] };
  const snap = await loadProposalSnapshot(tx, tenantId, {
    investorId: p.investorId ?? null,
    familyId: p.familyId ?? null,
    leadId: p.leadId ?? null,
  }).catch(() => null);
  const category = snap?.risk.category ?? null;
  return { profile: profileLabel(category), above: aboveAppetite(items, category) };
}
