/**
 * Field catalog — the source of truth for what is queryable on each subject.
 *
 * Every entry declares:
 *  - `key`: how the AST refers to this field
 *  - `label`: shown in the filter builder UI
 *  - `type`: drives the operator menu + value editor
 *  - `sql`: the SQL fragment to use (must be safe — never user-controlled)
 *  - `ops`: allowed operators (defense in depth — compiler also enforces)
 *  - `valueOptions`: for enum types, the dropdown options
 *
 * To add a new queryable field: add a row here. The UI, compiler, and AI
 * assistant pick it up automatically.
 */

import type { FilterOperator } from "./ast";
import { CLIENT_TYPE_KEYS, clientTypeDef } from "@/lib/investors/client-types";

export type FieldType =
  | "string"
  | "integer"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "enum"
  | "multi_enum"
  | "uuid";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Source SQL fragment — referenced unquoted in WHERE clauses. */
  sql: string;
  ops: FilterOperator[];
  enumValues?: string[];
  /** Whether this field can also be used in `update_field` actions. */
  writable?: boolean;
  /** Optional table alias hint for the compiler */
  table?: string;
  /** Help text shown in the UI */
  help?: string;
  /**
   * The value is a team member's NAME (the SQL compares users.name): the filter
   * builder offers a dropdown of the firm's people instead of a text box, so a
   * typed "rajesh chauhan" can never silently match nothing (We Care, 2026-11-20).
   * "user_id": the value is the person's id — the dropdown shows names, stores ids.
   * Shown only where the page asks for it (FilterBuilder teamLookup).
   */
  lookup?: "user" | "user_id";
  /** The NAME of the branch a row belongs to — what the report page's Branch filter matches (2026-11-21). One per subject. */
  branch?: true;
  /** The NAME of the desk a row belongs to (a sub-team inside a branch, e.g. Anand 1) — the Branch picker lists desks too. One per subject. */
  desk?: true;
}

export interface SubjectCatalog {
  subject:
    | "investor"
    | "lead"
    | "task"
    | "folio"
    | "user"
    | "transaction"
    | "sip"
    | "insurance"
    | "goal"
    | "service_request"
    | "claim"
    | "review_meeting"
    | "business_entry"
    | "business_line"
    | "equity_brokerage"
    | "equity_dmat"
    | "new_client"
    | "sip_rejection"
    | "client_gap";
  /** Primary table + alias used in compiled SQL. */
  table: string;
  alias: string;
  fields: FieldDef[];
  relations: Record<
    string,
    {
      // For correlated subqueries (e.g., "investor has transaction in last 30 days")
      table: string;
      alias: string;
      joinSql: string; // "tx.investor_id = inv.id"
      subjectAlias: string; // alias to use inside the subquery for further nesting
    }
  >;
}

const COMMON_NUMBER_OPS: FilterOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "not_between",
  "is_null",
  "is_not_null",
];

const COMMON_STRING_OPS: FilterOperator[] = [
  "eq",
  "ne",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
];

const COMMON_DATE_OPS: FilterOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_null",
  "is_not_null",
  "date_period",
  "date_within",
  "date_before",
  "date_after",
  "date_in_next",
  "date_in_last",
  "date_today",
  "date_yesterday",
  "date_tomorrow",
  "date_is_anniversary",
];

const COMMON_ENUM_OPS: FilterOperator[] = ["eq", "ne", "in", "not_in", "is_null", "is_not_null"];

/** A client's place in a family (We Care, 2026-11-27): the family's head (families.primary_investor_id),
 *  a member, or an individual in no family. The report bar's "Clients" picker filters on it. */
const familyRoleDef = (a: string): FieldDef => ({
  key: "family_role",
  label: "Family role",
  type: "enum",
  sql: `(CASE WHEN ${a}.family_id IS NULL THEN 'individual' WHEN EXISTS (SELECT 1 FROM families f WHERE f.id = ${a}.family_id AND f.primary_investor_id = ${a}.id) THEN 'head' ELSE 'member' END)`,
  ops: COMMON_ENUM_OPS,
  enumValues: ["head", "member", "individual"],
});

export const investorCatalog: SubjectCatalog = {
  subject: "investor",
  table: "investors",
  alias: "inv",
  fields: [
    { key: "name", label: "Name", type: "string", sql: "inv.name", ops: COMMON_STRING_OPS, writable: true },
    { key: "pan", label: "PAN", type: "string", sql: "inv.pan", ops: COMMON_STRING_OPS },
    { key: "email", label: "Email", type: "string", sql: "inv.email", ops: COMMON_STRING_OPS, writable: true },
    { key: "phone", label: "Phone", type: "string", sql: "inv.phone", ops: COMMON_STRING_OPS, writable: true },
    { key: "city", label: "City", type: "string", sql: "(inv.address->>'city')", ops: COMMON_STRING_OPS },
    { key: "state", label: "State", type: "string", sql: "(inv.address->>'state')", ops: COMMON_STRING_OPS },
    { key: "pincode", label: "Pincode", type: "string", sql: "(inv.address->>'pincode')", ops: COMMON_STRING_OPS },

    {
      key: "investor_category",
      label: "Category",
      type: "enum",
      sql: "inv.investor_category",
      ops: COMMON_ENUM_OPS,
      // lib/investors/client-types.ts
      enumValues: ["individual", "nri", "minor", "sole_proprietor", "huf", "company", "llp", "partnership", "trust", "aop_boi", "corporate", "other"],
      writable: true,
    },
    {
      key: "segment_tag",
      label: "Segment",
      type: "enum",
      sql: "inv.segment_tag",
      ops: COMMON_ENUM_OPS,
      enumValues: ["HNI", "Affluent", "Retail", "NRI", "Corporate"],
      writable: true,
    },
    {
      key: "client_category",
      label: "Client Category",
      type: "enum",
      sql: "inv.client_category",
      ops: COMMON_ENUM_OPS,
      enumValues: ["A", "B", "C", "D"],
      writable: true,
      help: "Manually-assigned A/B/C/D client grade.",
    },
    familyRoleDef("inv"),
    {
      key: "status",
      label: "Status",
      type: "enum",
      sql: "inv.status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["active", "dormant", "exited"],
      writable: true,
    },

    { key: "aum", label: "AUM (₹)", type: "currency", sql: "inv.aum", ops: COMMON_NUMBER_OPS },
    { key: "health_score", label: "Health score (0–100)", type: "integer", sql: "inv.health_score", ops: COMMON_NUMBER_OPS },
    {
      key: "health_band",
      label: "Health band",
      type: "enum",
      sql: "inv.health_band",
      ops: COMMON_ENUM_OPS,
      enumValues: ["green", "amber", "red"],
    },
    {
      key: "active_sip_amount",
      label: "Active SIP (₹)",
      type: "currency",
      sql: "inv.active_sip_amount",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "lifetime_inflow",
      label: "Lifetime inflow (₹)",
      type: "currency",
      sql: "inv.lifetime_inflow",
      ops: COMMON_NUMBER_OPS,
    },

    {
      key: "kyc_status",
      label: "KYC status",
      type: "enum",
      sql: "inv.kyc_status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["pending", "verified", "rejected", "expired"],
    },
    { key: "ckyc_expiry_at", label: "CKYC expiry", type: "date", sql: "inv.ckyc_expiry_at", ops: COMMON_DATE_OPS },
    { key: "fatca_expiry_at", label: "FATCA expiry", type: "date", sql: "inv.fatca_expiry_at", ops: COMMON_DATE_OPS },

    {
      key: "risk_profile",
      label: "Risk profile",
      type: "enum",
      sql: "inv.risk_profile",
      ops: COMMON_ENUM_OPS,
      enumValues: ["conservative", "moderate", "aggressive", "very_aggressive"],
    },

    { key: "dob", label: "Date of birth", type: "date", sql: "inv.dob", ops: COMMON_DATE_OPS },
    {
      key: "onboarded_at",
      label: "Onboarded date",
      type: "datetime",
      sql: "inv.onboarded_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_contact_at",
      label: "Last contact",
      type: "datetime",
      sql: "inv.last_contact_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_transaction_at",
      label: "Last transaction",
      type: "datetime",
      sql: "inv.last_transaction_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_review_at",
      label: "Last review meeting",
      type: "datetime",
      sql: "inv.last_review_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "next_review_at",
      label: "Next review meeting",
      type: "datetime",
      sql: "inv.next_review_at",
      ops: COMMON_DATE_OPS,
    },

    { key: "rm_id", label: "Relationship manager", type: "uuid", sql: "inv.rm_id", ops: COMMON_ENUM_OPS, lookup: "user_id" },
    { key: "branch_id", label: "Branch", type: "uuid", sql: "inv.branch_id", ops: COMMON_ENUM_OPS },
    // Names for reports — "clients by RM / by branch" (the ids above stay for filters).
    { key: "rm_name", label: "RM name", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = inv.rm_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "branch_name", label: "Branch name", type: "string", sql: "(SELECT b.name FROM branches b WHERE b.id = inv.branch_id)", ops: COMMON_STRING_OPS, branch: true },

    {
      key: "nominee_name",
      label: "Has nominee",
      type: "string",
      sql: "inv.nominee_name",
      ops: ["is_empty", "is_not_empty", "is_null", "is_not_null"],
    },

    {
      key: "is_minor",
      label: "Is minor",
      type: "boolean",
      sql: "inv.is_minor",
      ops: ["is_true", "is_false"],
    },

    // ============== Computed fields ==============
    {
      key: "days_since_last_contact",
      label: "Days since last contact",
      type: "integer",
      sql: "(now()::date - inv.last_contact_at::date)",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "days_since_last_transaction",
      label: "Days since last transaction",
      type: "integer",
      sql: "(now()::date - inv.last_transaction_at::date)",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "days_to_review",
      label: "Days to next review",
      type: "integer",
      sql: "(inv.next_review_at::date - now()::date)",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "age_years",
      label: "Age (years)",
      type: "integer",
      sql: "(date_part('year', age(inv.dob)))",
      ops: COMMON_NUMBER_OPS,
    },
    {
      key: "has_active_sip",
      label: "Has active SIP",
      type: "boolean",
      sql:
        "(EXISTS (SELECT 1 FROM sips s WHERE s.investor_id = inv.id AND s.tenant_id = inv.tenant_id AND s.status = 'active'))",
      ops: ["is_true", "is_false"],
    },
    {
      key: "has_active_mandate",
      label: "Has active mandate",
      type: "boolean",
      sql:
        "(EXISTS (SELECT 1 FROM mandates m WHERE m.investor_id = inv.id AND m.tenant_id = inv.tenant_id AND m.status = 'active'))",
      ops: ["is_true", "is_false"],
    },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = inv.rm_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {
    transactions: {
      table: "transactions",
      alias: "tx",
      joinSql: "tx.investor_id = inv.id AND tx.tenant_id = inv.tenant_id",
      subjectAlias: "tx",
    },
    sips: {
      table: "sips",
      alias: "s",
      joinSql: "s.investor_id = inv.id AND s.tenant_id = inv.tenant_id",
      subjectAlias: "s",
    },
    folios: {
      table: "folios",
      alias: "f",
      joinSql: "f.investor_id = inv.id AND f.tenant_id = inv.tenant_id",
      subjectAlias: "f",
    },
    goals: {
      table: "goals",
      alias: "g",
      joinSql: "g.investor_id = inv.id AND g.tenant_id = inv.tenant_id",
      subjectAlias: "g",
    },
  },
};

export const leadCatalog: SubjectCatalog = {
  subject: "lead",
  table: "leads",
  alias: "ld",
  fields: [
    { key: "name", label: "Name", type: "string", sql: "ld.name", ops: COMMON_STRING_OPS, writable: true },
    { key: "email", label: "Email", type: "string", sql: "ld.email", ops: COMMON_STRING_OPS, writable: true },
    { key: "phone", label: "Phone", type: "string", sql: "ld.phone", ops: COMMON_STRING_OPS, writable: true },
    {
      key: "stage",
      label: "Stage",
      type: "enum",
      sql: "ld.stage",
      ops: COMMON_ENUM_OPS,
      enumValues: ["new", "contacted", "qualified", "proposal_sent", "converted", "lost", "cold"],
      writable: true,
    },
    {
      key: "source",
      label: "Source",
      type: "enum",
      sql: "ld.source",
      ops: COMMON_ENUM_OPS,
      enumValues: ["website", "referral", "meta_ads", "google_ads", "linkedin", "youtube", "webinar", "event", "walk_in", "manual", "other"],
    },
    { key: "score", label: "Lead score (0–100)", type: "integer", sql: "ld.lead_score", ops: COMMON_NUMBER_OPS },
    {
      key: "score_band",
      label: "Score band",
      type: "enum",
      sql: "ld.score_band",
      ops: COMMON_ENUM_OPS,
      enumValues: ["hot", "warm", "cold"],
    },
    {
      key: "stage_changed_at",
      label: "Stage changed at",
      type: "datetime",
      sql: "ld.stage_changed_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "last_contact_at",
      label: "Last contact",
      type: "datetime",
      sql: "ld.last_contact_at",
      ops: COMMON_DATE_OPS,
    },
    {
      key: "next_follow_up_at",
      label: "Next follow-up",
      type: "datetime",
      sql: "ld.next_follow_up_at",
      ops: COMMON_DATE_OPS,
    },
    { key: "owner_id", label: "Owner", type: "uuid", sql: "ld.owner_id", ops: COMMON_ENUM_OPS, writable: true, lookup: "user_id" },
    {
      key: "days_in_stage",
      label: "Days in current stage",
      type: "integer",
      sql: "(now()::date - ld.stage_changed_at::date)",
      ops: COMMON_NUMBER_OPS,
    },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM users u JOIN branches b ON b.id = u.branch_id WHERE u.id = ld.owner_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = ld.owner_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

export const taskCatalog: SubjectCatalog = {
  subject: "task",
  table: "tasks",
  alias: "tk",
  fields: [
    { key: "title", label: "Title", type: "string", sql: "tk.title", ops: COMMON_STRING_OPS },
    { key: "type", label: "Type", type: "string", sql: "tk.type", ops: COMMON_STRING_OPS },
    {
      key: "status",
      label: "Status",
      type: "enum",
      sql: "tk.status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["open", "in_progress", "blocked", "completed", "cancelled"],
    },
    {
      key: "priority",
      label: "Priority",
      type: "enum",
      sql: "tk.priority",
      ops: COMMON_ENUM_OPS,
      enumValues: ["low", "normal", "high", "urgent"],
    },
    { key: "assignee_id", label: "Assignee", type: "uuid", sql: "tk.assignee_id", ops: COMMON_ENUM_OPS, lookup: "user_id" },
    { key: "due_at", label: "Due date", type: "datetime", sql: "tk.due_at", ops: COMMON_DATE_OPS },
    { key: "sla_due_at", label: "SLA due", type: "datetime", sql: "tk.sla_due_at", ops: COMMON_DATE_OPS },
    {
      key: "days_overdue",
      label: "Days overdue",
      type: "integer",
      sql: "GREATEST(0, (now()::date - tk.due_at::date))",
      ops: COMMON_NUMBER_OPS,
    },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM users u JOIN branches b ON b.id = u.branch_id WHERE u.id = tk.assignee_id)", ops: COMMON_STRING_OPS, branch: true },
    // Zoho Task Tracker's own request fields, kept in tasks.meta by the import (We Care Back Office report, 2026-11-21).
    { key: "request_for", label: "Request for", type: "string", sql: "NULLIF(btrim(tk.meta->>'zohoRequest'), '')", ops: COMMON_STRING_OPS },
    { key: "request_type", label: "Request type", type: "string", sql: "NULLIF(btrim(tk.meta->>'zohoType'), '')", ops: COMMON_STRING_OPS },
    { key: "request_count", label: "Number of (request)", type: "number", sql: "(CASE WHEN tk.meta->>'count' ~ '^[0-9]+([.][0-9]+)?$' THEN (tk.meta->>'count')::numeric END)", ops: COMMON_NUMBER_OPS },
    { key: "created_on", label: "Created on", type: "date", sql: "(tk.created_at AT TIME ZONE 'Asia/Kolkata')::date", ops: COMMON_DATE_OPS },
    { key: "completed_on", label: "Completed on", type: "date", sql: "(tk.completed_at AT TIME ZONE 'Asia/Kolkata')::date", ops: COMMON_DATE_OPS },
    { key: "client_name", label: "Client", type: "string", sql: "(SELECT i.name FROM investors i WHERE i.id = COALESCE(tk.related_investor_id, CASE WHEN tk.subject_type = 'investor' THEN tk.subject_id END))", ops: COMMON_STRING_OPS },
    { key: "client_branch", label: "Client's branch", type: "string", sql: "(SELECT b.name FROM investors i JOIN branches b ON b.id = i.branch_id WHERE i.id = COALESCE(tk.related_investor_id, CASE WHEN tk.subject_type = 'investor' THEN tk.subject_id END))", ops: COMMON_STRING_OPS },
    { key: "raised_by_branch", label: "Raised by — branch", type: "string", sql: "(SELECT b.name FROM users u JOIN branches b ON b.id = u.branch_id WHERE u.id = tk.created_by_id)", ops: COMMON_STRING_OPS },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = tk.assignee_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

export const userCatalog: SubjectCatalog = {
  subject: "user",
  table: "users",
  alias: "usr",
  fields: [
    { key: "name", label: "Name", type: "string", sql: "usr.name", ops: COMMON_STRING_OPS },
    { key: "email", label: "Email", type: "string", sql: "usr.email", ops: COMMON_STRING_OPS },
    {
      key: "status",
      label: "Status",
      type: "enum",
      sql: "usr.status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["invited", "active", "suspended", "offboarding", "offboarded"],
    },
    { key: "nism_expiry_at", label: "NISM expiry", type: "date", sql: "usr.nism_expiry_at", ops: COMMON_DATE_OPS },
    { key: "euin", label: "EUIN", type: "string", sql: "usr.euin", ops: COMMON_STRING_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM branches b WHERE b.id = usr.branch_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM desks d WHERE d.id = usr.desk_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** MF Transactions — purchases, redemptions, switches, SIP debits. */
export const transactionCatalog: SubjectCatalog = {
  subject: "transaction",
  table: "transactions",
  alias: "tx",
  fields: [
    { key: "type", label: "Type", type: "enum", sql: "tx.type", ops: COMMON_ENUM_OPS, enumValues: ["purchase", "redemption", "switch", "sip", "sip_stop", "sip_pause", "stp", "swp", "lumpsum", "dividend_payout", "dividend_reinvest"] },
    { key: "direction", label: "Direction", type: "enum", sql: "tx.direction", ops: COMMON_ENUM_OPS, enumValues: ["inflow", "outflow"] },
    { key: "status", label: "Status", type: "enum", sql: "tx.status", ops: COMMON_ENUM_OPS, enumValues: ["pending", "processed", "rejected", "cancelled", "submitted", "successful", "failed"] },
    { key: "amount", label: "Amount (₹)", type: "currency", sql: "tx.amount", ops: COMMON_NUMBER_OPS },
    { key: "scheme_name", label: "Scheme", type: "string", sql: "tx.scheme_name", ops: COMMON_STRING_OPS },
    { key: "amc_name", label: "AMC", type: "string", sql: "tx.amc_name", ops: COMMON_STRING_OPS },
    { key: "scheme_category", label: "Scheme category", type: "string", sql: "tx.scheme_category", ops: COMMON_STRING_OPS },
    { key: "order_date", label: "Order date", type: "date", sql: "tx.order_date", ops: COMMON_DATE_OPS },
    { key: "exchange", label: "Exchange", type: "enum", sql: "tx.exchange", ops: COMMON_ENUM_OPS, enumValues: ["BSE", "NSE", "MFU", "DIRECT"] },
    { key: "source_feed", label: "Source", type: "enum", sql: "tx.source_feed", ops: COMMON_ENUM_OPS, enumValues: ["manual", "cams", "kfintech", "nse", "mfu", "other", "bse", "import"] },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "tx.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "tx.created_at", ops: COMMON_DATE_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM investors i JOIN branches b ON b.id = i.branch_id WHERE i.id = tx.investor_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM investors i JOIN users u ON u.id = i.rm_id JOIN desks d ON d.id = u.desk_id WHERE i.id = tx.investor_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** SIP book — recurring mandates. */
export const sipCatalog: SubjectCatalog = {
  subject: "sip",
  table: "sips",
  alias: "s",
  fields: [
    { key: "scheme_name", label: "Scheme", type: "string", sql: "s.scheme_name", ops: COMMON_STRING_OPS },
    { key: "amc_name", label: "AMC", type: "string", sql: "s.amc_name", ops: COMMON_STRING_OPS },
    { key: "amount", label: "Amount (₹)", type: "currency", sql: "s.amount", ops: COMMON_NUMBER_OPS },
    { key: "frequency", label: "Frequency", type: "enum", sql: "s.frequency", ops: COMMON_ENUM_OPS, enumValues: ["monthly", "quarterly", "weekly", "fortnightly", "yearly"] },
    { key: "status", label: "Status", type: "enum", sql: "s.status", ops: COMMON_ENUM_OPS, enumValues: ["active", "paused", "stopped", "rejected", "completed", "pending", "expired"] },
    { key: "start_date", label: "Start date", type: "date", sql: "s.start_date", ops: COMMON_DATE_OPS },
    { key: "end_date", label: "End date", type: "date", sql: "s.end_date", ops: COMMON_DATE_OPS },
    { key: "next_installment_at", label: "Next due", type: "date", sql: "s.next_installment_at", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "s.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "s.created_at", ops: COMMON_DATE_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM investors i JOIN branches b ON b.id = i.branch_id WHERE i.id = s.investor_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM investors i JOIN users u ON u.id = i.rm_id JOIN desks d ON d.id = u.desk_id WHERE i.id = s.investor_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** Insurance policies. */
export const insuranceCatalog: SubjectCatalog = {
  subject: "insurance",
  table: "insurance_policies",
  alias: "ip",
  fields: [
    { key: "insurer", label: "Insurer", type: "string", sql: "ip.insurer", ops: COMMON_STRING_OPS },
    { key: "plan_name", label: "Plan", type: "string", sql: "ip.plan_name", ops: COMMON_STRING_OPS },
    { key: "policy_type", label: "Policy type", type: "enum", sql: "ip.policy_type", ops: COMMON_ENUM_OPS, enumValues: ["term", "ulip", "endowment", "money_back", "health", "critical_illness", "personal_accident", "motor", "travel", "home", "life_other", "general_other"] },
    { key: "status", label: "Status", type: "enum", sql: "ip.status", ops: COMMON_ENUM_OPS, enumValues: ["proposed", "in_underwriting", "active", "lapsed", "matured", "surrendered", "cancelled", "claim_filed", "claim_settled"] },
    { key: "sum_assured", label: "Sum assured (₹)", type: "currency", sql: "ip.sum_assured", ops: COMMON_NUMBER_OPS },
    { key: "annual_premium", label: "Annual premium (₹)", type: "currency", sql: "ip.annual_premium", ops: COMMON_NUMBER_OPS },
    { key: "premium_frequency", label: "Premium frequency", type: "enum", sql: "ip.premium_frequency", ops: COMMON_ENUM_OPS, enumValues: ["single", "annual", "semi_annual", "quarterly", "monthly"] },
    { key: "policy_start_date", label: "Start date", type: "date", sql: "ip.policy_start_date", ops: COMMON_DATE_OPS },
    { key: "maturity_date", label: "Maturity", type: "date", sql: "ip.maturity_date", ops: COMMON_DATE_OPS },
    { key: "next_premium_due_date", label: "Next premium due", type: "date", sql: "ip.next_premium_due_date", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "ip.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "ip.created_at", ops: COMMON_DATE_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM investors i JOIN branches b ON b.id = i.branch_id WHERE i.id = ip.investor_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM investors i JOIN users u ON u.id = i.rm_id JOIN desks d ON d.id = u.desk_id WHERE i.id = ip.investor_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** Financial goals. */
export const goalCatalog: SubjectCatalog = {
  subject: "goal",
  table: "goals",
  alias: "g",
  fields: [
    { key: "name", label: "Goal", type: "string", sql: "g.name", ops: COMMON_STRING_OPS },
    { key: "category", label: "Category", type: "enum", sql: "g.category", ops: COMMON_ENUM_OPS, enumValues: ["retirement", "child_education", "child_marriage", "house", "car", "vacation", "emergency_fund", "wealth_creation", "other"] },
    { key: "status", label: "Status", type: "enum", sql: "g.status", ops: COMMON_ENUM_OPS, enumValues: ["not_started", "on_track", "behind_track", "achieved", "active", "on_hold", "abandoned"] },
    { key: "target_amount", label: "Target (₹)", type: "currency", sql: "g.target_amount", ops: COMMON_NUMBER_OPS },
    { key: "current_value", label: "Current value (₹)", type: "currency", sql: "g.current_value", ops: COMMON_NUMBER_OPS },
    { key: "progress_pct", label: "Progress %", type: "number", sql: "g.progress_pct", ops: COMMON_NUMBER_OPS },
    { key: "target_date", label: "Target date", type: "date", sql: "g.target_date", ops: COMMON_DATE_OPS },
    { key: "next_review_at", label: "Next review", type: "datetime", sql: "g.next_review_at", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "g.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "g.created_at", ops: COMMON_DATE_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM investors i JOIN branches b ON b.id = i.branch_id WHERE i.id = g.investor_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM investors i JOIN users u ON u.id = i.rm_id JOIN desks d ON d.id = u.desk_id WHERE i.id = g.investor_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** Service requests / complaints. */
export const serviceRequestCatalog: SubjectCatalog = {
  subject: "service_request",
  table: "service_requests",
  alias: "sr",
  fields: [
    { key: "ticket_no", label: "Ticket #", type: "string", sql: "sr.ticket_no", ops: COMMON_STRING_OPS },
    { key: "subject", label: "Subject", type: "string", sql: "sr.subject", ops: COMMON_STRING_OPS },
    { key: "type", label: "Type", type: "enum", sql: "sr.type", ops: COMMON_ENUM_OPS, enumValues: ["nominee_update", "bank_update", "mobile_update", "email_update", "kyc_update", "minor_to_major", "capital_gain_report", "statement_request", "redemption_request", "switch_request", "transmission_case", "folio_correction", "complaint", "other"] },
    { key: "status", label: "Status", type: "enum", sql: "sr.status", ops: COMMON_ENUM_OPS, enumValues: ["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"] },
    { key: "priority", label: "Priority", type: "enum", sql: "sr.priority", ops: COMMON_ENUM_OPS, enumValues: ["low", "normal", "high", "urgent"] },
    { key: "channel", label: "Channel", type: "enum", sql: "sr.channel", ops: COMMON_ENUM_OPS, enumValues: ["whatsapp", "email", "phone", "in_person", "form"] },
    { key: "resolved_at", label: "Resolved at", type: "datetime", sql: "sr.resolved_at", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "sr.investor_id", ops: COMMON_ENUM_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "sr.created_at", ops: COMMON_DATE_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM investors i JOIN branches b ON b.id = i.branch_id WHERE i.id = sr.investor_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM investors i JOIN users u ON u.id = i.rm_id JOIN desks d ON d.id = u.desk_id WHERE i.id = sr.investor_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** Insurance claims — claim lifecycle + amounts. */
export const claimCatalog: SubjectCatalog = {
  subject: "claim",
  table: "insurance_claims",
  alias: "icl",
  fields: [
    { key: "proposer_name", label: "Proposer", type: "string", sql: "icl.proposer_name", ops: COMMON_STRING_OPS },
    { key: "insurer", label: "Insurer", type: "string", sql: "icl.insurer", ops: COMMON_STRING_OPS },
    { key: "policy_number", label: "Policy number", type: "string", sql: "icl.policy_number", ops: COMMON_STRING_OPS },
    { key: "claim_status", label: "Claim status", type: "enum", sql: "icl.claim_status", ops: COMMON_ENUM_OPS, enumValues: ["empty", "claim_intimated", "file_awaited", "file_received", "add_info_awaited", "query", "query_replied", "under_process", "settled_fully", "settled_partially", "rejected", "withdrawn"] },
    { key: "claim_type", label: "Claim type", type: "enum", sql: "icl.claim_type", ops: COMMON_ENUM_OPS, enumValues: ["main_claim", "supplementary", "pre_authorization", "rider", "other"] },
    { key: "claim_mode", label: "Claim mode", type: "enum", sql: "icl.claim_mode", ops: COMMON_ENUM_OPS, enumValues: ["cashless", "reimbursement"] },
    { key: "claimed_amount", label: "Claimed (₹)", type: "currency", sql: "icl.claimed_amount", ops: COMMON_NUMBER_OPS },
    { key: "settled_amount", label: "Settled (₹)", type: "currency", sql: "icl.settled_amount", ops: COMMON_NUMBER_OPS },
    { key: "intimation_date", label: "Intimation date", type: "date", sql: "icl.intimation_date", ops: COMMON_DATE_OPS },
    { key: "submission_date", label: "Submission date", type: "date", sql: "icl.submission_date", ops: COMMON_DATE_OPS },
    { key: "settlement_date", label: "Settlement date", type: "date", sql: "icl.settlement_date", ops: COMMON_DATE_OPS },
    { key: "investor_id", label: "Client (id)", type: "uuid", sql: "icl.investor_id", ops: COMMON_ENUM_OPS },
    { key: "rm_id", label: "RM (id)", type: "uuid", sql: "icl.rm_id", ops: COMMON_ENUM_OPS, lookup: "user_id" },
    { key: "created_at", label: "Created", type: "datetime", sql: "icl.created_at", ops: COMMON_DATE_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM investors i JOIN branches b ON b.id = i.branch_id WHERE i.id = icl.investor_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM investors i JOIN users u ON u.id = i.rm_id JOIN desks d ON d.id = u.desk_id WHERE i.id = icl.investor_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** Review meetings — Module 12. rm_name is a correlated lookup so charts can
 *  group by the RM by NAME (not a raw uuid). */
export const reviewMeetingCatalog: SubjectCatalog = {
  subject: "review_meeting",
  table: "review_meetings",
  alias: "mtg",
  fields: [
    { key: "category", label: "Category", type: "enum", sql: "mtg.category", ops: COMMON_ENUM_OPS, enumValues: ["review", "new", "follow_up"] },
    { key: "meeting_type", label: "Agenda / type", type: "enum", sql: "mtg.meeting_type", ops: COMMON_ENUM_OPS },
    { key: "meeting_mode", label: "Mode", type: "enum", sql: "mtg.meeting_mode", ops: COMMON_ENUM_OPS, enumValues: ["office", "client_place", "online", "phone"] },
    { key: "status", label: "Status", type: "enum", sql: "mtg.status", ops: COMMON_ENUM_OPS, enumValues: ["scheduled", "confirmed", "in_progress", "completed", "rescheduled", "cancelled", "no_show"] },
    { key: "outcome", label: "Outcome", type: "enum", sql: "mtg.outcome", ops: COMMON_ENUM_OPS },
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = mtg.rm_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "rm_id", label: "RM (id)", type: "uuid", sql: "mtg.rm_id", ops: COMMON_ENUM_OPS, lookup: "user_id" },
    { key: "client_name", label: "Client / lead", type: "string", sql: "COALESCE((SELECT i.name FROM investors i WHERE i.id = mtg.investor_id), (SELECT l.name FROM leads l WHERE l.id = mtg.lead_id))", ops: COMMON_STRING_OPS },
    { key: "meeting_kind", label: "Meeting type (New / Existing)", type: "string", sql: "(CASE mtg.category WHEN 'new' THEN 'New' WHEN 'review' THEN 'Existing' ELSE 'Follow-up' END)", ops: COMMON_STRING_OPS },
    { key: "title", label: "Title", type: "string", sql: "mtg.subject", ops: COMMON_STRING_OPS },
    { key: "description", label: "Description", type: "string", sql: "mtg.discussion_points", ops: COMMON_STRING_OPS },
    { key: "meeting_date", label: "Meeting date", type: "datetime", sql: "mtg.meeting_date", ops: COMMON_DATE_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "mtg.created_at", ops: COMMON_DATE_OPS },
    { key: "reschedule_count", label: "Reschedules", type: "integer", sql: "mtg.reschedule_count", ops: COMMON_NUMBER_OPS },
    { key: "duration_minutes", label: "Duration (min)", type: "integer", sql: "NULLIF(regexp_replace(COALESCE(mtg.duration_minutes,''), '[^0-9]', '', 'g'), '')::int", ops: COMMON_NUMBER_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM users u JOIN branches b ON b.id = u.branch_id WHERE u.id = mtg.rm_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = mtg.rm_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** Business Closing Entries — Module: business booked. total_amount is the headline
 *  measure (sum business by RM / month / product). */
export const businessEntryCatalog: SubjectCatalog = {
  subject: "business_entry",
  table: "business_entries",
  alias: "bze",
  fields: [
    { key: "product_type", label: "Product", type: "enum", sql: "bze.product_type", ops: COMMON_ENUM_OPS, enumValues: ["mutual_fund", "pms", "aif", "sif", "bond", "ncd", "other"] },
    { key: "status", label: "Status", type: "enum", sql: "bze.status", ops: COMMON_ENUM_OPS, enumValues: ["draft", "confirmed", "emailed", "cancelled"] },
    { key: "client_name", label: "Client", type: "string", sql: "bze.client_name", ops: COMMON_STRING_OPS },
    { key: "amc_name", label: "AMC", type: "string", sql: "bze.amc_name", ops: COMMON_STRING_OPS },
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = bze.rm_id)", ops: COMMON_STRING_OPS },
    { key: "rm_id", label: "RM (id)", type: "uuid", sql: "bze.rm_id", ops: COMMON_ENUM_OPS, lookup: "user_id" },
    { key: "business_date", label: "Business date", type: "date", sql: "bze.business_date", ops: COMMON_DATE_OPS },
    { key: "created_at", label: "Created", type: "datetime", sql: "bze.created_at", ops: COMMON_DATE_OPS },
    { key: "total_amount", label: "Total business (₹)", type: "currency", sql: "bze.total_amount", ops: COMMON_NUMBER_OPS },
    { key: "liquid_net", label: "Liquid net (₹)", type: "currency", sql: "bze.liquid_net", ops: COMMON_NUMBER_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM users u JOIN branches b ON b.id = u.branch_id WHERE u.id = bze.rm_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = bze.rm_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/** Business Entry LINES — one row per scheme line, with its entry's facts
 *  (owner, client, date). Zoho report parity for We Care (2026-11-19): a Zoho
 *  MF Transaction report filters and sums the Purchase / Redemption subform
 *  lines. The associate and the Zoho MFT number live in the entry's notes. */
export const businessLineCatalog: SubjectCatalog = {
  subject: "business_line",
  table: "business_entry_lines",
  alias: "bl",
  fields: [
    { key: "owner_name", label: "Owner / RM", type: "string", sql: "(SELECT u.name FROM business_entries e JOIN users u ON u.id = e.rm_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "associate", label: "Associate", type: "string", sql: "(SELECT NULLIF(btrim(substring(e.notes from 'Associate: ([^·]+)')), '') FROM business_entries e WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    { key: "client_name", label: "Client", type: "string", sql: "(SELECT e.client_name FROM business_entries e WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    // Zoho's "Contact Owner": the CLIENT's RM, which can differ from the transaction's owner (Redemption Done By Client report, 2026-11-20).
    { key: "client_rm", label: "Contact Owner (client's RM)", type: "string", sql: "(SELECT u.name FROM business_entries e JOIN investors i ON i.id = e.investor_id JOIN users u ON u.id = i.rm_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "entry_ref", label: "Zoho MF Transaction", type: "string", sql: "(SELECT substring(e.notes from 'Zoho (MFT[^ ·]*)') FROM business_entries e WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    { key: "business_date", label: "Date", type: "date", sql: "(SELECT e.business_date FROM business_entries e WHERE e.id = bl.entry_id)", ops: COMMON_DATE_OPS },
    { key: "entry_status", label: "Entry status", type: "enum", sql: "(SELECT e.status FROM business_entries e WHERE e.id = bl.entry_id)", ops: COMMON_ENUM_OPS, enumValues: ["draft", "confirmed", "emailed", "cancelled"] },
    { key: "product_type", label: "Product", type: "enum", sql: "(SELECT e.product_type FROM business_entries e WHERE e.id = bl.entry_id)", ops: COMMON_ENUM_OPS, enumValues: ["mutual_fund", "direct_equity", "pms", "aif", "sif", "bond", "ncd", "p2p", "las", "other"] },
    { key: "scheme_name", label: "Scheme", type: "string", sql: "bl.scheme_name", ops: COMMON_STRING_OPS },
    { key: "amc_name", label: "AMC", type: "string", sql: "bl.amc_name", ops: COMMON_STRING_OPS },
    { key: "txn_type", label: "Transaction", type: "enum", sql: "bl.txn_type", ops: COMMON_ENUM_OPS, enumValues: ["sip", "sip_topup", "sip_stop", "lumpsum", "additional_purchase", "switch", "stp", "swp", "redemption", "other"] },
    // Zoho's own Type when the line came from Zoho (migration 0276), else the asset class.
    { key: "asset_type", label: "Type (as in Zoho)", type: "string", sql: "COALESCE(bl.source_type, (CASE bl.asset_class WHEN 'liquid' THEN 'Liquid' WHEN 'equity' THEN 'Equity' WHEN 'debt' THEN 'Debt' WHEN 'hybrid' THEN 'Hybrid' WHEN 'gold' THEN 'Gold' ELSE 'Other' END))", ops: COMMON_STRING_OPS },
    { key: "kind", label: "Purchase / Redemption", type: "string", sql: "COALESCE(bl.source_kind, NULLIF(regexp_replace(COALESCE(bl.type_label, ''), ' [(]rejected[)]$', ''), ''), (CASE bl.txn_type WHEN 'lumpsum' THEN 'Purchase' WHEN 'additional_purchase' THEN 'Purchase' WHEN 'redemption' THEN 'Redemption' WHEN 'switch' THEN 'Switch' WHEN 'stp' THEN 'STP' WHEN 'swp' THEN 'SWP' WHEN 'sip' THEN 'SIP' WHEN 'sip_topup' THEN 'SIP top-up' WHEN 'sip_stop' THEN 'SIP Stop' ELSE 'Other' END))", ops: COMMON_STRING_OPS },
    { key: "rejected", label: "Rejected", type: "string", sql: "(CASE WHEN bl.type_label LIKE '%(rejected)' THEN 'Yes' ELSE 'No' END)", ops: COMMON_STRING_OPS },
    { key: "purchase_amount", label: "Purchase amount (₹)", type: "currency", sql: "(CASE WHEN bl.txn_type IN ('lumpsum', 'additional_purchase', 'switch', 'stp') THEN bl.amount ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "redemption_amount", label: "Redemption amount (₹)", type: "currency", sql: "(CASE WHEN bl.txn_type IN ('redemption', 'swp') THEN bl.amount ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "net_purchase", label: "Net purchase (₹)", type: "currency", sql: "(CASE WHEN bl.txn_type IN ('lumpsum', 'additional_purchase', 'switch', 'stp') THEN bl.amount WHEN bl.txn_type IN ('redemption', 'swp') THEN -bl.amount ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "sip_amount", label: "SIP amount (₹)", type: "currency", sql: "(CASE WHEN bl.txn_type IN ('sip', 'sip_topup') THEN bl.amount ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "sip_stop_amount", label: "SIP stop amount (₹)", type: "currency", sql: "(CASE WHEN bl.txn_type = 'sip_stop' THEN bl.amount ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "net_sip", label: "Net SIP (₹)", type: "currency", sql: "(CASE WHEN bl.txn_type IN ('sip', 'sip_topup') THEN bl.amount WHEN bl.txn_type = 'sip_stop' THEN -bl.amount ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    // Where the entry was first written: Zoho's MF Transaction module, Zoho's
    // old Mutual Fund module (MFT-OLD-…), another Zoho module, or the CRM.
    { key: "entry_source", label: "Recorded in", type: "string", sql: "(SELECT CASE WHEN e.notes ~ '^Zoho MFT-OLD-' THEN 'Zoho Mutual Fund (old module)' WHEN e.notes ~ '^Zoho MFT[0-9]' THEN 'Zoho MF Transaction' WHEN e.notes ~ '^Zoho ' THEN 'Zoho (other module)' ELSE 'CRM' END FROM business_entries e WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    { key: "amount", label: "Amount (₹)", type: "currency", sql: "bl.amount", ops: COMMON_NUMBER_OPS },
    // We Care plants a tree for every ₹10,000 of a single fresh SIP (2026-11-19):
    // each SIP on its own, never added together; not top-ups, Daily SIPs,
    // stops or rejected lines (a rejected line is txn_type other).
    { key: "trees", label: "Trees (1 per ₹10,000 SIP)", type: "number", sql: "(CASE WHEN bl.txn_type = 'sip' AND COALESCE(bl.type_label, '') !~* 'daily' THEN FLOOR(bl.amount / 10000)::int ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "client_pan", label: "Client PAN", type: "string", sql: "(SELECT i.pan FROM business_entries e JOIN investors i ON i.id = e.investor_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    { key: "client_phone", label: "Client phone", type: "string", sql: "(SELECT i.phone FROM business_entries e JOIN investors i ON i.id = e.investor_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    { key: "client_email", label: "Client email", type: "string", sql: "(SELECT i.email FROM business_entries e JOIN investors i ON i.id = e.investor_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    { key: "client_city", label: "Client city", type: "string", sql: "(SELECT i.address->>'city' FROM business_entries e JOIN investors i ON i.id = e.investor_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM business_entries e JOIN users u ON u.id = e.rm_id JOIN branches b ON b.id = u.branch_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM business_entries e JOIN users u ON u.id = e.rm_id JOIN desks d ON d.id = u.desk_id WHERE e.id = bl.entry_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/**
 * Monthly equity brokerage — one row per firm per month ('YYYY-MM'), the figure
 * the Equity Team MIS reads; We Care's Zoho "Equity" module lands here
 * (2026-11-20, Equity Brokerage MoM report). Report-only, behind zohoImport.
 */
export const equityBrokerageCatalog: SubjectCatalog = {
  subject: "equity_brokerage",
  table: "equity_brokerage",
  alias: "ebk",
  fields: [
    { key: "month", label: "Month", type: "date", sql: "to_date(ebk.period || '-01', 'YYYY-MM-DD')", ops: COMMON_DATE_OPS },
    { key: "brokerage", label: "Brokerage (₹)", type: "currency", sql: "ebk.amount", ops: COMMON_NUMBER_OPS },
    { key: "trading_days", label: "Trading days", type: "integer", sql: "(substring(ebk.notes from '([0-9]+) days?'))::int", ops: COMMON_NUMBER_OPS },
    { key: "notes", label: "Notes", type: "string", sql: "ebk.notes", ops: COMMON_STRING_OPS },
  ],
  relations: {},
};

/** DMAT accounts the equity desk opened (equity_dmat_accounts) — New DMAT MoM (2026-11-20). */
export const equityDmatCatalog: SubjectCatalog = {
  subject: "equity_dmat",
  table: "equity_dmat_accounts",
  alias: "edm",
  fields: [
    { key: "opened_date", label: "Opened on", type: "date", sql: "edm.opened_date", ops: COMMON_DATE_OPS },
    { key: "client_name", label: "Client", type: "string", sql: "edm.client_name", ops: COMMON_STRING_OPS },
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = edm.rm_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "broker", label: "Broker / DP", type: "string", sql: "edm.broker", ops: COMMON_STRING_OPS },
    { key: "dmat_number", label: "DP ID / Client ID", type: "string", sql: "edm.dmat_number", ops: COMMON_STRING_OPS },
    { key: "status", label: "Status", type: "enum", sql: "edm.status", ops: COMMON_ENUM_OPS, enumValues: ["active", "dormant", "closed"] },
    { key: "closed_date", label: "Closed on", type: "date", sql: "edm.closed_date", ops: COMMON_DATE_OPS },
    { key: "is_client", label: "CRM client", type: "string", sql: "(CASE WHEN edm.investor_id IS NULL THEN 'No' ELSE 'Yes' END)", ops: COMMON_STRING_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM users u JOIN branches b ON b.id = u.branch_id WHERE u.id = edm.rm_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = edm.rm_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/**
 * New clients (We Care, 2026-11-20 — the firm's monthly "new clients added" sheet):
 * one row per client, dated by onboarded_at, with where they came from and the
 * business booked IN THEIR ONBOARDING MONTH (India time). "From whom" is the
 * referring client when Zoho named one, else the Zoho Lead Source (SELF, Family
 * Member, Client Referrals …). Rejected lines are txn_type other, so they never count.
 */
export const newClientCatalog: SubjectCatalog = {
  subject: "new_client",
  table: "investors",
  alias: "nci",
  fields: [
    { key: "onboarded_at", label: "Onboarded on", type: "date", sql: "(nci.onboarded_at AT TIME ZONE 'Asia/Kolkata')::date", ops: COMMON_DATE_OPS },
    { key: "client_name", label: "Client", type: "string", sql: "nci.name", ops: COMMON_STRING_OPS },
    familyRoleDef("nci"),
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = nci.rm_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "source", label: "Source", type: "string", sql: "NULLIF(btrim(nci.custom_fields->>'cf_zoho_lead_source'), '')", ops: COMMON_STRING_OPS },
    { key: "referred_by", label: "Referred by (client)", type: "string", sql: "NULLIF(btrim(nci.referral_client_name), '')", ops: COMMON_STRING_OPS },
    { key: "from_whom", label: "From whom", type: "string", sql: "COALESCE(NULLIF(btrim(nci.referral_client_name), ''), NULLIF(btrim(nci.custom_fields->>'cf_zoho_lead_source'), ''))", ops: COMMON_STRING_OPS },
    { key: "sip_first_month", label: "SIP (onboarding month)", type: "currency", sql: "(SELECT COALESCE(SUM(l.amount), 0) FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id WHERE e.investor_id = nci.id AND e.status <> 'cancelled' AND l.txn_type IN ('sip', 'sip_topup') AND to_char(e.business_date, 'YYYY-MM') = to_char(nci.onboarded_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))", ops: COMMON_NUMBER_OPS },
    { key: "lumpsum_first_month", label: "Lumpsum (onboarding month)", type: "currency", sql: "(SELECT COALESCE(SUM(l.amount), 0) FROM business_entry_lines l JOIN business_entries e ON e.id = l.entry_id WHERE e.investor_id = nci.id AND e.status <> 'cancelled' AND l.txn_type IN ('lumpsum', 'additional_purchase', 'switch', 'stp') AND to_char(e.business_date, 'YYYY-MM') = to_char(nci.onboarded_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))", ops: COMMON_NUMBER_OPS },
    { key: "insurance_first_month", label: "Insurance premium (onboarding month)", type: "currency", sql: "(SELECT COALESCE(SUM(p.annual_premium), 0) FROM insurance_policies p WHERE p.investor_id = nci.id AND p.status NOT IN ('cancelled', 'proposed') AND to_char(COALESCE(p.risk_cover_start_date, p.policy_start_date), 'YYYY-MM') = to_char(nci.onboarded_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))", ops: COMMON_NUMBER_OPS },
    { key: "client_status", label: "Client status", type: "string", sql: "(CASE WHEN nci.deleted_at IS NOT NULL OR nci.merged_into_id IS NOT NULL THEN 'removed' ELSE nci.status END)", ops: COMMON_STRING_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM branches b WHERE b.id = nci.branch_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = nci.rm_id)", ops: COMMON_STRING_OPS, desk: true },
  ],
  relations: {},
};

/**
 * SIP rejections (We Care, 2026-11-20 — the firm's "SIP Rejection, Pending &
 * Repurchase" sheet). One row per rejected debit; "Add. purchase" = recovered
 * (Zoho "Purchase done"), pending = everything else. Branch and desk are the
 * responsible RM's (users.branch_id / desk_id), as the sheet groups them.
 */
export const sipRejectionCatalog: SubjectCatalog = {
  subject: "sip_rejection",
  table: "sip_rejections",
  alias: "srj",
  fields: [
    { key: "rejection_date", label: "Rejection date", type: "date", sql: "srj.rejection_date", ops: COMMON_DATE_OPS },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM users u JOIN branches b ON b.id = u.branch_id WHERE u.id = srj.assigned_rm_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = srj.assigned_rm_id)", ops: COMMON_STRING_OPS, desk: true },
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = srj.assigned_rm_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "client_name", label: "Client", type: "string", sql: "(SELECT i.name FROM investors i WHERE i.id = srj.investor_id)", ops: COMMON_STRING_OPS },
    { key: "scheme_name", label: "Scheme", type: "string", sql: "srj.scheme_name", ops: COMMON_STRING_OPS },
    { key: "status", label: "Status", type: "enum", sql: "srj.recovery_status", ops: COMMON_ENUM_OPS, enumValues: ["pending", "client_contacted", "bank_issue", "mandate_issue", "reprocessed", "recovered", "not_recoverable"] },
    { key: "rejection_amount", label: "Rejection value (₹)", type: "currency", sql: "srj.rejection_amount", ops: COMMON_NUMBER_OPS },
    { key: "purchase_done_amount", label: "Add. purchase value (₹)", type: "currency", sql: "(CASE WHEN srj.recovery_status = 'recovered' THEN srj.rejection_amount ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "purchase_done_count", label: "Add. purchase no.", type: "integer", sql: "(CASE WHEN srj.recovery_status = 'recovered' THEN 1 ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "pending_amount", label: "Pending value (₹)", type: "currency", sql: "(CASE WHEN srj.recovery_status = 'recovered' THEN 0 ELSE srj.rejection_amount END)", ops: COMMON_NUMBER_OPS },
    { key: "pending_count", label: "Pending no.", type: "integer", sql: "(CASE WHEN srj.recovery_status = 'recovered' THEN 0 ELSE 1 END)", ops: COMMON_NUMBER_OPS },
    { key: "without_remarks", label: "Without remarks", type: "integer", sql: "(CASE WHEN COALESCE(btrim(srj.remarks), '') = '' THEN 1 ELSE 0 END)", ops: COMMON_NUMBER_OPS },
    { key: "remarks", label: "Remarks", type: "string", sql: "srj.remarks", ops: COMMON_STRING_OPS },
    { key: "reason", label: "Reason", type: "string", sql: "srj.rejection_reason", ops: COMMON_STRING_OPS },
    { key: "source", label: "Recorded from", type: "string", sql: "(CASE WHEN srj.dedup_key LIKE 'zoho-sr:%' THEN 'Zoho SIP Reject' WHEN srj.dedup_key LIKE 'zoho:%' THEN 'Zoho SIP Tracking' ELSE 'RTA / CRM' END)", ops: COMMON_STRING_OPS },
  ],
  relations: {},
};

/*
 * Client data gaps (We Care, 2026-11-21 — the firm's "Data Update" sheet): one row
 * per client, with a 1/0 counter per missing field, summed by RM. Each counter
 * follows the client type exactly as lib/investors/type-rules.ts does (a company
 * has no date of birth; profession, company and Aadhaar are an adult
 * individual's) — built from the same client-type list, never a copied enum.
 */
const sqlList = (keys: readonly string[]) => keys.map((k) => `'${k}'`).join(", ");
const GAP_PERSON = sqlList(CLIENT_TYPE_KEYS.filter((k) => clientTypeDef(k).kind === "person"));
const GAP_DOB = sqlList(CLIENT_TYPE_KEYS.filter((k) => ["person", "minor"].includes(clientTypeDef(k).kind)));
const gapType = (list: string) => `COALESCE(cg.investor_category, 'individual') IN (${list})`;
const gap = (cond: string) => `(CASE WHEN ${cond} THEN 1 ELSE 0 END)`;
const blank = (col: string) => `COALESCE(btrim(${col}), '') = ''`;

export const clientGapCatalog: SubjectCatalog = {
  subject: "client_gap",
  table: "investors",
  alias: "cg",
  fields: [
    { key: "client_name", label: "Client", type: "string", sql: "cg.name", ops: COMMON_STRING_OPS },
    familyRoleDef("cg"),
    { key: "rm_name", label: "RM", type: "string", sql: "(SELECT u.name FROM users u WHERE u.id = cg.rm_id)", ops: COMMON_STRING_OPS, lookup: "user" },
    { key: "desk_name", label: "Desk", type: "string", sql: "(SELECT d.name FROM users u JOIN desks d ON d.id = u.desk_id WHERE u.id = cg.rm_id)", ops: COMMON_STRING_OPS, desk: true },
    { key: "branch_name", label: "Branch", type: "string", sql: "(SELECT b.name FROM branches b WHERE b.id = cg.branch_id)", ops: COMMON_STRING_OPS, branch: true },
    { key: "live", label: "Live client", type: "string", sql: "(CASE WHEN cg.deleted_at IS NULL AND cg.merged_into_id IS NULL AND COALESCE(cg.status, 'active') NOT IN ('exited', 'closed') THEN 'Yes' ELSE 'No' END)", ops: COMMON_STRING_OPS },
    { key: "onboarded_at", label: "Onboarded on", type: "date", sql: "(cg.onboarded_at AT TIME ZONE 'Asia/Kolkata')::date", ops: COMMON_DATE_OPS },
    { key: "missing_pan", label: "PAN pending", type: "integer", sql: gap(`${blank("cg.pan")} OR cg.pan LIKE 'NOPAN:%'`), ops: COMMON_NUMBER_OPS },
    { key: "missing_mobile", label: "Mobile pending", type: "integer", sql: gap(blank("cg.phone")), ops: COMMON_NUMBER_OPS },
    { key: "missing_email", label: "Email pending", type: "integer", sql: gap(blank("cg.email")), ops: COMMON_NUMBER_OPS },
    { key: "missing_category", label: "Category pending", type: "integer", sql: gap("cg.client_category IS NULL"), ops: COMMON_NUMBER_OPS },
    { key: "missing_address", label: "Address pending", type: "integer", sql: gap(`${blank("cg.address->>'line1'")} AND ${blank("cg.address->>'city'")}`), ops: COMMON_NUMBER_OPS },
    { key: "missing_aadhaar", label: "Aadhaar pending", type: "integer", sql: gap(`${gapType(GAP_PERSON)} AND ${blank("cg.aadhaar_last4")}`), ops: COMMON_NUMBER_OPS },
    { key: "missing_dob", label: "Date of birth pending", type: "integer", sql: gap(`${gapType(GAP_DOB)} AND cg.dob IS NULL`), ops: COMMON_NUMBER_OPS },
    { key: "missing_profession", label: "Profession pending", type: "integer", sql: gap(`${gapType(GAP_PERSON)} AND ${blank("cg.occupation")}`), ops: COMMON_NUMBER_OPS },
    { key: "missing_company", label: "Company name pending", type: "integer", sql: gap(`${gapType(GAP_PERSON)} AND ${blank("cg.employer_name")}`), ops: COMMON_NUMBER_OPS },
  ],
  relations: {},
};

export const CATALOGS: Record<string, SubjectCatalog> = {
  investor: investorCatalog,
  lead: leadCatalog,
  task: taskCatalog,
  user: userCatalog,
  transaction: transactionCatalog,
  sip: sipCatalog,
  insurance: insuranceCatalog,
  goal: goalCatalog,
  service_request: serviceRequestCatalog,
  claim: claimCatalog,
  review_meeting: reviewMeetingCatalog,
  business_entry: businessEntryCatalog,
  business_line: businessLineCatalog,
  equity_brokerage: equityBrokerageCatalog,
  equity_dmat: equityDmatCatalog,
  new_client: newClientCatalog,
  sip_rejection: sipRejectionCatalog,
  client_gap: clientGapCatalog,
};

/** The field a subject's rows are filtered by for "Branch" on the report page, if it has one. */
export function branchField(subject: string): FieldDef | null {
  return CATALOGS[subject]?.fields.find((f) => f.branch) ?? null;
}

/** The field a subject's rows are filtered by for a desk (Anand 1 …) in the Branch picker, if it has one. */
export function deskField(subject: string): FieldDef | null {
  return CATALOGS[subject]?.fields.find((f) => f.desk) ?? null;
}

/** The report bar's "Clients" picker (family heads / members / individuals / no category), for a subject that has it. */
export function clientPickFields(subject: string): { family: FieldDef | null; category: FieldDef | null } {
  const fields = CATALOGS[subject]?.fields ?? [];
  return { family: fields.find((f) => f.key === "family_role") ?? null, category: fields.find((f) => f.key === "client_category") ?? null };
}

export function getCatalog(subject: string): SubjectCatalog {
  const cat = CATALOGS[subject];
  if (!cat) throw new Error(`Unknown subject type: ${subject}`);
  return cat;
}

export function getField(subject: string, key: string): FieldDef {
  const cat = getCatalog(subject);
  const f = cat.fields.find((x) => x.key === key);
  if (!f) throw new Error(`Unknown field ${subject}.${key}`);
  return f;
}
