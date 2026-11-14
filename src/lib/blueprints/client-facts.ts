/**
 * A directly-added / imported client's place on the onboarding journey, from
 * the facts on their record (audit C2). Pure — the investor blueprint API
 * loads the facts; tests pin the rules.
 */

/** The main MF onboarding steps a directly-added client can be placed on from
 *  facts, in order. No failure / retry stage, no lead stage. */
export const FACT_STEPS = [
  "kyc_validated",
  "ucc_activated",
  "mandate_activated",
  "transaction_successful",
  "family_mapping",
  "add_in_review_sheet",
] as const;

export type FactStatus = "done" | "current" | "upcoming" | "skipped";

/**
 * Where a directly-added client stands, from what their record proves.
 */
export function factJourney(f: {
  kycVerified: boolean;
  hasUcc: boolean;
  mandateActive: boolean;
  invested: boolean;
  inFamily: boolean;
  active: boolean;
}): Record<(typeof FACT_STEPS)[number], FactStatus> {
  const out = {
    kyc_validated: f.kycVerified ? "done" : "upcoming",
    // No UCC but money with the registrar: invested through the physical route
    // — the exchange steps did not happen, so they are skipped, not ticked.
    ucc_activated: f.hasUcc ? "done" : f.invested ? "skipped" : "upcoming",
    mandate_activated: f.mandateActive ? "done" : f.invested ? "skipped" : "upcoming",
    transaction_successful: f.invested ? "done" : "upcoming",
    family_mapping: f.inFamily ? "done" : "upcoming",
    add_in_review_sheet: f.active && f.invested && f.kycVerified ? "done" : "upcoming",
  } as Record<(typeof FACT_STEPS)[number], FactStatus>;
  // The first step not yet proven is where the client is.
  const firstOpen = FACT_STEPS.find((k) => out[k] === "upcoming");
  if (firstOpen) out[firstOpen] = "current";
  return out;
}

