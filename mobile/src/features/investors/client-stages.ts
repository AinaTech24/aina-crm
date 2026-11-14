/**
 * The Clients board's columns — the client-phase stages of the onboarding SOP,
 * in the web board's order (src/components/investors/InvestorsKanban.tsx,
 * CLIENT_PHASE_STAGES). A client with no source lead sits in Active Client.
 */

const TONE_HEX: Record<string, string> = {
  blue: "#3B82F6",
  amber: "#F59E0B",
  cyan: "#06B6D4",
  violet: "#8B5CF6",
  indigo: "#6366F1",
  emerald: "#10B981",
  rose: "#F43F5E",
};

const STAGES: { key: string; label: string; tone: string }[] = [
  { key: "request_documents", label: "Request Documents", tone: "blue" },
  { key: "documents_pending", label: "Documents Pending", tone: "amber" },
  { key: "documents_received", label: "Documents Received", tone: "cyan" },
  { key: "kyc_validated", label: "KYC Validated", tone: "violet" },
  { key: "kyc_registered", label: "KYC Registered", tone: "violet" },
  { key: "kyc_pending", label: "KYC Pending", tone: "amber" },
  { key: "modify_kyc", label: "Modify KYC", tone: "amber" },
  { key: "physical_kyc", label: "Physical KYC", tone: "violet" },
  { key: "online_kyc", label: "Online KYC", tone: "violet" },
  { key: "ucc_create", label: "UCC Create", tone: "indigo" },
  { key: "ucc_activated", label: "UCC Activated", tone: "indigo" },
  { key: "mandate_create", label: "Mandate Create", tone: "indigo" },
  { key: "mandate_activated", label: "Mandate Activated", tone: "emerald" },
  { key: "mandate_reject", label: "Mandate Rejected", tone: "rose" },
  { key: "make_transaction", label: "Make Transaction", tone: "indigo" },
  { key: "transaction_successful", label: "Transaction Successful", tone: "emerald" },
  { key: "transaction_failed", label: "Transaction Failed", tone: "rose" },
  { key: "rta_forms_ready", label: "Forms Ready", tone: "indigo" },
  { key: "rta_client_signed", label: "Client Signed", tone: "indigo" },
  { key: "rta_submitted", label: "Submitted to RTA", tone: "amber" },
  { key: "rta_processed", label: "Processed by RTA", tone: "emerald" },
  { key: "rta_rejected", label: "Rejected by RTA", tone: "rose" },
  { key: "family_mapping", label: "Family Mapping", tone: "cyan" },
  { key: "update_information", label: "Update Information", tone: "cyan" },
  { key: "add_in_review_sheet", label: "Active Client", tone: "emerald" },
];

export const CLIENT_PHASE_STAGES = STAGES.map((s) => ({ key: s.key, label: s.label, color: TONE_HEX[s.tone] }));
const KEYS = new Set(STAGES.map((s) => s.key));

/** A stage outside the client phase (e.g. won_lead) reads as Active Client, as on the web. */
export function boardStage(stageKey?: string | null): string {
  return stageKey && KEYS.has(stageKey) ? stageKey : "add_in_review_sheet";
}
