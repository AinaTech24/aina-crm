/**
 * The documents a claim needs, by what is being claimed on. A plain module —
 * the claim page's document manager (a client component) and the Claims
 * Control Centre's loaders (server) read the same list, so "documents
 * pending" on the dashboard is exactly the unticked items on the claim.
 *
 * Keys are stored on each uploaded document as `docType`; the original six
 * (claim_form, hospital_bills, discharge_summary, kyc, bank_proof,
 * policy_copy) and the two death-claim extras keep their spelling so every
 * document already on file still ticks its item.
 *
 * The list follows the policy's PRODUCT (health, motor, life…), then the claim
 * mode and type: a cashless request needs a pre-authorisation form, not a
 * final bill. A claim with no linked policy falls back to the original
 * health-style list — the CRM cannot tell what it is.
 */

import { PRODUCT_GROUPS } from "./book";

export type ChecklistItem = { key: string; label: string };

export const DOC_LABEL: Record<string, string> = {
  claim_form: "Claim form",
  policy_copy: "Policy copy",
  kyc: "KYC (PAN / Aadhaar)",
  bank_proof: "Bank proof / cancelled cheque",
  hospital_bills: "Hospital bills / final bill",
  discharge_summary: "Discharge summary",
  diagnostic_reports: "Diagnostic reports",
  pre_auth_form: "Pre-authorisation form",
  death_certificate: "Death certificate",
  nominee_kyc: "Nominee KYC",
  fir: "FIR / police report",
  vehicle_documents: "Vehicle documents (RC, driving licence)",
  repair_estimate: "Repair estimate / invoice",
  survey_report: "Survey report",
  photos: "Photographs of the loss",
  employer_documents: "Employer documents",
  travel_documents: "Travel documents (passport, tickets)",
  loss_proof: "Proof of loss / invoices",
  other: "Other insurer-specific document",
};

const items = (...keys: string[]): ChecklistItem[] => keys.map((key) => ({ key, label: DOC_LABEL[key] ?? key }));

const GROUP_OF_TYPE: Record<string, string> = Object.fromEntries(
  PRODUCT_GROUPS.flatMap((g) => g.types.map((t) => [t, g.key])),
);

/** The product group a policy type belongs to, or null when the type is unknown. */
export const groupOfPolicyType = (policyType: string | null | undefined): string | null =>
  (policyType ? GROUP_OF_TYPE[policyType] ?? null : null);

export function checklistFor(o: { policyType?: string | null; claimType?: string | null; claimMode?: string | null }): ChecklistItem[] {
  const group = groupOfPolicyType(o.policyType);
  const cashless = o.claimMode === "cashless" || o.claimType === "pre_authorization";
  switch (group) {
    case "health":
    case "ghi":
      return cashless
        ? items("pre_auth_form", "kyc", "policy_copy", "diagnostic_reports")
        : items("claim_form", "hospital_bills", "discharge_summary", "diagnostic_reports", "kyc", "bank_proof", "policy_copy");
    case "life":
    case "ulip":
      return items("claim_form", "death_certificate", "nominee_kyc", "diagnostic_reports", "policy_copy", "bank_proof");
    case "pa":
    case "gpa":
      return items("claim_form", "fir", "diagnostic_reports", "hospital_bills", "kyc", "bank_proof", "policy_copy");
    case "motor":
      return items("claim_form", "vehicle_documents", "fir", "repair_estimate", "survey_report", "photos", "kyc", "bank_proof", "policy_copy");
    case "travel":
      return items("claim_form", "travel_documents", "loss_proof", "fir", "kyc", "bank_proof", "policy_copy");
    case "wc":
      return items("claim_form", "employer_documents", "diagnostic_reports", "hospital_bills", "kyc", "bank_proof", "policy_copy");
    case "fire":
    case "marine":
    case "general":
      return items("claim_form", "survey_report", "fir", "loss_proof", "photos", "kyc", "bank_proof", "policy_copy");
    default: {
      // No policy linked: the list the claim page has always shown. A rider or
      // "other" claim may be a death claim, so it also asks for the estate papers.
      const base = items("claim_form", "hospital_bills", "discharge_summary", "kyc", "bank_proof", "policy_copy");
      return o.claimType === "rider" || o.claimType === "other" ? [...base, ...items("death_certificate", "nominee_kyc")] : base;
    }
  }
}
