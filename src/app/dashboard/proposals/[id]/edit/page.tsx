/**
 * Edit a proposal in the builder. A draft is editable; a sent proposal opens
 * read-only (it is the record of what the client saw) — changes go into a new
 * version via Revise.
 */

import { ProposalBuilder } from "@/components/proposals/builder/ProposalBuilder";

export const dynamic = "force-dynamic";

export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProposalBuilder proposalId={id} />;
}
