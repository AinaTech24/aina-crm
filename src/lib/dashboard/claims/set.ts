/**
 * The claim set — every claim the window can say anything about, loaded ONCE
 * per request and shared by all sixty sections:
 *
 *   open now  ∪  intimated since `lo`  ∪  closed since `lo`
 *
 * where `lo` is the earliest date any section looks back to (the FY start,
 * the comparison period, last month for the monthly review). A claim opened
 * before `lo` and closed before `lo` cannot change any figure on the page, so
 * nothing is missing. Claim volumes are small beside policies and
 * transactions; one read with its history attached is cheaper and — more to
 * the point — cannot disagree with itself the way forty separate aggregates
 * can.
 *
 * Attached to each claim, from outside insurance_claims:
 *  · STATUS HISTORY from audit_log (every create / update writes the status
 *    before and after): when it entered each status, first and last, and how
 *    often. This is the only record of when a claim moved.
 *  · NEXT ACTION — its earliest open follow-up task (tasks.meta.claimId, set
 *    by "Schedule follow-up" on the dashboard).
 *  · LAST CLIENT CONTACT — the latest logged call / email / visit (activities)
 *    or message actually sent (communications) to the claimant.
 */

import { sql } from "drizzle-orm";
import { groupSql, lineSql } from "@/lib/insurance/book";
import { CLAIM_OPEN, PENDING_WITH, REACHED_STATUSES, ageBucketOf } from "@/lib/insurance/claims-book";
import { checklistFor } from "@/lib/insurance/claim-checklist";
import { addDays, daysBetween, istDate, num, recordedWhere, str, type ClaimWindow, type Row, type Tx } from "./window";

type Hist = Record<string, { f: string; l: string; n: number }>;

export type ClaimRec = {
  id: string;
  policyId: string | null;
  investorId: string | null;
  client: string;
  proposer: string;
  phone: string | null;
  status: string;
  type: string | null;
  mode: string | null;
  insurer: string | null;
  insurerKey: string;
  policyNumber: string | null;
  plan: string | null;
  policyType: string | null;
  group: string;
  line: string;
  /** Claimed amount; `claimedMissing` when the claim carries none (0 or blank). */
  claimed: number;
  claimedMissing: boolean;
  settled: number;
  intimationDate: string | null;
  submissionDate: string | null;
  settlementDate: string | null;
  /** Intimation date, or the day the claim was keyed when intimation is blank. */
  openedOn: string;
  openedOnKeyed: boolean;
  createdOn: string;
  updatedAt: string;
  /** Settlement date / the audit trail's closing change / the last edit, in that order. */
  closedOn: string | null;
  closedOnSource: "date" | "audit" | "edit" | null;
  ownerId: string | null;
  clientRmId: string | null;
  branchId: string | null;
  comments: string | null;
  docTypes: string[];
  docsCount: number;
  hist: Hist;
  statusSince: string;
  queryCount: number;
  nextAction: { id: string; title: string; due: string | null; assigneeId: string | null } | null;
  openTasks: number;
  lastContact: string | null;

  // ── derived for `today` ──
  isOpen: boolean;
  legal: boolean;
  ageDays: number | null;
  tatDays: number | null;
  daysInStatus: number;
  daysSinceUpdate: number;
  slaDue: string;
  /** Days from today to the SLA date — negative once breached. */
  slaLeft: number;
  sla: "within" | "approaching" | "breached" | null;
  breachDays: number;
  /** 0 none · 1 attention · 2 overdue · 3 escalation (the brief's §39). */
  level: 0 | 1 | 2 | 3;
  pendingWith: string | null;
  checklist: Array<{ key: string; label: string; have: boolean }>;
  docsMissing: string[];
  docState: "complete" | "partial" | "none";
  highValue: boolean;
  bucket: string | null;
  docsOverdue: boolean;
  queryOverdue: boolean;
  assessLong: boolean;
  noUpdate: boolean;
  clientUpdateDue: boolean;
  daysSinceContact: number | null;
  actionState: "none" | "overdue" | "today" | "upcoming";
  reached: { docs: boolean; submitted: boolean; assessment: boolean; settled: boolean };
};

const OPEN = CLAIM_OPEN as readonly string[];
const CLOSED_SETTLED = ["settled_fully", "settled_partially"];

/** `opts.id` loads that one claim (the drawer), whatever its dates — still inside the viewer's scope. */
export async function loadClaimSet(tx: Tx, w: ClaimWindow, lo: string, opts: { id?: string } = {}): Promise<ClaimRec[]> {
  const t = w.tenantId;
  const rows = (await tx.execute(sql`
    WITH tr AS (
      SELECT a.entity_id AS claim_id, a.at, a.after->>'claimStatus' AS to_s
        FROM audit_log a
       WHERE a.tenant_id = ${t}::uuid AND a.entity_type = 'insurance_claim'
         AND a.action IN ('insurance_claim.create', 'insurance_claim.update')
         AND a.after ? 'claimStatus'
         AND (a.action = 'insurance_claim.create' OR (a.before->>'claimStatus') IS DISTINCT FROM (a.after->>'claimStatus'))
    ), tr1 AS (
      SELECT claim_id, to_s, min(at) AS f, max(at) AS l, count(*)::int AS n FROM tr GROUP BY 1, 2
    ), hist AS (
      SELECT claim_id, jsonb_object_agg(to_s, jsonb_build_object('f', f, 'l', l, 'n', n)) AS h FROM tr1 GROUP BY 1
    ), na AS (
      SELECT DISTINCT ON (tk.meta->>'claimId') tk.meta->>'claimId' AS claim_key, tk.id, tk.title, tk.due_at, tk.assignee_id,
             count(*) OVER (PARTITION BY tk.meta->>'claimId')::int AS n
        FROM tasks tk
       WHERE tk.tenant_id = ${t}::uuid AND tk.deleted_at IS NULL AND tk.meta ? 'claimId'
         AND tk.status IN ('open', 'in_progress', 'blocked')
       ORDER BY tk.meta->>'claimId', tk.due_at ASC NULLS LAST, tk.created_at
    ), claimants AS (
      SELECT DISTINCT investor_id FROM insurance_claims WHERE tenant_id = ${t}::uuid AND investor_id IS NOT NULL
    ), contact AS (
      SELECT investor_id, max(at) AS at FROM (
        SELECT ac.subject_id AS investor_id, ac.occurred_at AS at FROM activities ac
         WHERE ac.tenant_id = ${t}::uuid AND ac.subject_type = 'investor' AND ac.subject_id IN (SELECT investor_id FROM claimants)
        UNION ALL
        SELECT m.investor_id, m.sent_at FROM communications m
         WHERE m.tenant_id = ${t}::uuid AND m.sent_at IS NOT NULL AND m.investor_id IN (SELECT investor_id FROM claimants)
      ) z GROUP BY 1
    ), base AS (
      SELECT c.id::text AS id, c.policy_id::text AS policy_id, c.investor_id::text AS investor_id,
             COALESCE(i.name, c.proposer_name) AS client, c.proposer_name,
             COALESCE(NULLIF(btrim(c.phone), ''), i.phone) AS phone,
             c.claim_status AS status, c.claim_type, c.claim_mode,
             NULLIF(btrim(COALESCE(c.insurer, p.insurer, '')), '') AS insurer,
             lower(btrim(COALESCE(c.insurer, p.insurer, ''))) AS insurer_key,
             NULLIF(btrim(COALESCE(c.policy_number, p.policy_number, '')), '') AS policy_number,
             p.plan_name, p.policy_type, ${groupSql("p")} AS grp, ${lineSql("p")} AS line,
             COALESCE(c.claimed_amount, 0)::numeric AS claimed, COALESCE(c.settled_amount, 0)::numeric AS settled,
             c.intimation_date::text AS intimation_date, c.submission_date::text AS submission_date,
             c.settlement_date::text AS settlement_date,
             COALESCE(c.intimation_date, (c.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS opened_on,
             (c.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
             c.created_at, c.updated_at,
             c.rm_id::text AS owner_id, i.rm_id::text AS client_rm_id, COALESCE(i.branch_id, c.branch_id)::text AS branch_id,
             NULLIF(btrim(COALESCE(c.comments, '')), '') AS comments,
             COALESCE((SELECT array_agg(DISTINCT d->>'docType') FROM jsonb_array_elements(COALESCE(c.documents, '[]'::jsonb)) d
                        WHERE NULLIF(d->>'docType', '') IS NOT NULL), '{}'::text[]) AS doc_types,
             jsonb_array_length(COALESCE(c.documents, '[]'::jsonb)) AS docs_n,
             COALESCE(hist.h, '{}'::jsonb) AS h,
             CASE
               WHEN c.claim_status IN ('settled_fully', 'settled_partially') THEN COALESCE(
                 c.settlement_date,
                 ((hist.h -> c.claim_status ->> 'l')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
                 (c.updated_at AT TIME ZONE 'Asia/Kolkata')::date)
               WHEN c.claim_status IN ('rejected', 'withdrawn') THEN COALESCE(
                 ((hist.h -> c.claim_status ->> 'l')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
                 (c.updated_at AT TIME ZONE 'Asia/Kolkata')::date)
             END AS closed_on,
             CASE
               WHEN c.claim_status IN ('settled_fully', 'settled_partially') AND c.settlement_date IS NOT NULL THEN 'date'
               WHEN c.claim_status IN ('settled_fully', 'settled_partially', 'rejected', 'withdrawn') AND hist.h ? c.claim_status THEN 'audit'
               WHEN c.claim_status IN ('settled_fully', 'settled_partially', 'rejected', 'withdrawn') THEN 'edit'
             END AS closed_src,
             na.id::text AS na_id, na.title AS na_title, na.due_at AS na_due, na.assignee_id::text AS na_assignee, COALESCE(na.n, 0) AS na_n,
             contact.at AS last_contact
        FROM insurance_claims c
        LEFT JOIN insurance_policies p ON p.id = c.policy_id AND p.tenant_id = c.tenant_id
        LEFT JOIN investors i ON i.id = c.investor_id AND i.tenant_id = c.tenant_id
        LEFT JOIN hist ON hist.claim_id = c.id
        LEFT JOIN na ON na.claim_key = c.id::text
        LEFT JOIN contact ON contact.investor_id = c.investor_id
       WHERE c.tenant_id = ${t}::uuid
    )
    SELECT x.*, x.opened_on::text AS opened_on_s, x.closed_on::text AS closed_on_s
      FROM base x
     WHERE (${recordedWhere(w, "x")})
       AND ${opts.id
         ? sql`x.id = ${opts.id}`
         : sql`(x.status IN (${sql.join(OPEN.map((s) => sql`${s}`), sql`, `)}) OR x.opened_on >= ${lo}::date OR x.closed_on >= ${lo}::date)`}
     ORDER BY x.opened_on, x.id
     LIMIT 20000
  `)).rows as Row[];
  return rows.map((r) => deriveClaim(r, w));
}

const iso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** One claim's state for the window's `today`, from its SQL row. Exported for the unit tests. */
export function deriveClaim(r: Row, w: ClaimWindow): ClaimRec {
  const t = w.t;
  const today = w.today;
  const status = String(r.status ?? "empty");
  const isOpen = OPEN.includes(status);
  const hist = (r.h ?? {}) as Hist;
  const openedOn = String(r.opened_on_s);
  const closedOn = str(r.closed_on_s);
  const claimed = num(r.claimed);
  const statusSince = hist[status]?.l ?? iso(r.created_at) ?? `${openedOn}T00:00:00Z`;
  const statusSinceDay = istDate(statusSince) ?? openedOn;
  const updatedAt = iso(r.updated_at) ?? `${openedOn}T00:00:00Z`;
  const ageDays = isOpen ? Math.max(0, daysBetween(openedOn, today)) : null;
  const slaDue = addDays(openedOn, t.claimSlaDays);
  const breachDays = isOpen ? Math.max(0, daysBetween(slaDue, today)) : 0;
  const sla = !isOpen ? null
    : daysBetween(slaDue, today) > 0 ? "breached"
    : daysBetween(today, slaDue) <= t.claimSlaWarnDays ? "approaching" : "within";
  const highValue = claimed >= w.highValue;
  const nextDue = r.na_id ? istDate(r.na_due as string | Date | null) : null;
  const actionState: ClaimRec["actionState"] = !r.na_id ? "none"
    : nextDue == null ? "upcoming"
    : nextDue < today ? "overdue" : nextDue === today ? "today" : "upcoming";
  const level: ClaimRec["level"] = !isOpen ? 0
    : sla === "breached" && (breachDays > t.claimEscalateDays || highValue) ? 3
    : sla === "breached" || actionState === "overdue" ? 2
    : sla === "approaching" || actionState === "today" ? 1 : 0;
  const docTypes = ((r.doc_types ?? []) as string[]).filter(Boolean);
  const list = checklistFor({ policyType: str(r.policy_type), claimType: str(r.claim_type), claimMode: str(r.claim_mode) });
  const have = new Set(docTypes);
  const checklist = list.map((i) => ({ ...i, have: have.has(i.key) }));
  const docsMissing = checklist.filter((i) => !i.have).map((i) => i.label);
  const docsCount = num(r.docs_n);
  const daysInStatus = Math.max(0, daysBetween(statusSinceDay, today));
  const lastContact = r.last_contact ? iso(r.last_contact) : null;
  const contactDay = lastContact ? istDate(lastContact) : null;
  const sinceContactRef = contactDay && contactDay >= openedOn ? contactDay : null;
  const daysSinceContact = sinceContactRef ? Math.max(0, daysBetween(sinceContactRef, today)) : null;
  const reachedAny = (keys: readonly string[]) => keys.includes(status) || keys.some((k) => k in hist);
  const tatDays = closedOn ? Math.max(0, daysBetween(openedOn, closedOn)) : null;
  const pendingWith = isOpen ? PENDING_WITH.find((p) => (p.statuses as readonly string[]).includes(status))?.key ?? null : null;

  return {
    id: String(r.id),
    policyId: str(r.policy_id),
    investorId: str(r.investor_id),
    client: String(r.client ?? r.proposer_name ?? "—"),
    proposer: String(r.proposer_name ?? ""),
    phone: str(r.phone),
    status,
    type: str(r.claim_type),
    mode: str(r.claim_mode),
    insurer: str(r.insurer),
    insurerKey: String(r.insurer_key ?? ""),
    policyNumber: str(r.policy_number),
    plan: str(r.plan_name),
    policyType: str(r.policy_type),
    group: String(r.grp ?? "unclassified"),
    line: r.policy_id ? String(r.line ?? "unclassified") : "unlinked",
    claimed,
    claimedMissing: claimed <= 0,
    settled: num(r.settled),
    intimationDate: str(r.intimation_date),
    submissionDate: str(r.submission_date),
    settlementDate: str(r.settlement_date),
    openedOn,
    openedOnKeyed: !r.intimation_date,
    createdOn: String(r.created_on ?? openedOn),
    updatedAt,
    closedOn,
    closedOnSource: (str(r.closed_src) as ClaimRec["closedOnSource"]) ?? null,
    ownerId: str(r.owner_id),
    clientRmId: str(r.client_rm_id),
    branchId: str(r.branch_id),
    comments: str(r.comments),
    docTypes,
    docsCount,
    hist,
    statusSince,
    queryCount: (hist.query?.n ?? 0) + (hist.add_info_awaited?.n ?? 0),
    nextAction: r.na_id ? { id: String(r.na_id), title: String(r.na_title ?? "Follow-up"), due: nextDue, assigneeId: str(r.na_assignee) } : null,
    openTasks: num(r.na_n),
    lastContact,

    isOpen,
    legal: r.claim_mode === "grievance",
    ageDays,
    tatDays,
    daysInStatus,
    daysSinceUpdate: Math.max(0, daysBetween(istDate(updatedAt) ?? today, today)),
    slaDue,
    slaLeft: daysBetween(today, slaDue),
    sla,
    breachDays,
    level,
    pendingWith,
    checklist,
    docsMissing,
    docState: docsCount === 0 ? "none" : docsMissing.length === 0 ? "complete" : "partial",
    highValue,
    bucket: ageBucketOf(ageDays),
    docsOverdue: status === "file_awaited" && daysInStatus > t.claimDocsDays,
    queryOverdue: (status === "query" || status === "add_info_awaited") && daysInStatus > t.claimQueryDays,
    assessLong: status === "under_process" && daysInStatus > t.claimAssessDays,
    noUpdate: isOpen && Math.max(0, daysBetween(istDate(updatedAt) ?? today, today)) >= w.noUpdateDays,
    clientUpdateDue: isOpen && daysBetween(sinceContactRef ?? openedOn, today) >= w.clientUpdateDays,
    daysSinceContact,
    actionState,
    reached: {
      docs: reachedAny(REACHED_STATUSES.docs),
      submitted: !!r.submission_date || reachedAny(REACHED_STATUSES.submitted),
      assessment: reachedAny(REACHED_STATUSES.assessment),
      settled: CLOSED_SETTLED.includes(status) || reachedAny(REACHED_STATUSES.settled),
    },
  };
}

/** The derived filters (window.ts), applied to the set. */
export function applyDerived(set: ClaimRec[], w: ClaimWindow): ClaimRec[] {
  const f = w.filter;
  if (!f.pendingWith && !f.docs && !f.sla && !f.age && !f.outcome && !f.actionWith) return set;
  return set.filter((c) => {
    if (f.outcome) return !c.isOpen && c.status === f.outcome;
    if (!c.isOpen) return false;
    if (f.pendingWith && c.pendingWith !== f.pendingWith) return false;
    if (f.docs && c.docState !== f.docs) return false;
    if (f.sla && c.sla !== f.sla) return false;
    if (f.age && c.bucket !== f.age) return false;
    if (f.actionWith === "none" && c.nextAction) return false;
    if (f.actionWith && f.actionWith !== "none" && c.nextAction?.assigneeId !== f.actionWith) return false;
    return true;
  });
}

/** The day a claim was opened / closed fell inside [from, to]. */
export const loggedIn = (c: ClaimRec, from: string, to: string) => c.openedOn >= from && c.openedOn <= to;
export const closedIn = (c: ClaimRec, from: string, to: string) => !!c.closedOn && c.closedOn >= from && c.closedOn <= to;
/** Open at the END of `day`: opened by then, and not closed by then. */
export const openAt = (c: ClaimRec, day: string) => c.openedOn <= day && (c.isOpen || (c.closedOn != null && c.closedOn > day));
