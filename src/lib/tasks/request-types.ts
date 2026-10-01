/**
 * Task request types — ONE list of the financial and non-financial requests a
 * task can be, with the fields each one asks for and the checklist it starts
 * with. Safe for server and client.
 *
 * Why it exists: the New task form offered "Financial" as a type and saved the
 * word `financial`, which no dashboard recognised — the RM desk, the Branch
 * dashboard, the Operations queue and the Tasks list's financial filter all
 * classify by the specific request (FINANCIAL_TASK_TYPES, the Operations
 * Dashboard's KIND_SQL), so every "Financial" task counted as non-financial.
 * The form now asks for the category, then the request, and saves the
 * request's key; the dashboards read the keys from here.
 *
 * Keys are stored in `tasks.type`. Existing keys keep their spelling
 * (purchase, redemption, switch, sip_registration, sip_stop, stp, swp,
 * mandate_create, mandate_renewal, sip_rejection_followup, kyc_renewal,
 * nominee_update, collect_document) so old tasks and automations still match.
 *
 * Details live on the task: amount → meta.boValue and mode → meta.boChannel
 * (what the Operations Dashboard already reads for value and online/offline),
 * the rest → meta.request.
 */

export type TaskCategory = "general" | "financial" | "non_financial";

export type RequestField = "amount" | "scheme" | "toScheme" | "folio" | "mode" | "sipDate" | "frequency" | "units";

export type RequestType = {
  key: string;
  label: string;
  category: Exclude<TaskCategory, "general">;
  /** Detail fields shown for this request, in order. */
  fields: RequestField[];
  /** The checklist a new task of this kind starts with. */
  checklist: string[];
};

const FIN_BASE: RequestField[] = ["amount", "scheme", "folio", "mode"];

export const REQUEST_TYPES: RequestType[] = [
  // ── Financial ──
  {
    key: "purchase", label: "Purchase (lumpsum)", category: "financial", fields: FIN_BASE,
    checklist: ["Transaction form / online link sent to client", "Payment received", "Submitted on the platform", "Allotment confirmed"],
  },
  {
    key: "additional_purchase", label: "Additional purchase", category: "financial", fields: FIN_BASE,
    checklist: ["Online link / form sent to client", "Payment received", "Submitted on the platform", "Allotment confirmed"],
  },
  {
    key: "redemption", label: "Redemption", category: "financial", fields: ["amount", "units", "scheme", "folio", "mode"],
    checklist: ["Redemption request signed / OTP approved", "Submitted on the platform", "Units processed by the RTA", "Proceeds credited to the client"],
  },
  {
    key: "switch", label: "Switch", category: "financial", fields: ["amount", "units", "scheme", "toScheme", "folio", "mode"],
    checklist: ["Switch request signed / OTP approved", "Submitted on the platform", "Switch processed by the RTA"],
  },
  {
    key: "sip_registration", label: "SIP registration", category: "financial", fields: ["amount", "scheme", "folio", "sipDate", "frequency", "mode"],
    checklist: ["SIP form / online link sent to client", "Mandate in place for the amount", "SIP registered on the platform", "First instalment confirmed"],
  },
  {
    key: "sip_modification", label: "SIP modification", category: "financial", fields: ["amount", "scheme", "folio", "sipDate", "frequency", "mode"],
    checklist: ["Change request signed", "Submitted on the platform", "Change confirmed by the RTA"],
  },
  {
    key: "sip_stop", label: "SIP stop", category: "financial", fields: ["amount", "scheme", "folio", "mode"],
    checklist: ["Cancellation request signed", "Submitted on the platform", "Cancellation confirmed by the RTA"],
  },
  {
    key: "stp", label: "STP", category: "financial", fields: ["amount", "scheme", "toScheme", "folio", "sipDate", "frequency", "mode"],
    checklist: ["STP form signed", "Submitted on the platform", "STP registered"],
  },
  {
    key: "swp", label: "SWP", category: "financial", fields: ["amount", "scheme", "folio", "sipDate", "frequency", "mode"],
    checklist: ["SWP form signed", "Submitted on the platform", "SWP registered"],
  },
  {
    key: "mandate_create", label: "New mandate", category: "financial", fields: ["amount", "mode"],
    checklist: ["Mandate form signed / e-mandate sent", "Bank approval received", "Mandate active"],
  },
  {
    key: "mandate_renewal", label: "Mandate renewal", category: "financial", fields: ["amount", "mode"],
    checklist: ["Renewal form signed / e-mandate sent", "Bank approval received", "Mandate active"],
  },
  {
    key: "sip_rejection_followup", label: "SIP rejection follow-up", category: "financial", fields: ["amount", "scheme", "folio"],
    checklist: ["Rejection reason checked with the client", "Bank / mandate issue fixed", "Instalment retried or SIP re-registered"],
  },
  {
    key: "pms", label: "PMS", category: "financial", fields: ["amount", "scheme", "mode"],
    checklist: ["Client documents collected", "Agreement signed", "Funds transferred", "Account activated"],
  },
  {
    key: "aif", label: "AIF", category: "financial", fields: ["amount", "scheme", "mode"],
    checklist: ["Client documents collected", "Contribution agreement signed", "Funds transferred", "Units allotted"],
  },

  // ── Non-financial ──
  {
    key: "kyc_renewal", label: "KYC / KYC update", category: "non_financial", fields: [],
    checklist: ["KYC form, PAN and address proof collected", "IPV / video KYC done", "Submitted to the KRA", "KRA status verified"],
  },
  {
    key: "nominee_update", label: "Nominee update", category: "non_financial", fields: ["folio"],
    checklist: ["Nomination form signed", "ID proof of the nominee", "Submitted to the RTA", "Confirmation received"],
  },
  {
    key: "bank_change", label: "Bank change", category: "non_financial", fields: ["folio"],
    checklist: ["Change of bank form signed", "Cancelled cheque / bank proof", "Submitted to the RTA", "Confirmation received"],
  },
  {
    key: "contact_change", label: "Address / contact change", category: "non_financial", fields: ["folio"],
    checklist: ["Change request signed", "Proof collected", "Submitted to the RTA", "Confirmation received"],
  },
  {
    key: "folio_consolidation", label: "Folio consolidation", category: "non_financial", fields: ["folio"],
    checklist: ["Consolidation request signed", "Submitted to the RTA", "Consolidated folio confirmed"],
  },
  {
    key: "account_statement", label: "Account statement", category: "non_financial", fields: ["folio"],
    checklist: ["Statement requested", "Statement sent to the client"],
  },
  {
    key: "collect_document", label: "Collect document", category: "non_financial", fields: [],
    checklist: ["Document list shared with the client", "Documents received", "Documents verified"],
  },
  {
    key: "onboarding", label: "Onboarding / UCC creation", category: "non_financial", fields: [],
    checklist: ["KYC verified", "UCC created on the platform", "FATCA and nominee done", "Client activated"],
  },
  {
    key: "service_other", label: "Other service request", category: "non_financial", fields: ["folio"],
    checklist: [],
  },
];

export const REQUEST_TYPE_BY_KEY: Record<string, RequestType> = Object.fromEntries(REQUEST_TYPES.map((r) => [r.key, r]));

export const requestTypesFor = (c: Exclude<TaskCategory, "general">) => REQUEST_TYPES.filter((r) => r.category === c);

/** Which category a stored task type belongs to. `financial` / `non_financial`
 *  are the old bare category values the form used to save. */
export function categoryOfType(type: string | null | undefined): TaskCategory {
  if (!type) return "general";
  if (type === "financial") return "financial";
  if (type === "non_financial") return "non_financial";
  return REQUEST_TYPE_BY_KEY[type]?.category ?? "general";
}

/** Every task type that is a FINANCIAL request — including the old bare
 *  `financial` value and the system types automations write. */
export const FINANCIAL_REQUEST_KEYS: string[] = [
  ...REQUEST_TYPES.filter((r) => r.category === "financial").map((r) => r.key),
  "financial",
];

export const FIELD_LABEL: Record<RequestField, string> = {
  amount: "Amount (₹)",
  scheme: "Scheme / AMC",
  toScheme: "To scheme",
  folio: "Folio number",
  mode: "Mode",
  sipDate: "SIP / instalment date",
  frequency: "Frequency",
  units: "Units",
};

export const FREQUENCIES: [string, string][] = [
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["weekly", "Weekly"],
  ["fortnightly", "Fortnightly"],
  ["half_yearly", "Half-yearly"],
  ["yearly", "Yearly"],
];

/** The details stored in meta.request (amount and mode go to boValue / boChannel). */
export type RequestDetails = {
  scheme?: string;
  toScheme?: string;
  folio?: string;
  sipDate?: string;
  frequency?: string;
  units?: string;
  allUnits?: boolean;
};
