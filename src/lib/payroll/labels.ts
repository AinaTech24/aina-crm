/** Payroll labels — a plain module so server and client pages share it. */

type Tone = "neutral" | "warning" | "success" | "info" | "danger";

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  paid: { label: "Paid", tone: "success" },
};

export const CLAIM_CATEGORIES = [
  { key: "fuel", label: "Fuel and conveyance" },
  { key: "travel", label: "Travel and stay" },
  { key: "phone", label: "Phone and internet" },
  { key: "client_meeting", label: "Client meeting" },
  { key: "office", label: "Office supplies" },
  { key: "training", label: "Training and exams (NISM, CFP…)" },
  { key: "other", label: "Other" },
] as const;
export const claimCategoryLabel = (k: string) => CLAIM_CATEGORIES.find((c) => c.key === k)?.label ?? k;

export const CLAIM_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  paid: { label: "Paid", tone: "success" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export const LOAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Recovering", tone: "info" },
  closed: { label: "Repaid", tone: "success" },
  cancelled: { label: "Stopped", tone: "neutral" },
};

export const INCENTIVE_STATUS: Record<string, { label: string; tone: Tone }> = {
  calculated: { label: "To approve", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  paid: { label: "Paid", tone: "success" },
};

export const PROOF_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "To verify", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};
