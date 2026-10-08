/**
 * Team & admin exports — Team Members, Attendance, Leave, Sub-Distributors,
 * Legal Registrations, Scheme Master, AMC Empanelments and Products & Services.
 *
 * Each `where` repeats its list page's own rules: the same tenant, the same
 * "not deleted" / default-tab conditions and the same URL filters, so the file
 * is what is on screen. Staff (and partner) personal data is gated under the
 * licence subject "user".
 *
 * Never exported: password hashes, 2FA secrets / backup codes, permission and
 * module grants, session data, avatar / signature / document URLs, punch
 * geolocation and IPs, and bank account numbers.
 */

import { sql, type SQL } from "drizzle-orm";
import { can, ROLE_LABELS } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { dateRangeCond } from "@/lib/filters/date-range";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance/policy";
import { LEAVE_TYPE_LABELS, LEAVE_DURATION_LABELS, LEAVE_STATUS_LABELS } from "@/lib/leave/policy";
import { planSql, coarseSql } from "@/lib/schemes/classify";
import { d, dIst, dt, userName, inFilter } from "../helpers";
import type { ExportModule } from "../types";

/** A code column shown by its label (unknown codes print as stored). */
function labelOf(expr: SQL, map: Record<string, string>): SQL {
  const whens = Object.entries(map).map(([k, v]) => sql`WHEN ${k}::text THEN ${v}::text`);
  return sql`(CASE (${expr})::text ${sql.join(whens, sql` `)} ELSE (${expr})::text END)`;
}

/** "back_office" → "Back office". */
const humanCode = (expr: SQL) => sql`initcap(replace((${expr})::text, '_', ' '))`;

/** "a, b" from a jsonb array of strings. */
const jsonbList = (expr: SQL) =>
  sql`(SELECT string_agg(x_, ', ') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${expr}) = 'array' THEN ${expr} ELSE '[]'::jsonb END) AS x_)`;

/** Number of entries in a jsonb array (documents on file). */
const jsonbCount = (expr: SQL) => sql`(CASE WHEN jsonb_typeof(${expr}) = 'array' THEN jsonb_array_length(${expr}) ELSE 0 END)`;

const hasRole = (s: SessionUser, roles: string[]) => s.roles.some((r) => roles.includes(r));

/** A comma-separated multi-select param, empty / "all" ignored. */
const listParam = (params: URLSearchParams, key: string) =>
  (params.get(key) ?? "").split(",").map((v) => v.trim()).filter((v) => v && v !== "all");

// ─────────────────────────────────────────────────────────────────────────────
// Team Members — /dashboard/employees
// ─────────────────────────────────────────────────────────────────────────────

const u = (c: string) => sql.raw(`u.${c}`);

export const teamMembersExport: ExportModule = {
  key: "team-members",
  label: "Team Members",
  fileName: "team-members",
  piiSubject: "user",
  // The list page has no capability of its own; the sidebar shows it to owners
  // and branch heads, user management is settings.users, and compliance keeps
  // the DDQ "list of employees".
  canView: (s) => hasRole(s, ["owner", "branch_head", "compliance"]) || can(s.roles, "settings.users", s.permissions),
  from: sql`users u LEFT JOIN users mgr ON mgr.id = u.reporting_manager_id`,
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`u.tenant_id = ${session.tenantId}::uuid`, sql`u.deleted_at IS NULL`];
    const q = (params.get("q") ?? "").trim();
    if (q) conds.push(sql`(u.name ILIKE ${`%${q}%`} OR u.email ILIKE ${`%${q}%`} OR u.phone ILIKE ${`%${q}%`} OR u.euin ILIKE ${`%${q}%`})`);
    const statuses = (params.get("status") ?? "").split(",").filter(Boolean);
    conds.push(...inFilter(params.get("department"), sql`u.department`));
    conds.push(...inFilter(params.get("status"), sql`u.status`));
    // Offboarded people are hidden unless asked for, as on the page.
    if (!(params.get("offboarded") === "1" || statuses.includes("offboarded"))) conds.push(sql`u.status <> 'offboarded'`);
    if (params.get("incomplete") === "1") {
      conds.push(sql`(u.department IS NULL OR u.reporting_manager_id IS NULL OR u.joining_date IS NULL)`);
    }
    return conds;
  },
  orderBy: sql`u.created_at DESC`,
  columns: [
    { key: "name", label: "Name", group: "Person", sql: u("name"), default: true },
    { key: "code", label: "Employee code", group: "Person", sql: u("employee_code") },
    { key: "email", label: "Email", group: "Person", sql: u("email"), pii: "email", default: true },
    { key: "phone", label: "Mobile", group: "Person", sql: u("phone"), pii: "phone", default: true },
    { key: "roles", label: "Roles", group: "Person", sql: sql`(SELECT string_agg(DISTINCT ${labelOf(sql`r_`, ROLE_LABELS)}, ', ') FROM unnest(u.roles) AS r_)`, default: true },
    { key: "department", label: "Department", group: "Person", sql: humanCode(u("department")), default: true },
    { key: "status", label: "Status", group: "Person", sql: u("status"), default: true },
    { key: "manager", label: "Reporting manager", group: "Person", sql: sql`mgr.name`, default: true },
    { key: "branch", label: "Branch", group: "Person", sql: sql`(SELECT b.name FROM branches b WHERE b.id = u.branch_id)` },
    { key: "desk", label: "Desk", group: "Person", sql: sql`(SELECT dk.name FROM desks dk WHERE dk.id = u.desk_id)` },
    { key: "joined", label: "Joining date", group: "Person", sql: d(u("joining_date")), kind: "date", default: true },
    { key: "invited", label: "Invited on", group: "Person", sql: dIst(u("invited_at")), kind: "date" },
    { key: "activated", label: "Activated on", group: "Person", sql: dIst(u("activated_at")), kind: "date" },
    { key: "offboarded_at", label: "Offboarded on", group: "Person", sql: dIst(u("offboarded_at")), kind: "date" },
    { key: "last_login", label: "Last login", group: "Person", sql: dt(u("last_login_at")), kind: "datetime" },
    { key: "two_fa", label: "Two-factor sign-in on", group: "Person", sql: sql`COALESCE(u.two_fa_enabled, false)`, kind: "bool" },
    { key: "email_verified", label: "Email verified", group: "Person", sql: sql`(u.email_verified_at IS NOT NULL)`, kind: "bool" },

    { key: "euin", label: "EUIN", group: "Licensing", sql: u("euin") },
    { key: "euin_expiry", label: "EUIN expiry", group: "Licensing", sql: d(u("euin_expiry_at")), kind: "date" },
    { key: "nism_no", label: "NISM certificate no.", group: "Licensing", sql: u("nism_cert_no") },
    { key: "nism_category", label: "NISM category", group: "Licensing", sql: u("nism_category") },
    { key: "nism_exam", label: "NISM exam date", group: "Licensing", sql: d(u("nism_exam_date")), kind: "date" },
    { key: "nism_expiry", label: "NISM expiry", group: "Licensing", sql: d(u("nism_expiry_at")), kind: "date" },
    { key: "arn", label: "Personal ARN", group: "Licensing", sql: u("personal_arn") },
    { key: "arn_reg", label: "ARN registration date", group: "Licensing", sql: d(u("arn_registration_date")), kind: "date" },
    { key: "arn_expiry", label: "ARN expiry", group: "Licensing", sql: d(u("arn_expiry_at")), kind: "date" },
    { key: "dsc", label: "DSC submitted", group: "Licensing", sql: sql`COALESCE(u.dsc_submitted, false)`, kind: "bool" },
    { key: "dsc_last", label: "DSC last submitted", group: "Licensing", sql: d(u("dsc_last_submitted_at")), kind: "date" },
    { key: "dsc_expiry", label: "DSC expiry", group: "Licensing", sql: d(u("dsc_expiry_at")), kind: "date" },
    { key: "amcs", label: "Distributing AMCs", group: "Licensing", sql: jsonbList(sql`u.distributing_amcs`) },
    { key: "territory_states", label: "Territory — states", group: "Licensing", sql: jsonbList(sql`(u.territory->'states')`) },
    { key: "territory_cities", label: "Territory — cities", group: "Licensing", sql: jsonbList(sql`(u.territory->'cities')`) },

    { key: "clients", label: "Active clients", group: "Targets & book", sql: sql`(SELECT COUNT(*)::int FROM investors i WHERE i.rm_id = u.id AND i.status = 'active')`, kind: "number" },
    { key: "aum", label: "AUM of active clients", group: "Targets & book", sql: sql`(SELECT COALESCE(SUM(i.aum::numeric), 0) FROM investors i WHERE i.rm_id = u.id AND i.status = 'active')`, kind: "money" },
    { key: "annual_target", label: "Annual target", group: "Targets & book", sql: u("annual_target"), kind: "money" },
    { key: "sip_target", label: "Monthly SIP target", group: "Targets & book", sql: u("sip_monthly_target"), kind: "money" },
    { key: "new_meetings_target", label: "New meetings target (monthly)", group: "Targets & book", sql: u("new_meetings_monthly_target"), kind: "number" },
    { key: "review_meetings_target", label: "Review meetings target (monthly)", group: "Targets & book", sql: u("renewal_meetings_monthly_target"), kind: "number" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Attendance — /dashboard/attendance
// ─────────────────────────────────────────────────────────────────────────────

const a = (c: string) => sql.raw(`a.${c}`);
/** IST "HH:MM" of a punch. */
const istTime = (expr: SQL) => sql`to_char((${expr}) AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')`;
/** The policy's expected wall-clock time on the row's date, as a timestamptz. */
const expectedAt = (col: "work_start" | "work_end", fallback: string) =>
  sql`((a.attendance_date + COALESCE(ast.${sql.raw(col)}, ${fallback})::time) AT TIME ZONE 'Asia/Kolkata')`;
const grace = sql`make_interval(mins => COALESCE(ast.grace_minutes, 10))`;

export const attendanceExport: ExportModule = {
  key: "attendance",
  label: "Attendance",
  fileName: "attendance",
  piiSubject: "user",
  // Managers only — the same rule as the payroll CSV (/api/attendance/export)
  // and the page's Settings / Monthly grid links.
  canView: (s) => hasRole(s, ["owner", "branch_head"]),
  from: sql`attendance a LEFT JOIN users u ON u.id = a.employee_user_id LEFT JOIN attendance_settings ast ON ast.tenant_id = a.tenant_id`,
  async where(_tx, session, params) {
    const sp: Record<string, string> = Object.fromEntries(params);
    const conds: SQL[] = [
      sql`a.tenant_id = ${session.tenantId}::uuid`,
      // Owners are left out unless the firm tracks them (Attendance settings).
      sql`(COALESCE(ast.track_owners, false) OR NOT ('owner' = ANY(COALESCE(u.roles, ARRAY[]::text[]))))`,
    ];
    const q = (params.get("q") ?? "").trim();
    if (q) conds.push(sql`u.name ILIKE ${`%${q}%`}`);
    conds.push(...inFilter(params.get("status"), sql`a.status`));
    const month = params.get("month");
    const dr = dateRangeCond(sp, "date", "a.attendance_date");
    if (params.get("today") === "1") conds.push(sql`a.attendance_date = current_date`);
    else if (dr) conds.push(dr);
    else if (month && /^\d{4}-\d{2}$/.test(month)) {
      // The monthly grid's month (?month=YYYY-MM).
      conds.push(sql`a.attendance_date >= ${`${month}-01`}::date AND a.attendance_date < (${`${month}-01`}::date + interval '1 month')`);
    } else conds.push(sql`a.attendance_date >= current_date - interval '30 days'`);
    return conds;
  },
  orderBy: sql`a.attendance_date DESC, u.name ASC`,
  columns: [
    { key: "date", label: "Date", group: "Day", sql: d(a("attendance_date")), kind: "date", default: true },
    { key: "employee", label: "Employee", group: "Day", sql: sql`u.name`, default: true },
    { key: "email", label: "Employee email", group: "Day", sql: sql`u.email`, pii: "email" },
    { key: "code", label: "Employee code", group: "Day", sql: sql`u.employee_code` },
    { key: "department", label: "Department", group: "Day", sql: humanCode(sql`u.department`) },
    { key: "branch", label: "Branch", group: "Day", sql: sql`(SELECT b.name FROM branches b WHERE b.id = u.branch_id)` },
    { key: "status", label: "Status", group: "Day", sql: labelOf(a("status"), ATTENDANCE_STATUS_LABELS), default: true },
    { key: "source", label: "Recorded by", group: "Day", sql: a("source") },
    { key: "note", label: "Note", group: "Day", sql: a("note") },

    { key: "clock_in", label: "Clock in", group: "Hours", sql: istTime(a("clock_in_at")), default: true },
    { key: "clock_out", label: "Clock out", group: "Hours", sql: istTime(a("clock_out_at")), default: true },
    { key: "minutes", label: "Worked (minutes)", group: "Hours", sql: a("total_minutes"), kind: "number" },
    { key: "hours", label: "Worked (hours)", group: "Hours", sql: sql`round(a.total_minutes / 60.0, 2)`, kind: "number", default: true },
    {
      key: "late",
      label: "Late by (minutes)",
      group: "Hours",
      sql: sql`(CASE WHEN a.clock_in_at IS NULL THEN NULL ELSE GREATEST(0, round(EXTRACT(EPOCH FROM (a.clock_in_at - (${expectedAt("work_start", "10:00")} + ${grace}))) / 60))::int END)`,
      kind: "number",
    },
    {
      key: "early",
      label: "Left early by (minutes)",
      group: "Hours",
      sql: sql`(CASE WHEN a.clock_out_at IS NULL THEN NULL ELSE GREATEST(0, round(EXTRACT(EPOCH FROM ((${expectedAt("work_end", "18:30")} - ${grace}) - a.clock_out_at)) / 60))::int END)`,
      kind: "number",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Leave — /dashboard/leave-applications
// ─────────────────────────────────────────────────────────────────────────────

const la = (c: string) => sql.raw(`la.${c}`);

export const leaveExport: ExportModule = {
  key: "leave",
  label: "Leave",
  fileName: "leave",
  piiSubject: "user",
  // Managers (the people who approve leave on this page), as for attendance.
  canView: (s) => hasRole(s, ["owner", "branch_head"]),
  from: sql`leave_applications la LEFT JOIN users u ON u.id = la.employee_user_id`,
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`la.tenant_id = ${session.tenantId}::uuid`];
    if (params.get("view") === "timeline") {
      // Team Timeline: requested + approved leave touching the month on show.
      const now = new Date(Date.now() + 330 * 60_000);
      const year = parseInt(params.get("year") ?? "", 10) || now.getUTCFullYear();
      const month = parseInt(params.get("month") ?? "", 10) || now.getUTCMonth() + 1;
      if (year >= 1900 && year <= 9999 && month >= 1 && month <= 12) {
        const start = `${year}-${String(month).padStart(2, "0")}-01`;
        conds.push(sql`la.status IN ('requested', 'approved')`);
        conds.push(sql`la.from_date < (${start}::date + interval '1 month') AND la.to_date >= ${start}::date`);
      }
      return conds;
    }
    const q = (params.get("q") ?? "").trim();
    if (q) conds.push(sql`u.name ILIKE ${`%${q}%`}`);
    // The list opens on Pending, as the page does.
    const statuses = (params.get("status") ?? "requested").split(",").filter(Boolean);
    if (statuses.length) conds.push(sql`la.status IN (${sql.join(statuses.map((v) => sql`${v}`), sql`, `)})`);
    conds.push(...inFilter(params.get("type"), sql`la.leave_type`));
    if (params.get("mine") === "1") conds.push(sql`la.employee_user_id = ${session.userId}::uuid`);
    return conds;
  },
  orderBy: sql`(la.status = 'requested') DESC, la.from_date DESC`,
  columns: [
    { key: "employee", label: "Employee", group: "Request", sql: sql`u.name`, default: true },
    { key: "code", label: "Employee code", group: "Request", sql: sql`u.employee_code` },
    { key: "department", label: "Department", group: "Request", sql: humanCode(sql`u.department`) },
    { key: "branch", label: "Branch", group: "Request", sql: sql`(SELECT b.name FROM branches b WHERE b.id = u.branch_id)` },
    { key: "type", label: "Leave type", group: "Request", sql: labelOf(la("leave_type"), LEAVE_TYPE_LABELS), default: true },
    { key: "duration", label: "Duration", group: "Request", sql: labelOf(la("duration"), LEAVE_DURATION_LABELS) },
    { key: "from", label: "From", group: "Request", sql: d(la("from_date")), kind: "date", default: true },
    { key: "to", label: "To", group: "Request", sql: d(la("to_date")), kind: "date", default: true },
    { key: "days", label: "Days", group: "Request", sql: la("no_of_days"), kind: "number", default: true },
    { key: "reason", label: "Reason", group: "Request", sql: la("reason") },
    { key: "comments", label: "Comments", group: "Request", sql: la("comments") },
    { key: "applied", label: "Applied on", group: "Request", sql: dIst(la("created_at")), kind: "date" },

    { key: "status", label: "Status", group: "Decision", sql: labelOf(la("status"), LEAVE_STATUS_LABELS), default: true },
    { key: "approver", label: "Decided by", group: "Decision", sql: userName(la("approver_user_id")), default: true },
    { key: "decided", label: "Decided on", group: "Decision", sql: dIst(la("decided_at")), kind: "date" },
    { key: "decision_notes", label: "Decision notes", group: "Decision", sql: la("decision_notes") },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-Distributors — /dashboard/sub-distributors
// ─────────────────────────────────────────────────────────────────────────────

const sd = (c: string) => sql.raw(`sd.${c}`);

const ASSOCIATION_LABELS: Record<string, string> = {
  individual: "Individual",
  firm: "Firm",
  channel_partner: "Channel partner",
  referral_partner: "Referral partner",
  internal_referral: "Internal referral",
  other: "Other",
};

export const subDistributorsExport: ExportModule = {
  key: "sub-distributors",
  label: "Sub-Distributors",
  fileName: "sub-distributors",
  piiSubject: "user",
  canView: (s) => can(s.roles, "compliance.edit", s.permissions),
  from: sql`sub_distributors sd`,
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`sd.tenant_id = ${session.tenantId}::uuid`];
    // The page opens on Active; "all" shows every status.
    const status = params.get("status") ?? "active";
    if (status !== "all") conds.push(sql`sd.status = ${status}`);
    return conds;
  },
  orderBy: sql`sd.name`,
  columns: [
    { key: "name", label: "Name", group: "Partner", sql: sd("name"), default: true },
    { key: "code", label: "Code", group: "Partner", sql: sd("code"), default: true },
    { key: "association", label: "Association", group: "Partner", sql: labelOf(sd("type_of_association"), ASSOCIATION_LABELS), default: true },
    { key: "status", label: "Status", group: "Partner", sql: sd("status"), default: true },
    { key: "city", label: "City", group: "Partner", sql: sd("city") },
    { key: "rm", label: "Our relationship manager", group: "Partner", sql: sql`(SELECT u_.name FROM users u_ WHERE u_.id::text = sd.relationship_manager_id)` },
    { key: "onboarded", label: "Agreement signed", group: "Partner", sql: d(sd("onboarded_at")), kind: "date" },
    { key: "terminated", label: "Terminated on", group: "Partner", sql: d(sd("terminated_at")), kind: "date" },
    { key: "remarks", label: "Remarks", group: "Partner", sql: sd("remarks") },

    { key: "email", label: "Email", group: "Contact", sql: sd("email"), pii: "email", default: true },
    { key: "mobile", label: "Mobile", group: "Contact", sql: sd("mobile"), pii: "phone", default: true },
    { key: "pan", label: "PAN", group: "Contact", sql: sd("pan_number"), pii: "pan" },

    { key: "arn", label: "ARN", group: "Licensing", sql: sd("arn_number"), default: true },
    { key: "arn_reg", label: "ARN registration date", group: "Licensing", sql: d(sd("arn_registration_date")), kind: "date" },
    { key: "arn_expiry", label: "ARN expiry", group: "Licensing", sql: d(sd("arn_expiry_at")), kind: "date", default: true },
    { key: "euin", label: "EUIN", group: "Licensing", sql: sd("euin") },
    { key: "euin_expiry", label: "EUIN expiry", group: "Licensing", sql: d(sd("euin_expiry_at")), kind: "date" },
    { key: "nism_no", label: "NISM certificate no.", group: "Licensing", sql: sd("nism_cert_no") },
    { key: "nism_category", label: "NISM category", group: "Licensing", sql: sd("nism_category") },
    { key: "nism_exam", label: "NISM exam date", group: "Licensing", sql: d(sd("nism_exam_date")), kind: "date" },
    { key: "nism_expiry", label: "NISM expiry", group: "Licensing", sql: d(sd("nism_expiry_at")), kind: "date" },
    { key: "dsc", label: "DSC on file", group: "Licensing", sql: sql`COALESCE(sd.dsc_on_file, false)`, kind: "bool" },

    { key: "split", label: "Commission split %", group: "Payout", sql: sd("commission_split_pct"), kind: "number" },
    { key: "bank_holder", label: "Account holder", group: "Payout", sql: sql`(sd.bank_details->>'accountHolder')`, pii: "bank" },
    { key: "bank_name", label: "Bank", group: "Payout", sql: sql`(sd.bank_details->>'bankName')`, pii: "bank" },
    { key: "bank_ifsc", label: "IFSC", group: "Payout", sql: sql`(sd.bank_details->>'ifsc')`, pii: "bank" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Legal Registrations — /dashboard/legal-registrations
// ─────────────────────────────────────────────────────────────────────────────

const lr = (c: string) => sql.raw(`lr.${c}`);

const AUTHORITY_LABELS: Record<string, string> = {
  AMFI: "AMFI",
  SEBI: "SEBI",
  IRDAI: "IRDAI",
  GST: "GST",
  Income_Tax: "Income Tax",
  MCA: "MCA / ROC",
  RBI: "RBI",
  State_Govt: "State Govt",
  Local_Authority: "Local Authority",
  Trademark_Registry: "Trademark Registry",
  FIU_IND: "FIU-IND",
  Other: "Other",
};

const today = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;
/** Days to expiry; null when perpetual or no date (these never alarm). */
const lrDaysLeft = sql`(CASE WHEN lr.expiry_at IS NULL OR lr.renewal_frequency = 'perpetual' THEN NULL ELSE (lr.expiry_at - ${today}) END)`;
/** Status as it stands today — the page's effectiveStatus(). */
const lrEffectiveStatus = sql`(CASE WHEN lr.status IN ('surrendered', 'rejected', 'expired') THEN lr.status
  WHEN ${lrDaysLeft} < 0 THEN 'expired' ELSE lr.status END)`;

export const legalRegistrationsExport: ExportModule = {
  key: "legal-registrations",
  label: "Legal Registrations",
  fileName: "legal-registrations",
  canView: (s) => can(s.roles, "compliance.edit", s.permissions),
  from: sql`legal_registrations lr`,
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`lr.tenant_id = ${session.tenantId}::uuid`];
    const status = params.get("status") ?? "active";
    if (status !== "all") conds.push(sql`${lrEffectiveStatus} = ${status}`);
    const authority = params.get("authority") ?? "all";
    if (authority !== "all") conds.push(sql`lr.authority = ${authority}`);
    return conds;
  },
  orderBy: sql`lr.expiry_at ASC NULLS LAST, lr.registration_for`,
  columns: [
    { key: "name_of", label: "Registered in name of", group: "Registration", sql: lr("registered_in_name_of"), default: true },
    { key: "authority", label: "Authority", group: "Registration", sql: sql`(CASE WHEN lr.authority = 'Other' AND lr.authority_other IS NOT NULL THEN lr.authority_other ELSE ${labelOf(lr("authority"), AUTHORITY_LABELS)} END)`, default: true },
    { key: "for", label: "Registration for", group: "Registration", sql: lr("registration_for"), default: true },
    { key: "number", label: "Registration number", group: "Registration", sql: lr("registration_number"), default: true },
    { key: "reg_date", label: "Registration date", group: "Registration", sql: d(lr("registration_date")), kind: "date" },
    { key: "documents", label: "Documents on file", group: "Registration", sql: jsonbCount(sql`lr.documents`), kind: "number" },
    { key: "remarks", label: "Remarks", group: "Registration", sql: lr("remarks") },
    { key: "added", label: "Added on", group: "Registration", sql: dIst(lr("created_at")), kind: "date" },

    { key: "expiry", label: "Expiry", group: "Renewal", sql: d(lr("expiry_at")), kind: "date", default: true },
    { key: "days_left", label: "Days to expiry", group: "Renewal", sql: lrDaysLeft, kind: "number" },
    { key: "renewal", label: "Renewal frequency", group: "Renewal", sql: humanCode(lr("renewal_frequency")) },
    { key: "renewal_details", label: "Renewal details", group: "Renewal", sql: lr("renewal_details") },
    { key: "status", label: "Status", group: "Renewal", sql: humanCode(lrEffectiveStatus), default: true },
    { key: "status_recorded", label: "Status as recorded", group: "Renewal", sql: humanCode(lr("status")) },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Scheme Master — /dashboard/schemes
// ─────────────────────────────────────────────────────────────────────────────

const s_ = (c: string) => sql.raw(`s.${c}`);
/** Plan / coarse category with the gaps filled from name + category, as the page shows them. */
const planEff = sql`COALESCE(s.plan, ${planSql(sql`s.scheme_name`, sql`COALESCE(s.category, s.sub_category)`)})`;
const coarseEff = sql`(CASE WHEN s.coarse_category IS NULL OR s.coarse_category = 'other'
  THEN ${coarseSql(sql`COALESCE(s.category, s.sub_category, '')`, sql`s.scheme_name`)}
  ELSE s.coarse_category END)`;

export const schemeMasterExport: ExportModule = {
  key: "schemes",
  label: "Scheme Master",
  fileName: "scheme-master",
  // Firm reference data: the page is open to every signed-in member (scheme
  // pickers across the CRM send people to it). The export permission still applies.
  canView: () => true,
  from: sql`scheme_master s LEFT JOIN amc_master am ON am.tenant_id = s.tenant_id AND am.code = s.amc_code`,
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`s.tenant_id = ${session.tenantId}::uuid`];
    // Direct plans are hidden by default: a distributor cannot sell them.
    if (params.get("direct") !== "1") conds.push(sql`${planEff} IS DISTINCT FROM 'direct'`);
    const q = (params.get("q") ?? "").trim();
    if (q) conds.push(sql`(s.scheme_name ILIKE ${`%${q}%`} OR s.scheme_code ILIKE ${`%${q}%`})`);
    const amc = listParam(params, "amc");
    if (amc.length) conds.push(sql`s.amc_code IN (${sql.join(amc.map((v) => sql`${v}`), sql`, `)})`);
    const coarse = listParam(params, "coarse");
    if (coarse.length) conds.push(sql`${coarseEff} IN (${sql.join(coarse.map((v) => sql`${v}`), sql`, `)})`);
    conds.push(...inFilter(params.get("risk"), sql`s.risk_category`));
    if (params.get("shortlisted") === "1") conds.push(sql`s.is_shortlisted = true`);
    return conds;
  },
  orderBy: sql`s.is_shortlisted DESC NULLS LAST, s.scheme_name ASC`,
  columns: [
    { key: "name", label: "Scheme", group: "Scheme", sql: s_("scheme_name"), default: true },
    { key: "code", label: "Scheme code", group: "Scheme", sql: s_("scheme_code"), default: true },
    { key: "amc", label: "AMC", group: "Scheme", sql: sql`COALESCE(am.name, s.amc_code)`, default: true },
    { key: "amc_code", label: "AMC code", group: "Scheme", sql: s_("amc_code") },
    { key: "rta", label: "RTA", group: "Scheme", sql: sql`upper(am.rta)` },
    { key: "coarse", label: "Asset class", group: "Scheme", sql: humanCode(coarseEff), default: true },
    { key: "category", label: "Category", group: "Scheme", sql: s_("category"), default: true },
    { key: "sub_category", label: "Sub-category", group: "Scheme", sql: s_("sub_category") },
    { key: "plan", label: "Plan", group: "Scheme", sql: humanCode(planEff) },
    { key: "option", label: "Option", group: "Scheme", sql: sql`(CASE s.option WHEN 'growth' THEN 'Growth' WHEN 'idcw_payout' THEN 'IDCW payout' WHEN 'idcw_reinvest' THEN 'IDCW reinvest' ELSE s.option END)` },
    { key: "risk", label: "Risk", group: "Scheme", sql: humanCode(s_("risk_category")), default: true },
    { key: "min_inv", label: "Minimum investment", group: "Scheme", sql: s_("min_investment") },
    { key: "min_sip", label: "Minimum SIP", group: "Scheme", sql: s_("min_sip") },
    { key: "exit_load", label: "Exit load", group: "Scheme", sql: s_("exit_load") },
    { key: "active", label: "Active", group: "Scheme", sql: s_("is_active"), kind: "bool" },
    { key: "closed", label: "Closed", group: "Scheme", sql: sql`COALESCE(s.is_closed, false)`, kind: "bool" },

    { key: "shortlisted", label: "Shortlisted (buy-list)", group: "Shortlist & evaluation", sql: sql`COALESCE(s.is_shortlisted, false)`, kind: "bool", default: true },
    { key: "shortlisted_on", label: "Shortlisted on", group: "Shortlist & evaluation", sql: dIst(s_("shortlisted_at")), kind: "date" },
    { key: "shortlisted_by", label: "Shortlisted by", group: "Shortlist & evaluation", sql: userName(s_("shortlisted_by")) },
    { key: "rationale", label: "Shortlist rationale", group: "Shortlist & evaluation", sql: s_("shortlist_rationale") },
    { key: "verdict", label: "IC verdict", group: "Shortlist & evaluation", sql: humanCode(sql`(s.evaluation->>'verdict')`) },
    { key: "evaluated_at", label: "Evaluated on", group: "Shortlist & evaluation", sql: sql`left(s.evaluation->>'evaluatedAt', 10)`, kind: "date" },
    { key: "fm", label: "Fund manager", group: "Shortlist & evaluation", sql: sql`(s.evaluation->>'fmName')` },
    { key: "cagr5", label: "5-year CAGR %", group: "Shortlist & evaluation", sql: sql`(s.evaluation->>'fiveYearCagrPct')`, kind: "number" },
    { key: "expense", label: "Expense ratio %", group: "Shortlist & evaluation", sql: sql`(s.evaluation->>'expenseRatioPct')`, kind: "number" },
    { key: "sharpe", label: "Sharpe ratio", group: "Shortlist & evaluation", sql: sql`(s.evaluation->>'sharpeRatio')`, kind: "number" },
    { key: "stddev", label: "Std deviation %", group: "Shortlist & evaluation", sql: sql`(s.evaluation->>'stdDevPct')`, kind: "number" },
    { key: "aum_cr", label: "Fund AUM (₹ Cr)", group: "Shortlist & evaluation", sql: sql`(s.evaluation->>'aumCrore')`, kind: "number" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// AMC Empanelments — /dashboard/amc-empanelments
// ─────────────────────────────────────────────────────────────────────────────

const ae = (c: string) => sql.raw(`ae.${c}`);

export const amcEmpanelmentsExport: ExportModule = {
  key: "amc-empanelments",
  label: "AMC Empanelments",
  fileName: "amc-empanelments",
  piiSubject: "user",
  canView: (s) =>
    can(s.roles, "compliance.view", s.permissions) ||
    can(s.roles, "compliance.edit", s.permissions) ||
    can(s.roles, "settings.masters", s.permissions),
  from: sql`amc_empanelments ae`,
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`ae.tenant_id = ${session.tenantId}::uuid`];
    const status = params.get("status") ?? "empanelled";
    if (status !== "all") conds.push(sql`ae.status = ${status}`);
    return conds;
  },
  orderBy: sql`ae.amc_name`,
  columns: [
    { key: "amc", label: "AMC", group: "Empanelment", sql: ae("amc_name"), default: true },
    { key: "amc_code", label: "AMC code", group: "Empanelment", sql: ae("amc_code") },
    { key: "distributor_code", label: "Distributor code", group: "Empanelment", sql: ae("distributor_code"), default: true },
    { key: "date", label: "Empanelled on", group: "Empanelment", sql: d(ae("empanelment_date")), kind: "date", default: true },
    { key: "status", label: "Status", group: "Empanelment", sql: humanCode(ae("status")), default: true },
    { key: "terminated", label: "Terminated on", group: "Empanelment", sql: d(ae("terminated_at")), kind: "date" },
    { key: "trail", label: "Trail rate % (agreed)", group: "Empanelment", sql: ae("trail_rate_override_pct"), kind: "number" },
    { key: "portal", label: "Distributor portal", group: "Empanelment", sql: ae("portal_url") },
    { key: "documents", label: "Documents on file", group: "Empanelment", sql: jsonbCount(sql`ae.documents`), kind: "number" },
    { key: "remarks", label: "Remarks", group: "Empanelment", sql: ae("remarks") },

    { key: "rm_name", label: "AMC RM", group: "AMC contacts", sql: ae("rm_name"), default: true },
    { key: "rm_email", label: "AMC RM email", group: "AMC contacts", sql: ae("rm_email"), pii: "email" },
    { key: "rm_phone", label: "AMC RM phone", group: "AMC contacts", sql: ae("rm_phone"), pii: "phone", default: true },
    { key: "ops_name", label: "Operations contact", group: "AMC contacts", sql: ae("ops_name") },
    { key: "ops_email", label: "Operations email", group: "AMC contacts", sql: ae("ops_email"), pii: "email" },
    { key: "ops_phone", label: "Operations phone", group: "AMC contacts", sql: ae("ops_phone"), pii: "phone" },
    { key: "esc_name", label: "Escalation contact", group: "AMC contacts", sql: ae("escalation_name") },
    { key: "esc_email", label: "Escalation email", group: "AMC contacts", sql: ae("escalation_email"), pii: "email" },
    { key: "esc_phone", label: "Escalation phone", group: "AMC contacts", sql: ae("escalation_phone"), pii: "phone" },

    { key: "philosophy", label: "Investment philosophy", group: "Due diligence", sql: ae("investment_philosophy") },
    { key: "strengths", label: "Fund-house strengths", group: "Due diligence", sql: ae("fund_house_strengths") },
    { key: "red_flags", label: "Red flags", group: "Due diligence", sql: ae("red_flags") },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Products & Services — /dashboard/product-offerings
// ─────────────────────────────────────────────────────────────────────────────

const po = (c: string) => sql.raw(`po.${c}`);

const CATEGORY_LABELS: Record<string, string> = {
  mutual_funds: "Mutual Funds",
  insurance_life: "Insurance — Life",
  insurance_general: "Insurance — General",
  insurance_health: "Insurance — Health",
  pms: "PMS",
  aif: "AIF",
  bonds: "Bonds",
  corporate_fd: "Corporate FD",
  nps: "NPS",
  equity: "Equity",
  tax_planning: "Tax Planning",
  estate_planning: "Estate Planning",
  advisory: "Advisory",
  loans: "Loans",
  real_estate: "Real Estate",
  international: "International Investments",
  other: "Other",
};

export const productOfferingsExport: ExportModule = {
  key: "product-offerings",
  label: "Products & Services",
  fileName: "products-and-services",
  // Viewing is open to every team member (the page's own rule).
  canView: () => true,
  from: sql`product_offerings po`,
  async where(_tx, session, params) {
    const conds: SQL[] = [sql`po.tenant_id = ${session.tenantId}::uuid`];
    const status = params.get("status") ?? "active";
    if (status !== "all") conds.push(sql`po.status = ${status}`);
    const category = params.get("category") ?? "all";
    if (category !== "all") conds.push(sql`po.category = ${category}`);
    return conds;
  },
  orderBy: sql`po.name`,
  columns: [
    { key: "name", label: "Offering", group: "Offering", sql: po("name"), default: true },
    { key: "category", label: "Category", group: "Offering", sql: labelOf(po("category"), CATEGORY_LABELS), default: true },
    { key: "regulator", label: "Regulator", group: "Offering", sql: sql`replace(po.regulator, '_', ' ')`, default: true },
    { key: "providers", label: "Providers", group: "Offering", sql: jsonbList(sql`po.providers`), default: true },
    { key: "status", label: "Status", group: "Offering", sql: humanCode(po("status")), default: true },
    { key: "launched", label: "Launched on", group: "Offering", sql: d(po("launched_at")), kind: "date" },
    { key: "discontinued", label: "Discontinued on", group: "Offering", sql: d(po("discontinued_at")), kind: "date" },
    { key: "documents", label: "Documents on file", group: "Offering", sql: jsonbCount(sql`po.documents`), kind: "number" },
    { key: "remarks", label: "Remarks", group: "Offering", sql: po("remarks") },

    { key: "exams", label: "Required exams", group: "Team & licences", sql: jsonbList(sql`po.required_exams`) },
    {
      key: "team",
      label: "Team members",
      group: "Team & licences",
      sql: sql`(SELECT string_agg(tu.name, ', ' ORDER BY tu.name) FROM users tu WHERE tu.id = ANY(COALESCE(po.team_member_ids, ARRAY[]::uuid[])))`,
      default: true,
    },
    {
      key: "registrations",
      label: "Authorising registrations",
      group: "Team & licences",
      sql: sql`(SELECT string_agg(rg.registration_for, ', ' ORDER BY rg.registration_for) FROM legal_registrations rg WHERE rg.id = ANY(COALESCE(po.linked_registration_ids, ARRAY[]::uuid[])))`,
    },
    {
      key: "licence_expiry",
      label: "Earliest licence expiry",
      group: "Team & licences",
      sql: sql`(SELECT to_char(MIN(rg.expiry_at), 'YYYY-MM-DD') FROM legal_registrations rg WHERE rg.id = ANY(COALESCE(po.linked_registration_ids, ARRAY[]::uuid[])) AND rg.renewal_frequency <> 'perpetual')`,
      kind: "date",
    },
  ],
};
