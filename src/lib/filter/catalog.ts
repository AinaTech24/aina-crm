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
}

export interface SubjectCatalog {
  subject: "investor" | "lead" | "task" | "folio" | "user" | "transaction";
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
      enumValues: ["individual", "huf", "corporate", "trust", "nri", "minor", "other"],
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
      key: "status",
      label: "Status",
      type: "enum",
      sql: "inv.status",
      ops: COMMON_ENUM_OPS,
      enumValues: ["active", "dormant", "exited"],
      writable: true,
    },

    { key: "aum", label: "AUM (₹)", type: "currency", sql: "inv.aum", ops: COMMON_NUMBER_OPS },
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

    { key: "rm_id", label: "Relationship manager", type: "uuid", sql: "inv.rm_id", ops: COMMON_ENUM_OPS },
    { key: "branch_id", label: "Branch", type: "uuid", sql: "inv.branch_id", ops: COMMON_ENUM_OPS },

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
    { key: "score", label: "Lead score", type: "integer", sql: "ld.score::int", ops: COMMON_NUMBER_OPS },
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
    { key: "owner_id", label: "Owner", type: "uuid", sql: "ld.owner_id", ops: COMMON_ENUM_OPS, writable: true },
    {
      key: "days_in_stage",
      label: "Days in current stage",
      type: "integer",
      sql: "(now()::date - ld.stage_changed_at::date)",
      ops: COMMON_NUMBER_OPS,
    },
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
    { key: "assignee_id", label: "Assignee", type: "uuid", sql: "tk.assignee_id", ops: COMMON_ENUM_OPS },
    { key: "due_at", label: "Due date", type: "datetime", sql: "tk.due_at", ops: COMMON_DATE_OPS },
    { key: "sla_due_at", label: "SLA due", type: "datetime", sql: "tk.sla_due_at", ops: COMMON_DATE_OPS },
    {
      key: "days_overdue",
      label: "Days overdue",
      type: "integer",
      sql: "GREATEST(0, (now()::date - tk.due_at::date))",
      ops: COMMON_NUMBER_OPS,
    },
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
  ],
  relations: {},
};

export const CATALOGS: Record<string, SubjectCatalog> = {
  investor: investorCatalog,
  lead: leadCatalog,
  task: taskCatalog,
  user: userCatalog,
};

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
