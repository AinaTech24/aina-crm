/**
 * The Operations Control Tower's one definition of "operations work".
 *
 * ── What an ops request IS in this CRM ─────────────────────────────────────
 *
 * There is no transaction-request table. The back-office team works its queue
 * in TASKS (the role's default home is the task list), so a request is a task
 * that is operations work:
 *
 *   · department operations / back office, OR
 *   · a transaction or servicing type (purchase, redemption, SIP, mandate,
 *     back-office work, SIP-rejection follow-up, document collection, KYC…), OR
 *   · assigned to someone in an operations role.
 *
 * Three things the brief asks for are DERIVED here, each by a stated rule, and
 * never invented:
 *
 *   · Request type — the task's type, the back-office category
 *     (meta.boParticular), or the operations template it was created from
 *     (its title: "Redemption (full / partial)", "New SIP Registration"…).
 *     Anything else is "Other", not guessed.
 *   · Value — only where the CRM holds one (back-office work's meta.boValue).
 *     A request with no recorded value is counted, never valued at ₹0.
 *   · Pending with — from who holds it: nobody (unassigned), the approver
 *     (awaiting approval), someone outside the team (blocked), an operations
 *     user, or an RM. The CRM has no "pending with AMC / client" field on a
 *     task; those dependencies come from the feeds and registers instead
 *     (platform-pending transactions, client-waiting queries, bank issues on
 *     SIP rejections).
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * Decided by the page from the viewer's permissions, applied here INSIDE the
 * base query so nothing outside it can leak through a filter:
 *   firm   — task.view.all (back office, ops, service team, owner)
 *   branch — a branch head locked to their branch: the client's branch, or
 *            for a task with no client, the assignee's branch
 *   self   — anyone else: tasks assigned to or raised by the viewer
 * Filters (branch, RM, executive, type, status…) only ever narrow that.
 */

import { sql, type SQL } from "drizzle-orm";
import type { withTenant } from "@/db/client";
import type { DashboardThresholds } from "@/lib/dashboard/thresholds";
import { FINANCIAL_TASK_TYPES, taskInvestor, taskLead } from "@/lib/dashboard/my/window";

export type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
export type Row = Record<string, unknown>;

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/* ───────────────────────────── vocabulary ───────────────────────────── */

export const OPS_KINDS = [
  { key: "purchase", label: "Purchase", financial: true },
  { key: "additional_purchase", label: "Additional purchase", financial: true },
  { key: "redemption", label: "Redemption", financial: true },
  { key: "switch", label: "Switch", financial: true },
  { key: "sip_registration", label: "SIP registration", financial: true },
  { key: "sip_modification", label: "SIP modification", financial: true },
  { key: "sip_stop", label: "SIP stop", financial: true },
  { key: "sip_rejection", label: "SIP rejection / repurchase", financial: true },
  { key: "stp", label: "STP", financial: true },
  { key: "swp", label: "SWP", financial: true },
  { key: "mandate", label: "Mandate", financial: true },
  { key: "liquid", label: "Liquid", financial: true },
  { key: "sif", label: "SIF", financial: true },
  { key: "aif", label: "AIF", financial: true },
  { key: "pms", label: "PMS", financial: true },
  { key: "documentation", label: "Documentation", financial: false },
  { key: "kyc", label: "KYC / onboarding", financial: false },
  { key: "service", label: "Client service", financial: false },
  { key: "other", label: "Other", financial: false },
] as const;
export type OpsKind = (typeof OPS_KINDS)[number]["key"];
export const KIND_LABEL: Record<string, string> = Object.fromEntries(OPS_KINDS.map((k) => [k.key, k.label]));
export const FINANCIAL_KINDS = OPS_KINDS.filter((k) => k.financial).map((k) => k.key) as OpsKind[];

export const PENDING_WITH = [
  { key: "operations", label: "Operations" },
  { key: "rm", label: "Relationship manager" },
  { key: "approval", label: "Awaiting approval" },
  { key: "blocked", label: "Blocked — outside the team" },
  { key: "other_team", label: "Another team" },
  { key: "unassigned", label: "Not assigned" },
] as const;
export type PendingWith = (typeof PENDING_WITH)[number]["key"];
export const PENDING_LABEL: Record<string, string> = Object.fromEntries(PENDING_WITH.map((p) => [p.key, p.label]));

export const STATUSES = [
  { key: "open", label: "Not started" },
  { key: "in_progress", label: "In process" },
  { key: "blocked", label: "Blocked" },
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

/**
 * The Status FILTER (`st=`) — which open work the page shows. Not the same list
 * as STATUSES, which labels a record: here "open" is every unfinished state
 * (the page's default, "Open"), and a request's own "open" status is
 * "not_started". Completed and cancelled are not offered: the page is pending
 * work, and the period's completions are always counted (see opsFilter).
 */
export const STATUS_FILTERS = [
  { key: "open", label: "Open" },
  { key: "not_started", label: "Not started" },
  { key: "in_progress", label: "In process" },
  { key: "blocked", label: "Blocked" },
  { key: "awaiting_approval", label: "Awaiting approval" },
] as const;

/** The CRM's own task priorities. "Urgent" is its highest — shown as the brief's Critical. */
export const PRIORITIES = [
  { key: "urgent", label: "Critical" },
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
] as const;
export const PRIORITY_LABEL: Record<string, string> = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.label]));

export const SLA_STATES = [
  { key: "breached", label: "SLA breached" },
  { key: "approaching", label: "Approaching SLA" },
  { key: "within", label: "Within SLA" },
  { key: "none", label: "No SLA set" },
] as const;

/** The brief's ageing buckets, in days since the request was received. */
export const AGE_BUCKETS = [
  { key: "d0", label: "Same day", min: 0, max: 0 },
  { key: "d1", label: "1 day", min: 1, max: 1 },
  { key: "d2", label: "2–3 days", min: 2, max: 3 },
  { key: "d4", label: "4–5 days", min: 4, max: 5 },
  { key: "d6", label: "6–7 days", min: 6, max: 7 },
  { key: "d8", label: "8–15 days", min: 8, max: 15 },
  { key: "d16", label: "Over 15 days", min: 16, max: null },
] as const;

/**
 * Processing mode. Only back-office work records one (tasks.meta.boChannel);
 * "Not recorded" is every other request, so choosing Online or Offline
 * narrows the tower to back-office work — the filter says what it can.
 */
export const MODE_FILTERS = [
  { key: "online", label: "Online" },
  { key: "offline", label: "Offline" },
  { key: "none", label: "Not recorded" },
] as const;

export const OPS_ROLES = ["back_office", "ops", "service_team"] as const;
const RM_ROLES = ["rm", "branch_head"] as const;

/** Task types that are operations work whatever their department. */
export const OPS_TYPES = [
  ...FINANCIAL_TASK_TYPES,
  "back_office_work", "sip_rejection_followup", "collect_document", "document", "documents",
  "kyc_renewal", "nominee_update", "reconciliation", "transaction_execution", "ucc_creation", "onboarding",
  // The New task form's non-financial requests (lib/tasks/request-types.ts).
  "non_financial", "bank_change", "contact_change", "folio_consolidation", "account_statement", "service_other",
] as const;

/* ───────────────────────────── SQL helpers ───────────────────────────── */

export const textArray = (xs: readonly string[]): SQL =>
  sql`ARRAY[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]`;
export const inList = (xs: readonly string[]): SQL => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** A numeric only when the text IS a number — never a cast error on junk. */
export const safeNum = (expr: SQL): SQL =>
  sql`CASE WHEN btrim(COALESCE(${expr}, '')) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN btrim(${expr})::numeric END`;

/** Calendar day in India time — timestamps are compared as IST days everywhere. */
export const istDay = (expr: SQL): SQL => sql`(${expr} AT TIME ZONE 'Asia/Kolkata')::date`;

const titleIs = (pattern: string): SQL => sql`t.title ~* ${pattern}`;

/**
 * The request type, by a fixed and visible order of rules (see header). Title
 * patterns follow the CRM's own operations templates; word boundaries (\m \M)
 * stop "stp" matching inside other words.
 */
export const KIND_SQL: SQL = sql`CASE
  WHEN t.type = 'back_office_work' THEN CASE t.meta->>'boParticular'
       WHEN 'nj_redemption' THEN 'redemption'
       WHEN 'nj_wecare_switch' THEN 'switch'
       WHEN 'pms' THEN 'pms'
       WHEN 'purchase_rectified' THEN 'purchase'
       WHEN 'sip_rectified' THEN 'sip_modification'
       ELSE 'other' END
  WHEN t.type IN ('sip_rejection_followup', 'sip_retry') THEN 'sip_rejection'
  WHEN t.type IN ('collect_document', 'document', 'documents') THEN 'documentation'
  WHEN t.type IN ('purchase', 'lumpsum') THEN 'purchase'
  WHEN t.type = 'redemption' THEN 'redemption'
  WHEN t.type = 'switch' THEN 'switch'
  WHEN t.type = 'sip_registration' THEN 'sip_registration'
  WHEN t.type = 'sip_stop' THEN 'sip_stop'
  WHEN t.type IN ('stp', 'swp') THEN t.type
  WHEN t.type IN ('mandate_renewal', 'mandate_create') THEN 'mandate'
  WHEN t.type IN ('additional_purchase', 'sip_modification', 'pms', 'aif') THEN t.type
  WHEN t.type IN ('nominee_update', 'bank_change', 'contact_change', 'folio_consolidation', 'account_statement', 'service_other') THEN 'service'
  WHEN t.type = 'onboarding' THEN 'kyc'
  WHEN ${titleIs("additional purchase")} THEN 'additional_purchase'
  WHEN ${titleIs("\\mnfo\\M|lumpsum|one-time purchase|\\mpurchase\\M")} THEN 'purchase'
  WHEN ${titleIs("redemption|\\mredeem")} THEN 'redemption'
  WHEN ${titleIs("sip modification|sip (pause|change)")} THEN 'sip_modification'
  WHEN ${titleIs("sip stop|stop sip")} THEN 'sip_stop'
  WHEN ${titleIs("sip registration|new sip")} THEN 'sip_registration'
  WHEN ${titleIs("\\mswitch")} THEN 'switch'
  WHEN ${titleIs("\\mstp\\M")} THEN 'stp'
  WHEN ${titleIs("\\mswp\\M")} THEN 'swp'
  WHEN ${titleIs("mandate")} THEN 'mandate'
  WHEN ${titleIs("\\mliquid\\M")} THEN 'liquid'
  WHEN ${titleIs("\\msif\\M")} THEN 'sif'
  WHEN ${titleIs("\\maif\\M")} THEN 'aif'
  WHEN ${titleIs("\\mpms\\M")} THEN 'pms'
  WHEN t.type IN ('kyc_renewal', 'onboarding', 'ucc_creation') OR ${titleIs("\\mkyc|onboarding|\\mucc\\M")} THEN 'kyc'
  WHEN t.type = 'nominee_update' OR ${titleIs("nominee|folio consolidation|statement")} THEN 'service'
  ELSE 'other'
END`;

/** Is this task operations work (see header)? Over alias `t`. */
export const OPS_WORK: SQL = sql`(
  t.department IN ('operations', 'back_office')
  OR t.type IN (${inList(OPS_TYPES)})
  OR t.assignee_id IN (SELECT u.id FROM users u WHERE u.roles && ${textArray(OPS_ROLES)})
)`;

/* ───────────────────────────── the window ───────────────────────────── */

export type OpsScope =
  | { kind: "firm" }
  | { kind: "branch"; branchId: string }
  | { kind: "self"; userId: string };

/**
 * The page's filters. Every list is OR within itself (any of these branches)
 * and AND across fields, so a filter only ever narrows.
 */
export type OpsFilter = {
  branchIds?: string[];
  /** Clients' RMs (investors.rm_id). */
  rmIds?: string[];
  /**
   * The viewer's own id when the RM filter holds "Me". "Me" replaced the old
   * Team / Mine switch and means what Mine meant — work ASSIGNED to the viewer
   * (the executive filter's `exec=me`), not clients whose RM they are. Like any
   * other field it narrows together with the rest, so "Me" beside an RM is my
   * work on that RM's clients.
   */
  mine?: string;
  /** Executives' user ids; "none" for unassigned work. */
  execIds?: string[];
  kinds?: string[];
  /** STATUS_FILTERS keys. Narrows open work only — see opsFilter. */
  statuses?: string[];
  priorities?: string[];
  sla?: string[];
  pendingWith?: string[];
  categories?: string[];
  /** AGE_BUCKETS keys. Narrows open work only, as status does. */
  ages?: string[];
  /** MODE_FILTERS keys. */
  modes?: string[];
};

export type OpsWindow = {
  tenantId: string;
  userId: string;
  scope: OpsScope;
  filter: OpsFilter;
  /** Period (India calendar days, inclusive). */
  from: string;
  to: string;
  today: string;
  periodLabel: string;
  t: DashboardThresholds;
};

export function hasFilter(w: OpsWindow): boolean {
  const f = w.filter;
  return !!(f.branchIds?.length || f.rmIds?.length || f.mine || f.execIds?.length || f.kinds?.length
    || (f.statuses?.length && !f.statuses.includes("open")) || f.priorities?.length
    || f.sla?.length || f.pendingWith?.length || f.categories?.length || f.ages?.length || f.modes?.length);
}

const uuidList = (xs: readonly string[]): SQL => sql.join(xs.map((x) => sql`${x}::uuid`), sql`, `);

/**
 * The executive filter and the RM filter's "Me" over an assignee column, or
 * null when neither is set. Shared by the requests and the service-request
 * register, the two places that know who a record is assigned to.
 */
export function assigneeFilter(f: OpsFilter, col: SQL): SQL | null {
  const parts: SQL[] = [];
  if (f.mine) parts.push(sql`${col} = ${f.mine}::uuid`);
  if (f.execIds?.length) {
    const ids = f.execIds.filter((x) => x !== "none");
    const terms: SQL[] = [];
    if (ids.length) terms.push(sql`${col} IN (${uuidList(ids)})`);
    if (ids.length !== f.execIds.length) terms.push(sql`${col} IS NULL`);
    parts.push(sql`(${sql.join(terms, sql` OR `)})`);
  }
  return parts.length ? sql.join(parts, sql` AND `) : null;
}

/** The scope as a predicate over the base query's aliases (t, i, au). */
function scopeSql(w: OpsWindow): SQL {
  const s = w.scope;
  if (s.kind === "branch") return sql`COALESCE(i.branch_id, au.branch_id) = ${s.branchId}::uuid`;
  if (s.kind === "self") return sql`(t.assignee_id = ${s.userId}::uuid OR t.created_by_id = ${s.userId}::uuid)`;
  return sql`TRUE`;
}

/**
 * Every ops work item with its derived columns. Use as a CTE:
 *   WITH ops AS (${opsBase(w)}) SELECT … FROM ops WHERE ${opsFilter(w)}
 */
export function opsBase(w: OpsWindow): SQL {
  const warn = Math.max(1, Math.round(w.t.opsSlaWarnHours));
  return sql`
    SELECT t.id, t.title, t.type, t.status, t.priority, t.approval_status, t.requires_approval,
           t.created_at, t.completed_at, t.updated_at, t.due_at, t.sla_due_at,
           t.submitted_at, t.approved_at, t.approval_note, t.remarks,
           t.assignee_id, t.created_by_id, t.department,
           (t.status IN ('open', 'in_progress', 'blocked')) AS is_open,
           ${KIND_SQL} AS kind,
           ${safeNum(sql`t.meta->>'boValue'`)} AS value,
           NULLIF(btrim(COALESCE(t.meta->>'boChannel', '')), '') AS mode,
           i.id AS investor_id,
           COALESCE(i.name, lt.name) AS client,
           lt.id AS lead_id,
           upper(NULLIF(btrim(i.client_category), '')) AS category,
           i.rm_id,
           COALESCE(i.branch_id, au.branch_id) AS branch_id,
           au.name AS assignee,
           cu.name AS created_by,
           CASE
             WHEN t.status NOT IN ('open', 'in_progress', 'blocked') THEN NULL
             WHEN t.approval_status = 'pending' THEN 'approval'
             WHEN t.assignee_id IS NULL THEN 'unassigned'
             WHEN t.status = 'blocked' THEN 'blocked'
             WHEN au.roles && ${textArray(OPS_ROLES)} THEN 'operations'
             WHEN au.roles && ${textArray(RM_ROLES)} THEN 'rm'
             ELSE 'other_team'
           END AS pending_with,
           CASE
             WHEN t.sla_due_at IS NULL THEN 'none'
             WHEN t.status NOT IN ('open', 'in_progress', 'blocked') THEN
               CASE WHEN t.completed_at IS NOT NULL AND t.completed_at <= t.sla_due_at THEN 'within' ELSE 'breached' END
             WHEN t.sla_due_at < now() THEN 'breached'
             WHEN t.sla_due_at < now() + (${warn} || ' hours')::interval THEN 'approaching'
             ELSE 'within'
           END AS sla_state,
           (${w.today}::date - ${istDay(sql`t.created_at`)}) AS age_days,
           ${istDay(sql`t.created_at`)} AS received_day,
           ${istDay(sql`t.completed_at`)} AS completed_day,
           EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600.0 AS tat_hours,
           GREATEST(t.updated_at,
                    COALESCE((SELECT MAX(c.created_at) FROM task_comments c
                               WHERE c.task_id = t.id AND c.deleted_at IS NULL), t.updated_at)) AS last_touch,
           (NULLIF(btrim(COALESCE(t.remarks, '')), '') IS NOT NULL
             OR EXISTS (SELECT 1 FROM task_comments c WHERE c.task_id = t.id AND c.deleted_at IS NULL)) AS has_remarks
      FROM tasks t
      LEFT JOIN investors i ON i.id = ${taskInvestor("t")}
      LEFT JOIN leads lt    ON lt.id = ${taskLead("t")}
      LEFT JOIN users au    ON au.id = t.assignee_id
      LEFT JOIN users cu    ON cu.id = t.created_by_id
     WHERE t.tenant_id = ${w.tenantId}::uuid
       AND t.deleted_at IS NULL
       AND ${OPS_WORK}
       AND ${scopeSql(w)}`;
}

/** The viewer's filters over the `ops` CTE (empty filter = TRUE). */
export function opsFilter(w: OpsWindow, alias = "ops"): SQL {
  const f = w.filter;
  const a = sql.raw(alias);
  const parts: SQL[] = [];
  if (f.branchIds?.length) parts.push(sql`${a}.branch_id IN (${uuidList(f.branchIds)})`);
  if (f.rmIds?.length) parts.push(sql`${a}.rm_id IN (${uuidList(f.rmIds)})`);
  const assignee = assigneeFilter(f, sql`${a}.assignee_id`);
  if (assignee) parts.push(assignee);
  if (f.kinds?.length) parts.push(sql`${a}.kind IN (${inList(f.kinds)})`);
  // Status narrows OPEN work only. A completed or cancelled request always
  // passes, so received, completed, TAT and the trend stay whole under any
  // status — otherwise the default ("Open") would print 0 completed on every
  // card. "open" is every unfinished state, so with it the filter is a no-op.
  if (f.statuses?.length && !f.statuses.includes("open")) {
    const plain = [
      ...(f.statuses.includes("not_started") ? ["open"] : []),
      ...f.statuses.filter((s) => s === "in_progress" || s === "blocked"),
    ];
    const terms: SQL[] = [];
    if (plain.length) terms.push(sql`(${a}.status IN (${inList(plain)}) AND ${a}.approval_status IS DISTINCT FROM 'pending')`);
    if (f.statuses.includes("awaiting_approval")) terms.push(sql`${a}.approval_status = 'pending'`);
    parts.push(terms.length ? sql`(NOT ${a}.is_open OR ${sql.join(terms, sql` OR `)})` : sql`NOT ${a}.is_open`);
  }
  if (f.priorities?.length) parts.push(sql`${a}.priority IN (${inList(f.priorities)})`);
  if (f.sla?.length) parts.push(sql`${a}.sla_state IN (${inList(f.sla)})`);
  if (f.pendingWith?.length) parts.push(sql`${a}.pending_with IN (${inList(f.pendingWith)})`);
  if (f.categories?.length) {
    const named = f.categories.filter((c) => c !== "none");
    const terms: SQL[] = [];
    if (named.length) terms.push(sql`${a}.category IN (${inList(named)})`);
    if (named.length !== f.categories.length) terms.push(sql`${a}.category IS NULL`);
    parts.push(sql`(${sql.join(terms, sql` OR `)})`);
  }
  // Ageing narrows OPEN work only, like status: a finished request has no
  // age to be in, and received / completed / TAT must stay whole under it.
  if (f.ages?.length) {
    const terms = AGE_BUCKETS.filter((b) => f.ages!.includes(b.key)).map((b) =>
      b.max == null ? sql`${a}.age_days >= ${b.min}` : sql`${a}.age_days BETWEEN ${b.min} AND ${b.max}`);
    if (terms.length) parts.push(sql`(NOT ${a}.is_open OR ${sql.join(terms, sql` OR `)})`);
  }
  if (f.modes?.length) {
    const named = f.modes.filter((m) => m !== "none");
    const terms: SQL[] = [];
    if (named.length) terms.push(sql`lower(${a}.mode) IN (${inList(named)})`);
    if (named.length !== f.modes.length) terms.push(sql`${a}.mode IS NULL`);
    parts.push(sql`(${sql.join(terms, sql` OR `)})`);
  }
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

/**
 * The client-side scope for the REGISTERS (queries, SIP rejections, the feed):
 * the same permission scope plus the client filters that mean something there
 * (branch, RM, category). Over an investors alias. Type / status / SLA filters
 * belong to tasks and are not applied to registers.
 */
export function clientScope(w: OpsWindow, alias = "i"): SQL {
  const a = sql.raw(alias);
  const parts: SQL[] = [];
  if (w.scope.kind === "branch") parts.push(sql`${a}.branch_id = ${w.scope.branchId}::uuid`);
  if (w.filter.branchIds?.length) parts.push(sql`${a}.branch_id IN (${uuidList(w.filter.branchIds)})`);
  if (w.filter.rmIds?.length) parts.push(sql`${a}.rm_id IN (${uuidList(w.filter.rmIds)})`);
  const cats = w.filter.categories ?? [];
  if (cats.length) {
    const named = cats.filter((c) => c !== "none");
    const terms: SQL[] = [];
    if (named.length) terms.push(sql`upper(NULLIF(btrim(${a}.client_category), '')) IN (${inList(named)})`);
    if (named.length !== cats.length) terms.push(sql`NULLIF(btrim(${a}.client_category), '') IS NULL`);
    parts.push(sql`(${sql.join(terms, sql` OR `)})`);
  }
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

/** `true` when the viewer's own scope is "self" — registers then show only their assigned rows. */
export function selfOnly(w: OpsWindow): string | null {
  return w.scope.kind === "self" ? w.scope.userId : null;
}

/** Link to the task list, narrowed as far as its own filters allow. */
export function tasksHref(extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return `/dashboard/tasks${s ? `?${s}` : ""}`;
}

/**
 * One rejected instruction. An STP is reported as two legs (out of the source
 * scheme, into the target) that share the registrar's switch reference; that
 * reference is a short number, unique only within the client's folio, date
 * and amount — so the key carries all of them. Every other row is its own
 * instruction. The amount of an instruction is its largest leg (the legs of
 * one STP carry the same amount).
 */
export const rejectedInstructionKey = (t = "t") => sql.raw(
  `CASE WHEN ${t}.type = 'stp' AND NULLIF(btrim(${t}.raw_feed_row->>'switchRef'), '') IS NOT NULL
        THEN concat_ws('|', 'stp', ${t}.investor_id::text, ${t}.folio_number, ${t}.order_date::text, abs(${t}.amount::numeric)::text, btrim(${t}.raw_feed_row->>'switchRef'))
        ELSE ${t}.id::text END`);
