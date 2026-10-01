"use client";

/**
 * New proposal — the four-step builder (components/proposals/builder).
 *
 * Opens prefilled from the URL: ?investorId=, ?leadId= or ?familyId= (the
 * "Create proposal" buttons on client, lead, family and opportunity pages).
 */

import { ProposalBuilder } from "@/components/proposals/builder/ProposalBuilder";

export default function NewProposalPage() {
  return <ProposalBuilder />;
}
