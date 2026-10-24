/**
 * The practice as a system — the shared vocabulary (The E-Myth Revisited).
 *
 * An MFD owner is usually the firm's best technician. Gerber's prescription is
 * to work ON the business: write down how every core process is done
 * (documented), give each one to a POSITION rather than a person (owned),
 * measure it (measured) and let the system run it where it can (automated).
 * The Practice Systems Map scores the firm on exactly those four things.
 *
 * Pure data, no I/O: safe to import from server and client code alike.
 * Per-firm settings live in the tables of migration 0245 (db/schema/practice.ts).
 */

/** How a process is measured. Each key is implemented in lib/practice/measures.ts. */
export type ProcessMeasureKey =
  | "lead_to_client_days"
  | "lead_conversion"
  | "onboarding_days"
  | "sip_rejection_recovery"
  | "redemption_followed_up"
  | "review_on_time"
  | "sr_within_sla"
  | "complaint_within_sla"
  | "renewal_on_time"
  | "kyc_expiry_cleared"
  | "rta_import_freshness"
  | "birthday_wished";

export type PracticeProcess = {
  key: string;
  name: string;
  /** One line: what "done right" means. */
  outcome: string;
  /** Default owner, a DEFAULT_POSITIONS key; the firm can change it. */
  defaultOwner: string;
  /** Recipes (lib/recipes keys) that automate part of it; any one enabled counts. */
  recipeKeys: string[];
  /** Automation rules (workflow_rules.module, the Automations page) that act on
   *  this process's records; any enabled rule in these modules counts too. */
  ruleModules?: string[];
  /** Journey blueprints that run it (lib/blueprints), by subject type. */
  blueprintSubject?: "lead" | "service_request" | "complaint" | "sip_rejection" | "investor" | "opportunity";
  /** Task types / service-request types whose work belongs to this process. */
  taskTypes?: string[];
  srTypes?: string[];
  measure: ProcessMeasureKey;
};

/** The core processes of an MFD practice, in the order a client meets them. */
export const PRACTICE_PROCESSES: PracticeProcess[] = [
  {
    key: "lead_to_client",
    name: "Lead to client",
    outcome: "Every enquiry is called within a day and moved to a decision.",
    defaultOwner: "relationship_manager",
    recipeKeys: ["lead_welcome", "lead_nurture_drip"],
    ruleModules: ["leads"],
    blueprintSubject: "lead",
    measure: "lead_conversion",
  },
  {
    key: "onboarding",
    name: "Onboarding (KYC, UCC, mandate)",
    outcome: "A won lead is investible — KYC, UCC and mandate done — within a week.",
    defaultOwner: "operations_executive",
    recipeKeys: ["lead_converted_onboarding", "docs_received_convert", "document_chase"],
    ruleModules: ["onboarding"],
    taskTypes: ["collect_document", "kyc_renewal"],
    measure: "onboarding_days",
  },
  {
    key: "first_investment",
    name: "First investment and welcome",
    outcome: "The first investment is confirmed and the client is welcomed.",
    defaultOwner: "relationship_manager",
    recipeKeys: ["first_investment_celebration", "new_business_thankyou", "ops_complete_portal_welcome"],
    ruleModules: ["transactions"],
    measure: "lead_to_client_days",
  },
  {
    key: "sip_rejection",
    name: "SIP rejection recovery",
    outcome: "Every bounced SIP is chased and recovered or closed with a reason.",
    defaultOwner: "operations_executive",
    recipeKeys: ["sip_rejection_followup", "mandate_failure_smart_retry"],
    ruleModules: ["sip_rejections"],
    blueprintSubject: "sip_rejection",
    measure: "sip_rejection_recovery",
  },
  {
    key: "redemption_retention",
    name: "Redemption retention",
    outcome: "Every large redemption gets a call from the RM within two days.",
    defaultOwner: "relationship_manager",
    recipeKeys: ["redemption_retention"],
    ruleModules: ["transactions"],
    measure: "redemption_followed_up",
  },
  {
    key: "periodic_review",
    name: "Periodic portfolio review",
    outcome: "Every client is reviewed on their service tier's cadence.",
    defaultOwner: "relationship_manager",
    recipeKeys: ["hni_quarterly_review", "retail_halfyearly_review", "family_linked_review"],
    ruleModules: ["review_meetings"],
    blueprintSubject: "investor",
    taskTypes: ["review_meeting"],
    measure: "review_on_time",
  },
  {
    key: "service_requests",
    name: "Service requests",
    outcome: "Every client request is resolved within its SLA.",
    defaultOwner: "service_desk",
    recipeKeys: ["service_request_escalation"],
    ruleModules: ["service_requests"],
    blueprintSubject: "service_request",
    srTypes: [
      "nominee_update", "bank_update", "mobile_update", "email_update", "kyc_update", "minor_to_major",
      "capital_gain_report", "statement_request", "redemption_request", "switch_request",
      "transmission_case", "folio_correction",
    ],
    measure: "sr_within_sla",
  },
  {
    key: "complaints",
    name: "Complaints",
    outcome: "Every complaint is acknowledged at once and resolved within 21 days.",
    defaultOwner: "compliance_officer",
    recipeKeys: ["complaint_sla_breach"],
    ruleModules: ["complaints"],
    blueprintSubject: "complaint",
    measure: "complaint_within_sla",
  },
  {
    key: "insurance_renewal",
    name: "Insurance renewals",
    outcome: "No policy lapses for want of a reminder.",
    defaultOwner: "relationship_manager",
    recipeKeys: ["insurance_premium_reminder", "insurance_lapse_recovery"],
    ruleModules: ["insurance"],
    measure: "renewal_on_time",
  },
  {
    key: "kyc_compliance",
    name: "KYC and compliance hygiene",
    outcome: "KYC, nominee, risk profile and licences never lapse unnoticed.",
    defaultOwner: "compliance_officer",
    recipeKeys: ["kyc_expiry_renew", "nominee_missing", "risk_profile_annual_review", "nism_expiry_alert", "arn_expiry_alert"],
    ruleModules: ["risk_profiles"],
    taskTypes: ["kyc_renewal"],
    measure: "kyc_expiry_cleared",
  },
  {
    key: "rta_reconciliation",
    name: "RTA data and reconciliation",
    outcome: "CAMS / KFintech feeds are imported and reconciled every week.",
    defaultOwner: "operations_executive",
    recipeKeys: ["daily_mis_digest"],
    measure: "rta_import_freshness",
  },
  {
    key: "client_delight",
    name: "Client touchpoints",
    outcome: "Birthdays, anniversaries and milestones are never missed.",
    defaultOwner: "relationship_manager",
    recipeKeys: ["birthday_touchpoint", "investor_anniversary", "aum_milestone_celebrate"],
    measure: "birthday_wished",
  },
];

export const PROCESS_BY_KEY = new Map(PRACTICE_PROCESSES.map((p) => [p.key, p]));

/** A default position and its contract. Firms edit their own copy. */
export type DefaultPosition = {
  key: string;
  title: string;
  purpose: string;
  results: string[];
  approvals: string[];
  /** The CRM roles a holder of this position normally has (to suggest holders). */
  roles: string[];
};

export const DEFAULT_POSITIONS: DefaultPosition[] = [
  {
    key: "owner_director",
    title: "Owner / Director",
    purpose: "Works ON the practice: its direction, its systems and its people.",
    results: [
      "The strategic objective is set and reviewed every quarter.",
      "Every core process is documented, owned, measured and automated where it can be.",
      "Every position has a holder and a contract.",
    ],
    approvals: ["Hire and exit", "Change a service promise", "Merge client records"],
    roles: ["owner"],
  },
  {
    key: "branch_head",
    title: "Branch Head",
    purpose: "Runs a branch so it delivers the firm's promise without the owner.",
    results: ["Branch targets met", "Every client in the branch reviewed on cadence", "No complaint past SLA"],
    approvals: ["Reassign a client between RMs", "Approve leave", "Escalate a complaint"],
    roles: ["branch_head"],
  },
  {
    key: "relationship_manager",
    title: "Relationship Manager",
    purpose: "Owns the relationship with every client in the book.",
    results: [
      "Every client reviewed on the tier's cadence",
      "Every enquiry called within a day",
      "Every large redemption followed up within two days",
    ],
    approvals: ["Share a proposal with a client"],
    roles: ["rm"],
  },
  {
    key: "operations_executive",
    title: "Operations Executive",
    purpose: "Turns a client's instruction into a confirmed transaction, right first time.",
    results: [
      "Transactions executed on the day asked, before cut-off",
      "Onboarding (KYC, UCC, mandate) done within a week",
      "RTA feeds imported and reconciled weekly",
    ],
    approvals: ["Confirm a business entry"],
    roles: ["ops", "back_office"],
  },
  {
    key: "service_desk",
    title: "Service Desk",
    purpose: "Resolves every client request within its SLA.",
    results: ["Requests acknowledged the same day", "Requests resolved within SLA"],
    approvals: [],
    roles: ["ops", "back_office"],
  },
  {
    key: "compliance_officer",
    title: "Compliance Officer",
    purpose: "Keeps the practice audit-ready.",
    results: ["Complaints resolved within 21 days", "No lapsed KYC, licence or risk profile", "DDQ score maintained"],
    approvals: ["Approve a client communication template", "Close a complaint"],
    roles: ["compliance"],
  },
  {
    key: "marketing_executive",
    title: "Marketing Executive",
    purpose: "Brings in enquiries the RMs can convert.",
    results: ["Enquiries per month to target", "Campaigns sent through approved templates"],
    approvals: [],
    roles: ["marketing"],
  },
];

/** Service tiers the CRM knows (investors.service_tier). */
export const SERVICE_TIERS = ["A", "B", "C"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

/** A sensible starting promise per tier; the firm edits its own. */
export const DEFAULT_SERVICE_PROMISES: Record<ServiceTier, {
  reviewEveryDays: number;
  callEveryDays: number;
  statementEveryDays: number;
  birthdayWish: boolean;
  querySlaHours: number;
}> = {
  A: { reviewEveryDays: 90, callEveryDays: 30, statementEveryDays: 30, birthdayWish: true, querySlaHours: 24 },
  B: { reviewEveryDays: 180, callEveryDays: 90, statementEveryDays: 90, birthdayWish: true, querySlaHours: 48 },
  C: { reviewEveryDays: 365, callEveryDays: 180, statementEveryDays: 180, birthdayWish: true, querySlaHours: 72 },
};

/** The four things a process needs, and the weight each carries in the score. */
export const SYSTEM_PILLARS = [
  { key: "documented", label: "Documented", hint: "An SOP says how it is done." },
  { key: "owned", label: "Owned", hint: "A position, not a named person, answers for it." },
  { key: "measured", label: "Measured", hint: "The CRM can tell how well it is done." },
  { key: "automated", label: "Automated", hint: "An automation runs part of it." },
] as const;
export type SystemPillar = (typeof SYSTEM_PILLARS)[number]["key"];
