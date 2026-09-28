/**
 * §2 Today's Action Centre — the first thing on the page. SERVER-ONLY.
 *
 * This section answers one question: what should I do in the next hour? So it
 * is the only part of the cockpit that IGNORES the period filter. "Meetings
 * today" means today, whether the KPI strip above is showing this month or the
 * whole financial year — a filter that silently reaches into a to-do list turns
 * "3 follow-ups due" into "3 follow-ups due at some point last quarter", which
 * is not a to-do list at all.
 *
 * ── Severity, and why most cards are not red ────────────────────────────────
 *
 * Three levels, from the brief: critical (overdue and consequential),
 * attention (approaching), normal (routine). The budget is deliberate — if
 * eight of ten cards are red, none of them is. A card with nothing in it is
 * `normal` and reads as calm, never as a green success badge; "0 SIP
 * rejections" is not an achievement, it is Tuesday.
 *
 * Every card carries an href. A count you cannot open is decoration.
 *
 * ── Every href uses a param the TARGET page actually reads ──────────────────
 *
 * A drill-down link is a contract with another page, and it fails silently in
 * both directions. The first version of this file passed `?owner=me` to Leads
 * and `?assignee=me` to Tasks — both cast the value to a uuid, so "me" made
 * Postgres reject the query and the card opened an error page. Other params
 * (`?mine=1` on Meetings, `?renewal=30` on Insurance) were simply ignored, so
 * the card opened the whole firm's list under a personal-cockpit heading.
 *
 * Before changing an href here, grep the target page for `sp.<param>`. The
 * ones used below are: leads `mine` / `followup_today` / `followup_overdue`,
 * tasks `assignee=<uuid>` / `due=overdue` / `task=<id>` (opens the drawer —
 * there is no /dashboard/tasks/[id] route), review-meetings `rm=<uuid>`,
 * sip-rejections `recovery=`, insurance `due=1`.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** A raw SQL result row. Postgres hands numerics back as strings, so every
 *  field goes through num() / numOrNull() before it is used. */
type Row = Record<string, unknown>;
import { pluralDays } from "@/lib/format";
import {
  asInList, clientIds, clientsHref, clientsWhere, FINANCIAL_TASK_TYPES, LEAD_CLOSED_STAGES, leadsHref,
  leadsMatch, MEETING_UPCOMING, num, PROPOSAL_LIVE, SR_OPEN_ON_US, staffMatch, staffParam, TASK_DEAD,
  type MyWindow,
  taskInvestor,
} from "./window";

export type Severity = "critical" | "attention" | "normal";

export type ActionCard = {
  key: string;
  label: string;
  /** null = the source holds nothing at all, so the count is unknown, not 0. */
  count: number | null;
  /** The supporting figure — rupees, oldest age, a split. Already formatted. */
  detail: string | null;
  severity: Severity;
  href: string;
  /** Up to five names, so the card is a worklist rather than a number. */
  names: Array<{ id: string; name: string; meta: string | null; href: string }>;
  /** Shown when `count` is null — says WHY, never implies zero. */
  unavailable?: string;
};

/** Sort so the work that is actually overdue floats, then the largest counts. */
const RANK: Record<Severity, number> = { critical: 0, attention: 1, normal: 2 };

export async function loadActionCentre(tx: Tx, w: MyWindow): Promise<ActionCard[]> {
  const MINE = clientIds(w.scope);
  const OPEN_SR = asInList(SR_OPEN_ON_US);
  const DEAD_TASK = asInList(TASK_DEAD);
  const UPCOMING = asInList(MEETING_UPCOMING);
  const LIVE_PROPOSAL = asInList(PROPOSAL_LIVE);
  const FINANCIAL_IN = asInList(FINANCIAL_TASK_TYPES);
  const CLOSED_LEAD = asInList(LEAD_CLOSED_STAGES);

  /* ── Meetings today ──────────────────────────────────────────────────── */
  const meetings = (await tx.execute(sql`
    SELECT m.id, m.meeting_date, m.meeting_type, m.meeting_mode, m.subject,
           COALESCE(i.name, l.name, m.subject, 'Untitled') AS who,
           i.id AS investor_id
      FROM review_meetings m
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l     ON l.id = m.lead_id
     WHERE ${staffMatch("rm_id", w, "m")}
       AND m.status IN (${UPCOMING})
       AND m.meeting_date >= ${w.today}::date
       AND m.meeting_date <  (${w.today}::date + 1)
     ORDER BY m.meeting_date ASC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  const meetingCorpus = (await tx.execute(sql`
    SELECT COUNT(*)::int AS any_ever FROM review_meetings WHERE ${staffMatch("rm_id", w)}
  `)).rows[0] as Row | undefined;

  /* ── Follow-ups due today: leads I own with a follow-up date of today
        or earlier. Overdue ones are included — a follow-up that slipped is
        MORE due today, not less. ─────────────────────────────────────────── */
  const followUps = (await tx.execute(sql`
    SELECT id, name, next_follow_up_at, last_contact_at, stage,
           (next_follow_up_at::date < ${w.today}::date) AS overdue
      FROM leads
     WHERE ${leadsMatch(w)}
       AND converted_investor_id IS NULL
       AND lower(btrim(COALESCE(stage,''))) NOT IN (${CLOSED_LEAD})
       AND next_follow_up_at IS NOT NULL
       AND next_follow_up_at < (${w.today}::date + 1)
     ORDER BY next_follow_up_at ASC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;
  const followUpTotal = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE next_follow_up_at::date < ${w.today}::date)::int AS overdue
      FROM leads
     WHERE ${leadsMatch(w)}
       AND converted_investor_id IS NULL
       AND lower(btrim(COALESCE(stage,''))) NOT IN (${CLOSED_LEAD})
       AND next_follow_up_at IS NOT NULL
       AND next_follow_up_at < (${w.today}::date + 1)
  `)).rows[0] as Row | undefined;

  /* ── Client reviews: due today / this week / overdue ─────────────────── */
  const reviews = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE next_review_at::date = ${w.today}::date)::int                                          AS due_today,
      COUNT(*) FILTER (WHERE next_review_at::date > ${w.today}::date
                         AND next_review_at::date <= (${w.today}::date + 7))::int                                   AS due_week,
      COUNT(*) FILTER (WHERE next_review_at::date < ${w.today}::date)::int                                          AS overdue,
      COUNT(*) FILTER (WHERE next_review_at IS NULL)::int                                                           AS unscheduled
      FROM investors
     WHERE ${clientsWhere(w.scope)}
  `)).rows[0] as Row | undefined;
  const reviewNames = (await tx.execute(sql`
    SELECT id, name, client_category, next_review_at,
           (${w.today}::date - next_review_at::date) AS days_over
      FROM investors
     WHERE ${clientsWhere(w.scope)}
       AND next_review_at IS NOT NULL
       AND next_review_at::date <= (${w.today}::date + 7)
     ORDER BY next_review_at ASC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  /* ── Proposals awaiting a response ───────────────────────────────────── */
  const proposals = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(total_investment::numeric), 0) AS amount,
           COUNT(*) FILTER (WHERE COALESCE(sent_at, created_at) < now() - interval '7 days')::int AS stale,
           (SELECT COUNT(*)::int FROM proposals WHERE ${staffMatch("prepared_by_user_id", w)}) AS any_ever
      FROM proposals
     WHERE ${staffMatch("prepared_by_user_id", w)}
       AND status IN (${LIVE_PROPOSAL})
  `)).rows[0] as Row | undefined;
  const proposalNames = (await tx.execute(sql`
    SELECT id, COALESCE(recipient_name, title, 'Untitled') AS name, total_investment, sent_at, created_at
      FROM proposals
     WHERE ${staffMatch("prepared_by_user_id", w)} AND status IN (${LIVE_PROPOSAL})
     ORDER BY COALESCE(sent_at, created_at) ASC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  /* ── SIP rejections, and the repurchase still pending ─────────────────
        Ground truth is the LEDGER (a debit that bounced), not the
        `sip_rejections` register — the register is written by the RTA
        importer and is empty on a book whose feed predates it, which would
        show "no rejections" on a book with five. The register is joined for
        the recovery state where it exists. ─────────────────────────────── */
  const rejections = (await tx.execute(sql`
    SELECT
      COUNT(*)::int                                                      AS n,
      COALESCE(SUM(t.amount::numeric), 0)                                AS amount,
      COUNT(*) FILTER (WHERE r.recovery_status IS NULL
                          OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable'))::int AS pending,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE r.recovery_status IS NULL
                          OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable')), 0)  AS pending_amount
      FROM transactions t
      LEFT JOIN sip_rejections r ON r.transaction_id = t.id
     WHERE t.investor_id IN ${MINE}
       AND t.status = 'rejected'
       AND t.type IN ('sip','sip_topup')
       AND t.order_date >= (${w.today}::date - 90)
  `)).rows[0] as Row | undefined;
  const rejectionNames = (await tx.execute(sql`
    SELECT t.id, i.name, t.amount, t.order_date, t.scheme_name, i.id AS investor_id
      FROM transactions t
      JOIN investors i ON i.id = t.investor_id
     WHERE t.investor_id IN ${MINE}
       AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
       AND t.order_date >= (${w.today}::date - 90)
     ORDER BY t.order_date DESC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  /* ── Client queries still with us ─────────────────────────────────────── */
  const queries = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0)::int AS oldest_days,
           COUNT(*) FILTER (WHERE sla_resolution_at IS NOT NULL AND sla_resolution_at < now())::int AS breached
      FROM service_requests
     WHERE investor_id IN ${MINE} AND status IN (${OPEN_SR})
  `)).rows[0] as Row | undefined;
  const queryNames = (await tx.execute(sql`
    SELECT sr.id, i.name, sr.type, sr.created_at,
           EXTRACT(EPOCH FROM (now() - sr.created_at))::bigint / 86400 AS age_days
      FROM service_requests sr
      JOIN investors i ON i.id = sr.investor_id
     WHERE sr.investor_id IN ${MINE} AND sr.status IN (${OPEN_SR})
     ORDER BY sr.created_at ASC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  /* ── My overdue tasks, split financial / non-financial ─────────────────
        The split comes from `tasks.type`, not `department` — see
        FINANCIAL_TASK_TYPES for why. Anything unclassified counts as
        non-financial rather than being dropped from the total. ──────────── */
  const tasksRow = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE type IN (${FINANCIAL_IN}))::int     AS financial,
           COUNT(*) FILTER (WHERE type IS NULL
                              OR type NOT IN (${FINANCIAL_IN}))::int  AS non_financial
      FROM tasks
     WHERE ${staffMatch("assignee_id", w)}
       AND deleted_at IS NULL
       AND status NOT IN (${DEAD_TASK})
       AND due_at < now()
  `)).rows[0] as Row | undefined;
  const taskNames = (await tx.execute(sql`
    SELECT t.id, t.title, t.due_at, t.priority, i.name AS client
      FROM tasks t
      LEFT JOIN investors i ON i.id = ${taskInvestor("t")}
     WHERE ${staffMatch("assignee_id", w, "t")}
       AND t.deleted_at IS NULL
       AND t.status NOT IN (${DEAD_TASK})
       AND t.due_at < now()
     ORDER BY t.due_at ASC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  /* ── Insurance renewals on my clients' policies ───────────────────────── */
  const renewals = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE next_premium_due_date <= (${w.today}::date + 7))::int  AS d7,
      COUNT(*) FILTER (WHERE next_premium_due_date <= (${w.today}::date + 15))::int AS d15,
      COUNT(*) FILTER (WHERE next_premium_due_date <= (${w.today}::date + 30))::int AS d30,
      (SELECT COUNT(*)::int FROM insurance_policies WHERE investor_id IN ${MINE}) AS any_ever
      FROM insurance_policies
     WHERE investor_id IN ${MINE}
       AND status = 'active'
       AND next_premium_due_date IS NOT NULL
       AND next_premium_due_date >= ${w.today}::date
  `)).rows[0] as Row | undefined;
  const renewalNames = (await tx.execute(sql`
    SELECT p.id, i.name, p.insurer, p.next_premium_due_date, p.annual_premium
      FROM insurance_policies p
      JOIN investors i ON i.id = p.investor_id
     WHERE p.investor_id IN ${MINE} AND p.status = 'active'
       AND p.next_premium_due_date BETWEEN ${w.today}::date AND (${w.today}::date + 30)
     ORDER BY p.next_premium_due_date ASC
     LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  /* ── Birthdays and anniversaries in the next 7 days ────────────────────
        Computed as the NEXT occurrence, not by comparing 'MM-DD' strings.
        The string form looks right and then silently empties the card for the
        week of Christmas: on 28 Dec the window runs from '12-28' to '01-04',
        and no date is both ≥ '12-28' and ≤ '01-04'. Adding whole years to the
        stored date also lets Postgres clamp 29 February to the 28th in a
        non-leap year, which make_date() would have thrown on. ───────────── */
  const moments = (await tx.execute(sql`
    SELECT id, name, kind, next_on FROM (
      SELECT id, name, kind,
             CASE WHEN this_year >= ${w.today}::date THEN this_year
                  ELSE (on_date + ((EXTRACT(YEAR FROM ${w.today}::date) - EXTRACT(YEAR FROM on_date))::int + 1 || ' years')::interval)::date
             END AS next_on
        FROM (
          SELECT i.id, i.name, 'Birthday' AS kind, i.dob AS on_date,
                 (i.dob + ((EXTRACT(YEAR FROM ${w.today}::date) - EXTRACT(YEAR FROM i.dob))::int || ' years')::interval)::date AS this_year
            FROM investors i WHERE ${clientsWhere(w.scope)} AND i.dob IS NOT NULL
          UNION ALL
          SELECT i.id, i.name, 'Anniversary', i.anniversary_date,
                 (i.anniversary_date + ((EXTRACT(YEAR FROM ${w.today}::date) - EXTRACT(YEAR FROM i.anniversary_date))::int || ' years')::interval)::date
            FROM investors i WHERE ${clientsWhere(w.scope)} AND i.anniversary_date IS NOT NULL
        ) o
    ) m
    WHERE next_on <= (${w.today}::date + 7)
    ORDER BY next_on ASC
    LIMIT 6
  `)).rows as Array<Record<string, unknown>>;

  const inr = (n: number) => {
    if (!Number.isFinite(n) || n === 0) return "₹0";
    const abs = Math.abs(n);
    if (abs >= 1e7) return `₹${(abs / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `₹${(abs / 1e5).toFixed(2)} Lakh`;
    return `₹${Math.round(abs).toLocaleString("en-IN")}`;
  };

  const cards: ActionCard[] = [
    {
      key: "meetings_today",
      label: "Meetings today",
      count: num(meetingCorpus?.any_ever) > 0 || meetings.length > 0 ? meetings.length : null,
      unavailable: "No meeting has ever been logged against you.",
      detail: meetings.length > 0 ? `Next at ${fmtTime(meetings[0].meeting_date)}` : null,
      severity: meetings.length > 0 ? "attention" : "normal",
      href: `/dashboard/review-meetings?rm=${staffParam(w)}`,
      names: meetings.map((m) => ({
        id: String(m.id),
        name: String(m.who ?? "—"),
        meta: [fmtTime(m.meeting_date), label(m.meeting_type), label(m.meeting_mode)].filter(Boolean).join(" · ") || null,
        href: `/dashboard/review-meetings/${m.id}`,
      })),
    },
    {
      key: "follow_ups",
      label: "Follow-ups due",
      count: num(followUpTotal?.n),
      detail: num(followUpTotal?.overdue) > 0 ? `${num(followUpTotal?.overdue)} already overdue` : "All due today",
      severity: num(followUpTotal?.overdue) > 0 ? "critical" : num(followUpTotal?.n) > 0 ? "attention" : "normal",
      href: num(followUpTotal?.overdue) > 0
        ? leadsHref(w.scope, "followup_overdue=1")
        : leadsHref(w.scope, "followup_today=1"),
      names: followUps.map((l) => ({
        id: String(l.id),
        name: String(l.name ?? "—"),
        meta: [label(l.stage), l.overdue ? "overdue" : "today"].filter(Boolean).join(" · "),
        href: `/dashboard/leads/${l.id}`,
      })),
    },
    {
      key: "reviews",
      label: "Client reviews due",
      count: num(reviews?.due_today) + num(reviews?.overdue),
      detail: [
        num(reviews?.overdue) > 0 ? `${num(reviews?.overdue)} overdue` : null,
        num(reviews?.due_week) > 0 ? `${num(reviews?.due_week)} this week` : null,
      ].filter(Boolean).join(" · ") || "Nothing due this week",
      severity: num(reviews?.overdue) > 0 ? "critical" : num(reviews?.due_today) > 0 ? "attention" : "normal",
      href: clientsHref(w.scope, "review=due"),
      names: reviewNames.map((i) => ({
        id: String(i.id),
        name: String(i.name ?? "—"),
        meta: num(i.days_over) > 0 ? `${pluralDays(num(i.days_over))} overdue` : "due soon",
        href: `/dashboard/investors/${i.id}`,
      })),
    },
    {
      key: "proposals",
      label: "Proposals awaiting reply",
      count: num(proposals?.any_ever) > 0 ? num(proposals?.n) : null,
      unavailable: "You have not created a proposal yet.",
      detail: num(proposals?.n) > 0 ? `${inr(num(proposals?.amount))} in play` : null,
      severity: num(proposals?.stale) > 0 ? "critical" : num(proposals?.n) > 0 ? "attention" : "normal",
      href: "/dashboard/proposals?mine=1",
      names: proposalNames.map((p) => ({
        id: String(p.id),
        name: String(p.name ?? "—"),
        meta: p.total_investment ? inr(num(p.total_investment)) : null,
        href: `/dashboard/proposals/${p.id}`,
      })),
    },
    {
      key: "sip_rejections",
      label: "SIP rejections",
      count: num(rejections?.n),
      // "of SIP value bounced", not "of monthly SIP": the figure is the sum of
      // the rejected DEBITS over 90 days, which is not the same as a month's
      // SIP book and must not be read as one.
      detail: num(rejections?.n) > 0 ? `${inr(num(rejections?.amount))} of SIP value bounced` : "Last 90 days",
      severity: num(rejections?.n) > 0 ? "critical" : "normal",
      href: "/dashboard/sip-rejections",
      names: rejectionNames.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? "—"),
        meta: [inr(num(r.amount)), String(r.scheme_name ?? "").slice(0, 28) || null].filter(Boolean).join(" · "),
        href: `/dashboard/investors/${r.investor_id}`,
      })),
    },
    {
      key: "repurchase",
      label: "Repurchase pending",
      count: num(rejections?.pending),
      detail: num(rejections?.pending) > 0
        ? `${inr(num(rejections?.pending_amount))} not yet re-processed`
        : "Every rejection has been closed off",
      severity: num(rejections?.pending) > 0 ? "critical" : "normal",
      href: "/dashboard/sip-rejections?recovery=pending",
      names: [],
    },
    {
      key: "queries",
      label: "Client queries open",
      count: num(queries?.n),
      detail: queries?.oldest_days != null && num(queries.n) > 0
        ? `Oldest ${pluralDays(num(queries.oldest_days))}${num(queries.breached) > 0 ? ` · ${num(queries.breached)} past SLA` : ""}`
        : "Nothing waiting on us",
      severity: num(queries?.breached) > 0 ? "critical" : num(queries?.n) > 0 ? "attention" : "normal",
      href: "/dashboard/service-requests?mine=1",
      names: queryNames.map((q) => ({
        id: String(q.id),
        name: String(q.name ?? "—"),
        meta: [label(q.type), `${num(q.age_days)}d old`].filter(Boolean).join(" · "),
        href: `/dashboard/service-requests/${q.id}`,
      })),
    },
    {
      key: "tasks",
      label: "Tasks overdue",
      count: num(tasksRow?.n),
      detail: num(tasksRow?.n) > 0
        ? `${num(tasksRow?.financial)} financial · ${num(tasksRow?.non_financial)} other`
        : "Nothing past its due date",
      severity: num(tasksRow?.n) > 0 ? "critical" : "normal",
      href: `/dashboard/tasks?assignee=${staffParam(w)}&due=overdue`,
      names: taskNames.map((t) => ({
        id: String(t.id),
        name: String(t.title ?? "—"),
        meta: [t.client ? String(t.client) : null, label(t.priority)].filter(Boolean).join(" · ") || null,
        href: `/dashboard/tasks?task=${t.id}`,
      })),
    },
    {
      key: "renewals",
      label: "Insurance renewals",
      count: num(renewals?.any_ever) > 0 ? num(renewals?.d30) : null,
      unavailable: "None of your clients has a policy on record.",
      detail: num(renewals?.d30) > 0
        ? `${num(renewals?.d7)} in 7d · ${num(renewals?.d15)} in 15d · ${num(renewals?.d30)} in 30d`
        : "Nothing due in 30 days",
      severity: num(renewals?.d7) > 0 ? "critical" : num(renewals?.d30) > 0 ? "attention" : "normal",
      href: "/dashboard/insurance?due=1",
      names: renewalNames.map((p) => ({
        id: String(p.id),
        name: String(p.name ?? "—"),
        meta: [String(p.insurer ?? ""), fmtDay(p.next_premium_due_date)].filter(Boolean).join(" · ") || null,
        href: `/dashboard/insurance/${p.id}`,
      })),
    },
    {
      key: "moments",
      label: "Client occasions",
      count: moments.length,
      detail: moments.length > 0 ? "Next 7 days" : "Nothing in the next 7 days",
      // Never red. A birthday is a relationship prompt, not an exception —
      // spending the alarm colour on it devalues the colour everywhere else.
      severity: "normal",
      href: clientsHref(w.scope, "occasion=7"),
      names: moments.map((m) => ({
        id: String(m.id),
        name: String(m.name ?? "—"),
        meta: [String(m.kind), fmtDay(m.next_on)].filter(Boolean).join(" · "),
        href: `/dashboard/investors/${m.id}`,
      })),
    },
  ];

  return cards.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.count ?? -1) - (a.count ?? -1));
}

/* ── Small formatters. Server-side, so they use a fixed IST-safe shape
      rather than the browser locale — the dashboard renders on the server and
      a timestamp formatted in the server's timezone is a hydration mismatch
      waiting to happen. ─────────────────────────────────────────────────── */

function fmtTime(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(d);
}

function fmtDay(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(d);
}

function label(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const s = v.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
