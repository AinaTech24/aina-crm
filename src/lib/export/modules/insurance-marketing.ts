/**
 * Export definitions — Insurance (policy register, renewals, claims), Marketing
 * Campaigns, Message Templates and Documents.
 *
 * Each `where` repeats its list page's own access rule and URL filters, so the
 * file holds the rows that page would show:
 *
 *   · Insurance / Insurance Renewals — `insurance.view`; a non-manager sees
 *     their own book (policies they sold, or of clients they are RM of). The
 *     register's "manager" is seesWholeInsuranceBook(); the renewals page's is
 *     investor.view.all / compliance.view — each kept as its page has it.
 *   · Insurance Claims — `insurance.view`, firm-wide (as the claims register).
 *   · Campaigns — `campaign.send`, firm-wide.
 *   · Templates — as GET /api/templates (view / edit / send / workflow edit), firm-wide; metadata only, never bodies.
 *   · Documents — the vault's own rule (canOpenVault + vaultScopeFragment);
 *     metadata only, never the storage key or a file URL.
 */

import { sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { dateRangeCond } from "@/lib/filters/date-range";
import {
  bookedOnSql, branchSql, CLAIM_OPEN, CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL, GROUP_LABEL, groupSql, inList, installmentSql,
  LINE_LABEL, lineSql, natureSql, ownerSql, POLICY_STATUS_LABEL, POLICY_TYPE_LABEL, PRODUCT_GROUPS, STATUS_IN_FORCE,
  STATUS_ISSUED_EXCLUDED, typesOfGroups, typesOfLine, type Line,
} from "@/lib/insurance/book";
import { seesWholeInsuranceBook } from "@/lib/dashboard/insurance/access";
import { clientRecordWhere, uuidList } from "@/lib/metrics";
import { canOpenVault, vaultScopeFragment } from "@/lib/compliance/document-access";
import { d, dIst, dt, inFilter, userName } from "../helpers";
import type { ExportColumn, ExportModule } from "../types";

const raw = (c: string) => sql.raw(c);

/** `CASE expr WHEN 'a' THEN 'Label A' … ELSE expr END` from a label map. */
function labelOf(expr: SQL, labels: Record<string, string>): SQL {
  const whens = Object.entries(labels).map(([k, v]) => sql`WHEN ${k} THEN ${v}`);
  return sql`(CASE (${expr})::text ${sql.join(whens, sql` `)} ELSE initcap(replace((${expr})::text, '_', ' ')) END)`;
}

const FREQ_LABEL: Record<string, string> = {
  annual: "Annual", semi_annual: "Semi-annual", quarterly: "Quarterly", monthly: "Monthly", single: "Single-pay",
};

const sp = (params: URLSearchParams): Record<string, string | undefined> => Object.fromEntries(params);
const csv = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────── Insurance policies ───────────────────────── */

// FROM shared by the register and renewals: p = policy, i = client, su = seller.
const POLICY_FROM = sql`insurance_policies p
  LEFT JOIN investors i ON i.id = p.investor_id
  LEFT JOIN users su ON su.id = p.sold_by_user_id`;

/** Every policy column, with the given keys ticked by default. */
function policyColumns(defaults: string[], extra: ExportColumn[] = []): ExportColumn[] {
  const cols: ExportColumn[] = [
    ...extra,
    { key: "client", label: "Client", group: "Client", sql: raw("i.name") },
    { key: "client_pan", label: "Client PAN", group: "Client", sql: raw("i.pan"), pii: "pan" },
    { key: "client_phone", label: "Client mobile", group: "Client", sql: raw("i.phone"), pii: "phone" },
    { key: "client_whatsapp", label: "Client WhatsApp", group: "Client", sql: raw("i.whatsapp_phone"), pii: "phone" },
    { key: "client_email", label: "Client email", group: "Client", sql: raw("i.email"), pii: "email" },
    { key: "client_category", label: "Client grade", group: "Client", sql: raw("i.client_category") },
    { key: "rm", label: "Relationship manager", group: "Client", sql: userName(raw("i.rm_id")) },
    { key: "branch", label: "Branch", group: "Client", sql: sql`(SELECT b_.name FROM branches b_ WHERE b_.id = ${branchSql("p", "i")})` },

    { key: "plan", label: "Plan", group: "Policy", sql: raw("p.plan_name") },
    { key: "insurer", label: "Insurer", group: "Policy", sql: raw("p.insurer") },
    { key: "policy_number", label: "Policy number", group: "Policy", sql: raw("p.policy_number") },
    { key: "type", label: "Policy type", group: "Policy", sql: labelOf(raw("p.policy_type"), POLICY_TYPE_LABEL) },
    { key: "product", label: "Product group", group: "Policy", sql: labelOf(groupSql("p"), GROUP_LABEL) },
    { key: "line", label: "Line", group: "Policy", sql: labelOf(lineSql("p"), LINE_LABEL) },
    { key: "nature", label: "New / renewal", group: "Policy", sql: sql`(CASE ${natureSql("p")} WHEN 'renewal' THEN 'Renewal' ELSE 'New' END)` },
    { key: "business_type", label: "Business type (as entered)", group: "Policy", sql: sql`p.details->>'businessType'` },
    { key: "status", label: "Status", group: "Policy", sql: labelOf(raw("p.status"), POLICY_STATUS_LABEL) },
    { key: "lives", label: "Lives covered", group: "Policy", sql: raw("p.lives_covered"), kind: "number" },
    { key: "vehicle", label: "Vehicle registration", group: "Policy", sql: sql`p.details->>'vehicleRegNo'` },

    { key: "sum_assured", label: "Sum assured", group: "Cover & premium", sql: raw("p.sum_assured"), kind: "money" },
    { key: "premium", label: "Annual premium", group: "Cover & premium", sql: raw("p.annual_premium"), kind: "money" },
    { key: "installment", label: "Premium per instalment", group: "Cover & premium", sql: installmentSql("p"), kind: "money" },
    { key: "frequency", label: "Premium frequency", group: "Cover & premium", sql: labelOf(raw("p.premium_frequency"), FREQ_LABEL) },
    { key: "ppt", label: "Premium paying term (years)", group: "Cover & premium", sql: raw("p.premium_paying_term_years"), kind: "number" },
    { key: "term", label: "Policy term (years)", group: "Cover & premium", sql: raw("p.policy_term_years"), kind: "number" },
    { key: "commission", label: "Commission", group: "Cover & premium", sql: raw("p.commission_paisa"), kind: "money" },
    { key: "surrender_value", label: "Surrender value", group: "Cover & premium", sql: raw("p.surrender_value"), kind: "money" },

    { key: "start", label: "Policy start", group: "Dates", sql: d(raw("p.policy_start_date")), kind: "date" },
    { key: "risk_start", label: "Risk cover start", group: "Dates", sql: d(raw("p.risk_cover_start_date")), kind: "date" },
    { key: "booked_on", label: "Booked on", group: "Dates", sql: d(bookedOnSql("p")), kind: "date" },
    { key: "maturity", label: "Maturity", group: "Dates", sql: d(raw("p.maturity_date")), kind: "date" },
    { key: "last_premium", label: "Last premium paid", group: "Dates", sql: d(raw("p.last_premium_date")), kind: "date" },
    { key: "next_due", label: "Next premium due", group: "Dates", sql: d(raw("p.next_premium_due_date")), kind: "date" },
    { key: "grace", label: "Grace period (days)", group: "Dates", sql: raw("p.grace_period_days"), kind: "number" },

    { key: "nominee", label: "Nominee", group: "Nominee", sql: raw("p.nominee_name") },
    { key: "nominee_relation", label: "Nominee relation", group: "Nominee", sql: raw("p.nominee_relation") },
    { key: "nominee_dob", label: "Nominee date of birth", group: "Nominee", sql: d(raw("p.nominee_dob")), kind: "date", pii: "dob" },
    { key: "nominee_share", label: "Nominee share %", group: "Nominee", sql: raw("p.nominee_share"), kind: "number" },

    { key: "sold_by", label: "Sold by", group: "Sales", sql: raw("su.name") },
    { key: "owner", label: "Business owner", group: "Sales", sql: userName(ownerSql("p", "i", "su")) },
    { key: "sold_at", label: "Sold on", group: "Sales", sql: dIst(raw("p.sold_at")), kind: "date" },
    { key: "remarks", label: "Remarks", group: "Sales", sql: raw("p.remarks") },
    { key: "lapse_reason", label: "Lapse reason", group: "Sales", sql: raw("p.lapse_reason") },
    { key: "created", label: "Added on", group: "Sales", sql: dt(raw("p.created_at")), kind: "datetime" },
    { key: "updated", label: "Last updated", group: "Sales", sql: dt(raw("p.updated_at")), kind: "datetime" },
  ];
  return cols.map((c) => (defaults.includes(c.key) ? { ...c, default: true } : c));
}

const ISSUED_STATUSES = ["active", "lapsed", "matured", "surrendered", "claim_filed", "claim_settled"];
const GAPS = ["cat", "due", "type", "insurer", "premium", "number", "owner", "branch", "contact"];

export const insurancePoliciesExport: ExportModule = {
  key: "insurance",
  label: "Insurance",
  fileName: "insurance-policies",
  piiSubject: "investor",
  canView: (s) => can(s.roles, "insurance.view", s.permissions),
  from: POLICY_FROM,
  // Mirrors /dashboard/insurance (page.tsx) filter for filter.
  async where(_tx, session, params) {
    const p = sp(params);
    const conds: SQL[] = [sql`p.tenant_id = ${session.tenantId}::uuid`, sql`(i.id IS NULL OR i.deleted_at IS NULL)`];
    if (!seesWholeInsuranceBook(session)) conds.push(sql`(p.sold_by_user_id = ${session.userId}::uuid OR i.rm_id = ${session.userId}::uuid)`);

    const q = (p.q ?? "").trim();
    if (q) {
      conds.push(sql`(p.policy_number ILIKE ${`%${q}%`} OR p.plan_name ILIKE ${`%${q}%`} OR p.insurer ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`}
           OR p.details->>'vehicleRegNo' ILIKE ${`%${q}%`})`);
    }
    const types = csv(p.type ?? null);
    if (types.length) conds.push(sql`p.policy_type IN (${inList(types)})`);
    const statuses = [...new Set(csv(p.status ?? null).flatMap((v) => (v === "issued" ? ISSUED_STATUSES : [v])))];
    if (statuses.length) conds.push(sql`p.status IN (${inList(statuses)})`);
    const freqs = csv(p.frequency ?? null);
    if (freqs.length) conds.push(sql`p.premium_frequency IN (${inList(freqs)})`);
    if (p.due === "1") {
      conds.push(sql`(p.status = 'active' AND p.next_premium_due_date IS NOT NULL AND p.next_premium_due_date <= current_date + interval '30 days' AND p.next_premium_due_date >= current_date)`);
    }
    const dr = dateRangeCond(p, "created", "p.created_at");
    if (dr) conds.push(dr);
    // The Filters panel's ranges: maturity date, sum assured, annual premium.
    if (ISO.test(p.maturity_from ?? "")) conds.push(sql`p.maturity_date >= ${p.maturity_from}::date`);
    if (ISO.test(p.maturity_to ?? "")) conds.push(sql`p.maturity_date <= ${p.maturity_to}::date`);
    const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
    const saMin = num(p.sa_min), saMax = num(p.sa_max), premMin = num(p.prem_min), premMax = num(p.prem_max);
    if (saMin != null) conds.push(sql`p.sum_assured::numeric >= ${saMin}`);
    if (saMax != null) conds.push(sql`p.sum_assured::numeric < ${saMax}`);
    if (premMin != null) conds.push(sql`p.annual_premium::numeric >= ${premMin}`);
    if (premMax != null) conds.push(sql`p.annual_premium::numeric < ${premMax}`);

    // Drill-down params from the Insurance dashboard (lib/insurance/book.ts).
    const line = (p.line === "personal" || p.line === "commercial" ? p.line : null) as Line | null;
    const groups = csv(p.grp ?? null).filter((g) => PRODUCT_GROUPS.some((x) => x.key === g));
    const nature = p.nature === "new" || p.nature === "renewal" ? p.nature : null;
    const branch = csv(p.branch ?? null).filter((v) => UUID.test(v));
    const owner = csv(p.owner ?? null).filter((v) => UUID.test(v));
    const insurer = (p.insurer ?? "").trim().slice(0, 120) || null;
    const cats = csv(p.cat ?? null).filter((c) => ["A", "B", "C", "D", "none"].includes(c));
    const mf = p.mf === "yes" || p.mf === "no" ? p.mf : null;
    const bookedFrom = ISO.test(p.booked_from ?? "") ? p.booked_from! : null;
    const bookedTo = ISO.test(p.booked_to ?? "") ? p.booked_to! : null;
    const dueFrom = ISO.test(p.due_from ?? "") ? p.due_from! : null;
    const dueTo = ISO.test(p.due_to ?? "") ? p.due_to! : null;
    const gap = p.gap && GAPS.includes(p.gap) ? p.gap : null;
    const ccActive = !!(line || groups.length || nature || branch.length || owner.length || insurer || cats.length || mf
      || bookedFrom || bookedTo || dueFrom || dueTo || gap);
    if (ccActive) {
      conds.push(sql`i.deleted_at IS NULL`);
      if (line) conds.push(sql`p.policy_type IN (${inList(typesOfLine(line))})`);
      if (groups.length) conds.push(sql`p.policy_type IN (${inList(typesOfGroups(groups))})`);
      if (nature) conds.push(sql`${natureSql("p")} = ${nature}`);
      if (branch.length) conds.push(sql`${branchSql("p", "i")} IN (${uuidList(branch)})`);
      if (owner.length) conds.push(sql`${ownerSql("p", "i", "su")} IN (${uuidList(owner)})`);
      if (insurer) conds.push(sql`lower(btrim(p.insurer)) = ${insurer.toLowerCase()}`);
      if (cats.length) {
        const letters = cats.filter((c) => c !== "none");
        conds.push(sql`(${letters.length ? sql`upper(btrim(COALESCE(i.client_category, ''))) IN (${inList(letters)})` : sql`FALSE`}
                       ${cats.includes("none") ? sql`OR COALESCE(btrim(i.client_category), '') = ''` : sql``})`);
      }
      if (mf === "yes") conds.push(sql`COALESCE(i.aum, 0)::numeric > 0`);
      if (mf === "no") conds.push(sql`COALESCE(i.aum, 0)::numeric = 0`);
      if (bookedFrom) conds.push(sql`${bookedOnSql("p")} >= ${bookedFrom}::date`);
      if (bookedTo) conds.push(sql`${bookedOnSql("p")} <= ${bookedTo}::date`);
      if (bookedFrom || bookedTo) conds.push(sql`p.status NOT IN (${inList(STATUS_ISSUED_EXCLUDED)})`);
      if ((dueFrom || dueTo) && !statuses.length) conds.push(sql`p.status IN (${inList(STATUS_IN_FORCE)})`);
      if (dueFrom || dueTo) conds.push(sql`p.premium_frequency <> 'single' AND p.next_premium_due_date IS NOT NULL`);
      if (dueFrom) conds.push(sql`p.next_premium_due_date >= ${dueFrom}::date`);
      if (dueTo) conds.push(sql`p.next_premium_due_date <= ${dueTo}::date`);
      const inForce = sql`p.status IN (${inList(STATUS_IN_FORCE)})`;
      const known = PRODUCT_GROUPS.flatMap((g) => [...g.types]);
      switch (gap) {
        case "cat": conds.push(sql`COALESCE(btrim(i.client_category), '') = ''`); break;
        case "due": conds.push(sql`${inForce} AND p.premium_frequency <> 'single' AND p.next_premium_due_date IS NULL`); break;
        case "type": conds.push(sql`(p.policy_type IS NULL OR p.policy_type NOT IN (${inList(known)}))`); break;
        case "insurer": conds.push(sql`NULLIF(btrim(p.insurer), '') IS NULL`); break;
        case "premium": conds.push(sql`(p.annual_premium IS NULL OR p.annual_premium = 0)`); break;
        case "number": conds.push(sql`${inForce} AND NULLIF(btrim(p.policy_number), '') IS NULL`); break;
        case "owner": conds.push(sql`${ownerSql("p", "i", "su")} IS NULL`); break;
        case "branch": conds.push(sql`${branchSql("p", "i")} IS NULL`); break;
        case "contact": conds.push(sql`NULLIF(btrim(COALESCE(i.phone, '')), '') IS NULL AND NULLIF(btrim(COALESCE(i.email, '')), '') IS NULL`); break;
      }
    }
    return conds;
  },
  orderBy: sql`p.created_at DESC`,
  columns: policyColumns(["client", "plan", "insurer", "policy_number", "type", "sum_assured", "premium", "next_due", "status"]),
};

/* ───────────────────────── Insurance renewals ───────────────────────── */

const RENEWAL_BUCKETS = ["overdue", "this_week", "next_30", "lapsing"] as const;
type Bucket = (typeof RENEWAL_BUCKETS)[number];
// /dashboard/insurance/renewals BUCKET_SQL, verbatim.
const BUCKET_SQL: Record<Bucket, SQL> = {
  overdue: sql`p.next_premium_due_date < current_date AND p.next_premium_due_date >= current_date - COALESCE(p.grace_period_days, 30)`,
  this_week: sql`p.next_premium_due_date BETWEEN current_date AND current_date + 7`,
  next_30: sql`p.next_premium_due_date BETWEEN current_date + 8 AND current_date + 30`,
  lapsing: sql`p.next_premium_due_date < current_date - COALESCE(p.grace_period_days, 30)`,
};

export const insuranceRenewalsExport: ExportModule = {
  key: "insurance-renewals",
  label: "Insurance Renewals",
  fileName: "insurance-renewals",
  piiSubject: "investor",
  canView: (s) => can(s.roles, "insurance.view", s.permissions),
  from: POLICY_FROM,
  async where(_tx, session, params) {
    // The renewals page's own "manager" rule (narrower than the register's).
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const b = params.get("bucket") ?? "";
    const bucket: Bucket = (RENEWAL_BUCKETS as readonly string[]).includes(b) ? (b as Bucket) : "this_week";
    return [
      sql`p.tenant_id = ${session.tenantId}::uuid`,
      sql`p.status = 'active'`,
      sql`p.next_premium_due_date IS NOT NULL`,
      sql`(${BUCKET_SQL[bucket]})`,
      ...(seesAll ? [] : [sql`(p.sold_by_user_id = ${session.userId}::uuid OR i.rm_id = ${session.userId}::uuid)`]),
    ];
  },
  orderBy: sql`p.next_premium_due_date ASC`,
  columns: policyColumns(
    ["client", "client_phone", "plan", "insurer", "policy_number", "next_due", "days_to_due", "premium", "frequency"],
    [
      {
        key: "bucket", label: "Renewal bucket", group: "Renewal",
        sql: sql`(CASE WHEN ${BUCKET_SQL.overdue} THEN 'Overdue (in grace)' WHEN ${BUCKET_SQL.this_week} THEN 'Due this week'
                      WHEN ${BUCKET_SQL.next_30} THEN 'Due in 30 days' WHEN ${BUCKET_SQL.lapsing} THEN 'Lapsing (past grace)' END)`,
      },
      { key: "days_to_due", label: "Days to due (negative = overdue)", group: "Renewal", sql: sql`(p.next_premium_due_date - current_date)`, kind: "number" },
    ],
  ),
};

/* ───────────────────────── Insurance claims ───────────────────────── */

const CLAIM_MODE_LABEL: Record<string, string> = { cashless: "Cashless", reimbursement: "Reimbursement", grievance: "Grievance" };
const CLAIM_STATUS_KEYS = Object.keys(CLAIM_STATUS_LABEL);

export const insuranceClaimsExport: ExportModule = {
  key: "insurance-claims",
  label: "Insurance Claims",
  fileName: "insurance-claims",
  piiSubject: "investor",
  canView: (s) => can(s.roles, "insurance.view", s.permissions),
  from: sql`insurance_claims c
    LEFT JOIN investors i ON i.id = c.investor_id
    LEFT JOIN insurance_policies p ON p.id = c.policy_id`,
  // Mirrors /dashboard/insurance-claims: firm-wide for insurance.view.
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`c.tenant_id = ${session.tenantId}::uuid`];
    const status = params.get("status") ?? "";
    const mode = params.get("mode") ?? "";
    if (mode && CLAIM_MODE_LABEL[mode]) conds.push(sql`c.claim_mode = ${mode}`);
    else if (status && CLAIM_STATUS_KEYS.includes(status)) conds.push(sql`c.claim_status = ${status}`);
    const openOverRaw = params.get("open_over") ? Number(params.get("open_over")) : NaN;
    if (Number.isInteger(openOverRaw) && openOverRaw >= 0 && openOverRaw <= 3650) {
      conds.push(sql`COALESCE(c.claim_status, 'empty') IN (${inList(CLAIM_OPEN)})
        AND COALESCE(c.intimation_date, c.created_at::date) < (now() AT TIME ZONE 'Asia/Kolkata')::date - ${openOverRaw}::int`);
    }
    const rm = csv(params.get("rm"));
    const branch = csv(params.get("branch"));
    if (rm.length || branch.length) {
      conds.push(sql`c.investor_id IN (SELECT ci.id FROM investors ci
        WHERE ${clientRecordWhere({ tenantId: session.tenantId, rmIds: rm, branchIds: branch }, "ci")})`);
    }
    const q = (params.get("q") ?? "").trim();
    if (q) conds.push(sql`(c.proposer_name ILIKE ${`%${q}%`} OR c.policy_number ILIKE ${`%${q}%`} OR c.insurer ILIKE ${`%${q}%`})`);
    return conds;
  },
  orderBy: sql`c.updated_at DESC`,
  columns: [
    { key: "proposer", label: "Proposer", group: "Claim", sql: raw("c.proposer_name"), default: true },
    { key: "client", label: "Client", group: "Claim", sql: raw("i.name"), default: true },
    { key: "status", label: "Status", group: "Claim", sql: labelOf(raw("c.claim_status"), CLAIM_STATUS_LABEL), default: true },
    { key: "type", label: "Claim type", group: "Claim", sql: labelOf(raw("c.claim_type"), CLAIM_TYPE_LABEL), default: true },
    { key: "mode", label: "Claim mode", group: "Claim", sql: labelOf(raw("c.claim_mode"), CLAIM_MODE_LABEL) },
    { key: "intimation_mode", label: "Intimated by", group: "Claim", sql: sql`initcap(c.intimation_mode)` },
    { key: "submitted_mode", label: "Submitted by", group: "Claim", sql: sql`initcap(c.submitted_mode)` },
    { key: "rm", label: "Relationship manager", group: "Claim", sql: userName(raw("c.rm_id")) },
    { key: "branch", label: "Branch", group: "Claim", sql: sql`(SELECT b_.name FROM branches b_ WHERE b_.id = c.branch_id)` },
    { key: "documents", label: "Documents on file", group: "Claim", sql: sql`(CASE WHEN jsonb_typeof(c.documents) = 'array' THEN jsonb_array_length(c.documents) END)`, kind: "number" },
    { key: "comments", label: "Comments", group: "Claim", sql: raw("c.comments") },

    { key: "contact_person", label: "Contact person", group: "Contact", sql: raw("c.contact_person") },
    { key: "phone", label: "Contact phone", group: "Contact", sql: raw("c.phone"), pii: "phone" },
    { key: "email", label: "Contact email", group: "Contact", sql: raw("c.email"), pii: "email" },

    { key: "insurer", label: "Insurer", group: "Policy", sql: raw("c.insurer"), default: true },
    { key: "policy_number", label: "Policy number", group: "Policy", sql: raw("c.policy_number"), default: true },
    { key: "plan", label: "Plan", group: "Policy", sql: raw("p.plan_name") },
    { key: "policy_type", label: "Policy type", group: "Policy", sql: labelOf(raw("p.policy_type"), POLICY_TYPE_LABEL) },
    { key: "policy_details", label: "Policy details", group: "Policy", sql: raw("c.policy_details") },

    { key: "admission", label: "Admission date", group: "Dates", sql: d(raw("c.admission_date")), kind: "date" },
    { key: "intimation", label: "Intimation date", group: "Dates", sql: d(raw("c.intimation_date")), kind: "date", default: true },
    { key: "submission", label: "Submission date", group: "Dates", sql: d(raw("c.submission_date")), kind: "date" },
    { key: "settlement", label: "Settlement date", group: "Dates", sql: d(raw("c.settlement_date")), kind: "date" },
    {
      key: "tat", label: "TAT (days, intimation → settlement)", group: "Dates", kind: "number",
      sql: sql`(CASE WHEN c.intimation_date IS NOT NULL AND c.settlement_date IS NOT NULL THEN GREATEST(0, c.settlement_date - c.intimation_date) END)`,
    },
    {
      key: "age", label: "Days open", group: "Dates", kind: "number",
      sql: sql`(CASE WHEN COALESCE(c.claim_status, 'empty') IN (${inList(CLAIM_OPEN)}) AND c.intimation_date IS NOT NULL
                     THEN GREATEST(0, (now() AT TIME ZONE 'Asia/Kolkata')::date - c.intimation_date) END)`,
    },
    { key: "created", label: "Logged on", group: "Dates", sql: dt(raw("c.created_at")), kind: "datetime" },
    { key: "updated", label: "Last updated", group: "Dates", sql: dt(raw("c.updated_at")), kind: "datetime" },

    { key: "claimed", label: "Claimed amount", group: "Amounts", sql: raw("c.claimed_amount"), kind: "money", default: true },
    { key: "settled", label: "Settled amount", group: "Amounts", sql: raw("c.settled_amount"), kind: "money", default: true },
    {
      key: "settled_pct", label: "Settled % of claimed", group: "Amounts", kind: "number",
      sql: sql`(CASE WHEN COALESCE(c.claimed_amount, 0) > 0 THEN round(COALESCE(c.settled_amount, 0) * 100.0 / c.claimed_amount, 1) END)`,
    },
  ],
};

/* ───────────────────────── Marketing campaigns ───────────────────────── */

const CAMPAIGN_KIND_LABEL: Record<string, string> = {
  social_media: "Social Media", whatsapp: "WhatsApp", email: "Email", sms: "SMS", webinar: "Webinar / Seminar",
  seminar: "Webinar / Seminar", referral: "Referral", google_business: "Google Business", paid_ads: "Paid Ads", content: "Content", other: "Other",
};

export const campaignsExport: ExportModule = {
  key: "campaigns",
  label: "Marketing Campaigns",
  fileName: "campaigns",
  canView: (s) => can(s.roles, "campaign.send", s.permissions),
  from: sql`campaigns c LEFT JOIN segments s ON s.id = c.segment_id`,
  // Mirrors /dashboard/campaigns: firm-wide for campaign.send.
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`c.tenant_id = ${session.tenantId}::uuid`];
    const q = (params.get("q") ?? "").trim();
    if (q) conds.push(sql`(c.name ILIKE ${`%${q}%`} OR c.theme ILIKE ${`%${q}%`} OR c.target_audience ILIKE ${`%${q}%`})`);
    conds.push(...inFilter(params.get("kind"), raw("c.kind")));
    conds.push(...inFilter(params.get("status"), raw("c.status")));
    conds.push(...inFilter(params.get("approval"), raw("c.approval_status")));
    conds.push(...inFilter(params.get("compliance"), raw("c.compliance_check_status")));
    const dr = dateRangeCond(sp(params), "created", "c.created_at");
    if (dr) conds.push(dr);
    return conds;
  },
  orderBy: sql`COALESCE(c.start_date, c.created_at) DESC`,
  columns: [
    { key: "name", label: "Campaign", group: "Campaign", sql: raw("c.name"), default: true },
    { key: "kind", label: "Type", group: "Campaign", sql: labelOf(sql`COALESCE(c.kind, c.channel)`, CAMPAIGN_KIND_LABEL), default: true },
    { key: "channel", label: "Channel", group: "Campaign", sql: sql`initcap(c.channel)` },
    { key: "theme", label: "Theme", group: "Campaign", sql: raw("c.theme") },
    { key: "description", label: "Description", group: "Campaign", sql: raw("c.description") },
    { key: "status", label: "Status", group: "Campaign", sql: sql`initcap(c.status)`, default: true },
    { key: "template", label: "Template", group: "Campaign", sql: sql`(SELECT t_.name FROM templates t_ WHERE t_.id = c.template_id)` },
    { key: "recurrence", label: "Recurrence", group: "Campaign", sql: sql`initcap(c.recurrence)` },
    { key: "created_by", label: "Created by", group: "Campaign", sql: userName(raw("c.created_by_user_id")) },
    { key: "remarks", label: "Remarks", group: "Campaign", sql: raw("c.remarks") },

    { key: "segment", label: "Segment", group: "Audience", sql: raw("s.name") },
    { key: "segment_size", label: "Segment size", group: "Audience", sql: raw("s.member_count"), kind: "number" },
    { key: "audience", label: "Target audience", group: "Audience", sql: raw("c.target_audience") },

    { key: "start", label: "Start", group: "Schedule", sql: dIst(raw("c.start_date")), kind: "date", default: true },
    { key: "end", label: "End", group: "Schedule", sql: dIst(raw("c.end_date")), kind: "date" },
    { key: "scheduled_at", label: "Scheduled for", group: "Schedule", sql: dt(raw("c.scheduled_at")), kind: "datetime" },
    { key: "started_at", label: "Started", group: "Schedule", sql: dt(raw("c.started_at")), kind: "datetime" },
    { key: "completed_at", label: "Completed", group: "Schedule", sql: dt(raw("c.completed_at")), kind: "datetime" },
    { key: "created", label: "Created", group: "Schedule", sql: dt(raw("c.created_at")), kind: "datetime" },

    { key: "content_status", label: "Content", group: "Approval", sql: sql`initcap(replace(c.content_status, '_', ' '))` },
    { key: "compliance", label: "Compliance check", group: "Approval", sql: sql`initcap(replace(c.compliance_check_status, '_', ' '))` },
    { key: "approval", label: "Approval", group: "Approval", sql: sql`initcap(replace(c.approval_status, '_', ' '))`, default: true },
    { key: "approved_by", label: "Approved by", group: "Approval", sql: userName(raw("c.approved_by_user_id")) },
    { key: "approved_at", label: "Approved on", group: "Approval", sql: dt(raw("c.approved_at")), kind: "datetime" },

    { key: "recipients", label: "Recipients", group: "Delivery", sql: raw("c.total_recipients"), kind: "number" },
    { key: "sent", label: "Sent", group: "Delivery", sql: raw("c.sent_count"), kind: "number" },
    { key: "delivered", label: "Delivered", group: "Delivery", sql: raw("c.delivered_count"), kind: "number" },
    { key: "read", label: "Read / opened", group: "Delivery", sql: raw("c.read_count"), kind: "number" },
    { key: "clicked", label: "Clicked", group: "Delivery", sql: raw("c.clicked_count"), kind: "number" },
    { key: "replied", label: "Replied", group: "Delivery", sql: raw("c.replied_count"), kind: "number" },
    { key: "failed", label: "Failed", group: "Delivery", sql: raw("c.failed_count"), kind: "number" },
    { key: "bounced", label: "Bounced", group: "Delivery", sql: raw("c.bounced_count"), kind: "number" },
    { key: "unsubscribed", label: "Unsubscribed", group: "Delivery", sql: raw("c.unsubscribed_count"), kind: "number" },

    { key: "leads", label: "Leads generated", group: "Results", sql: raw("c.leads_generated"), kind: "number", default: true },
    { key: "meetings", label: "Meetings booked", group: "Results", sql: raw("c.meetings_booked"), kind: "number" },
    { key: "converted", label: "Clients converted", group: "Results", sql: raw("c.clients_converted"), kind: "number", default: true },
    { key: "cost", label: "Campaign cost", group: "Results", sql: raw("c.campaign_cost"), kind: "money" },
    {
      key: "cost_per_lead", label: "Cost per lead", group: "Results", kind: "money",
      sql: sql`(CASE WHEN COALESCE(c.leads_generated, 0) > 0 AND c.campaign_cost IS NOT NULL THEN round(c.campaign_cost / c.leads_generated, 2) END)`,
    },
  ],
};

/* ───────────────────────── Message templates ───────────────────────── */

export const templatesExport: ExportModule = {
  key: "templates",
  label: "Message Templates",
  fileName: "message-templates",
  // Same rule as GET /api/templates.
  canView: (s) => (["template.view", "template.edit", "communication.send", "workflow.edit"] as const).some((c) => can(s.roles, c, s.permissions)),
  from: sql`templates t LEFT JOIN template_versions v ON v.id = t.current_version_id`,
  // Mirrors /dashboard/templates: firm-wide; channel / status / name-or-key search.
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`t.tenant_id = ${session.tenantId}::uuid`];
    const channel = params.get("channel") ?? "";
    if (channel) conds.push(sql`t.channel = ${channel}`);
    const status = params.get("status") ?? "";
    if (status) conds.push(sql`t.status = ${status}`);
    const q = (params.get("q") ?? "").trim().toLowerCase();
    if (q) conds.push(sql`position(${q} in lower(t.name || ' ' || t.key)) > 0`);
    return conds;
  },
  orderBy: sql`t.updated_at DESC`,
  // Metadata only — never a version's body, variables or attachments.
  columns: [
    { key: "name", label: "Name", group: "Template", sql: raw("t.name"), default: true },
    { key: "key", label: "Key", group: "Template", sql: raw("t.key") },
    { key: "channel", label: "Channel", group: "Template", sql: labelOf(raw("t.channel"), { whatsapp: "WhatsApp", email: "Email", sms: "SMS", inapp: "In-app" }), default: true },
    { key: "category", label: "Category", group: "Template", sql: sql`initcap(t.category)`, default: true },
    { key: "status", label: "Status", group: "Template", sql: sql`initcap(replace(t.status, '_', ' '))`, default: true },
    { key: "locale", label: "Language", group: "Template", sql: raw("t.locale") },
    { key: "description", label: "Description", group: "Template", sql: raw("t.description") },
    { key: "created", label: "Created", group: "Template", sql: dt(raw("t.created_at")), kind: "datetime" },
    { key: "updated", label: "Last updated", group: "Template", sql: dt(raw("t.updated_at")), kind: "datetime", default: true },

    { key: "versions", label: "Versions", group: "Versions", sql: sql`(SELECT count(*) FROM template_versions v_ WHERE v_.template_id = t.id)`, kind: "number", default: true },
    { key: "current_version", label: "Current version", group: "Versions", sql: raw("v.version_number"), kind: "number" },
    { key: "version_approval", label: "Current version approval", group: "Versions", sql: sql`initcap(replace(v.approval_status, '_', ' '))` },
    { key: "compliance_score", label: "Compliance score", group: "Versions", sql: raw("v.compliance_score"), kind: "number" },
    { key: "compliance_blocked", label: "Blocked by compliance", group: "Versions", sql: raw("v.auto_compliance_blocked"), kind: "bool" },
    { key: "version_author", label: "Current version by", group: "Versions", sql: userName(raw("v.created_by_user_id")) },
    { key: "approved_by", label: "Approved by", group: "Versions", sql: userName(raw("v.approved_by_user_id")) },
    { key: "approved_at", label: "Approved on", group: "Versions", sql: dt(raw("v.approved_at")), kind: "datetime" },
    { key: "rejection", label: "Rejection reason", group: "Versions", sql: raw("v.rejection_reason") },
    { key: "external_status", label: "Provider status (e.g. Meta)", group: "Versions", sql: raw("v.external_status") },
    { key: "external_synced", label: "Provider status checked", group: "Versions", sql: dt(raw("v.external_synced_at")), kind: "datetime" },
    {
      key: "campaigns", label: "Used in campaigns", group: "Versions", kind: "number",
      sql: sql`(SELECT count(*) FROM campaigns c_ WHERE c_.tenant_id = t.tenant_id AND (c_.template_id = t.id OR c_.variant_template_id = t.id))`,
    },
  ],
};

/* ───────────────────────── Documents ───────────────────────── */

export const documentsExport: ExportModule = {
  key: "documents",
  label: "Documents",
  fileName: "documents",
  canView: (s: SessionUser) => canOpenVault(s),
  // Unaliased: vaultScopeFragment refers to the vault's columns by bare name.
  from: sql`compliance_documents`,
  async where(tx, session) {
    return [
      sql`compliance_documents.tenant_id = ${session.tenantId}::uuid`,
      sql`compliance_documents.superseded_by_id IS NULL`,
      await vaultScopeFragment(tx, session),
    ];
  },
  orderBy: sql`compliance_documents.created_at DESC`,
  // Metadata only — never the storage key or a link to the file.
  columns: [
    { key: "name", label: "Document", group: "Document", sql: raw("compliance_documents.name"), default: true },
    { key: "category", label: "Category", group: "Document", sql: sql`initcap(replace(compliance_documents.category, '_', ' '))`, default: true },
    { key: "description", label: "Description", group: "Document", sql: raw("compliance_documents.description") },
    {
      key: "client", label: "Client", group: "Document", default: true,
      sql: sql`(CASE WHEN compliance_documents.related_entity_type = 'investor'
                    THEN (SELECT i_.name FROM investors i_ WHERE i_.id = compliance_documents.related_entity_id) END)`,
    },
    { key: "filed_against", label: "Filed against", group: "Document", sql: sql`COALESCE(initcap(compliance_documents.related_entity_type), 'Firm')` },
    {
      key: "tags", label: "Tags", group: "Document",
      sql: sql`(CASE WHEN jsonb_typeof(compliance_documents.tags) = 'array'
                    THEN (SELECT string_agg(x_, ', ') FROM jsonb_array_elements_text(compliance_documents.tags) x_) END)`,
    },
    { key: "version", label: "Version", group: "Document", sql: raw("compliance_documents.version"), kind: "number" },

    { key: "issued", label: "Issued on", group: "Validity", sql: d(raw("compliance_documents.issued_on")), kind: "date" },
    { key: "expires", label: "Expires on", group: "Validity", sql: d(raw("compliance_documents.expires_on")), kind: "date", default: true },
    {
      key: "validity", label: "Validity", group: "Validity", default: true,
      sql: sql`(CASE WHEN compliance_documents.expires_on IS NULL THEN 'No expiry'
                    WHEN compliance_documents.expires_on < current_date THEN 'Expired'
                    WHEN compliance_documents.expires_on <= current_date + 30 THEN 'Expiring in 30 days'
                    ELSE 'Valid' END)`,
    },

    { key: "file_type", label: "File type", group: "File", sql: raw("compliance_documents.mime_type") },
    {
      key: "size_kb", label: "Size (KB)", group: "File", kind: "number",
      sql: sql`(CASE WHEN compliance_documents.size_bytes ~ '^[0-9]+$' THEN round(compliance_documents.size_bytes::numeric / 1024, 1) END)`,
    },
    { key: "uploaded_by", label: "Uploaded by", group: "File", sql: userName(raw("compliance_documents.uploaded_by_user_id")) },
    { key: "uploaded", label: "Uploaded on", group: "File", sql: dt(raw("compliance_documents.created_at")), kind: "datetime", default: true },
    { key: "updated", label: "Last updated", group: "File", sql: dt(raw("compliance_documents.updated_at")), kind: "datetime" },
  ],
};
