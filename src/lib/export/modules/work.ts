/**
 * Work modules — Tasks, Meetings, Service Requests, Activity Log and Expected
 * Inflows. Each `where` repeats its list page's access rule and URL filters,
 * so the file is what the viewer may see on that screen (and never more: where
 * the page itself applies no row scope, the module's own API rule is used).
 */

import { sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { attendeeIs, attendeeIsAnyUser } from "@/lib/review-meetings/attendees";
import { dateRangeCond } from "@/lib/filters/date-range";
import { overdueTaskSql, srPastSlaSql, srWhere, staffWhere, taskAwaitingSql } from "@/lib/metrics";
import { FINANCIAL_TASK_TYPES, taskInvestor, taskLead } from "@/lib/dashboard/my/window";
import { REQUEST_TYPES } from "@/lib/tasks/request-types";
import { INFLOW_SOURCE_LABELS } from "@/db/schema";
import { d, dIst, dt, inFilter, userName } from "../helpers";
import type { ExportModule } from "../types";

// ── shared bits ────────────────────────────────────────────────────────────

/** "in_progress" → "In Progress". */
const human = (e: SQL) => sql`initcap(replace(${e}, '_', ' '))`;

/** A coded value through a label map, else humanised. */
function labelled(e: SQL, map: Record<string, string>): SQL {
  const whens = Object.entries(map).map(([k, v]) => sql`WHEN ${k}::text THEN ${v}::text`);
  return sql`(CASE ${e} ${sql.join(whens, sql` `)} ELSE ${human(e)} END)`;
}

/** A jsonb value as an array (anything else → empty). */
const jarr = (e: SQL) => sql`(CASE WHEN jsonb_typeof(${e}) = 'array' THEN ${e} ELSE '[]'::jsonb END)`;

/** The list page's query string as the record the shared filter helpers read. */
const spOf = (params: URLSearchParams) => Object.fromEntries(params) as Record<string, string>;
const csv = (params: URLSearchParams, k: string) =>
  (params.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const UUID = /^[0-9a-f-]{36}$/i;
const uuidList = (ids: string[]) => sql.join(ids.map((v) => sql`${v}::uuid`), sql`, `);

// ── Tasks (/dashboard/tasks) ───────────────────────────────────────────────

const t = (c: string) => sql.raw(`tasks.${c}`);
const TASK_TYPE_LABEL: Record<string, string> = Object.fromEntries(REQUEST_TYPES.map((r) => [r.key, r.label]));
const OPEN_TASK = sql`tasks.status IN ('open', 'in_progress', 'blocked')`;
const IST_TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const DUE_DAY = sql`(tasks.due_at AT TIME ZONE 'Asia/Kolkata')::date`;
const reqRows = jarr(sql`tasks.meta->'request'->'rows'`);

export const tasksExport: ExportModule = {
  key: "tasks",
  label: "Tasks",
  fileName: "tasks",
  piiSubject: "investor",
  canView: (s) => can(s.roles, "task.view.all", s.permissions) || can(s.roles, "task.view.assigned", s.permissions),
  from: sql`tasks
    LEFT JOIN users au ON au.id = tasks.assignee_id
    LEFT JOIN investors ti ON ti.id = ${taskInvestor("tasks")}
    LEFT JOIN leads tl ON tl.id = ${taskLead("tasks")}`,
  async where(_tx, session, params) {
    const sp = spOf(params);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const conds: SQL[] = [sql`tasks.tenant_id = ${session.tenantId}::uuid`, sql`tasks.deleted_at IS NULL`];
    // Same rule as the list: firm-wide with task.view.all, else what I'm
    // assigned or created.
    if (!canViewAll) conds.push(sql`(tasks.assignee_id = ${session.userId}::uuid OR tasks.created_by_id = ${session.userId}::uuid)`);

    const rawView = sp.view ?? "";
    const isKanban = rawView === "kanban" || sp.layout === "kanban";
    const view = rawView === "kanban" ? "" : rawView;
    if (view === "to_me") conds.push(sql`tasks.assignee_id = ${session.userId}::uuid`);
    else if (view === "by_me") conds.push(sql`tasks.created_by_id = ${session.userId}::uuid`);

    const statusFilter = csv(params, "status");
    const approval = sp.approval ?? "";
    const state = ["all", "pending", "awaiting", "completed"].includes(sp.state ?? "") ? sp.state : "";
    const tab = ["overdue", "today", "upcoming", "completed"].includes(sp.tab ?? "") ? sp.tab : "";
    if (!isKanban) {
      if (tab === "completed") conds.push(sql`tasks.status = 'completed'`);
      else if (tab === "overdue") conds.push(overdueTaskSql("tasks"));
      else if (tab) conds.push(OPEN_TASK);
      if (tab === "today") conds.push(sql`tasks.due_at >= now() AND ${DUE_DAY} = ${IST_TODAY}`);
      if (tab === "upcoming") conds.push(sql`${DUE_DAY} > ${IST_TODAY}`);
      if (statusFilter.length) conds.push(...inFilter(statusFilter.join(","), sql`tasks.status`));
      else if (!tab && !approval && !state) conds.push(OPEN_TASK);
      if (!statusFilter.length) {
        if (state === "pending") conds.push(sql`tasks.status IN ('open', 'in_progress') AND NOT ${taskAwaitingSql("tasks")}`);
        else if (state === "awaiting") conds.push(taskAwaitingSql("tasks"));
        else if (state === "completed") conds.push(sql`tasks.status = 'completed'`);
      }
    }
    const finList = sql.join(FINANCIAL_TASK_TYPES.map((x) => sql`${x}`), sql`, `);
    if (sp.fin === "1") conds.push(sql`tasks.type IN (${finList})`);
    else if (sp.fin === "0") conds.push(sql`(tasks.type IS NULL OR tasks.type NOT IN (${finList}))`);

    if (approval === "pending" || approval === "mine") conds.push(sql`tasks.approval_status = 'pending'`);
    if (approval === "mine" && !canViewAll) conds.push(sql`tasks.created_by_id = ${session.userId}::uuid`);

    const q = (sp.q ?? "").trim();
    if (q) conds.push(sql`(tasks.title ILIKE ${`%${q}%`} OR tasks.description ILIKE ${`%${q}%`} OR au.name ILIKE ${`%${q}%`})`);
    conds.push(...inFilter(params.get("priority"), sql`tasks.priority`));
    conds.push(...inFilter(params.get("type"), sql`tasks.type`));
    conds.push(...inFilter(params.get("department"), sql`tasks.department`));
    conds.push(...inFilter(params.get("assignee"), sql`tasks.assignee_id`));
    const branches = csv(params, "branch").filter((v) => UUID.test(v));
    if (branches.length) conds.push(staffWhere({ tenantId: session.tenantId, branchIds: branches }, sql`tasks.assignee_id`));
    const tags = csv(params, "tags");
    if (tags.length) conds.push(sql`tasks.tags ?| ARRAY[${sql.join(tags.map((x) => sql`${x}`), sql`, `)}]::text[]`);
    const flags = csv(params, "flag");
    if (flags.includes("requires_approval")) conds.push(sql`tasks.requires_approval = true`);
    if (flags.includes("recurring")) conds.push(sql`tasks.recurrence IS NOT NULL`);
    if (flags.includes("has_attachments"))
      conds.push(sql`EXISTS (SELECT 1 FROM task_attachments a WHERE a.task_id = tasks.id AND a.deleted_at IS NULL)`);
    const dueDr = dateRangeCond(sp, "due", "tasks.due_at");
    if (dueDr) conds.push(dueDr);
    const due = csv(params, "due");
    const dueConds: SQL[] = [];
    if (due.includes("today")) dueConds.push(sql`tasks.due_at::date = current_date`);
    if (due.includes("overdue")) dueConds.push(sql`tasks.due_at < now()`);
    if (due.includes("sla_risk")) dueConds.push(sql`(tasks.sla_due_at IS NOT NULL AND tasks.sla_due_at < now() + interval '24 hours')`);
    if (dueConds.length) conds.push(sql`(${sql.join(dueConds, sql` OR `)})`);
    const createdDr = dateRangeCond(sp, "created", "(tasks.created_at AT TIME ZONE 'Asia/Kolkata')::date");
    if (createdDr) conds.push(createdDr);
    return conds;
  },
  orderBy: sql`CASE WHEN tasks.due_at < now() AND tasks.status IN ('open','in_progress','blocked') THEN 0 ELSE 1 END, tasks.due_at ASC NULLS LAST, tasks.created_at DESC`,
  columns: [
    { key: "title", label: "Title", group: "Task", sql: t("title"), default: true },
    { key: "type", label: "Type", group: "Task", sql: labelled(t("type"), TASK_TYPE_LABEL), default: true },
    { key: "financial", label: "Financial request", group: "Task", sql: sql`(tasks.type IN (${sql.join(FINANCIAL_TASK_TYPES.map((x) => sql`${x}`), sql`, `)}))`, kind: "bool" },
    { key: "department", label: "Department", group: "Task", sql: human(t("department")) },
    { key: "priority", label: "Priority", group: "Task", sql: human(t("priority")), default: true },
    { key: "status", label: "Status", group: "Task", sql: human(t("status")), default: true },
    { key: "overdue", label: "Overdue", group: "Task", sql: sql`(${OPEN_TASK} AND tasks.due_at < now())`, kind: "bool" },
    { key: "description", label: "Description", group: "Task", sql: t("description") },
    { key: "remarks", label: "Remarks", group: "Task", sql: t("remarks") },
    { key: "tags", label: "Tags", group: "Task", sql: sql`(SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(${jarr(sql`tasks.tags`)}) x)` },
    { key: "recurrence", label: "Repeats", group: "Task", sql: human(t("recurrence")) },

    { key: "assignee", label: "Assigned to", group: "People", sql: sql`au.name`, default: true },
    { key: "created_by", label: "Assigned by", group: "People", sql: userName(t("created_by_id")) },

    { key: "client", label: "Client", group: "Linked to", sql: sql`ti.name`, default: true },
    { key: "lead", label: "Lead", group: "Linked to", sql: sql`tl.name` },
    { key: "about", label: "Related to", group: "Linked to", sql: labelled(t("subject_type"), { investor: "Client", service_request: "Service request" }) },
    { key: "ticket", label: "Service request #", group: "Linked to", sql: sql`(SELECT sr_.ticket_no FROM service_requests sr_ WHERE sr_.id = COALESCE(tasks.related_service_request_id, CASE WHEN tasks.subject_type = 'service_request' THEN tasks.subject_id END))` },

    { key: "created", label: "Created on", group: "Dates", sql: dt(t("created_at")), kind: "datetime" },
    { key: "due", label: "Due", group: "Dates", sql: dt(t("due_at")), kind: "datetime", default: true },
    { key: "sla_due", label: "SLA due", group: "Dates", sql: dt(t("sla_due_at")), kind: "datetime" },
    { key: "remind", label: "Reminder", group: "Dates", sql: dt(t("remind_at")), kind: "datetime" },
    { key: "completed", label: "Completed on", group: "Dates", sql: dt(t("completed_at")), kind: "datetime" },

    { key: "req_schemes", label: "Schemes", group: "Request details", sql: sql`COALESCE((SELECT string_agg(r->>'schemeName', '; ') FROM jsonb_array_elements(${reqRows}) r), tasks.meta->'request'->>'scheme')` },
    { key: "req_from", label: "From scheme (switch / STP)", group: "Request details", sql: sql`(SELECT string_agg(r->>'fromSchemeName', '; ') FROM jsonb_array_elements(${reqRows}) r WHERE r->>'fromSchemeName' IS NOT NULL)` },
    { key: "req_amount", label: "Amount", group: "Request details", sql: sql`tasks.meta->>'boValue'`, kind: "money" },
    { key: "req_mode", label: "Mode", group: "Request details", sql: human(sql`tasks.meta->>'boChannel'`) },
    { key: "req_folio", label: "Folio", group: "Request details", sql: sql`COALESCE((SELECT string_agg(DISTINCT r->>'folio', ', ') FROM jsonb_array_elements(${reqRows}) r WHERE COALESCE(r->>'folio', '') <> ''), tasks.meta->'request'->>'folio')` },
    { key: "req_sip_day", label: "SIP day", group: "Request details", sql: sql`COALESCE((SELECT string_agg(DISTINCT r->>'sipDay', ', ') FROM jsonb_array_elements(${reqRows}) r WHERE COALESCE(r->>'sipDay', '') <> ''), tasks.meta->'request'->>'sipDate')` },

    { key: "requires_approval", label: "Needs approval", group: "Approval", sql: t("requires_approval"), kind: "bool" },
    { key: "approval_status", label: "Approval status", group: "Approval", sql: human(t("approval_status")) },
    { key: "approved_by", label: "Approved by", group: "Approval", sql: userName(t("approved_by")) },
    { key: "approved_at", label: "Approved on", group: "Approval", sql: dt(t("approved_at")), kind: "datetime" },
    { key: "approval_note", label: "Approval note", group: "Approval", sql: t("approval_note") },

    { key: "estimate", label: "Estimate (minutes)", group: "Time", sql: t("estimate_minutes"), kind: "number" },
    { key: "spent", label: "Time spent (minutes)", group: "Time", sql: t("time_spent_minutes"), kind: "number" },
  ],
};

// ── Meetings (/dashboard/review-meetings) ──────────────────────────────────

const m = (c: string) => sql.raw(`m.${c}`);
const MEETING_TYPE_LABEL: Record<string, string> = {
  portfolio_review: "Portfolio Review",
  goal_review: "Goal Review",
  new_investment_discussion: "New Investment",
  service_discussion: "Service Discussion",
  family_review: "Family Review",
  complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call",
  new_client_kickoff: "Client Kickoff",
  product_demo: "Product Demo",
  sales_pitch: "Sales Pitch",
  follow_up_call: "Follow-up Call",
  follow_up_visit: "Follow-up Visit",
  other: "Other",
};

export const meetingsExport: ExportModule = {
  key: "meetings",
  label: "Meetings",
  fileName: "meetings",
  piiSubject: "investor",
  canView: (s) =>
    can(s.roles, "review_meeting.manage.all", s.permissions) || can(s.roles, "review_meeting.manage.assigned", s.permissions),
  from: sql`review_meetings m
    LEFT JOIN investors i ON i.id = m.investor_id
    LEFT JOIN leads l ON l.id = m.lead_id
    LEFT JOIN users u ON u.id = m.rm_id`,
  async where(_tx, session, params) {
    const sp = spOf(params);
    const conds: SQL[] = [sql`m.tenant_id = ${session.tenantId}::uuid`];
    // The meetings API's rule: firm-wide with review_meeting.manage.all, else the
    // meetings I own or attend.
    if (!can(session.roles, "review_meeting.manage.all", session.permissions)) {
      conds.push(sql`(m.rm_id = ${session.userId}::uuid OR ${attendeeIs("user", session.userId)})`);
    }
    const q = (sp.q ?? "").trim();
    if (q) {
      conds.push(sql`(i.name ILIKE ${`%${q}%`} OR l.name ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`} OR m.discussion_points ILIKE ${`%${q}%`} OR m.meeting_notes ILIKE ${`%${q}%`})`);
    }
    conds.push(...inFilter(params.get("category"), sql`m.category`));
    conds.push(...inFilter(params.get("status"), sql`m.status`));
    conds.push(...inFilter(params.get("mode"), sql`m.meeting_mode`));
    conds.push(...inFilter(params.get("type"), sql`m.meeting_type`));
    const rms = csv(params, "rm").filter((v) => UUID.test(v));
    if (rms.length) conds.push(sql`(m.rm_id IN (${uuidList(rms)}) OR ${attendeeIsAnyUser(rms)})`);
    const dr = dateRangeCond(sp, "meeting", "m.meeting_date");
    if (dr) conds.push(dr);
    return conds;
  },
  orderBy: sql`m.meeting_date DESC`,
  columns: [
    { key: "date", label: "Meeting date", group: "Meeting", sql: dt(m("meeting_date")), kind: "datetime", default: true },
    { key: "subject", label: "Subject", group: "Meeting", sql: m("subject") },
    { key: "agenda", label: "Agenda", group: "Meeting", sql: labelled(m("meeting_type"), MEETING_TYPE_LABEL), default: true },
    { key: "category", label: "Category", group: "Meeting", sql: human(m("category")) },
    { key: "mode", label: "Mode", group: "Meeting", sql: human(m("meeting_mode")), default: true },
    { key: "location", label: "Location / link", group: "Meeting", sql: m("location_or_link") },
    { key: "duration", label: "Duration (minutes)", group: "Meeting", sql: m("duration_minutes"), kind: "number" },
    { key: "status", label: "Status", group: "Meeting", sql: human(m("status")), default: true },
    { key: "ended", label: "Ended at", group: "Meeting", sql: dt(m("actual_end_at")), kind: "datetime" },
    { key: "reschedules", label: "Times rescheduled", group: "Meeting", sql: m("reschedule_count"), kind: "number" },
    { key: "reschedule_reason", label: "Reschedule reason", group: "Meeting", sql: m("reschedule_reason") },

    { key: "party", label: "Client / lead", group: "With", sql: sql`COALESCE(i.name, l.name)`, default: true },
    { key: "party_kind", label: "Client or lead", group: "With", sql: sql`CASE WHEN i.id IS NOT NULL THEN 'Client' WHEN l.id IS NOT NULL THEN 'Lead' END` },
    { key: "client_phone", label: "Client mobile", group: "With", sql: sql`i.phone`, pii: "phone" },
    { key: "family", label: "Family", group: "With", sql: sql`(SELECT COALESCE(f.family_name, f.head_name) FROM families f WHERE f.id = m.family_id)` },
    { key: "rm", label: "RM", group: "With", sql: sql`u.name`, default: true },
    { key: "attendees", label: "Attendees", group: "With", sql: sql`(SELECT string_agg(att->>'name', ', ') FROM jsonb_array_elements(${jarr(sql`m.attendees`)}) att)` },

    { key: "discussion", label: "Discussion points", group: "Record", sql: m("discussion_points") },
    { key: "notes", label: "Meeting notes", group: "Record", sql: m("meeting_notes") },
    { key: "outcome", label: "Outcome", group: "Record", sql: human(m("outcome")) },
    { key: "outcome_notes", label: "Outcome notes", group: "Record", sql: m("outcome_notes") },
    { key: "action_count", label: "Action items", group: "Record", sql: sql`jsonb_array_length(${jarr(sql`m.action_items`)})`, kind: "number" },
    { key: "actions", label: "Action items (list)", group: "Record", sql: sql`(SELECT string_agg(ai->>'title', '; ') FROM jsonb_array_elements(${jarr(sql`m.action_items`)}) ai)` },
    { key: "next_review", label: "Next review date", group: "Record", sql: d(m("next_review_date")), kind: "date" },
    { key: "created", label: "Scheduled on", group: "Record", sql: dt(m("created_at")), kind: "datetime" },
  ],
};

// ── Service Requests (/dashboard/service-requests) ─────────────────────────

const s = (c: string) => sql.raw(`sr.${c}`);
const SR_TYPE_LABEL: Record<string, string> = {
  nominee_update: "Nominee Update",
  bank_update: "Bank Update",
  mobile_update: "Mobile Update",
  email_update: "Email Update",
  kyc_update: "KYC Update",
  minor_to_major: "Minor to Major",
  capital_gain_report: "Capital Gain Report",
  statement_request: "Statement Request",
  redemption_request: "Redemption Request",
  switch_request: "Switch Request",
  transmission_case: "Transmission Case",
  folio_correction: "Folio Correction",
  other: "Other",
  complaint: "Complaint",
  redemption_help: "Redemption Request",
  switch_help: "Switch Request",
  transaction_query: "Other",
};
const SR_TABS: Record<string, string[]> = {
  open: ["open", "in_progress"],
  escalated: ["escalated"],
  waiting: ["waiting_customer"],
  closed: ["resolved", "closed"],
};

export const serviceRequestsExport: ExportModule = {
  key: "service-requests",
  label: "Service Requests",
  fileName: "service-requests",
  piiSubject: "investor",
  canView: (x) =>
    can(x.roles, "service_request.view.all", x.permissions) || can(x.roles, "service_request.view.assigned", x.permissions),
  from: sql`service_requests sr
    LEFT JOIN investors i ON i.id = sr.investor_id
    LEFT JOIN users u ON u.id = sr.assigned_to_user_id`,
  async where(_tx, session, params) {
    const sp = spOf(params);
    const rmIds = csv(params, "rm").filter((v) => UUID.test(v));
    const branchIds = csv(params, "branch").filter((v) => UUID.test(v));
    const conds: SQL[] = [sql`sr.tenant_id = ${session.tenantId}::uuid`, srWhere({ tenantId: session.tenantId, rmIds, branchIds })];
    // The list shows every ticket of the firm; the export narrows that for
    // people who only see ASSIGNED tickets (as the global search does): tickets
    // assigned to me, or about a client whose RM I am.
    const all = ["service_request.view.all", "service_request.manage"].some((c) => can(session.roles, c as any, session.permissions));
    if (!all) conds.push(sql`(sr.assigned_to_user_id = ${session.userId}::uuid OR i.rm_id = ${session.userId}::uuid)`);

    if (sp.mine === "1") conds.push(sql`sr.assigned_to_user_id = ${session.userId}::uuid`);
    conds.push(...inFilter(params.get("assignee"), sql`sr.assigned_to_user_id`));
    const q = (sp.q ?? "").trim();
    if (q) conds.push(sql`(sr.ticket_no ILIKE ${`%${q}%`} OR sr.subject ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`})`);
    const status = csv(params, "status");
    conds.push(...inFilter(params.get("status"), sql`sr.status`));
    conds.push(...inFilter(params.get("priority"), sql`sr.priority`));
    conds.push(...inFilter(params.get("srtype"), sql`sr.type`));
    const breached = sp.breached === "1";
    if (breached) conds.push(srPastSlaSql("sr"));
    const dr = dateRangeCond(sp, "created", "sr.created_at");
    if (dr) conds.push(dr);
    // Status tab — Open by default, unless ?status= or breached=1 without a tab.
    const tab = status.length ? null : (sp.tab && SR_TABS[sp.tab] ? sp.tab : breached ? null : "open");
    if (tab) conds.push(...inFilter(SR_TABS[tab].join(","), sql`sr.status`));
    return conds;
  },
  orderBy: sql`sr.created_at DESC`,
  columns: [
    { key: "ticket", label: "Ticket #", group: "Ticket", sql: s("ticket_no"), default: true },
    { key: "type", label: "Request type", group: "Ticket", sql: labelled(s("type"), SR_TYPE_LABEL), default: true },
    { key: "subject", label: "Subject", group: "Ticket", sql: s("subject"), default: true },
    { key: "description", label: "Description", group: "Ticket", sql: s("description") },
    { key: "status", label: "Status", group: "Ticket", sql: human(s("status")), default: true },
    { key: "priority", label: "Priority", group: "Ticket", sql: human(s("priority")) },
    { key: "channel", label: "Received via", group: "Ticket", sql: human(s("channel")) },
    { key: "attachments", label: "Attachments", group: "Ticket", sql: sql`jsonb_array_length(${jarr(sql`sr.attachments`)})`, kind: "number" },

    { key: "client", label: "Client", group: "Client", sql: sql`i.name`, default: true },
    { key: "client_phone", label: "Client mobile", group: "Client", sql: sql`i.phone`, pii: "phone" },
    { key: "client_email", label: "Client email", group: "Client", sql: sql`i.email`, pii: "email" },
    { key: "client_rm", label: "Client's RM", group: "Client", sql: userName(sql`i.rm_id`) },
    { key: "branch", label: "Branch", group: "Client", sql: sql`(SELECT b.name FROM branches b WHERE b.id = i.branch_id)` },

    { key: "assignee", label: "Assigned to", group: "Handling", sql: sql`u.name`, default: true },
    { key: "escalated_to", label: "Escalated to", group: "Handling", sql: userName(s("escalated_to_user_id")) },
    { key: "remarks", label: "Remarks", group: "Handling", sql: s("remarks") },
    { key: "resolution", label: "Resolution notes", group: "Handling", sql: s("resolution_notes") },

    { key: "raised", label: "Raised on", group: "SLA", sql: dt(s("created_at")), kind: "datetime", default: true },
    { key: "response_due", label: "Response due", group: "SLA", sql: dt(s("sla_response_at")), kind: "datetime" },
    { key: "resolution_due", label: "Resolution due (SLA)", group: "SLA", sql: dt(s("sla_resolution_at")), kind: "datetime", default: true },
    { key: "responded", label: "Responded on", group: "SLA", sql: dt(s("responded_at")), kind: "datetime" },
    { key: "resolved", label: "Resolved on", group: "SLA", sql: dt(s("resolved_at")), kind: "datetime" },
    { key: "escalated", label: "Escalated on", group: "SLA", sql: dt(s("escalated_at")), kind: "datetime" },
    { key: "age", label: "Age (days)", group: "SLA", sql: sql`EXTRACT(DAY FROM COALESCE(sr.resolved_at, now()) - sr.created_at)::int`, kind: "number" },
    { key: "breached", label: "Past SLA", group: "SLA", sql: sql`(${srPastSlaSql("sr")})`, kind: "bool" },

    { key: "sebi_category", label: "SEBI category", group: "Complaint", sql: s("sebi_category") },
    { key: "sebi_sub", label: "SEBI sub-category", group: "Complaint", sql: s("sebi_sub_category") },
    { key: "complaint_source", label: "Complaint source", group: "Complaint", sql: human(s("complaint_source")) },
    { key: "scores", label: "SCORES ref no.", group: "Complaint", sql: s("scores_ref_no") },

    { key: "csat", label: "CSAT rating", group: "Feedback", sql: s("csat_rating"), kind: "number" },
    { key: "csat_comment", label: "CSAT comment", group: "Feedback", sql: s("csat_comment") },
  ],
};

// ── Activity Log (/dashboard/activities) ───────────────────────────────────

const a = (c: string) => sql.raw(`a.${c}`);

export const activitiesExport: ExportModule = {
  key: "activities",
  label: "Activity Log",
  fileName: "activity-log",
  piiSubject: "investor",
  // The page has no capability of its own: everyone sees what they logged, and
  // the firm's activity needs the owner-dashboard view (below, in `where`).
  canView: () => true,
  from: sql`activities a LEFT JOIN users u ON u.id = a.owner_user_id`,
  async where(_tx, session, params) {
    const sp = spOf(params);
    const firmWide = can(session.roles, "dashboard.view.owner", session.permissions);
    const conds: SQL[] = [sql`a.tenant_id = ${session.tenantId}::uuid`];
    if (sp.mine === "1" || !firmWide) conds.push(sql`a.owner_user_id = ${session.userId}::uuid`);
    const q = (sp.q ?? "").trim();
    if (q) conds.push(sql`(a.subject_name ILIKE ${`%${q}%`} OR a.subject ILIKE ${`%${q}%`} OR a.notes ILIKE ${`%${q}%`})`);
    conds.push(...inFilter(params.get("kind"), sql`a.kind`));
    const dr = dateRangeCond(sp, "created", "a.occurred_at");
    if (dr) conds.push(dr);
    return conds;
  },
  orderBy: sql`a.occurred_at DESC`,
  columns: [
    { key: "when", label: "When", group: "Activity", sql: dt(a("occurred_at")), kind: "datetime", default: true },
    { key: "kind", label: "Type", group: "Activity", sql: human(a("kind")), default: true },
    { key: "direction", label: "Direction", group: "Activity", sql: human(a("direction")) },
    { key: "subject", label: "Subject", group: "Activity", sql: a("subject"), default: true },
    { key: "outcome", label: "Outcome", group: "Activity", sql: human(a("status")), default: true },
    { key: "notes", label: "Notes", group: "Activity", sql: a("notes") },
    { key: "duration", label: "Duration (minutes)", group: "Activity", sql: sql`round(a.duration_sec / 60.0, 1)`, kind: "number" },
    { key: "location", label: "Location", group: "Activity", sql: a("location_label") },
    { key: "followup", label: "Next follow-up", group: "Activity", sql: dt(a("next_followup_at")), kind: "datetime" },

    { key: "with", label: "Client / lead", group: "With", sql: a("subject_name"), default: true },
    { key: "with_kind", label: "Record type", group: "With", sql: labelled(a("subject_type"), { investor: "Client" }) },
    { key: "phone", label: "Phone", group: "With", sql: a("subject_phone"), pii: "phone" },

    { key: "owner", label: "Logged by", group: "Team", sql: sql`u.name`, default: true },
    { key: "branch", label: "Branch", group: "Team", sql: sql`(SELECT b.name FROM branches b WHERE b.id = a.branch_id)` },
    { key: "logged", label: "Logged on", group: "Team", sql: dt(a("created_at")), kind: "datetime" },
  ],
};

// ── Expected Inflows (/dashboard/expected-inflows) ─────────────────────────

const e = (c: string) => sql.raw(`ei.${c}`);

export const expectedInflowsExport: ExportModule = {
  key: "expected-inflows",
  label: "Expected Inflows",
  fileName: "expected-inflows",
  piiSubject: "investor",
  canView: (x) => can(x.roles, "investor.view.all", x.permissions) || can(x.roles, "investor.view.assigned", x.permissions),
  from: sql`expected_inflows ei JOIN investors i ON i.id = ei.investor_id`,
  async where(tx, session) {
    // An inflow belongs to a client: the client access scope decides.
    return [sql`ei.tenant_id = ${session.tenantId}::uuid`, await investorScopeSql(tx, session, "i")];
  },
  orderBy: sql`ei.expected_on ASC`,
  columns: [
    { key: "client", label: "Client", group: "Inflow", sql: sql`i.name`, default: true },
    { key: "source", label: "Source", group: "Inflow", sql: labelled(e("source_type"), INFLOW_SOURCE_LABELS), default: true },
    { key: "amount", label: "Expected amount", group: "Inflow", sql: e("expected_amount"), kind: "money", default: true },
    { key: "expected_on", label: "Expected on", group: "Inflow", sql: d(e("expected_on")), kind: "date", default: true },
    { key: "month", label: "Month", group: "Inflow", sql: sql`to_char(ei.expected_on, 'YYYY-MM')` },
    { key: "confidence", label: "Confidence", group: "Inflow", sql: human(e("confidence")) },
    { key: "status", label: "Status", group: "Inflow", sql: human(e("status")), default: true },
    { key: "passed", label: "Date passed, not actioned", group: "Inflow", sql: sql`(ei.status IN ('expected', 'confirmed') AND ei.expected_on < (now() AT TIME ZONE 'Asia/Kolkata')::date)`, kind: "bool" },
    { key: "notes", label: "Notes", group: "Inflow", sql: e("notes") },

    { key: "owner", label: "Owner", group: "People", sql: userName(e("owner_id")), default: true },
    { key: "client_rm", label: "Client's RM", group: "People", sql: userName(sql`i.rm_id`) },
    { key: "branch", label: "Branch", group: "People", sql: sql`(SELECT b.name FROM branches b WHERE b.id = i.branch_id)` },
    { key: "created_by", label: "Added by", group: "People", sql: userName(e("created_by")) },

    { key: "invested_amount", label: "Invested amount", group: "Outcome", sql: e("invested_amount"), kind: "money" },
    { key: "invested_on", label: "Invested on", group: "Outcome", sql: d(e("invested_at")), kind: "date" },
    { key: "remind", label: "Remind (days before)", group: "Outcome", sql: e("remind_days_before"), kind: "number" },
    { key: "added", label: "Added on", group: "Outcome", sql: dIst(e("created_at")), kind: "date" },
  ],
};
