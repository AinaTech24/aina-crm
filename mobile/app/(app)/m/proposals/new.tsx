/**
 * New / edit proposal — the live CRM's four-step builder (Client · Recommend ·
 * Review as client · Send), in src/features/proposals/builder.
 *
 *  ?editId=        a saved proposal (a sent one opens read-only — revise it instead)
 *  ?investorId= / ?leadId= / ?familyId=   start with that recipient
 *  ?opportunityId= link the proposal to the opportunity it answers
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";
import { ProposalBuilder } from "../../../../src/features/proposals/builder/ProposalBuilder";

export default function NewProposal() {
  const params = useLocalSearchParams<{ editId?: string; investorId?: string; leadId?: string; familyId?: string; opportunityId?: string }>();
  // A different proposal (Revise → the new version) is a fresh builder.
  return <ProposalBuilder key={params.editId ?? "new"} params={params} />;
}
