/**
 * What the proposal PDF needs beyond the proposal row: the firm's brand and
 * contact details, the RM who prepared it (name, EUIN, contact, signature) and
 * the client's own risk profile. One loader, so the RM's download, the email
 * attachment and the client's link always print the same document.
 */

import { and, eq } from "drizzle-orm";
import { investors, users } from "@/db/schema";
import { suitabilityProfile } from "@/lib/risk-profile/own-assessment";
import type { ProposalBrand, ProposalClient, ProposalPreparer } from "./proposal-pdf";

type Tx = any;

export function proposalBrand(t: any): ProposalBrand {
  return {
    displayName: t?.displayName,
    legalName: t?.legalName,
    arn: t?.arn,
    euin: t?.euin,
    primaryColor: t?.primaryColor,
    secondaryColor: t?.secondaryColor,
    logoUrl: t?.logoUrl,
    address: t?.address ?? null,
    phone: t?.phone ?? null,
    email: t?.email ?? null,
    website: t?.website ?? null,
  };
}

export async function loadProposalPdfPeople(
  tx: Tx,
  p: { tenantId: string; preparedByUserId?: string | null; investorId?: string | null },
): Promise<{ preparedBy: ProposalPreparer | null; client: ProposalClient | null }> {
  const [preparedBy] = p.preparedByUserId
    ? await tx
        .select({ name: users.name, euin: users.euin, phone: users.phone, email: users.email, signatureUrl: users.signatureUrl })
        .from(users)
        .where(and(eq(users.id, p.preparedByUserId), eq(users.tenantId, p.tenantId)))
        .limit(1)
    : [];
  const [row] = p.investorId
    ? await tx
        .select({ id: investors.id })
        .from(investors)
        .where(and(eq(investors.id, p.investorId), eq(investors.tenantId, p.tenantId)))
        .limit(1)
    : [];
  // A minor's risk is their own assessment, never the guardian's copy (G-1).
  const own = row ? await suitabilityProfile(tx, p.tenantId, row.id) : null;
  const client: ProposalClient | null = own
    ? { riskProfile: own.category, riskProfileSignedAt: own.signedAt, riskProfileProvisional: own.provisional }
    : null;
  return { preparedBy: preparedBy ?? null, client };
}
