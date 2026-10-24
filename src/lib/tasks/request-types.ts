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
 * A financial request carries one or more SCHEME ROWS (a client often invests
 * in several schemes at once). On the task: the rows → meta.request.rows, the
 * total amount → meta.boValue and the mode → meta.boChannel (what the
 * Operations Dashboard reads for value and online/offline). A request with a
 * `business` mapping also books a Business entry — one line per row — so
 * Operations never keys the same transaction twice (lib/business/create-entry).
 */

export type TaskCategory = "general" | "financial" | "non_financial";

/** Fields asked once for the whole request. */
export type RequestField = "amount" | "mode" | "folio";
/** Fields asked on each scheme row. */
export type RowField = "scheme" | "fromScheme" | "amount" | "units" | "folio" | "sipDay" | "frequency";

/** Business entry transaction types (business_entries.TXN_TYPES) a request books. */
export type BusinessTxn = "sip" | "sip_stop" | "lumpsum" | "additional_purchase" | "switch" | "stp" | "swp" | "redemption";

export type RequestType = {
  key: string;
  label: string;
  category: Exclude<TaskCategory, "general">;
  /** Asked once for the request. */
  fields: RequestField[];
  /** Asked per scheme row; empty = the request has no scheme rows. */
  rowFields: RowField[];
  /** Scheme rows search the MF scheme catalog (false = free text, e.g. PMS / AIF). */
  catalog?: boolean;
  /** Books a Business entry with this transaction type and product. */
  business?: { txnType: BusinessTxn; productType: "mutual_fund" | "pms" | "aif" };
  /** The checklist a new task of this kind starts with. */
  checklist: string[];
};

const REQUEST_TYPE_LIST: RequestType[] = [
  // ── Financial ──
  {
    key: "purchase", label: "Purchase (lumpsum)", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount", "folio"], catalog: true,
    business: { txnType: "lumpsum", productType: "mutual_fund" },
    checklist: ["Transaction form / online link sent to client", "Payment received", "Submitted on the platform", "Allotment confirmed"],
  },
  {
    key: "additional_purchase", label: "Additional purchase", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount", "folio"], catalog: true,
    business: { txnType: "additional_purchase", productType: "mutual_fund" },
    checklist: ["Online link / form sent to client", "Payment received", "Submitted on the platform", "Allotment confirmed"],
  },
  {
    key: "redemption", label: "Redemption", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount", "units", "folio"], catalog: true,
    business: { txnType: "redemption", productType: "mutual_fund" },
    checklist: ["Redemption request signed / OTP approved", "Submitted on the platform", "Units processed by the RTA", "Proceeds credited to the client"],
  },
  {
    key: "switch", label: "Switch", category: "financial", fields: ["mode"],
    rowFields: ["fromScheme", "scheme", "amount", "units", "folio"], catalog: true,
    business: { txnType: "switch", productType: "mutual_fund" },
    checklist: ["Switch request signed / OTP approved", "Submitted on the platform", "Switch processed by the RTA"],
  },
  {
    key: "sip_registration", label: "SIP registration", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount", "sipDay", "frequency", "folio"], catalog: true,
    business: { txnType: "sip", productType: "mutual_fund" },
    checklist: ["SIP form / online link sent to client", "Mandate in place for the amount", "SIP registered on the platform", "First instalment confirmed"],
  },
  {
    key: "sip_modification", label: "SIP modification", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount", "sipDay", "frequency", "folio"], catalog: true,
    checklist: ["Change request signed", "Submitted on the platform", "Change confirmed by the RTA"],
  },
  {
    key: "sip_stop", label: "SIP stop", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount", "folio"], catalog: true,
    business: { txnType: "sip_stop", productType: "mutual_fund" },
    checklist: ["Cancellation request signed", "Submitted on the platform", "Cancellation confirmed by the RTA"],
  },
  {
    key: "stp", label: "STP", category: "financial", fields: ["mode"],
    rowFields: ["fromScheme", "scheme", "amount", "sipDay", "frequency", "folio"], catalog: true,
    business: { txnType: "stp", productType: "mutual_fund" },
    checklist: ["STP form signed", "Submitted on the platform", "STP registered"],
  },
  {
    key: "swp", label: "SWP", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount", "sipDay", "frequency", "folio"], catalog: true,
    business: { txnType: "swp", productType: "mutual_fund" },
    checklist: ["SWP form signed", "Submitted on the platform", "SWP registered"],
  },
  {
    key: "mandate_create", label: "New mandate", category: "financial", fields: ["amount", "mode"], rowFields: [],
    checklist: ["Mandate form signed / e-mandate sent", "Bank approval received", "Mandate active"],
  },
  {
    key: "mandate_renewal", label: "Mandate renewal", category: "financial", fields: ["amount", "mode"], rowFields: [],
    checklist: ["Renewal form signed / e-mandate sent", "Bank approval received", "Mandate active"],
  },
  {
    key: "sip_rejection_followup", label: "SIP rejection follow-up", category: "financial", fields: [],
    rowFields: ["scheme", "amount", "folio"], catalog: true,
    checklist: ["Rejection reason checked with the client", "Bank / mandate issue fixed", "Instalment retried or SIP re-registered"],
  },
  {
    key: "pms", label: "PMS", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount"], catalog: false,
    business: { txnType: "lumpsum", productType: "pms" },
    checklist: ["Client documents collected", "Agreement signed", "Funds transferred", "Account activated"],
  },
  {
    key: "aif", label: "AIF", category: "financial", fields: ["mode"],
    rowFields: ["scheme", "amount"], catalog: false,
    business: { txnType: "lumpsum", productType: "aif" },
    checklist: ["Client documents collected", "Contribution agreement signed", "Funds transferred", "Units allotted"],
  },

  // ── Non-financial ──
  {
    key: "kyc_renewal", label: "KYC / KYC update", category: "non_financial", fields: [], rowFields: [],
    checklist: ["KYC form, PAN and address proof collected", "IPV / video KYC done", "Submitted to the KRA", "KRA status verified"],
  },
  {
    key: "nominee_update", label: "Nominee update", category: "non_financial", fields: ["folio"], rowFields: [],
    checklist: ["Nomination form signed", "ID proof of the nominee", "Submitted to the RTA", "Confirmation received"],
  },
  {
    key: "bank_change", label: "Bank change", category: "non_financial", fields: ["folio"], rowFields: [],
    checklist: ["Change of bank form signed", "Cancelled cheque / bank proof", "Submitted to the RTA", "Confirmation received"],
  },
  {
    key: "contact_change", label: "Address / contact change", category: "non_financial", fields: ["folio"], rowFields: [],
    checklist: ["Change request signed", "Proof collected", "Submitted to the RTA", "Confirmation received"],
  },
  {
    key: "folio_consolidation", label: "Folio consolidation", category: "non_financial", fields: ["folio"], rowFields: [],
    checklist: ["Consolidation request signed", "Submitted to the RTA", "Consolidated folio confirmed"],
  },
  {
    key: "account_statement", label: "Account statement", category: "non_financial", fields: ["folio"], rowFields: [],
    checklist: ["Statement requested", "Statement sent to the client"],
  },
  {
    key: "collect_document", label: "Collect document", category: "non_financial", fields: [], rowFields: [],
    checklist: ["Document list shared with the client", "Documents received", "Documents verified"],
  },
  {
    key: "onboarding", label: "Onboarding / UCC creation", category: "non_financial", fields: [], rowFields: [],
    checklist: ["KYC verified", "UCC created on the platform", "FATCA and nominee done", "Client activated"],
  },
  {
    key: "service_other", label: "Other service request", category: "non_financial", fields: ["folio"], rowFields: [],
    checklist: [],
  },
];

/**
 * The last sub-task of EVERY request, financial or not: once the work is done
 * the data the registrar (CAMS / KFintech) holds is checked against it —
 * the transaction, folio, nominee, bank or contact change really shows there.
 * Added here, not in each list above, so a new request type cannot forget it.
 */
export const RTA_DATA_CHECK = "RTA data check";

export const REQUEST_TYPES: RequestType[] = REQUEST_TYPE_LIST.map((r) => ({
  ...r,
  checklist: r.checklist.includes(RTA_DATA_CHECK) ? r.checklist : [...r.checklist, RTA_DATA_CHECK],
}));

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
 *  `financial` value. */
export const FINANCIAL_REQUEST_KEYS: string[] = [
  ...REQUEST_TYPES.filter((r) => r.category === "financial").map((r) => r.key),
  "financial",
];

export const FIELD_LABEL: Record<RequestField, string> = {
  amount: "Amount (₹)",
  mode: "Mode",
  folio: "Folio number",
};

export function rowFieldLabel(f: RowField, req: RequestType): string {
  switch (f) {
    case "scheme":
      return req.rowFields.includes("fromScheme") ? "To scheme" : req.catalog === false ? "Product / scheme" : "Scheme";
    case "fromScheme":
      return "From scheme";
    case "amount":
      return "Amount (₹)";
    case "units":
      return "Units";
    case "folio":
      return "Folio";
    case "sipDay":
      return req.key === "swp" ? "SWP day" : req.key === "stp" ? "STP day" : "SIP day";
    case "frequency":
      return "Frequency";
  }
}

/** Business-entry frequencies (business_entries.TXN_FREQUENCIES, less one_time). */
export const FREQUENCIES: [string, string][] = [
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["weekly", "Weekly"],
  ["half_yearly", "Half-yearly"],
  ["yearly", "Yearly"],
];

/** One scheme row as stored on the task (meta.request.rows). */
export type RequestRow = {
  schemeCode?: string;
  schemeName: string;
  amcName?: string;
  assetCategory?: string;
  fromSchemeCode?: string;
  fromSchemeName?: string;
  amount?: number;
  units?: number;
  allUnits?: boolean;
  folio?: string;
  /** Day of month, "1".."28". */
  sipDay?: string;
  frequency?: string;
};

/** meta.request. `rows` since 2026-10-02; the single-scheme fields are what
 *  tasks created on 2026-10-01 carry, still read by the summary. */
export type RequestDetails = {
  rows?: RequestRow[];
  folio?: string;
  scheme?: string;
  toScheme?: string;
  sipDate?: string;
  frequency?: string;
  units?: string;
  allUnits?: boolean;
};
