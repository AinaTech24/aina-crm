/**
 * Public proposal approval page — /p/<token>.
 *
 * The client sees every recommendation, ticks the ones they accept, types
 * their name and accepts — or asks for a change instead. Coming back to the
 * link after answering shows what they agreed, read-only, with their copy to
 * download.
 *
 * It used to show only a title and a total, with a "Read the full proposal"
 * link that needed a CRM login. A client on WhatsApp had no other copy, so
 * they were approving a document they could not open.
 */

import { eq } from "drizzle-orm";
import { FileSignature } from "lucide-react";
import { formatArn } from "@/lib/branding/arn";
import { withSystem } from "@/db/client";
import { proposals, tenants } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { formatDate } from "@/lib/format";
import { PROPOSAL_ACCEPTANCE_TEXT } from "@/lib/proposals/public-link";
import { itemAmountText, itemKindLabel, itemName, itemRiskLabel } from "@/lib/proposals/items";
import { PublicProposalApproval } from "@/components/public/PublicProposalApproval";

export const dynamic = "force-dynamic";

export default async function PublicProposalApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let info: Awaited<ReturnType<typeof resolveShareToken>>;
  try {
    // Answered links still open, read-only (see the header).
    info = await resolveShareToken(token, { allowUsed: true });
  } catch (e: any) {
    return <ErrorScreen message={e?.message ?? "This link is no longer valid"} />;
  }
  if (info.kind !== "proposal_approval") {
    return <ErrorScreen message="This link is not a proposal approval form." />;
  }

  const { tenant, proposal } = await withSystem(async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId));
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, info.subjectId));
    return { tenant: t, proposal: p };
  });

  if (!proposal) return <ErrorScreen message="Proposal not found." />;

  const firm = tenant?.displayName ?? tenant?.legalName ?? "Your mutual fund distributor";
  const products = Array.isArray(proposal.products) ? (proposal.products as any[]) : [];
  const expired = !!proposal.validUntil && new Date(proposal.validUntil as any) < new Date();

  return (
    <div className="min-h-screen bg-secondary">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileSignature className="size-5 text-brand-cyan shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold truncate">{firm}</div>
              <div className="text-2xs text-muted-foreground">AMFI Registered Mutual Fund Distributor</div>
            </div>
          </div>
          <div className="text-2xs text-muted-foreground shrink-0">{formatArn(tenant?.arn)}</div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <PublicProposalApproval
          tokenId={info.id}
          answered={!!info.usedAt}
          proposal={{
            number: proposal.proposalNumber ?? "",
            version: proposal.version ?? 1,
            title: proposal.title,
            summary: proposal.summary ?? null,
            recipientName: proposal.recipientName ?? "",
            status: proposal.status,
            validUntil: proposal.validUntil ? formatDate(new Date(proposal.validUntil as any)) : null,
            expired,
            acceptedAt: proposal.acceptedAt ? formatDate(new Date(proposal.acceptedAt as any)) : null,
            acceptedItems: (proposal.acceptedItems as number[] | null) ?? null,
            changeRequestNote: proposal.changeRequestNote ?? null,
            pdfUrl: `/api/public/proposals/pdf?token=${encodeURIComponent(info.id)}`,
            items: products.map((it) => ({
              name: itemName(it),
              kind: itemKindLabel(it),
              amount: itemAmountText(it),
              risk: itemRiskLabel(it),
              goal: (it?.goal as string | undefined) ?? null,
              amc: (it?.amcName ?? it?.insurer ?? it?.manager ?? it?.company ?? null) as string | null,
            })),
          }}
          acceptanceText={PROPOSAL_ACCEPTANCE_TEXT}
        />
      </main>

      <footer className="max-w-3xl mx-auto px-4 py-6 text-2xs text-muted-foreground text-center">
        Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        {tenant?.arn ? <> · {firm} · {formatArn(tenant.arn)}</> : null}
      </footer>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-secondary grid place-items-center p-6">
      <div className="max-w-md bg-white rounded-lg shadow p-6 text-center">
        <FileSignature className="size-10 text-rose-600 mx-auto" />
        <h1 className="text-lg font-semibold mt-3">Link unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2">{message}</p>
      </div>
    </div>
  );
}
