/**
 * What the proposal PDF needs beyond the proposal row: the firm's brand and
 * contact details, the RM who prepared it (name, EUIN, contact, signature) and
 * the client's own risk profile. One loader, so the RM's download, the email
 * attachment and the client's link always print the same document.
 */

import { and, eq } from "drizzle-orm";
import { investors, users } from "@/db/schema";
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
  const [client] = p.investorId
    ? await tx
        .select({
          riskProfile: investors.riskProfile,
          riskProfileSignedAt: investors.riskProfileSignedAt,
          riskProfileProvisional: investors.riskProfileProvisional,
        })
        .from(investors)
        .where(and(eq(investors.id, p.investorId), eq(investors.tenantId, p.tenantId)))
        .limit(1)
    : [];
  return { preparedBy: preparedBy ?? null, client: client ?? null };
}
