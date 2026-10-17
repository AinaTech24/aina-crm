/**
 * The RM desk — the ACTION side of the personal cockpit. SERVER-ONLY.
 *
 * The brief's first rule is "action before analytics": before a single chart,
 * the page must say whom to contact today, what is overdue and what is next.
 * Everything here answers one of those three, and every figure is a list of
 * records rather than a statistic:
 *
 *   My Day              what falls due on the action day (today, or tomorrow)
 *   Needs My Attention  what is already late, with its age and its money
 *   Today's worklist    the two above as ONE sorted list of rows to work
 *   Upcoming 7 days     what is coming, by day
 *   Meeting prep        a data-only snapshot for each coming client meeting
 *
 * ── Due and overdue, once ──────────────────────────────────────────────────
 *
 * Dates are compared as CALENDAR DAYS against `w.today`: due on the action day
 * is "due", before today is "overdue". A proposal has no follow-up date of its
 * own, so its follow-up falls due `proposalAgeingDays` after it was sent (the
 * firm's "proposal needs attention after" threshold) — due on that day,
 * overdue after it — rather than inventing a date nobody set.
 *
 * ── What this never does ───────────────────────────────────────────────────
 *
 * It never recommends a product. Every action is a CRM workflow verb — call,
 * schedule a review, complete a task, follow up a proposal, resolve a query,
 * update a record — which is the brief's "next best action" rule (§37).
 * Priority is a visible rule (overdue first, then due today, then client
 * category, then time), stated beside each row; there is no hidden score.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientRiskSql } from "@/lib/risk-profile/own-assessment";
import { formatDate } from "@/lib/format";
import { attendeeIsAnyUser } from "@/lib/review-meetings/attendees";
import type { DashboardThresholds } from "@/lib/dashboard/thresholds";
import { findAtRiskSips, type AtRiskSip } from "@/lib/finance/sip-defense";
import {
  asInList, bookPerson, clientIds, clientsHref, clientsWhere, clientsWhereOn, clientRecordsWhereOn, FINANCIAL_TASK_TYPES,
  onboardedDateSql,
  GROSS_TYPES, LEAD_CLOSED_STAGES, leadsHref, leadsMatch, MEETING_UPCOMING, num, PROPOSAL_LIVE,
  SR_OPEN_ON_US, staffMatch, staffParam, TASK_DEAD, type MyWindow,
  taskInvestor, taskIsAbout, taskLead,
} from "./window";
import { FUNNEL, LEAD_VALUE } from "./pipeline";
import { bookedLinesOnBook } from "./booked";

type Row = Record<string, unknown>;

const DEAD_TASK = asInList(TASK_DEAD);
const OPEN_SR = asInList(SR_OPEN_ON_US);
const UPCOMING = asInList(MEETING_UPCOMING);
const LIVE = asInList(PROPOSAL_LIVE);
const FIN = asInList(FINANCIAL_TASK_TYPES);
const CLOSED_LEAD = asInList(LEAD_CLOSED_STAGES);
const UNRECOVERED = sql`(r.recovery_status IS NULL
  OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable'))`;

/** yyyy-mm-dd, local — never a UTC slice (see build-window.ts). */
export function addDaysISO(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Days from `from` to `to` (both yyyy-mm-dd or ISO); positive when `to` is later. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00`);
  return Math.round((b - a) / 864e5);
}

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/* ═══════════════════════════════ §1 My Day ═══════════════════════════════ */

export type DayPart = { label: string; value: number | string; tone?: "neutral" | "warn" | "bad" };
export type DayCard = {
  key: "meetings" | "followups" | "reviews" | "sip" | "tasks" | "queries" | "renewals" | "events";
  label: string;
  /** null = nothing of this kind has ever been recorded — unknown, not zero. */
  count: number | null;
  parts: DayPart[];
  detail: string | null;
  severity: "critical" | "attention" | "normal";
  href: string;
  unavailable?: string;
};
export type MyDay = { day: string; isToday: boolean; cards: DayCard[] };

/**
 * What falls due on the ACTION DAY — today by default, tomorrow on request so
 * an RM can plan the next morning the evening before. Overdue work is NOT
 * here; it has its own section, so a card never mixes "due" with "late".
 * (Queries and SIP exceptions are standing queues rather than dated items, so
 * those two cards show what is open now.)
 */
export async function loadMyDay(
  tx: Tx, w: MyWindow, t: DashboardThresholds, day: string,
): Promise<MyDay> {
  const MINE = clientIds(w.scope);
  const isToday = day === w.today;
  const N = t.proposalAgeingDays;

  const meet = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled','no_show'))::int                 AS n,
           COUNT(*) FILTER (WHERE status NOT IN ('cancelled','no_show') AND category = 'new')::int    AS new_n,
           COUNT(*) FILTER (WHERE status NOT IN ('cancelled','no_show') AND category = 'review')::int AS review_n,
           COUNT(*) FILTER (WHERE status = 'completed')::int                                  AS done_n,
           MIN(meeting_date) FILTER (WHERE status IN (${UPCOMING})
                                      AND (${isToday} = false OR meeting_date >= now()))   AS next_at,
           (SELECT COUNT(*)::int FROM review_meetings WHERE ${staffMatch("rm_id", w)})        AS any_ever
      FROM review_meetings
     WHERE ${staffMatch("rm_id", w)}
       AND meeting_date >= ${day}::date AND meeting_date < (${day}::date + 1)
  `)).rows[0] as Row | undefined;

  const fu = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM leads
        WHERE ${leadsMatch(w)} AND converted_investor_id IS NULL
          AND lower(btrim(COALESCE(stage,''))) NOT IN (${CLOSED_LEAD})
          AND next_follow_up_at::date = ${day}::date)                                          AS leads,
      (SELECT COUNT(*)::int FROM (
         SELECT DISTINCT ON (a.subject_id) a.subject_id, a.next_followup_at
           FROM activities a
          WHERE a.subject_type = 'investor' AND ${staffMatch("owner_user_id", w, "a")}
            AND a.subject_id IN ${MINE}
          ORDER BY a.subject_id, a.occurred_at DESC
       ) x WHERE x.next_followup_at::date = ${day}::date)                                     AS clients,
      (SELECT COUNT(*)::int FROM proposals
        WHERE ${staffMatch("prepared_by_user_id", w)} AND status IN (${LIVE})
          AND (COALESCE(sent_at, created_at)::date + ${N}::int) = ${day}::date)               AS proposals
  `)).rows[0] as Row | undefined;

  const rev = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE upper(COALESCE(client_category,'')) IN ('A','B'))::int AS ab
      FROM investors
     WHERE ${clientsWhere(w.scope)} AND next_review_at::date = ${day}::date
  `)).rows[0] as Row | undefined;

  const tsk = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE type IN (${FIN}))::int AS fin
      FROM tasks
     WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL AND status NOT IN (${DEAD_TASK})
       AND due_at::date = ${day}::date
  `)).rows[0] as Row | undefined;

  const qry = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0)::int AS oldest,
           COUNT(*) FILTER (WHERE sla_resolution_at IS NOT NULL AND sla_resolution_at < now())::int AS breached
      FROM service_requests
     WHERE investor_id IN ${MINE} AND status IN (${OPEN_SR})
  `)).rows[0] as Row | undefined;

  const sip = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE t.order_date >= (${w.today}::date - 30))::int AS rejected_30,
           COUNT(*) FILTER (WHERE ${UNRECOVERED})::int                          AS pending,
           COALESCE(SUM(t.amount::numeric) FILTER (WHERE ${UNRECOVERED}), 0)   AS pending_value
      FROM transactions t
      LEFT JOIN sip_rejections r ON r.transaction_id = t.id
     WHERE t.investor_id IN ${MINE} AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
       AND t.order_date >= (${w.today}::date - 90)
  `)).rows[0] as Row | undefined;

  const ren = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE next_premium_due_date = ${day}::date)::int                          AS on_day,
           COUNT(*) FILTER (WHERE next_premium_due_date BETWEEN ${day}::date AND (${day}::date + 6))::int AS week,
           (SELECT COUNT(*)::int FROM insurance_policies WHERE investor_id IN ${MINE})              AS any_ever
      FROM insurance_policies
     WHERE investor_id IN ${MINE} AND status = 'active' AND next_premium_due_date IS NOT NULL
  `)).rows[0] as Row | undefined;

  // Birthdays and anniversaries by NEXT occurrence (the action centre's rule —
  // string month-day comparisons empty the week of Christmas).
  const ev = (await tx.execute(sql`
    WITH o AS (
      SELECT i.id, 'birthday' AS kind, i.dob AS d FROM investors i
       WHERE ${clientsWhereOn("i", w.scope)} AND i.dob IS NOT NULL
      UNION ALL
      SELECT i.id, 'anniversary', i.anniversary_date FROM investors i
       WHERE ${clientsWhereOn("i", w.scope)} AND i.anniversary_date IS NOT NULL
    ), n AS (
      SELECT kind,
             CASE WHEN (d + ((EXTRACT(YEAR FROM ${day}::date) - EXTRACT(YEAR FROM d))::int || ' years')::interval)::date >= ${day}::date
                  THEN (d + ((EXTRACT(YEAR FROM ${day}::date) - EXTRACT(YEAR FROM d))::int || ' years')::interval)::date
                  ELSE (d + ((EXTRACT(YEAR FROM ${day}::date) - EXTRACT(YEAR FROM d))::int + 1 || ' years')::interval)::date
             END AS next_on
        FROM o
    )
    SELECT COUNT(*) FILTER (WHERE kind = 'birthday' AND next_on = ${day}::date)::int    AS birthdays,
           COUNT(*) FILTER (WHERE kind = 'anniversary' AND next_on = ${day}::date)::int AS anniversaries,
           COUNT(*) FILTER (WHERE next_on > ${day}::date AND next_on <= (${day}::date + 6))::int AS later
      FROM n
  `)).rows[0] as Row | undefined;

  const me = staffParam(w);
  const dayWord = isToday ? "today" : "tomorrow";
  const leadsN = num(fu?.leads), clientsN = num(fu?.clients), propN = num(fu?.proposals);
  const tasksN = num(tsk?.n), finN = num(tsk?.fin);

  const cards: DayCard[] = [
    {
      key: "meetings", label: `Meetings ${dayWord}`,
      count: num(meet?.any_ever) > 0 ? num(meet?.n) : null,
      unavailable: "No meeting has ever been logged against you.",
      parts: [
        { label: "New", value: num(meet?.new_n) },
        { label: "Review", value: num(meet?.review_n) },
        ...(isToday ? [{ label: "Done", value: num(meet?.done_n) }] : []),
      ],
      detail: meet?.next_at ? `Next at ${timeIST(String(meet.next_at))}` : num(meet?.n) > 0 ? "No more today" : null,
      severity: "normal",
      href: `/dashboard/review-meetings?rm=${me}&status=scheduled`,
    },
    {
      key: "followups", label: `Follow-ups ${dayWord}`,
      count: leadsN + clientsN + propN,
      parts: [
        { label: "Clients", value: clientsN },
        { label: "Leads", value: leadsN },
        { label: "Proposals", value: propN },
      ],
      detail: propN > 0 ? `Proposals fall due ${N} days after sending` : null,
      severity: "normal",
      href: leadsHref(w.scope, isToday ? "followup_today=1" : ""),
    },
    {
      key: "reviews", label: `Reviews due ${dayWord}`,
      count: num(rev?.n),
      parts: num(rev?.ab) > 0 ? [{ label: "A/B clients", value: num(rev?.ab), tone: "warn" }] : [],
      detail: null,
      severity: num(rev?.ab) > 0 ? "attention" : "normal",
      href: clientsHref(w.scope, "review=due"),
    },
    {
      key: "sip", label: "SIP exceptions",
      count: num(sip?.pending) + num(sip?.rejected_30) > 0 ? num(sip?.pending) : 0,
      parts: [
        { label: "Rejected (30 days)", value: num(sip?.rejected_30), tone: num(sip?.rejected_30) > 0 ? "warn" : "neutral" },
        { label: "Repurchase pending", value: num(sip?.pending), tone: num(sip?.pending) > 0 ? "bad" : "neutral" },
      ],
      detail: num(sip?.pending_value) > 0 ? `${inr(num(sip?.pending_value))} still to recover` : null,
      severity: num(sip?.pending) > 0 ? "critical" : "normal",
      href: "/dashboard/sip-rejections?recovery=pending,client_contacted,bank_issue,mandate_issue",
    },
    {
      key: "tasks", label: `Tasks due ${dayWord}`,
      count: tasksN,
      parts: [
        { label: "Financial", value: finN },
        { label: "Non-financial", value: tasksN - finN },
      ],
      detail: null,
      severity: "normal",
      href: `/dashboard/tasks?assignee=${me}`,
    },
    {
      key: "queries", label: "Service requests pending",
      count: num(qry?.n),
      parts: num(qry?.breached) > 0 ? [{ label: "Past SLA", value: num(qry?.breached), tone: "bad" }] : [],
      detail: qry?.oldest != null && num(qry?.n) > 0 ? `Oldest ${num(qry?.oldest)} day${num(qry?.oldest) === 1 ? "" : "s"}` : null,
      severity: num(qry?.breached) > 0 ? "critical" : "normal",
      href: "/dashboard/service-requests?mine=1",
    },
    {
      key: "renewals", label: "Insurance renewals",
      count: num(ren?.any_ever) > 0 ? num(ren?.on_day) : null,
      unavailable: "None of your clients has a policy recorded in the CRM.",
      parts: [{ label: "Next 7 days", value: num(ren?.week) }],
      detail: null,
      severity: num(ren?.on_day) > 0 ? "attention" : "normal",
      href: "/dashboard/insurance?due=1",
    },
    {
      key: "events", label: "Client occasions",
      count: num(ev?.birthdays) + num(ev?.anniversaries),
      parts: [
        { label: "Birthdays", value: num(ev?.birthdays) },
        { label: "Anniversaries", value: num(ev?.anniversaries) },
      ],
      detail: num(ev?.later) > 0 ? `${num(ev?.later)} more in the next 6 days` : null,
      severity: "normal",
      href: clientsHref(w.scope, "occasion=7"),
    },
  ];
  return { day, isToday, cards };
}

/* ═══════════════════════════ §2 Needs My Attention ═══════════════════════════ */

export type OverdueCard = {
  key: string;
  label: string;
  count: number;
  /** Age of the oldest item, in days; null where age means nothing. */
  oldestDays: number | null;
  /** Rupees involved, where the items carry money. */
  value: number | null;
  severity: "critical" | "attention";
  href: string;
  /** Short rule text: what makes an item land here. */
  rule: string;
};

/**
 * Everything already LATE, by kind, with count, oldest age and money. All nine
 * cards always render — a zero reads "Nothing overdue" in neutral grey — so
 * the RM sees the whole checklist, not only its failures. Severity follows the
 * brief's alert logic (§38): critical for SLA breaches, significant unresolved
 * SIP rejections, badly overdue A/B reviews and past-due renewals; attention
 * for the rest.
 */
export async function loadOverdue(tx: Tx, w: MyWindow, t: DashboardThresholds): Promise<OverdueCard[]> {
  const MINE = clientIds(w.scope);
  const N = t.proposalAgeingDays;
  const r = (await tx.execute(sql`
    SELECT
      -- lead follow-ups past their date, and client follow-ups (the latest
      -- activity per client) past theirs
      (SELECT COUNT(*)::int FROM leads
        WHERE ${leadsMatch(w)} AND converted_investor_id IS NULL
          AND lower(btrim(COALESCE(stage,''))) NOT IN (${CLOSED_LEAD})
          AND next_follow_up_at::date < ${w.today}::date)                                  AS fu_leads,
      (SELECT MIN(next_follow_up_at)::date FROM leads
        WHERE ${leadsMatch(w)} AND converted_investor_id IS NULL
          AND lower(btrim(COALESCE(stage,''))) NOT IN (${CLOSED_LEAD})
          AND next_follow_up_at::date < ${w.today}::date)                                  AS fu_leads_min,
      (SELECT COUNT(*)::int FROM (
         SELECT DISTINCT ON (a.subject_id) a.next_followup_at FROM activities a
          WHERE a.subject_type = 'investor' AND ${staffMatch("owner_user_id", w, "a")} AND a.subject_id IN ${MINE}
          ORDER BY a.subject_id, a.occurred_at DESC) x
        WHERE x.next_followup_at::date < ${w.today}::date)                                 AS fu_clients,
      (SELECT MIN(x.next_followup_at)::date FROM (
         SELECT DISTINCT ON (a.subject_id) a.next_followup_at FROM activities a
          WHERE a.subject_type = 'investor' AND ${staffMatch("owner_user_id", w, "a")} AND a.subject_id IN ${MINE}
          ORDER BY a.subject_id, a.occurred_at DESC) x
        WHERE x.next_followup_at::date < ${w.today}::date)                                 AS fu_clients_min,

      (SELECT COUNT(*)::int FROM investors WHERE ${clientsWhere(w.scope)}
          AND next_review_at::date < ${w.today}::date)                                     AS rev_n,
      (SELECT MIN(next_review_at)::date FROM investors WHERE ${clientsWhere(w.scope)}
          AND next_review_at::date < ${w.today}::date)                                     AS rev_min,
      (SELECT COALESCE(SUM(aum::numeric), 0) FROM investors WHERE ${clientsWhere(w.scope)}
          AND next_review_at::date < ${w.today}::date)                                     AS rev_aum,
      (SELECT COUNT(*)::int FROM investors WHERE ${clientsWhere(w.scope)}
          AND upper(COALESCE(client_category,'')) IN ('A','B')
          AND next_review_at::date < (${w.today}::date - ${t.reviewSevereOverdueDays}::int)) AS rev_severe,

      (SELECT COUNT(*)::int FROM tasks WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
          AND status NOT IN (${DEAD_TASK}) AND due_at::date < ${w.today}::date)            AS tsk_n,
      (SELECT MIN(due_at)::date FROM tasks WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
          AND status NOT IN (${DEAD_TASK}) AND due_at::date < ${w.today}::date)            AS tsk_min,
      (SELECT COUNT(*)::int FROM tasks WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
          AND status NOT IN (${DEAD_TASK}) AND sla_due_at IS NOT NULL AND sla_due_at < now()) AS tsk_sla,

      (SELECT COUNT(*)::int FROM service_requests WHERE investor_id IN ${MINE} AND status IN (${OPEN_SR})
          AND sla_resolution_at IS NOT NULL AND sla_resolution_at < now())                 AS q_n,
      (SELECT MIN(created_at)::date FROM service_requests WHERE investor_id IN ${MINE} AND status IN (${OPEN_SR})
          AND sla_resolution_at IS NOT NULL AND sla_resolution_at < now())                 AS q_min,

      (SELECT COUNT(*)::int FROM proposals WHERE ${staffMatch("prepared_by_user_id", w)} AND status IN (${LIVE})
          AND (COALESCE(sent_at, created_at)::date + ${N}::int) < ${w.today}::date)        AS p_n,
      (SELECT MIN(COALESCE(sent_at, created_at))::date FROM proposals WHERE ${staffMatch("prepared_by_user_id", w)}
          AND status IN (${LIVE}) AND (COALESCE(sent_at, created_at)::date + ${N}::int) < ${w.today}::date) AS p_min,
      (SELECT COALESCE(SUM(total_investment::numeric), 0) FROM proposals WHERE ${staffMatch("prepared_by_user_id", w)}
          AND status IN (${LIVE}) AND (COALESCE(sent_at, created_at)::date + ${N}::int) < ${w.today}::date) AS p_value,

      (SELECT COUNT(*)::int FROM insurance_policies WHERE investor_id IN ${MINE} AND status = 'active'
          AND next_premium_due_date < ${w.today}::date)                                    AS ren_n,
      (SELECT MIN(next_premium_due_date) FROM insurance_policies WHERE investor_id IN ${MINE} AND status = 'active'
          AND next_premium_due_date < ${w.today}::date)                                    AS ren_min,
      (SELECT COALESCE(SUM(annual_premium::numeric), 0) FROM insurance_policies WHERE investor_id IN ${MINE}
          AND status = 'active' AND next_premium_due_date < ${w.today}::date)              AS ren_value,

      (SELECT COUNT(*)::int FROM investors WHERE ${clientsWhere(w.scope)}
          AND NOT ((pan IS NOT NULL AND btrim(pan) <> '') AND dob IS NOT NULL
               AND (email IS NOT NULL AND btrim(email) <> '')
               AND (phone IS NOT NULL AND btrim(phone) <> '')
               AND (client_category IS NOT NULL AND btrim(client_category) <> '')))        AS data_n
  `)).rows[0] as Row | undefined;

  // SIP rejections: unworked (no recovery record, or still "pending") and
  // worked-but-not-repurchased, each with age and money.
  const s = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE r.recovery_status IS NULL OR r.recovery_status = 'pending')::int AS unworked,
      MIN(t.order_date) FILTER (WHERE r.recovery_status IS NULL OR r.recovery_status = 'pending') AS unworked_min,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE r.recovery_status IS NULL OR r.recovery_status = 'pending'), 0) AS unworked_value,
      COUNT(*) FILTER (WHERE (r.recovery_status IS NULL OR r.recovery_status = 'pending')
                         AND t.order_date < (${w.today}::date - ${t.sipRejectionSlaDays}::int))::int AS past_sla,
      COUNT(*) FILTER (WHERE r.recovery_status IN ('client_contacted','bank_issue','mandate_issue'))::int AS repurchase,
      MIN(t.order_date) FILTER (WHERE r.recovery_status IN ('client_contacted','bank_issue','mandate_issue')) AS repurchase_min,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE r.recovery_status IN ('client_contacted','bank_issue','mandate_issue')), 0) AS repurchase_value
      FROM transactions t
      LEFT JOIN sip_rejections r ON r.transaction_id = t.id
     WHERE t.investor_id IN ${MINE} AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
       AND t.order_date >= (${w.today}::date - 90)
  `)).rows[0] as Row | undefined;

  const age = (d: unknown) => (d ? Math.max(0, daysBetween(String(d), w.today)) : null);
  const minDate = (...ds: unknown[]) => ds.filter(Boolean).map(String).sort()[0] ?? null;
  const me = staffParam(w);
  const fuN = num(r?.fu_leads) + num(r?.fu_clients);

  return [
    {
      key: "followups", label: "Overdue follow-ups", count: fuN,
      oldestDays: age(minDate(r?.fu_leads_min, r?.fu_clients_min)), value: null,
      severity: "attention", href: leadsHref(w.scope, "followup_overdue=1"),
      rule: "A lead or client follow-up date that has passed.",
    },
    {
      key: "reviews", label: "Overdue reviews", count: num(r?.rev_n),
      oldestDays: age(r?.rev_min), value: num(r?.rev_n) > 0 ? num(r?.rev_aum) : null,
      severity: num(r?.rev_severe) > 0 ? "critical" : "attention", href: clientsHref(w.scope, "review=overdue"),
      rule: `Review date passed. Critical when an A/B client is ${t.reviewSevereOverdueDays}+ days late.`,
    },
    {
      key: "tasks", label: "Overdue tasks", count: num(r?.tsk_n),
      oldestDays: age(r?.tsk_min), value: null,
      severity: num(r?.tsk_sla) > 0 ? "critical" : "attention", href: `/dashboard/tasks?assignee=${me}&due=overdue`,
      rule: "Due date passed, still open. Critical when past its SLA.",
    },
    {
      key: "queries", label: "Overdue service requests", count: num(r?.q_n),
      oldestDays: age(r?.q_min), value: null,
      severity: "critical", href: "/dashboard/service-requests?mine=1&breached=1",
      rule: "Past the resolution SLA and still with us.",
    },
    {
      key: "proposals", label: "Proposal follow-up overdue", count: num(r?.p_n),
      oldestDays: age(r?.p_min), value: num(r?.p_n) > 0 ? num(r?.p_value) : null,
      severity: "attention", href: "/dashboard/proposals?status=sent",
      rule: `Sent more than ${N} days ago with no decision.`,
    },
    {
      key: "sip_rejections", label: "SIP rejection pending", count: num(s?.unworked),
      oldestDays: age(s?.unworked_min), value: num(s?.unworked) > 0 ? num(s?.unworked_value) : null,
      severity: num(s?.past_sla) > 0 ? "critical" : "attention",
      href: "/dashboard/sip-rejections?recovery=pending",
      rule: `Bounced debit not yet worked. Critical past ${t.sipRejectionSlaDays} day${t.sipRejectionSlaDays === 1 ? "" : "s"}.`,
    },
    {
      key: "sip_repurchase", label: "SIP repurchase pending", count: num(s?.repurchase),
      oldestDays: age(s?.repurchase_min), value: num(s?.repurchase) > 0 ? num(s?.repurchase_value) : null,
      severity: "attention", href: "/dashboard/sip-rejections?recovery=client_contacted,bank_issue,mandate_issue",
      rule: "Client contacted or bank / mandate issue raised; not yet re-processed.",
    },
    {
      key: "renewals", label: "Renewal follow-up pending", count: num(r?.ren_n),
      oldestDays: age(r?.ren_min), value: num(r?.ren_n) > 0 ? num(r?.ren_value) : null,
      severity: "critical", href: "/dashboard/insurance?due=1",
      rule: "Premium due date passed on an active policy.",
    },
    {
      key: "data", label: "Client data pending", count: num(r?.data_n),
      oldestDays: null, value: null,
      severity: "attention", href: clientsHref(w.scope),
      rule: "Missing PAN, date of birth, email, mobile or category.",
    },
  ];
}

/* ═══════════════════════════ §5 Today's worklist ═══════════════════════════ */

export type WorkKind =
  | "meeting" | "meeting_update" | "review" | "lead_followup" | "client_followup"
  | "task" | "query" | "sip_rejection" | "proposal" | "renewal";

export type WorkItem = {
  key: string;
  kind: WorkKind;
  /** Activity family for the filter chips. */
  activity: "meeting" | "review" | "follow_up" | "proposal" | "task" | "query" | "sip" | "insurance";
  clientId: string | null;
  leadId: string | null;
  /** Null when the record is linked to neither a client nor a lead. */
  client: string | null;
  category: string | null;
  aum: number | null;
  action: string;
  /** ISO date or timestamp the action falls due. */
  due: string | null;
  hasTime: boolean;
  /** "3 days overdue" · "11:30 AM" · "Today" · "Tomorrow 10:00 AM" — formatted here, in India time. */
  dueText: string;
  bucket: "overdue" | "today" | "tomorrow";
  daysOverdue: number;
  lastInteraction: string | null;
  related: { label: string; href: string };
  /** The brief's three alert levels (§38): critical · attention · normal. */
  priority: "critical" | "attention" | "normal";
  /** The visible reasons for the priority — never a score. */
  why: string[];
  status: string;
  phone: string | null;
  email: string | null;
  taskId: string | null;
  meetingId: string | null;
};

const CAT_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
const catRank = (c: string | null) => (c && c in CAT_RANK ? CAT_RANK[c] : 4);
const BUCKET_RANK = { overdue: 0, today: 1, tomorrow: 2 } as const;

/**
 * Every due and overdue action as one list, sorted the way the brief orders
 * it: overdue first, then due on the action day, then client category (A
 * before B before C before D), then due time. Each row names the reason for
 * its priority in words, so the order can be checked, never taken on trust.
 */
export async function loadWorklist(
  tx: Tx, w: MyWindow, t: DashboardThresholds, day: string,
): Promise<{ items: WorkItem[]; truncated: boolean }> {
  const MINE = clientIds(w.scope);
  const N = t.proposalAgeingDays;
  const PER = 25;
  const client = sql`i.id AS client_id, i.name AS client, upper(NULLIF(btrim(i.client_category), '')) AS category,
                     i.aum::numeric AS aum, i.phone, i.email, i.last_contact_at AS last_touch`;

  const meetings = (await tx.execute(sql`
    SELECT m.id, m.meeting_date AS due, m.category AS mcat, m.meeting_type, m.status, m.subject,
           i.id AS client_id, COALESCE(i.name, l.name, m.subject, 'Untitled') AS client,
           upper(NULLIF(btrim(i.client_category), '')) AS category, i.aum::numeric AS aum,
           COALESCE(i.phone, l.phone) AS phone, COALESCE(i.email, l.email) AS email,
           COALESCE(i.last_contact_at, l.last_contact_at) AS last_touch, l.id AS lead_id
      FROM review_meetings m
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l     ON l.id = m.lead_id
     WHERE ${staffMatch("rm_id", w, "m")} AND m.status IN (${UPCOMING})
       AND m.meeting_date < (${day}::date + 1)
       AND m.meeting_date >= (${w.today}::date - 60)
     ORDER BY m.meeting_date ASC LIMIT ${PER}
  `)).rows as Row[];

  // A review already booked is not "schedule a review" — the meeting row is.
  const reviews = (await tx.execute(sql`
    SELECT ${client}, i.next_review_at AS due
      FROM investors i
     WHERE ${clientsWhereOn("i", w.scope)} AND i.next_review_at IS NOT NULL
       AND i.next_review_at::date <= ${day}::date
       AND NOT EXISTS (SELECT 1 FROM review_meetings m WHERE m.investor_id = i.id
                        AND m.status IN (${UPCOMING}) AND m.meeting_date >= ${w.today}::date)
     ORDER BY i.next_review_at ASC LIMIT ${PER}
  `)).rows as Row[];

  const leadFu = (await tx.execute(sql`
    SELECT l.id AS lead_id, l.name AS client, l.phone, l.email, l.next_follow_up_at AS due, l.stage,
           GREATEST(l.last_contact_at, l.last_follow_up_at) AS last_touch, ${LEAD_VALUE} AS value
      FROM leads l
     WHERE ${leadsMatch(w, "l")} AND l.converted_investor_id IS NULL
       AND lower(btrim(COALESCE(l.stage,''))) NOT IN (${CLOSED_LEAD})
       AND l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at::date <= ${day}::date
     ORDER BY l.next_follow_up_at ASC LIMIT ${PER}
  `)).rows as Row[];

  const clientFu = (await tx.execute(sql`
    SELECT x.activity_id, x.what, x.next_followup_at AS due, ${client}
      FROM (
        SELECT DISTINCT ON (a.subject_id) a.id AS activity_id, a.subject_id, a.subject AS what, a.next_followup_at
          FROM activities a
         WHERE a.subject_type = 'investor' AND ${staffMatch("owner_user_id", w, "a")} AND a.subject_id IN ${MINE}
         ORDER BY a.subject_id, a.occurred_at DESC
      ) x
      JOIN investors i ON i.id = x.subject_id
     WHERE x.next_followup_at IS NOT NULL AND x.next_followup_at::date <= ${day}::date
     ORDER BY x.next_followup_at ASC LIMIT ${PER}
  `)).rows as Row[];

  // A task can be about someone OUTSIDE this book — a colleague's client the
  // task was assigned over. Then the row shows only the name the task already
  // carries: no link, category, AUM or contact details from another RM's book.
  // "In the book" means the whole book, not the filtered view, so a client
  // filter never turns the RM's own clients into strangers.
  const own = sql`i.id IN ${clientIds({ ...w.scope, filter: undefined })}`;
  const ownLead = sql`(lt.id IS NOT NULL AND ${leadsMatch(w, "lt")})`;
  const tasks = (await tx.execute(sql`
    SELECT tk.id, tk.title, tk.type, tk.priority, tk.status, tk.due_at AS due, tk.sla_due_at,
           COALESCE(i.name, lt.name)                                                  AS client,
           CASE WHEN ${own} THEN i.id END                                             AS client_id,
           CASE WHEN ${own} THEN upper(NULLIF(btrim(i.client_category), '')) END      AS category,
           CASE WHEN ${own} THEN i.aum::numeric END                                   AS aum,
           CASE WHEN ${own} THEN i.phone WHEN ${ownLead} THEN lt.phone END            AS phone,
           CASE WHEN ${own} THEN i.email WHEN ${ownLead} THEN lt.email END            AS email,
           CASE WHEN ${own} THEN i.last_contact_at WHEN ${ownLead} THEN lt.last_contact_at END AS last_touch,
           CASE WHEN ${ownLead} THEN lt.id END                                        AS lead_id
      FROM tasks tk
      LEFT JOIN investors i ON i.id = ${taskInvestor("tk")}
      LEFT JOIN leads lt    ON lt.id = ${taskLead("tk")}
     WHERE ${staffMatch("assignee_id", w, "tk")} AND tk.deleted_at IS NULL AND tk.status NOT IN (${DEAD_TASK})
       AND tk.due_at IS NOT NULL AND tk.due_at::date <= ${day}::date
     ORDER BY tk.due_at ASC LIMIT ${PER}
  `)).rows as Row[];

  // Open queries whose SLA falls on or before the action day, plus any older
  // than the firm's ageing threshold that were never given an SLA.
  const queries = (await tx.execute(sql`
    SELECT sr.id, sr.type, sr.status, sr.created_at, sr.sla_resolution_at, ${client}
      FROM service_requests sr JOIN investors i ON i.id = sr.investor_id
     WHERE sr.investor_id IN ${MINE} AND sr.status IN (${OPEN_SR})
       AND ((sr.sla_resolution_at IS NOT NULL AND sr.sla_resolution_at::date <= ${day}::date)
         OR (sr.sla_resolution_at IS NULL AND sr.created_at < now() - (${t.queryAgeingDays} || ' days')::interval))
     ORDER BY COALESCE(sr.sla_resolution_at, sr.created_at) ASC LIMIT ${PER}
  `)).rows as Row[];

  const sips = (await tx.execute(sql`
    SELECT tr.id, tr.amount::numeric AS amount, tr.order_date, tr.scheme_name, r.id AS rejection_id,
           COALESCE(r.recovery_status, 'not_worked') AS recovery, ${client}
      FROM transactions tr
      JOIN investors i ON i.id = tr.investor_id
      LEFT JOIN sip_rejections r ON r.transaction_id = tr.id
     WHERE tr.investor_id IN ${MINE} AND tr.status = 'rejected' AND tr.type IN ('sip','sip_topup')
       AND tr.order_date >= (${w.today}::date - 90) AND ${UNRECOVERED}
     ORDER BY tr.order_date ASC LIMIT ${PER}
  `)).rows as Row[];

  const proposals = (await tx.execute(sql`
    SELECT p.id, p.total_investment::numeric AS amount, p.status, COALESCE(p.sent_at, p.created_at) AS sent,
           i.id AS client_id, COALESCE(i.name, l.name, p.recipient_name, 'Proposal') AS client,
           upper(NULLIF(btrim(i.client_category), '')) AS category, i.aum::numeric AS aum,
           COALESCE(i.phone, l.phone, p.recipient_phone) AS phone, COALESCE(i.email, l.email, p.recipient_email) AS email,
           COALESCE(i.last_contact_at, l.last_contact_at) AS last_touch, l.id AS lead_id
      FROM proposals p
      LEFT JOIN investors i ON i.id = p.investor_id
      LEFT JOIN leads l     ON l.id = p.lead_id
     WHERE ${staffMatch("prepared_by_user_id", w, "p")} AND p.status IN (${LIVE})
       AND (COALESCE(p.sent_at, p.created_at)::date + ${N}::int) <= ${day}::date
     ORDER BY COALESCE(p.sent_at, p.created_at) ASC LIMIT ${PER}
  `)).rows as Row[];

  const renewals = (await tx.execute(sql`
    SELECT p.id, p.insurer, p.policy_type, p.annual_premium::numeric AS premium, p.next_premium_due_date AS due, ${client}
      FROM insurance_policies p JOIN investors i ON i.id = p.investor_id
     WHERE p.investor_id IN ${MINE} AND p.status = 'active'
       AND p.next_premium_due_date IS NOT NULL AND p.next_premium_due_date <= ${day}::date
     ORDER BY p.next_premium_due_date ASC LIMIT ${PER}
  `)).rows as Row[];

  const items: WorkItem[] = [];
  const bucketOf = (due: string | null): WorkItem["bucket"] => {
    if (!due) return "today";
    const d = due.slice(0, 10);
    return d < w.today ? "overdue" : d === w.today ? "today" : "tomorrow";
  };
  const base = (x: Row, kind: WorkKind, activity: WorkItem["activity"], id: string, due: string | null, hasTime: boolean) => {
    const bucket = bucketOf(due);
    const daysOverdue = bucket === "overdue" && due ? daysBetween(due, w.today) : 0;
    const clock = hasTime && due && hasClock(due) ? timeIST(due) : null;
    const dueText = bucket === "overdue" ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
      : bucket === "today" ? clock ?? "Today" : clock ? `Tomorrow ${clock}` : "Tomorrow";
    return {
      key: `${kind}:${id}`, kind, activity,
      clientId: str(x.client_id), leadId: str(x.lead_id),
      client: str(x.client), category: str(x.category), aum: x.aum == null ? null : num(x.aum),
      due, hasTime, dueText, bucket, daysOverdue,
      lastInteraction: str(x.last_touch), phone: str(x.phone), email: str(x.email),
      taskId: null as string | null, meetingId: null as string | null,
    };
  };
  const clientHref = (x: Row) =>
    x.client_id ? `/dashboard/investors/${x.client_id}` : x.lead_id ? `/dashboard/leads/${x.lead_id}` : "#";
  // The age is not repeated here: the Due column already reads "12 days overdue".
  const catWhy = (c: string | null) => (c === "A" || c === "B" ? [`${c} category`] : []);

  for (const x of meetings) {
    const due = str(x.due);
    const b = base(x, "meeting", x.mcat === "review" ? "review" : "meeting", String(x.id), due, true);
    // Past its time and still "scheduled": the outcome was never recorded —
    // including a 10am meeting on a page opened at 3pm.
    const past = b.bucket === "overdue" || (due != null && b.bucket === "today" && Date.parse(due) < Date.now());
    items.push({
      ...b,
      kind: past ? "meeting_update" : "meeting",
      key: `${past ? "meeting_update" : "meeting"}:${x.id}`,
      action: past ? "Record meeting outcome" : x.mcat === "review" ? "Review meeting" : `Meeting${x.subject ? ` — ${x.subject}` : ""}`,
      related: { label: past ? "Update meeting" : "Open meeting", href: `/dashboard/review-meetings/${x.id}` },
      priority: past ? "attention" : catRank(b.category) <= 1 ? "attention" : "normal",
      why: past ? ["Meeting passed, outcome not recorded", ...catWhy(b.category)] : [`At ${timeIST(due ?? "")}`, ...catWhy(b.category)],
      status: past ? "Not updated" : humanStatus(String(x.status)),
      meetingId: String(x.id),
    });
  }
  for (const x of reviews) {
    const b = base(x, "review", "review", String(x.client_id), str(x.due), false);
    const severe = b.bucket === "overdue" && catRank(b.category) <= 1 && b.daysOverdue >= t.reviewSevereOverdueDays;
    items.push({
      ...b, action: "Schedule review",
      related: { label: "Book review", href: `/dashboard/review-meetings/new?investorId=${x.client_id}&category=review` },
      priority: severe ? "critical" : b.bucket === "overdue" || catRank(b.category) <= 1 ? "attention" : "normal",
      why: [...catWhy(b.category)],
      status: "Not scheduled",
    });
  }
  for (const x of leadFu) {
    const b = base(x, "lead_followup", "follow_up", String(x.lead_id), str(x.due), true);
    items.push({
      ...b, action: "Follow up lead",
      related: { label: "Open lead", href: `/dashboard/leads/${x.lead_id}` },
      priority: b.bucket === "overdue" ? "attention" : "normal",
      why: [...(num(x.value) > 0 ? [`${inr(num(x.value))} potential`] : [])],
      status: humanStatus(String(x.stage ?? "new")),
    });
  }
  for (const x of clientFu) {
    const b = base(x, "client_followup", "follow_up", String(x.activity_id), str(x.due), true);
    items.push({
      ...b, action: x.what ? `Follow up — ${x.what}` : "Follow up client",
      related: { label: "Open client", href: clientHref(x) },
      priority: b.bucket === "overdue" ? "attention" : catRank(b.category) <= 1 ? "attention" : "normal",
      why: [...catWhy(b.category)],
      status: "Follow-up set",
    });
  }
  for (const x of tasks) {
    const b = base(x, "task", "task", String(x.id), str(x.due), true);
    const pastSla = x.sla_due_at != null && Date.parse(String(x.sla_due_at)) < Date.now();
    const urgent = x.priority === "urgent" || x.priority === "high";
    items.push({
      ...b, action: String(x.title ?? "Task"),
      related: { label: "Open task", href: `/dashboard/tasks?task=${x.id}` },
      priority: pastSla ? "critical" : b.bucket === "overdue" || urgent ? "attention" : "normal",
      why: [...(pastSla ? ["Past SLA"] : []), ...(urgent ? [`Priority: ${x.priority}`] : []), ...catWhy(b.category)],
      status: humanStatus(String(x.status)),
      taskId: String(x.id),
    });
  }
  for (const x of queries) {
    const due = str(x.sla_resolution_at) ?? str(x.created_at);
    const b = base(x, "query", "query", String(x.id), due, false);
    const breached = x.sla_resolution_at != null && Date.parse(String(x.sla_resolution_at)) < Date.now();
    items.push({
      ...b, action: `Resolve query — ${humanStatus(String(x.type ?? "query"))}`,
      related: { label: "Open service request", href: `/dashboard/service-requests/${x.id}` },
      priority: breached ? "critical" : "normal",
      why: breached ? ["SLA breached", ...catWhy(b.category)] : [x.sla_resolution_at ? "SLA due" : `Open ${t.queryAgeingDays}+ days, no SLA`, ...catWhy(b.category)],
      status: humanStatus(String(x.status)),
    });
  }
  for (const x of sips) {
    const due = addDaysISO(String(x.order_date).slice(0, 10), t.sipRejectionSlaDays);
    const b = base(x, "sip_rejection", "sip", String(x.id), due, false);
    items.push({
      ...b, action: "Follow up SIP rejection",
      related: { label: "SIP rejections", href: `/dashboard/sip-rejections?q=${encodeURIComponent(String(x.client ?? ""))}` },
      priority: b.bucket === "overdue" ? "critical" : "attention",
      why: [`${inr(num(x.amount))} SIP bounced ${fmtShort(String(x.order_date))}`, ...(b.bucket === "overdue" ? ["Past SLA"] : []), ...catWhy(b.category)],
      status: humanStatus(String(x.recovery)),
    });
  }
  for (const x of proposals) {
    const due = addDaysISO(String(x.sent).slice(0, 10), N);
    const b = base(x, "proposal", "proposal", String(x.id), due, false);
    items.push({
      ...b, action: "Follow up proposal",
      related: { label: "Open proposal", href: `/dashboard/proposals/${x.id}` },
      priority: b.bucket === "overdue" ? "attention" : "normal",
      why: [`Sent ${fmtShort(String(x.sent))}`, ...(num(x.amount) > 0 ? [inr(num(x.amount))] : []), ...catWhy(b.category)],
      status: humanStatus(String(x.status)),
    });
  }
  for (const x of renewals) {
    const b = base(x, "renewal", "insurance", String(x.id), str(x.due), false);
    items.push({
      ...b, action: "Contact for renewal",
      related: { label: "Open policy", href: `/dashboard/insurance/${x.id}` },
      priority: b.bucket === "overdue" ? "critical" : "attention",
      why: [...(num(x.premium) > 0 ? [`${inr(num(x.premium))} premium`] : []), ...catWhy(b.category)],
      status: b.bucket === "overdue" ? "Past due" : "Due",
    });
  }

  items.sort((a, b) =>
    BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket]
    || catRank(a.category) - catRank(b.category)
    || String(a.due ?? "").localeCompare(String(b.due ?? "")));
  const LIMIT = 80;
  return { items: items.slice(0, LIMIT), truncated: items.length > LIMIT };
}

/* ═══════════════════════════ §6 Upcoming 7 days ═══════════════════════════ */

export type UpcomingItem = {
  key: string;
  date: string;
  time: string | null;
  kind: "meeting" | "review" | "follow_up" | "task" | "renewal" | "occasion";
  title: string;
  client: string | null;
  href: string;
  /** Where to move it, where the CRM allows moving it. */
  rescheduleHref: string | null;
};

export async function loadUpcoming(tx: Tx, w: MyWindow, days = 7): Promise<UpcomingItem[]> {
  const MINE = clientIds(w.scope);
  const end = addDaysISO(w.today, days - 1);
  const rows = (await tx.execute(sql`
    SELECT * FROM (
      SELECT 'meeting' AS kind, m.id::text AS id, m.meeting_date AS at, true AS timed,
             CASE WHEN m.category = 'review' THEN 'Review meeting' ELSE COALESCE(NULLIF(m.subject, ''), 'Meeting') END AS title,
             COALESCE(i.name, l.name) AS client, i.id::text AS client_id
        FROM review_meetings m
        LEFT JOIN investors i ON i.id = m.investor_id LEFT JOIN leads l ON l.id = m.lead_id
       WHERE (${staffMatch("rm_id", w, "m")} OR ${attendeeIsAnyUser(w.staff)}) AND m.status IN (${UPCOMING})
         AND m.meeting_date >= ${w.today}::date AND m.meeting_date < (${end}::date + 1)
      UNION ALL
      SELECT 'review', i.id::text, i.next_review_at, false, 'Review due', i.name, i.id::text
        FROM investors i
       WHERE ${clientsWhereOn("i", w.scope)} AND i.next_review_at::date BETWEEN ${w.today}::date AND ${end}::date
      UNION ALL
      SELECT 'follow_up', l.id::text, l.next_follow_up_at, true, 'Lead follow-up', l.name, NULL
        FROM leads l
       WHERE ${leadsMatch(w, "l")} AND l.converted_investor_id IS NULL
         AND lower(btrim(COALESCE(l.stage,''))) NOT IN (${CLOSED_LEAD})
         AND l.next_follow_up_at::date BETWEEN ${w.today}::date AND ${end}::date
      UNION ALL
      SELECT 'follow_up', x.subject_id::text, x.next_followup_at, true, COALESCE(NULLIF(x.subject, ''), 'Client follow-up'), i.name, i.id::text
        FROM (SELECT DISTINCT ON (a.subject_id) a.subject_id, a.subject, a.next_followup_at FROM activities a
               WHERE a.subject_type = 'investor' AND ${staffMatch("owner_user_id", w, "a")} AND a.subject_id IN ${MINE}
               ORDER BY a.subject_id, a.occurred_at DESC) x
        JOIN investors i ON i.id = x.subject_id
       WHERE x.next_followup_at::date BETWEEN ${w.today}::date AND ${end}::date
      UNION ALL
      SELECT 'task', tk.id::text, tk.due_at, true, tk.title, i.name, i.id::text
        FROM tasks tk LEFT JOIN investors i ON i.id = ${taskInvestor("tk")}
       WHERE ${staffMatch("assignee_id", w, "tk")} AND tk.deleted_at IS NULL AND tk.status NOT IN (${DEAD_TASK})
         AND tk.due_at::date BETWEEN ${w.today}::date AND ${end}::date
      UNION ALL
      SELECT 'renewal', p.id::text, p.next_premium_due_date::timestamp, false,
             'Premium due' || COALESCE(' — ' || p.insurer, ''), i.name, i.id::text
        FROM insurance_policies p JOIN investors i ON i.id = p.investor_id
       WHERE p.investor_id IN ${MINE} AND p.status = 'active'
         AND p.next_premium_due_date BETWEEN ${w.today}::date AND ${end}::date
    ) u ORDER BY at ASC LIMIT 120
  `)).rows as Row[];

  // Occasions by next occurrence, as everywhere else.
  const occ = (await tx.execute(sql`
    SELECT id::text AS id, name, kind, next_on FROM (
      SELECT i.id, i.name, k.kind,
             CASE WHEN (k.d + ((EXTRACT(YEAR FROM ${w.today}::date) - EXTRACT(YEAR FROM k.d))::int || ' years')::interval)::date >= ${w.today}::date
                  THEN (k.d + ((EXTRACT(YEAR FROM ${w.today}::date) - EXTRACT(YEAR FROM k.d))::int || ' years')::interval)::date
                  ELSE (k.d + ((EXTRACT(YEAR FROM ${w.today}::date) - EXTRACT(YEAR FROM k.d))::int + 1 || ' years')::interval)::date
             END AS next_on
        FROM investors i
        CROSS JOIN LATERAL (VALUES ('Birthday', i.dob), ('Anniversary', i.anniversary_date)) AS k(kind, d)
       WHERE ${clientsWhereOn("i", w.scope)} AND k.d IS NOT NULL
    ) o WHERE next_on BETWEEN ${w.today}::date AND ${end}::date
    ORDER BY next_on LIMIT 40
  `)).rows as Row[];

  const out: UpcomingItem[] = rows.map((r) => {
    const kind = String(r.kind) as UpcomingItem["kind"];
    const at = String(r.at);
    const clientLink = r.client_id ? `/dashboard/investors/${r.client_id}` : null;
    const href =
      kind === "meeting" ? `/dashboard/review-meetings/${r.id}`
      : kind === "task" ? `/dashboard/tasks?task=${r.id}`
      : kind === "renewal" ? `/dashboard/insurance/${r.id}`
      : kind === "follow_up" && !r.client_id ? `/dashboard/leads/${r.id}`
      : clientLink ?? "#";
    return {
      key: `${kind}:${r.id}:${at}`,
      date: localDate(at),
      time: r.timed === true && hasClock(at) ? timeIST(at) : null,
      kind,
      title: String(r.title ?? ""),
      client: str(r.client),
      href,
      rescheduleHref: kind === "meeting" ? `/dashboard/review-meetings/${r.id}`
        : kind === "task" ? `/dashboard/tasks?task=${r.id}` : null,
    };
  });
  for (const o of occ) {
    out.push({
      key: `occasion:${o.id}:${o.kind}`,
      date: String(o.next_on).slice(0, 10),
      time: null,
      kind: "occasion",
      title: String(o.kind),
      client: str(o.name),
      href: `/dashboard/investors/${o.id}`,
      rescheduleHref: null,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"));
}

/* ═══════════════════════════ §8 meeting preparation ═══════════════════════════ */

export type MeetingPrep = {
  meetingId: string;
  when: string;
  type: string;
  purpose: string | null;
  clientId: string;
  client: string;
  category: string | null;
  family: string | null;
  aum: number;
  sipBook: number;
  recent: Array<{ date: string; type: string; amount: number; scheme: string | null }>;
  lastMeeting: string | null;
  lastNotes: string | null;
  openTasks: number;
  openQueries: number;
  nextReview: string | null;
  risk: "Completed" | "Provisional" | "Not completed";
  riskSigned: string | null;
  renewalDue: string | null;
  pendingProposals: number;
  pendingProposalValue: number;
};

/**
 * A data-only snapshot for each coming client meeting. Relationship
 * preparation, not a sales script: nothing here suggests a product (§8). The
 * meeting page's own prep pack remains one click away for the full brief.
 */
export async function loadMeetingPrep(tx: Tx, w: MyWindow, limit = 6): Promise<MeetingPrep[]> {
  const meetings = (await tx.execute(sql`
    SELECT m.id, m.meeting_date, m.meeting_type, m.category, m.subject, m.investor_id
      FROM review_meetings m
     WHERE ${staffMatch("rm_id", w, "m")} AND m.status IN (${UPCOMING}) AND m.investor_id IS NOT NULL
       AND m.meeting_date >= ${w.today}::date AND m.meeting_date < (${w.today}::date + 8)
     ORDER BY m.meeting_date ASC LIMIT ${limit}
  `)).rows as Row[];
  if (meetings.length === 0) return [];
  const ids = [...new Set(meetings.map((m) => String(m.investor_id)))];
  const IDS = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

  // A minor's risk is their own assessment, never the guardian's copy (G-1).
  const rk = clientRiskSql("i");
  const clients = (await tx.execute(sql`
    SELECT i.id, i.name, upper(NULLIF(btrim(i.client_category), '')) AS category, i.aum::numeric AS aum,
           i.active_sip_amount::numeric AS sip, i.next_review_at, ${rk.category} AS risk_profile, ${rk.signedAt} AS risk_profile_signed_at,
           ${rk.provisional} AS provisional,
           COALESCE(f.family_name, f.head_name) AS family,
           (SELECT COUNT(*)::int FROM tasks tk WHERE ${taskIsAbout("tk", sql`i.id`)} AND tk.deleted_at IS NULL
             AND tk.status NOT IN (${DEAD_TASK}))                                            AS open_tasks,
           (SELECT COUNT(*)::int FROM service_requests sr WHERE sr.investor_id = i.id
             AND sr.status NOT IN ('resolved','closed'))                                     AS open_queries,
           (SELECT MIN(p.next_premium_due_date) FROM insurance_policies p WHERE p.investor_id = i.id
             AND p.status = 'active' AND p.next_premium_due_date >= ${w.today}::date)          AS renewal_due,
           (SELECT COUNT(*)::int FROM proposals pr WHERE pr.investor_id = i.id AND pr.status IN (${LIVE})) AS props,
           (SELECT COALESCE(SUM(pr.total_investment::numeric), 0) FROM proposals pr WHERE pr.investor_id = i.id
             AND pr.status IN (${LIVE}))                                                     AS props_value
      FROM investors i LEFT JOIN families f ON f.id = i.family_id
     WHERE i.id IN (${IDS})
  `)).rows as Row[];

  const last = (await tx.execute(sql`
    SELECT DISTINCT ON (investor_id) investor_id, meeting_date,
           COALESCE(NULLIF(btrim(meeting_notes), ''), NULLIF(btrim(outcome_notes), '')) AS notes
      FROM review_meetings
     WHERE investor_id IN (${IDS}) AND status = 'completed'
     ORDER BY investor_id, meeting_date DESC
  `)).rows as Row[];

  const txns = (await tx.execute(sql`
    SELECT investor_id, order_date, type, amount::numeric AS amount, scheme_name FROM (
      SELECT t.*, row_number() OVER (PARTITION BY t.investor_id ORDER BY t.order_date DESC NULLS LAST) AS rn
        FROM transactions t
       WHERE t.investor_id IN (${IDS}) AND t.status IN ('processed','successful') AND t.amount IS NOT NULL
    ) x WHERE rn <= 3
  `)).rows as Row[];

  const C = new Map(clients.map((c) => [String(c.id), c]));
  const L = new Map(last.map((l) => [String(l.investor_id), l]));
  return meetings.flatMap((m) => {
    const c = C.get(String(m.investor_id));
    if (!c) return [];
    const l = L.get(String(m.investor_id));
    const signed = c.risk_profile != null;
    return [{
      meetingId: String(m.id),
      when: String(m.meeting_date),
      type: m.category === "review" ? "Review" : humanStatus(String(m.meeting_type ?? "meeting")),
      purpose: str(m.subject),
      clientId: String(c.id),
      client: String(c.name ?? "—"),
      category: str(c.category),
      family: str(c.family),
      aum: num(c.aum),
      sipBook: num(c.sip),
      recent: txns.filter((t) => String(t.investor_id) === String(c.id)).map((t) => ({
        date: String(t.order_date ?? ""), type: String(t.type ?? ""), amount: num(t.amount), scheme: str(t.scheme_name),
      })),
      lastMeeting: l ? String(l.meeting_date) : null,
      lastNotes: l ? str(l.notes) : null,
      openTasks: num(c.open_tasks),
      openQueries: num(c.open_queries),
      nextReview: str(c.next_review_at),
      risk: !signed ? "Not completed" : c.provisional === true ? "Provisional" : "Completed",
      riskSigned: str(c.risk_profile_signed_at),
      renewalDue: str(c.renewal_due),
      pendingProposals: num(c.props),
      pendingProposalValue: num(c.props_value),
    }];
  });
}

/* ═══════════════════════════ §14 leads needing action ═══════════════════════════ */

export type LeadActionRow = {
  id: string; name: string; source: string | null; created: string; lastActivity: string | null;
  stage: string; potential: number | null; nextAction: string; urgency: "bad" | "warn" | "neutral";
};
export type LeadActions = {
  notContacted: number; dueToday: number; overdue: number; noNextAction: number;
  stale: number; staleAfterDays: number; meetingNotScheduled: number;
  rows: LeadActionRow[];
};

const MEETING_STAGE_SET = new Set(
  FUNNEL.filter((f) => f.key === "contacted").flatMap((f) => f.stages),
);

export async function loadLeadActions(tx: Tx, w: MyWindow, staleDays: number): Promise<LeadActions> {
  const CONTACTED = sql.join([...MEETING_STAGE_SET].map((s) => sql`${s}`), sql`, `);
  const open = sql`${leadsMatch(w, "l")} AND l.converted_investor_id IS NULL
                   AND lower(btrim(COALESCE(l.stage,''))) NOT IN (${CLOSED_LEAD})`;
  const noMeeting = sql`NOT EXISTS (SELECT 1 FROM review_meetings m WHERE m.lead_id = l.id)`;
  const touch = sql`GREATEST(
    COALESCE(l.last_contact_at, to_timestamp(0)), COALESCE(l.last_follow_up_at, to_timestamp(0)),
    COALESCE(l.stage_changed_at, to_timestamp(0)), COALESCE(l.updated_at, to_timestamp(0)))`;
  const c = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE lower(btrim(COALESCE(l.stage,'new'))) = 'new'
                         AND l.last_contact_at IS NULL AND l.last_follow_up_at IS NULL)::int AS not_contacted,
      COUNT(*) FILTER (WHERE l.next_follow_up_at::date = ${w.today}::date)::int          AS due_today,
      COUNT(*) FILTER (WHERE l.next_follow_up_at::date < ${w.today}::date)::int          AS overdue,
      COUNT(*) FILTER (WHERE l.next_follow_up_at IS NULL)::int                             AS no_next,
      COUNT(*) FILTER (WHERE ${touch} < now() - (${staleDays} || ' days')::interval)::int  AS stale,
      COUNT(*) FILTER (WHERE lower(btrim(COALESCE(l.stage,''))) IN (${CONTACTED}) AND ${noMeeting})::int AS no_meeting
      FROM leads l WHERE ${open}
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT l.id, l.name, l.source, l.created_at, l.stage, l.next_follow_up_at,
           NULLIF(${touch}, to_timestamp(0)) AS last_activity,
           COALESCE(l.expected_business_amount,
             NULLIF(regexp_replace(COALESCE(l.intended_amount, ''), '[^0-9.]', '', 'g'), '')::numeric) AS potential,
           (lower(btrim(COALESCE(l.stage,'new'))) = 'new' AND l.last_contact_at IS NULL AND l.last_follow_up_at IS NULL) AS not_contacted,
           (lower(btrim(COALESCE(l.stage,''))) IN (${CONTACTED}) AND ${noMeeting}) AS no_meeting,
           (${touch} < now() - (${staleDays} || ' days')::interval) AS stale,
           EXTRACT(EPOCH FROM (now() - ${touch}))::bigint / 86400 AS silent_days
      FROM leads l
     WHERE ${open}
       AND (l.next_follow_up_at::date <= ${w.today}::date OR l.next_follow_up_at IS NULL
            OR ${touch} < now() - (${staleDays} || ' days')::interval)
     ORDER BY (l.next_follow_up_at::date < ${w.today}::date) DESC NULLS LAST,
              (lower(btrim(COALESCE(l.stage,'new'))) = 'new' AND l.last_contact_at IS NULL) DESC,
              l.next_follow_up_at ASC NULLS LAST, l.created_at ASC
     LIMIT 15
  `)).rows as Row[];

  return {
    notContacted: num(c?.not_contacted), dueToday: num(c?.due_today), overdue: num(c?.overdue),
    noNextAction: num(c?.no_next), stale: num(c?.stale), staleAfterDays: staleDays,
    meetingNotScheduled: num(c?.no_meeting),
    rows: rows.map((r) => {
      const fu = str(r.next_follow_up_at);
      const overdueBy = fu && fu.slice(0, 10) < w.today ? daysBetween(fu, w.today) : 0;
      const nextAction =
        overdueBy > 0 ? `Follow up — ${overdueBy} day${overdueBy === 1 ? "" : "s"} overdue`
        : fu && fu.slice(0, 10) === w.today ? "Follow up today"
        : r.not_contacted === true ? "Make first contact"
        : r.no_meeting === true ? "Schedule a meeting"
        : r.stale === true ? `Re-engage — silent ${num(r.silent_days)} days`
        : "Set the next follow-up date";
      return {
        id: String(r.id), name: String(r.name ?? "—"), source: str(r.source),
        created: String(r.created_at), lastActivity: str(r.last_activity),
        stage: String(r.stage ?? "new"), potential: r.potential == null ? null : num(r.potential),
        nextAction,
        urgency: overdueBy > 0 ? "bad" : r.not_contacted === true || r.stale === true ? "warn" : "neutral",
      };
    }),
  };
}

/* ═══════════════════════════ §19 SIP debit health ═══════════════════════════ */

export type SipDebitHealth = {
  /** Does the SIP register carry next-instalment dates at all? */
  tracked: boolean;
  dueSoon: Array<{ sipId: string; clientId: string; client: string; scheme: string | null; amount: number; next: string }>;
  failedDebits: number;
  repeatedFailures: number;
  followUpPending: number;
  mandateIssues: number;
  atRisk: AtRiskSip[];
};

/**
 * Debit monitoring, only as far as the register actually records it. The
 * at-risk rules are the SIP-defence module's (lib/finance/sip-defense.ts) —
 * dead or expiring mandate, 2+ consecutive failures, ending soon — so this
 * card and the At-risk SIPs page agree. Failed debits are the ledger's
 * rejections. Nothing is inferred where the register is silent (§19).
 */
export async function loadSipDebitHealth(
  tx: Tx, w: MyWindow, tenantId: string,
): Promise<SipDebitHealth> {
  const MINE = clientIds(w.scope);
  const person = bookPerson(w.scope);
  const reg = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE s.next_installment_at IS NOT NULL)::int AS with_next
      FROM sips s WHERE s.investor_id IN ${MINE} AND s.status = 'active'
  `)).rows[0] as Row | undefined;
  const due = (await tx.execute(sql`
    SELECT s.id, i.id AS client_id, i.name AS client, s.scheme_name, s.amount::numeric AS amount, s.next_installment_at
      FROM sips s JOIN investors i ON i.id = s.investor_id
     WHERE s.investor_id IN ${MINE} AND s.status = 'active'
       AND s.next_installment_at::date BETWEEN ${w.today}::date AND (${w.today}::date + 3)
     ORDER BY s.next_installment_at ASC LIMIT 10
  `)).rows as Row[];
  const led = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE t.order_date >= (${w.today}::date - 30))::int AS failed_30,
           COUNT(*) FILTER (WHERE ${UNRECOVERED})::int AS pending
      FROM transactions t LEFT JOIN sip_rejections r ON r.transaction_id = t.id
     WHERE t.investor_id IN ${MINE} AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
       AND t.order_date >= (${w.today}::date - 90)
  `)).rows[0] as Row | undefined;
  // The SIP-defence rules run on the person's whole book; a client filter on
  // the page narrows the list to the clients still in view.
  const defence = await findAtRiskSips(tx, tenantId, { rmId: person });
  const inView = new Set(((await tx.execute(sql`SELECT id::text AS id FROM investors WHERE ${clientsWhere(w.scope)}`))
    .rows as Array<{ id: string }>).map((r) => r.id));
  const atRisk = defence.atRisk.filter((s) => inView.has(String(s.investorId)));
  return {
    tracked: num(reg?.with_next) > 0,
    dueSoon: due.map((d) => ({
      sipId: String(d.id), clientId: String(d.client_id), client: String(d.client ?? "—"),
      scheme: str(d.scheme_name), amount: num(d.amount), next: String(d.next_installment_at),
    })),
    failedDebits: num(led?.failed_30),
    repeatedFailures: atRisk.filter((s) => s.reasons.includes("repeated_failures")).length,
    followUpPending: num(led?.pending),
    mandateIssues: atRisk.filter((s) => s.reasons.includes("dead_mandate") || s.reasons.includes("mandate_expiring")).length,
    atRisk: atRisk.slice(0, 8),
  };
}

/* ═══════════════════════════ §28 new-client onboarding ═══════════════════════════ */

export type OnboardingStep = { key: string; label: string; done: number; stuck: number };
export type OnboardingClient = {
  id: string; name: string; category: string | null; source: string | null; created: string;
  kyc: boolean; risk: boolean; proposal: boolean; transacted: boolean; active: boolean; nextStep: string;
};
export type Onboarding = {
  /** Clients added this FY — the cohort the pipeline is drawn over. */
  cohort: number;
  steps: OnboardingStep[];
  thisMonth: OnboardingClient[];
};

/**
 * Lead converted → client created → KYC & data complete → risk profile →
 * proposal → first transaction → relationship active, for the clients added
 * this FY. A client counts as STUCK at the first step it has not completed.
 * A proposal is not required before a transaction (execution-only clients
 * exist), so a client who has transacted is never shown stuck at "Proposal".
 */
export async function loadOnboarding(tx: Tx, w: MyWindow): Promise<Onboarding> {
  // A minor's risk is their own assessment, never the guardian's copy (G-1).
  const rk = clientRiskSql("i");
  const rows = (await tx.execute(sql`
    SELECT i.id, i.name, upper(NULLIF(btrim(i.client_category), '')) AS category,
           to_char(${onboardedDateSql("i")}, 'YYYY-MM-DD') AS onboarded_on,
           (SELECT l.source FROM leads l WHERE l.converted_investor_id = i.id
             ORDER BY l.converted_at DESC NULLS LAST LIMIT 1)                               AS source,
           EXISTS (SELECT 1 FROM leads l WHERE l.converted_investor_id = i.id)              AS from_lead,
           (i.kyc_status IN ('validated','registered','verified')
             AND (i.pan IS NOT NULL AND btrim(i.pan) <> '') AND i.dob IS NOT NULL
             AND (i.phone IS NOT NULL AND btrim(i.phone) <> '')
             AND (i.email IS NOT NULL AND btrim(i.email) <> ''))                            AS kyc,
           (${rk.category} IS NOT NULL AND ${rk.provisional} = false) AS risk,
           EXISTS (SELECT 1 FROM proposals p WHERE p.investor_id = i.id)                    AS proposal,
           EXISTS (SELECT 1 FROM transactions t WHERE t.investor_id = i.id
                    AND t.status IN ('processed','successful'))                              AS transacted,
           (i.status = 'active' AND (COALESCE(i.aum::numeric, 0) > 0
                                     OR COALESCE(i.active_sip_amount::numeric, 0) > 0))    AS active
      FROM investors i
     WHERE ${clientsWhereOn("i", w.scope)} AND ${onboardedDateSql("i")} >= ${w.fyStart}::date
     ORDER BY i.onboarded_at DESC
  `)).rows as Row[];

  const STEPS = [
    { key: "lead", label: "Lead converted" },
    { key: "created", label: "Client created" },
    { key: "kyc", label: "KYC & data complete" },
    { key: "risk", label: "Risk profile" },
    { key: "proposal", label: "Proposal" },
    { key: "transacted", label: "First transaction" },
    { key: "active", label: "Relationship active" },
  ];
  const nextOf = (r: Row): string => {
    if (r.kyc !== true) return "kyc";
    if (r.risk !== true) return "risk";
    if (r.transacted !== true && r.proposal !== true) return "proposal";
    if (r.transacted !== true) return "transacted";
    if (r.active !== true) return "active";
    return "done";
  };
  const counts = Object.fromEntries(STEPS.map((s) => [s.key, { done: 0, stuck: 0 }]));
  for (const r of rows) {
    if (r.from_lead === true) counts.lead.done++;
    counts.created.done++;
    for (const k of ["kyc", "risk", "proposal", "transacted", "active"]) if (r[k] === true) counts[k].done++;
    const n = nextOf(r);
    if (n !== "done") counts[n].stuck++;
  }
  const monthStart = `${w.today.slice(0, 8)}01`;
  const label = Object.fromEntries(STEPS.map((s) => [s.key, s.label]));
  return {
    cohort: rows.length,
    steps: STEPS.map((s) => ({ key: s.key, label: s.label, done: counts[s.key].done, stuck: counts[s.key].stuck })),
    thisMonth: rows.filter((r) => String(r.onboarded_on) >= monthStart).slice(0, 20).map((r) => {
      const n = nextOf(r);
      return {
        id: String(r.id), name: String(r.name ?? "—"), category: str(r.category), source: str(r.source),
        created: String(r.onboarded_on), kyc: r.kyc === true, risk: r.risk === true, proposal: r.proposal === true,
        transacted: r.transacted === true, active: r.active === true,
        nextStep: n === "done" ? "Onboarded" : label[n],
      };
    }),
  };
}

/* ═══════════════════════════ §29 client source ═══════════════════════════ */

export type SourceRow = { source: string; leads: number; newClients: number; business: number };

/**
 * Where relationships came from, by the lead's recorded source — only values
 * that actually occur in the CRM (§29). Business is gross investment (the
 * RTA ledger's purchase and SIP rows) in the period from clients converted
 * from that source. Clients with no originating lead are "Not recorded".
 */
export async function loadSourceAnalysis(tx: Tx, w: MyWindow): Promise<SourceRow[]> {
  const GROSS_IN = asInList(GROSS_TYPES);
  const leads = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(btrim(l.source), ''), '__none__') AS source, COUNT(*)::int AS n
      FROM leads l WHERE ${leadsMatch(w, "l")}
       AND l.created_at >= ${w.from}::date AND l.created_at < (${w.to}::date + 1)
     GROUP BY 1
  `)).rows as Row[];
  const clients = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(btrim(src.source), ''), '__none__') AS source,
           COUNT(*) FILTER (WHERE ${onboardedDateSql("i")} BETWEEN ${w.from}::date AND ${w.to}::date)::int AS n,
           COALESCE(SUM((SELECT SUM(t.amount::numeric) FROM transactions t
                          WHERE t.investor_id = i.id AND t.status IN ('processed','successful')
                            AND t.type IN (${GROSS_IN})
                            AND t.order_date BETWEEN ${w.from}::date AND ${w.to}::date)), 0) AS business
      FROM investors i
      LEFT JOIN LATERAL (SELECT l.source FROM leads l WHERE l.converted_investor_id = i.id
                          ORDER BY l.converted_at DESC NULLS LAST LIMIT 1) src ON TRUE
     WHERE ${clientsWhereOn("i", w.scope)}
     GROUP BY 1
  `)).rows as Row[];
  const map = new Map<string, SourceRow>();
  const get = (s: string) => map.get(s) ?? (map.set(s, { source: s, leads: 0, newClients: 0, business: 0 }), map.get(s)!);
  for (const r of leads) get(String(r.source)).leads += num(r.n);
  for (const r of clients) {
    const e = get(String(r.source));
    e.newClients += num(r.n);
    e.business += num(r.business);
  }
  return [...map.values()]
    .filter((r) => r.leads + r.newClients > 0 || r.business !== 0)
    .sort((a, b) => Number(a.source === "__none__") - Number(b.source === "__none__") || b.business - a.business || b.leads - a.leads);
}

/* ═══════════════════════════ §36 end of day ═══════════════════════════ */

export type TodayProgress = {
  meetings: { planned: number; done: number };
  followUps: { due: number; done: number };
  tasks: { due: number; done: number };
  reviews: { due: number; done: number };
  queriesActioned: number;
  leadsCreated: number;
  proposalsShared: number;
  business: { entries: number; value: number } | null;
};

/**
 * "Close the day": what was planned for today against what got done. Business
 * recorded today is Business Entries logged today; null when the firm has
 * never used Business Entries (unknown, not ₹0).
 */
export async function loadTodayProgress(tx: Tx, w: MyWindow): Promise<TodayProgress> {
  const MINE = clientIds(w.scope);
  const T = w.today;
  const r = (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM review_meetings WHERE ${staffMatch("rm_id", w)}
         AND meeting_date >= ${T}::date AND meeting_date < (${T}::date + 1)
         AND status NOT IN ('cancelled','no_show'))                                         AS m_planned,
      (SELECT COUNT(*)::int FROM review_meetings WHERE ${staffMatch("rm_id", w)}
         AND meeting_date >= ${T}::date AND meeting_date < (${T}::date + 1) AND status = 'completed') AS m_done,
      (SELECT COUNT(*)::int FROM review_meetings WHERE ${staffMatch("rm_id", w)} AND category = 'review'
         AND meeting_date >= ${T}::date AND meeting_date < (${T}::date + 1) AND status = 'completed') AS r_done,
      (SELECT COUNT(*)::int FROM investors WHERE ${clientsWhere(w.scope)}
         AND next_review_at::date = ${T}::date)                                             AS r_due,
      (SELECT COUNT(*)::int FROM leads WHERE ${leadsMatch(w)}
         AND next_follow_up_at::date = ${T}::date)                                          AS fu_due_leads,
      (SELECT COUNT(*)::int FROM leads WHERE ${leadsMatch(w)}
         AND last_follow_up_at::date = ${T}::date)                                          AS fu_done_leads,
      (SELECT COUNT(DISTINCT a.subject_id)::int FROM activities a
        WHERE ${staffMatch("owner_user_id", w, "a")} AND a.subject_type = 'investor'
          AND a.occurred_at >= ${T}::date AND a.occurred_at < (${T}::date + 1))              AS fu_done_clients,
      (SELECT COUNT(*)::int FROM tasks WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
         AND due_at::date = ${T}::date AND status <> 'cancelled')                           AS t_due,
      (SELECT COUNT(*)::int FROM tasks WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
         AND status = 'completed' AND completed_at >= ${T}::date AND completed_at < (${T}::date + 1)) AS t_done,
      (SELECT COUNT(*)::int FROM service_requests WHERE investor_id IN ${MINE}
         AND (updated_at >= ${T}::date OR resolved_at >= ${T}::date))                       AS q_actioned,
      (SELECT COUNT(*)::int FROM leads WHERE ${leadsMatch(w)} AND created_at >= ${T}::date
         AND created_at < (${T}::date + 1))                                                 AS leads_new,
      (SELECT COUNT(*)::int FROM proposals WHERE ${staffMatch("prepared_by_user_id", w)}
         AND sent_at >= ${T}::date AND sent_at < (${T}::date + 1))                          AS props_sent,
      (SELECT COUNT(*)::int FROM business_entries be
        WHERE be.investor_id IN ${MINE} OR (be.investor_id IS NULL AND ${staffMatch("rm_id", w, "be")})) AS be_ever,
      (SELECT COUNT(*)::int FROM business_entries be
        WHERE (be.investor_id IN ${MINE} OR (be.investor_id IS NULL AND ${staffMatch("rm_id", w, "be")}))
          AND be.created_at >= ${T}::date AND be.created_at < (${T}::date + 1))             AS be_today,
      (SELECT COALESCE(SUM(bel.amount::numeric), 0) FROM business_entries be
         JOIN business_entry_lines bel ON bel.entry_id = be.id
        WHERE (be.investor_id IN ${MINE} OR (be.investor_id IS NULL AND ${staffMatch("rm_id", w, "be")}))
          AND be.created_at >= ${T}::date AND be.created_at < (${T}::date + 1))             AS be_value
  `)).rows[0] as Row | undefined;
  return {
    meetings: { planned: num(r?.m_planned), done: num(r?.m_done) },
    followUps: { due: num(r?.fu_due_leads), done: num(r?.fu_done_leads) + num(r?.fu_done_clients) },
    tasks: { due: num(r?.t_due), done: num(r?.t_done) },
    reviews: { due: num(r?.r_due), done: num(r?.r_done) },
    queriesActioned: num(r?.q_actioned),
    leadsCreated: num(r?.leads_new),
    proposalsShared: num(r?.props_sent),
    business: num(r?.be_ever) > 0 ? { entries: num(r?.be_today), value: num(r?.be_value) } : null,
  };
}

/* ═══════════════════════════ §21 investment flow by month ═══════════════════════════ */

export type FlowProduct = "all_mf" | "equity" | "debt" | "liquid" | "other_mf" | "sif" | "aif" | "pms" | "other";
export type MonthFlow = { purchase: number; redemption: number };
export type FlowByMonth = {
  /** null when this book has never had a business entry. */
  months: string[] | null;
  /** product → twelve months, April first. */
  series: Record<FlowProduct, MonthFlow[]>;
  mtd: Record<FlowProduct, MonthFlow>;
  fytd: Record<FlowProduct, MonthFlow>;
};

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

/**
 * Gross purchase, redemption and net by month and product, from Business
 * Entries — the only source that records SIF, AIF and PMS and an explicit
 * asset class (see loadInvestmentFlow in lib/dashboard/branch/sections.ts for
 * the same rule at branch level). Entries belong to the book through their
 * client, or — with no client on the entry — through the RM who booked it.
 * Switch and STP count as purchase into the target product, as in the MIS.
 */
export async function loadFlowByMonth(tx: Tx, w: MyWindow): Promise<FlowByMonth> {
  // The book's signed booked lines (lib/dashboard/my/booked.ts): a line the
  // RTA rejected reverses in the month it was rejected.
  const src = await bookedLinesOnBook(tx, w.scope);
  const fyEnd = `${Number(w.fyStart.slice(0, 4)) + 1}-03-31`;
  const rows = src
    ? ((await tx.execute(sql`
        SELECT ((EXTRACT(MONTH FROM bel.eff_date)::int + 8) % 12) AS m,
               CASE WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'equity' THEN 'equity'
                    WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'liquid' THEN 'liquid'
                    WHEN be.product_type = 'mutual_fund' AND bel.asset_class = 'debt'   THEN 'debt'
                    WHEN be.product_type = 'mutual_fund'                               THEN 'other_mf'
                    WHEN be.product_type IN ('sif','aif','pms')                        THEN be.product_type
                    ELSE 'other' END AS product,
               (bel.eff_date >= ${`${w.today.slice(0, 8)}01`}::date) AS this_month,
               COALESCE(SUM(bel.amount * bel.sign) FILTER (
                 WHERE bel.txn_type IN ('lumpsum','additional_purchase','sip','sip_topup','switch','stp')), 0) AS purchase,
               COALESCE(SUM(bel.amount * bel.sign) FILTER (WHERE bel.txn_type IN ('redemption','swp')), 0)   AS redemption
          FROM ${src.from}
         WHERE ${src.where}
           AND bel.eff_date >= ${w.fyStart}::date AND bel.eff_date <= ${fyEnd}::date
           AND bel.eff_date <= ${w.today}::date
         GROUP BY 1, 2, 3
      `)).rows as Row[])
    : [];

  const PRODUCTS: FlowProduct[] = ["all_mf", "equity", "debt", "liquid", "other_mf", "sif", "aif", "pms", "other"];
  const blank = () => FY_MONTHS.map(() => ({ purchase: 0, redemption: 0 }));
  const series = Object.fromEntries(PRODUCTS.map((p) => [p, blank()])) as Record<FlowProduct, MonthFlow[]>;
  const mtd = Object.fromEntries(PRODUCTS.map((p) => [p, { purchase: 0, redemption: 0 }])) as Record<FlowProduct, MonthFlow>;
  const fytd = Object.fromEntries(PRODUCTS.map((p) => [p, { purchase: 0, redemption: 0 }])) as Record<FlowProduct, MonthFlow>;
  const MF = new Set(["equity", "debt", "liquid", "other_mf"]);
  for (const r of rows) {
    const m = num(r.m);
    const p = String(r.product) as FlowProduct;
    const add = (k: FlowProduct) => {
      series[k][m].purchase += num(r.purchase);
      series[k][m].redemption += num(r.redemption);
      fytd[k].purchase += num(r.purchase);
      fytd[k].redemption += num(r.redemption);
      if (r.this_month === true) { mtd[k].purchase += num(r.purchase); mtd[k].redemption += num(r.redemption); }
    };
    add(p);
    if (MF.has(p)) add("all_mf");
  }
  return { months: src ? FY_MONTHS : null, series, mtd, fytd };
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

/** "11:30 AM" in India time — the RM's clock, whatever the server's. */
export function timeIST(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatDate(d, "time");
}
function localDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).format(d);
  return parts;
}
/** A timestamp carries a meaningful time when it is not exactly midnight IST. */
function hasClock(iso: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const t = timeIST(iso);
  return t !== "" && t !== "12:00 AM";
}
function fmtShort(iso: string): string {
  const out = formatDate(iso.slice(0, 10), "dayMonth");
  return out === "—" ? iso : out;
}
export function humanStatus(s: string): string {
  const t = s.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
}
function inr(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(2)} Lakh`;
  return `₹${Math.round(a).toLocaleString("en-IN")}`;
}
