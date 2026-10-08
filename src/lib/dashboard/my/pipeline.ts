/**
 * The pipeline-and-exception half of the personal cockpit. SERVER-ONLY.
 *
 *   §9  Meeting dashboard
 *   §10 Lead & prospect funnel
 *   §11 Proposal dashboard
 *   §12 SIP health
 *   §13 Redemption watch
 *   §15 My tasks
 *   §16 My query tracker
 *   §17 Insurance relationship view
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** A raw SQL result row. Postgres hands numerics back as strings, so every
 *  field goes through num() / numOrNull() before it is used. */
type Row = Record<string, unknown>;
import {
  asInList, clientIds, clientsWhereOn, FINANCIAL_TASK_TYPES, LEAD_CLOSED_STAGES,
  LEAD_DEAD_STAGES, leadsMatch, num, numOrNull, PROPOSAL_LOST, PROPOSAL_WON,
  REDEMPTION_TYPES, SR_OPEN_ON_US, SR_WAITING_CLIENT, staffMatch, TASK_DEAD, type MyWindow,
  taskInvestor, taskIsAbout,
} from "./window";
import { bookedLinesOnBook, loadBookedFlows } from "./booked";

/* ─────────────────────────── §9 meetings ─────────────────────────── */

export type MeetingDesk = {
  /** null when no meeting has ever been logged — different from "none this period". */
  newMeetings: number | null;
  reviewMeetings: number | null;
  total: number | null;
  completed: number | null;
  cancelled: number | null;
  followUpsPending: number | null;
  /** Scheduled for today / the next seven days, whatever the period. */
  today: number | null;
  thisWeek: number | null;
  upcoming: Array<{
    id: string; client: string; when: string; type: string; mode: string | null;
    purpose: string | null; prepared: boolean; href: string;
    clientId: string | null; category: string | null; lastMeeting: string | null;
    meetingCategory: string | null;
  }>;
  /** Month-by-month for the running FY, oldest first. */
  trend: Array<{ month: string; completed: number }>;
};

export async function loadMeetingDesk(tx: Tx, w: MyWindow): Promise<MeetingDesk> {
  const totals = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE in_window AND category = 'new')::int        AS new_n,
      COUNT(*) FILTER (WHERE in_window AND category = 'review')::int     AS review_n,
      COUNT(*) FILTER (WHERE in_window)::int                             AS total_n,
      COUNT(*) FILTER (WHERE in_window AND status = 'completed')::int    AS completed_n,
      COUNT(*) FILTER (WHERE in_window AND status IN ('cancelled','no_show'))::int AS cancelled_n,
      -- A completed meeting with no follow-up task raised is the gap worth
      -- naming: the conversation happened and nothing came of it in the
      -- system. follow_up_task_created is TEXT, not boolean — it defaults to
      -- the string 'false' and later holds a task id, so it is compared as
      -- text. Treating it as a boolean makes Postgres reject the whole query.
      COUNT(*) FILTER (WHERE in_window AND status = 'completed'
                         AND COALESCE(follow_up_task_created, 'false') IN ('false', ''))::int AS followup_n,
      COUNT(*)::int AS any_ever,
      COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed','completed') AND on_day)::int   AS today_n,
      COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed','completed') AND in_week)::int  AS week_n
    FROM (
      SELECT category, status, follow_up_task_created,
             (meeting_date >= ${w.from}::date AND meeting_date < (${w.to}::date + 1)) AS in_window,
             (meeting_date >= ${w.today}::date AND meeting_date < (${w.today}::date + 1)) AS on_day,
             (meeting_date >= ${w.today}::date AND meeting_date < (${w.today}::date + 7)) AS in_week
        FROM review_meetings WHERE ${staffMatch("rm_id", w)}
    ) m
  `)).rows[0] as Row | undefined;

  const upcoming = (await tx.execute(sql`
    SELECT m.id, m.meeting_date, m.meeting_type, m.meeting_mode, m.subject, m.status, m.category AS mcat,
           COALESCE(i.name, l.name, 'Untitled') AS client, i.id AS client_id,
           upper(NULLIF(btrim(i.client_category), '')) AS client_category,
           (SELECT MAX(pm.meeting_date) FROM review_meetings pm
             WHERE pm.investor_id = m.investor_id AND pm.status = 'completed'
               AND pm.meeting_date < m.meeting_date)                                      AS last_meeting,
           (m.discussion_points IS NOT NULL AND m.discussion_points::text NOT IN ('', 'null', '[]', '{}')) AS prepared
      FROM review_meetings m
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l     ON l.id = m.lead_id
     WHERE ${staffMatch("rm_id", w, "m")}
       AND m.status IN ('scheduled','confirmed')
       AND m.meeting_date >= ${w.today}::date
     ORDER BY m.meeting_date ASC
     LIMIT 8
  `)).rows as Array<Record<string, unknown>>;

  const trend = (await tx.execute(sql`
    SELECT to_char(date_trunc('month', meeting_date), 'Mon') AS month,
           date_trunc('month', meeting_date) AS m,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
      FROM review_meetings
     WHERE ${staffMatch("rm_id", w)}
       AND meeting_date >= ${w.fyStart}::date
     GROUP BY 1, 2 ORDER BY 2 ASC
  `)).rows as Array<Record<string, unknown>>;

  const ever = num(totals?.any_ever) > 0;
  const orNull = (v: unknown) => (ever ? num(v) : null);

  return {
    newMeetings: orNull(totals?.new_n),
    reviewMeetings: orNull(totals?.review_n),
    total: orNull(totals?.total_n),
    completed: orNull(totals?.completed_n),
    cancelled: orNull(totals?.cancelled_n),
    followUpsPending: orNull(totals?.followup_n),
    today: orNull(totals?.today_n),
    thisWeek: orNull(totals?.week_n),
    upcoming: upcoming.map((m) => ({
      clientId: m.client_id ? String(m.client_id) : null,
      category: m.client_category ? String(m.client_category) : null,
      lastMeeting: m.last_meeting ? String(m.last_meeting) : null,
      meetingCategory: m.mcat ? String(m.mcat) : null,
      id: String(m.id),
      client: String(m.client ?? "—"),
      when: String(m.meeting_date),
      type: String(m.meeting_type ?? "other"),
      mode: m.meeting_mode ? String(m.meeting_mode) : null,
      purpose: m.subject ? String(m.subject) : null,
      prepared: m.prepared === true,
      href: `/dashboard/review-meetings/${m.id}`,
    })),
    trend: trend.map((t) => ({ month: String(t.month), completed: num(t.completed) })),
  };
}

/* ──────────────────────── §10 lead funnel ──────────────────────── */

/**
 * The seven steps the brief asks for, with every stage this schema can hold
 * folded onto one of them.
 *
 * The app's own `LEAD_PHASE_STAGES` vocabulary cannot be reused here: it folds
 * `proposal_shared`, `proposal_drafted` and `converted` all onto `won_lead`,
 * which would file a proposal the client has not answered under "Client
 * onboarded". That is fine for the blueprint board it was built for and wrong
 * for a funnel.
 */
export const FUNNEL: Array<{ key: string; label: string; stages: string[] }> = [
  { key: "new", label: "New lead", stages: ["new"] },
  { key: "contacted", label: "Contacted", stages: ["contacted", "call_done", "call_back_later", "call_not_connected", "contact_in_future", "qualified"] },
  { key: "meeting_set", label: "Meeting scheduled", stages: ["meeting_scheduled", "meeting_pending", "appointment_scheduled"] },
  { key: "met", label: "Meeting completed", stages: ["meeting_done", "post_meeting_qualified"] },
  { key: "proposal", label: "Proposal shared", stages: ["proposal_shared", "proposal_sent", "proposal_drafted", "proposal_approved", "risk_profile_sent", "risk_profiled"] },
  { key: "follow_up", label: "Follow-up / documents", stages: ["follow_up", "docs_requested", "request_documents", "docs_received", "documents_pending", "documents_received", "kyc_pending", "kyc_validated", "kyc_registered", "modify_kyc", "physical_kyc", "online_kyc", "ucc_create", "ucc_activated", "mandate_create", "mandate_activated", "update_information", "family_mapping", "add_in_review_sheet", "make_transaction", "rta_forms_ready", "rta_client_signed", "rta_submitted", "rta_rejected"] },
  { key: "onboarded", label: "Client onboarded", stages: ["converted", "won_lead", "transaction_successful", "rta_processed"] },
];

// Won and lost, from the shared lists in ./window so the funnel and the
// action centre cannot drift apart about what "still open" means. A lead the
// funnel calls "Client onboarded" must not also appear in the stale queue.
const LOST_STAGES = [...LEAD_DEAD_STAGES];
const CLOSED_STAGES = [...LEAD_CLOSED_STAGES];

/**
 * What a lead is worth. `expected_business_amount` is numeric and preferred;
 * `intended_amount` is the older free-text field and is still the only value
 * on imported books.
 *
 * The strip-then-cast is load-bearing, not defensive dressing: a plain
 * `intended_amount::numeric` throws on the first row where somebody typed
 * "5 lakh" or "₹3,00,000" into a web form, and one such row takes the entire
 * funnel down with a 500. Non-numeric junk becomes NULL and drops out of the
 * SUM, which is the right answer for a value nobody actually recorded.
 */
export const LEAD_VALUE = sql`COALESCE(
  expected_business_amount,
  NULLIF(regexp_replace(COALESCE(intended_amount, ''), '[^0-9.]', '', 'g'), '')::numeric
)`;

export type FunnelStep = {
  key: string;
  label: string;
  /** Leads that have REACHED this step or gone past it. */
  reached: number;
  /** Reached here / reached the top. Null for the first step. */
  conversionFromTop: number | null;
  /** Reached here / reached the previous step. Null for the first step. */
  stepConversion: number | null;
  /** Potential business sitting AT this step right now. */
  value: number;
  /** Sitting exactly here right now. */
  here: number;
};

export type LeadFunnel = {
  steps: FunnelStep[];
  lost: number;
  /** Open leads with no meaningful activity for longer than the threshold. */
  stale: number;
  staleAfterDays: number;
  staleValue: number;
  total: number;
  /** Open leads nobody has ever followed up or contacted. */
  withoutFollowUp: number;
  /** Open leads with no next follow-up date — nothing is scheduled to happen. */
  noNextAction: number;
  staleRows: Array<{ id: string; name: string; stage: string; days: number; value: number }>;
};

/**
 * Stale threshold. Configurable per tenant the same way every other dashboard
 * threshold is — `getDashboardThresholds` — with 21 days as the default,
 * which is the point at which an untouched lead in an MFD pipeline has
 * generally gone cold.
 */
export async function loadLeadFunnel(tx: Tx, w: MyWindow, staleAfterDays = 21): Promise<LeadFunnel> {
  const rows = (await tx.execute(sql`
    SELECT lower(btrim(COALESCE(stage, 'new'))) AS stage,
           COUNT(*)::int AS n,
           COALESCE(SUM(${LEAD_VALUE}), 0) AS value,
           COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL)::int AS converted
      FROM leads
     WHERE ${leadsMatch(w)}
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;

  const stale = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(${LEAD_VALUE}), 0) AS value
      FROM leads
     WHERE ${leadsMatch(w)}
       AND converted_investor_id IS NULL
       AND lower(btrim(COALESCE(stage,''))) NOT IN (${asInList(CLOSED_STAGES)})
       AND GREATEST(
             COALESCE(last_contact_at, to_timestamp(0)),
             COALESCE(last_follow_up_at, to_timestamp(0)),
             COALESCE(stage_changed_at, to_timestamp(0)),
             COALESCE(updated_at, to_timestamp(0))
           ) < now() - (${staleAfterDays} || ' days')::interval
  `)).rows[0] as Row | undefined;

  const staleRows = (await tx.execute(sql`
    SELECT id, name, stage,
           ${LEAD_VALUE} AS value,
           EXTRACT(EPOCH FROM (now() - GREATEST(
             COALESCE(last_contact_at, to_timestamp(0)),
             COALESCE(last_follow_up_at, to_timestamp(0)),
             COALESCE(stage_changed_at, to_timestamp(0)),
             COALESCE(updated_at, to_timestamp(0))
           )))::bigint / 86400 AS days
      FROM leads
     WHERE ${leadsMatch(w)}
       AND converted_investor_id IS NULL
       AND lower(btrim(COALESCE(stage,''))) NOT IN (${asInList(CLOSED_STAGES)})
       AND GREATEST(
             COALESCE(last_contact_at, to_timestamp(0)),
             COALESCE(last_follow_up_at, to_timestamp(0)),
             COALESCE(stage_changed_at, to_timestamp(0)),
             COALESCE(updated_at, to_timestamp(0))
           ) < now() - (${staleAfterDays} || ' days')::interval
     ORDER BY 5 DESC
     LIMIT 8
  `)).rows as Array<Record<string, unknown>>;

  const gaps = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE last_follow_up_at IS NULL AND last_contact_at IS NULL)::int AS never,
      COUNT(*) FILTER (WHERE next_follow_up_at IS NULL)::int                             AS no_next
      FROM leads
     WHERE ${leadsMatch(w)}
       AND converted_investor_id IS NULL
       AND lower(btrim(COALESCE(stage,''))) NOT IN (${asInList(CLOSED_STAGES)})
  `)).rows[0] as Row | undefined;

  const byStage = new Map(rows.map((r) => [String(r.stage), r]));
  const at = (stages: string[]) =>
    stages.reduce(
      (acc, s) => {
        const r = byStage.get(s);
        return { n: acc.n + num(r?.n), value: acc.value + num(r?.value) };
      },
      { n: 0, value: 0 },
    );

  const here = FUNNEL.map((f) => at(f.stages));
  const lost = at(LOST_STAGES).n;
  const total = rows.reduce((s, r) => s + num(r.n), 0);

  // Cumulative from the bottom: reaching step 5 means you passed 1-4.
  //
  // Lost leads are NOT distributed back up the funnel. The CRM records where
  // a lead stopped, not every stage it passed through, so a lead lost after
  // three meetings is indistinguishable from one lost on the first call. They
  // are reported as their own figure instead of being guessed into steps.
  const reached: number[] = new Array(FUNNEL.length).fill(0);
  for (let i = FUNNEL.length - 1; i >= 0; i--) {
    reached[i] = here[i].n + (i < FUNNEL.length - 1 ? reached[i + 1] : 0);
  }

  const top = reached[0];
  const steps: FunnelStep[] = FUNNEL.map((f, i) => ({
    key: f.key,
    label: f.label,
    reached: reached[i],
    // No leads at the top is not a 0% conversion rate — there is no rate.
    conversionFromTop: i === 0 || top === 0 ? null : reached[i] / top,
    stepConversion: i === 0 ? null : reached[i - 1] === 0 ? null : reached[i] / reached[i - 1],
    value: here[i].value,
    here: here[i].n,
  }));

  return {
    steps,
    lost,
    stale: num(stale?.n),
    staleAfterDays,
    staleValue: num(stale?.value),
    total,
    withoutFollowUp: num(gaps?.never),
    noNextAction: num(gaps?.no_next),
    staleRows: staleRows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "—"),
      stage: String(r.stage ?? "new"),
      days: num(r.days),
      value: num(r.value),
    })),
  };
}

/* ─────────────────────── §11 proposal desk ─────────────────────── */

export type ProposalDesk = {
  /** null when nothing has ever been created — not a zero pipeline. */
  created: number | null;
  amount: number;
  shared: number;
  followUpPending: number;
  converted: number;
  lost: number;
  /** Converted / decided. Null while nothing has been decided. */
  conversionPct: number | null;
  /** Sent-and-waiting proposals by days since sent, oldest bucket last. */
  ageing: Array<{ key: string; label: string; count: number; value: number }>;
  rows: Array<{
    id: string; client: string; date: string | null; product: string;
    amount: number; status: string; daysPending: number | null; nextFollowUp: string | null;
    preparedBy: string | null;
  }>;
};

/** The branch brief's proposal ageing buckets. */
export const PROPOSAL_AGEING = [
  { key: "d0_3", label: "0–3 days", min: 0, max: 3 },
  { key: "d4_7", label: "4–7 days", min: 4, max: 7 },
  { key: "d8_15", label: "8–15 days", min: 8, max: 15 },
  { key: "d16_30", label: "16–30 days", min: 16, max: 30 },
  { key: "d30p", label: "30+ days", min: 31, max: null },
] as const;

export async function loadProposalDesk(tx: Tx, w: MyWindow): Promise<ProposalDesk> {
  const WON = asInList(PROPOSAL_WON);
  const LOST = asInList(PROPOSAL_LOST);

  const t = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE in_window)::int                                       AS created,
      COALESCE(SUM(total_investment) FILTER (WHERE in_window), 0)                  AS amount,
      COUNT(*) FILTER (WHERE in_window AND sent_at IS NOT NULL)::int               AS shared,
      COUNT(*) FILTER (WHERE status IN ('sent','viewed'))::int                     AS follow_up,
      COUNT(*) FILTER (WHERE in_window AND status IN (${WON}))::int                AS converted,
      COUNT(*) FILTER (WHERE in_window AND status IN (${LOST}))::int               AS lost,
      COUNT(*)::int                                                                AS any_ever
    FROM (
      SELECT status, sent_at, total_investment::numeric AS total_investment,
             (created_at >= ${w.from}::date AND created_at < (${w.to}::date + 1)) AS in_window
        FROM proposals WHERE ${staffMatch("prepared_by_user_id", w)}
    ) p
  `)).rows[0] as Row | undefined;

  const age = (await tx.execute(sql`
    SELECT (EXTRACT(EPOCH FROM (now() - COALESCE(sent_at, created_at))) / 86400)::int AS d,
           total_investment::numeric AS v
      FROM proposals
     WHERE ${staffMatch("prepared_by_user_id", w)} AND status IN ('sent','viewed')
  `)).rows as Array<{ d: number; v: string }>;
  const ageing = PROPOSAL_AGEING.map((b) => {
    const hit = age.filter((r) => num(r.d) >= b.min && (b.max == null || num(r.d) <= b.max));
    return { key: b.key, label: b.label, count: hit.length, value: hit.reduce((s, r) => s + num(r.v), 0) };
  });

  const rows = (await tx.execute(sql`
    SELECT p.id, COALESCE(i.name, p.recipient_name, l.name, 'Untitled') AS client,
           COALESCE(p.sent_at, p.created_at) AS dated, p.type, p.title,
           p.total_investment, p.status, p.valid_until, u.name AS prepared_by,
           EXTRACT(EPOCH FROM (now() - COALESCE(p.sent_at, p.created_at)))::bigint / 86400 AS days_pending
      FROM proposals p
      LEFT JOIN investors i ON i.id = p.investor_id
      LEFT JOIN leads l     ON l.id = p.lead_id
      LEFT JOIN users u     ON u.id = p.prepared_by_user_id
     WHERE ${staffMatch("prepared_by_user_id", w, "p")}
       AND p.status NOT IN ('draft')
     ORDER BY (p.status IN ('sent','viewed')) DESC, COALESCE(p.sent_at, p.created_at) ASC
     LIMIT 10
  `)).rows as Array<Record<string, unknown>>;

  const decided = num(t?.converted) + num(t?.lost);
  return {
    created: num(t?.any_ever) > 0 ? num(t?.created) : null,
    amount: num(t?.amount),
    shared: num(t?.shared),
    followUpPending: num(t?.follow_up),
    converted: num(t?.converted),
    lost: num(t?.lost),
    conversionPct: decided > 0 ? num(t?.converted) / decided : null,
    ageing,
    rows: rows.map((r) => ({
      id: String(r.id),
      client: String(r.client ?? "—"),
      date: r.dated ? String(r.dated) : null,
      product: String(r.type ?? r.title ?? "—"),
      amount: num(r.total_investment),
      status: String(r.status ?? "—"),
      daysPending: ["sent", "viewed"].includes(String(r.status)) ? num(r.days_pending) : null,
      nextFollowUp: r.valid_until ? String(r.valid_until) : null,
      preparedBy: r.prepared_by ? String(r.prepared_by) : null,
    })),
  };
}

/* ───────────────────────── §12 SIP health ───────────────────────── */

export type SipHealth = {
  activeBook: number;
  activeCount: number;
  grossAdded: number | null;
  stopped: number | null;
  netSip: number | null;
  rejections: number;
  rejectionValue: number;
  repurchaseDone: number;
  repurchasePending: number;
  repurchasePendingValue: number;
  withoutRemarks: number;
  rows: Array<{
    id: string; client: string; clientId: string; amount: number; rejectedOn: string | null;
    reason: string | null; repurchase: string; pendingValue: number;
    followUp: string | null; remarks: string | null;
    /** For the row's quick actions: call the client, open the register entry. */
    phone: string | null; email: string | null; rejectionId: string | null;
  }>;
};

/**
 * Rejections come from the LEDGER, with the `sip_rejections` register joined
 * on for recovery state. The register is written by the RTA importer, so a
 * book whose feed predates it has an empty register and five bounced debits;
 * reading the register alone would report a clean SIP book.
 */
export async function loadSipHealth(tx: Tx, w: MyWindow): Promise<SipHealth> {
  const MINE = clientIds(w.scope);

  // The active book is the SIP register's balance; SIP added and stopped in
  // the period are BOOKED (lib/dashboard/my/booked.ts), like the KPI strip.
  const book = (await tx.execute(sql`
    SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'active'), 0) AS active_book,
           COUNT(*) FILTER (WHERE status = 'active')::int                     AS active_n,
           COUNT(*) FILTER (WHERE status = 'active' AND (remarks IS NULL OR btrim(remarks) = ''))::int AS no_remarks
      FROM sips WHERE investor_id IN ${MINE}
  `)).rows[0] as Row | undefined;
  const booked = await loadBookedFlows(tx, w.scope, { p: { from: w.from, to: w.to } });

  const rej = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(t.amount::numeric), 0) AS value,
           COUNT(*) FILTER (WHERE r.recovery_status IN ('recovered','reprocessed'))::int AS done,
           COUNT(*) FILTER (WHERE r.recovery_status IS NULL
                              OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable'))::int AS pending,
           COALESCE(SUM(t.amount::numeric) FILTER (WHERE r.recovery_status IS NULL
                              OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable')), 0) AS pending_value
      FROM transactions t
      LEFT JOIN sip_rejections r ON r.transaction_id = t.id
     WHERE t.investor_id IN ${MINE}
       AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
       AND t.order_date >= (${w.today}::date - 180)
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT t.id, i.name AS client, i.id AS client_id, t.amount, t.order_date, t.scheme_name,
           COALESCE(r.rejection_reason, t.reason_description, t.reason_code) AS reason,
           r.recovery_status, r.follow_up_date, r.remarks, r.id AS rejection_id, i.phone, i.email
      FROM transactions t
      JOIN investors i ON i.id = t.investor_id
      LEFT JOIN sip_rejections r ON r.transaction_id = t.id
     WHERE t.investor_id IN ${MINE}
       AND t.status = 'rejected' AND t.type IN ('sip','sip_topup')
       AND t.order_date >= (${w.today}::date - 180)
     ORDER BY (r.recovery_status IS NULL
               OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable')) DESC,
              t.order_date DESC
     LIMIT 12
  `)).rows as Array<Record<string, unknown>>;

  const ever = booked.ever;
  const bk = booked.flows.p;
  return {
    activeBook: num(book?.active_book),
    activeCount: num(book?.active_n),
    grossAdded: ever ? bk.newSip : null,
    stopped: ever ? bk.stoppedSip : null,
    netSip: ever ? bk.netSip : null,
    rejections: num(rej?.n),
    rejectionValue: num(rej?.value),
    repurchaseDone: num(rej?.done),
    repurchasePending: num(rej?.pending),
    repurchasePendingValue: num(rej?.pending_value),
    withoutRemarks: num(book?.no_remarks),
    rows: rows.map((r) => ({
      id: String(r.id),
      client: String(r.client ?? "—"),
      clientId: String(r.client_id),
      amount: num(r.amount),
      rejectedOn: r.order_date ? String(r.order_date) : null,
      reason: r.reason ? String(r.reason) : null,
      // "Not recorded" is the honest label for a rejection nobody has worked
      // yet. "Pending" would imply somebody has looked at it.
      repurchase: r.recovery_status ? String(r.recovery_status) : "Not recorded",
      pendingValue: ["recovered", "reprocessed", "not_recoverable"].includes(String(r.recovery_status ?? ""))
        ? 0 : num(r.amount),
      followUp: r.follow_up_date ? String(r.follow_up_date) : null,
      remarks: r.remarks ? String(r.remarks) : null,
      phone: r.phone ? String(r.phone) : null,
      email: r.email ? String(r.email) : null,
      rejectionId: r.rejection_id ? String(r.rejection_id) : null,
    })),
  };
}

/* ────────────────────── §13 redemption watch ────────────────────── */

export type RedemptionWatch = {
  total: number | null;
  clients: number;
  highValue: number;
  highValueThreshold: number;
  followUpPending: number;
  rows: Array<{
    id: string; client: string; clientId: string; category: string | null;
    aum: number; amount: number; date: string; product: string | null;
    reason: string | null; shareOfAum: number | null; followedUp: boolean;
    rm: string | null;
  }>;
};

/**
 * Not every redemption is a problem. A client funding a house is not churning,
 * and a dashboard that paints all of them red trains its reader to ignore the
 * colour. So the reason is shown where the feed recorded one, and severity
 * comes from SIZE RELATIVE TO THE RELATIONSHIP — a ₹2 L redemption is most of
 * a ₹3 L client and a rounding error on a ₹5 Cr one.
 *
 * `highValueThreshold` is the firm's configurable rupee floor; the share of
 * AUM is the second, scale-free signal.
 */
export async function loadRedemptionWatch(
  tx: Tx, w: MyWindow, highValueThreshold = 500000,
): Promise<RedemptionWatch> {
  // Redemptions BOOKED on the book (lib/dashboard/my/booked.ts): the total
  // nets a reversal the RTA rejected; the list is the bookings themselves.
  const src = await bookedLinesOnBook(tx, w.scope);
  const RED = asInList(REDEMPTION_TYPES);
  const inPeriod = sql`bel.txn_type IN (${RED}) AND bel.eff_date >= ${w.from}::date AND bel.eff_date <= ${w.to}::date`;

  const t = src
    ? ((await tx.execute(sql`
        SELECT COALESCE(SUM(bel.amount * bel.sign), 0) AS total,
               COUNT(DISTINCT COALESCE(be.investor_id::text, lower(btrim(be.client_name)))) FILTER (WHERE bel.sign = 1)::int AS clients,
               COUNT(*) FILTER (WHERE bel.sign = 1 AND bel.amount >= ${highValueThreshold})::int AS high_value,
               COUNT(*) FILTER (WHERE bel.sign = 1 AND (be.investor_id IS NULL OR NOT EXISTS (
                 SELECT 1 FROM tasks tk
                  WHERE ${taskIsAbout("tk", sql`be.investor_id`)} AND tk.deleted_at IS NULL
                    AND tk.created_at >= bel.eff_date::timestamptz)))::int AS no_follow_up
          FROM ${src.from}
         WHERE ${src.where} AND ${inPeriod}
      `)).rows[0] as Row | undefined)
    : undefined;

  // Only bookings on a client can be opened and followed up from here.
  const rows = src
    ? ((await tx.execute(sql`
        SELECT bel.id, i.name AS client, i.id AS client_id, i.client_category, i.aum,
               bel.amount, bel.eff_date AS order_date, bel.scheme_name, ru.name AS rm_name,
               COALESCE(NULLIF(btrim(bel.notes), ''), i.redemption_risk_reason) AS reason,
               -- A follow-up counts when a task references this client AFTER
               -- the redemption date. Anything earlier was about something else.
               EXISTS (
                 SELECT 1 FROM tasks tk
                  WHERE ${taskIsAbout("tk", sql`i.id`)} AND tk.deleted_at IS NULL
                    AND tk.created_at >= bel.eff_date::timestamptz
               ) AS followed_up
          FROM ${src.from}
          LEFT JOIN users ru ON ru.id = COALESCE(i.rm_id, be.rm_id)
         WHERE ${src.where} AND ${inPeriod} AND bel.sign = 1 AND i.id IS NOT NULL
         ORDER BY bel.amount DESC
         LIMIT 12
      `)).rows as Array<Record<string, unknown>>)
    : [];

  const mapped = rows.map((r) => {
    const aum = num(r.aum);
    const amount = num(r.amount);
    // AUM is what is LEFT, so the relationship before the exit was roughly
    // AUM + this redemption. An approximation, and named as one in the UI.
    const before = aum + amount;
    return {
      id: String(r.id),
      client: String(r.client ?? "—"),
      clientId: String(r.client_id),
      category: r.client_category ? String(r.client_category).toUpperCase() : null,
      aum,
      amount,
      date: String(r.order_date),
      product: r.scheme_name ? String(r.scheme_name) : null,
      reason: r.reason ? String(r.reason) : null,
      shareOfAum: before > 0 ? amount / before : null,
      followedUp: r.followed_up === true,
      rm: r.rm_name ? String(r.rm_name) : null,
    };
  });

  return {
    total: src ? num(t?.total) : null,
    clients: num(t?.clients),
    highValue: num(t?.high_value),
    highValueThreshold,
    followUpPending: num(t?.no_follow_up),
    rows: mapped,
  };
}

/* ──────────────────── §15 tasks + §16 queries ──────────────────── */

export type TaskBacklog = {
  /** Open now and due today, whenever raised. */
  dueToday: number;
  /** Everything open now, whenever raised. */
  open: number;
  overdue: number;
  /** Completed this calendar month, whenever raised. */
  completedMtd: number;
};

export type MyTasks = {
  financial: { assigned: number; completed: number; pending: number; overdue: number; pct: number | null };
  nonFinancial: { assigned: number; completed: number; pending: number; overdue: number; pct: number | null };
  /** Today's backlog by side — the RM desk's cards (§24); the cohort figures
   *  above stay for the completion rate. */
  backlog: { financial: TaskBacklog; nonFinancial: TaskBacklog };
  /** Open tasks, most overdue first, for the task table. */
  openRows: Array<{
    id: string; title: string; client: string | null; clientId: string | null; type: string;
    created: string; due: string | null; ageDays: number; status: string; priority: string;
    financial: boolean; overdue: boolean;
  }>;
  today: Array<{ id: string; title: string; client: string | null; type: string; due: string | null; priority: string; status: string; assignee: string | null }>;
  overdue: Array<{ id: string; title: string; client: string | null; type: string; due: string | null; priority: string; daysOver: number; assignee: string | null }>;
};

export async function loadMyTasks(tx: Tx, w: MyWindow): Promise<MyTasks> {
  const FIN = asInList(FINANCIAL_TASK_TYPES);
  const DEAD = asInList(TASK_DEAD);

  // Cohort completion: of the work RAISED in the period, how much closed.
  // Counting what closed in the period instead pushes the rate past 100% in a
  // catch-up month and flatters a genuinely bad one.
  const t = (await tx.execute(sql`
    SELECT fin,
           COUNT(*)::int                                                    AS assigned,
           COUNT(*) FILTER (WHERE status = 'completed')::int                AS completed,
           COUNT(*) FILTER (WHERE status NOT IN (${DEAD}))::int             AS pending,
           COUNT(*) FILTER (WHERE status NOT IN (${DEAD}) AND due_at < now())::int AS overdue
      FROM (
        SELECT status, due_at, (type IN (${FIN})) AS fin
          FROM tasks
         WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
           AND created_at >= ${w.from}::date AND created_at < (${w.to}::date + 1)
      ) s
     GROUP BY fin
  `)).rows as Array<Record<string, unknown>>;

  const today = (await tx.execute(sql`
    SELECT t.id, t.title, t.type, t.due_at, t.priority, t.status, i.name AS client, au.name AS assignee
      FROM tasks t LEFT JOIN investors i ON i.id = ${taskInvestor("t")}
      LEFT JOIN users au ON au.id = t.assignee_id
     WHERE ${staffMatch("assignee_id", w, "t")} AND t.deleted_at IS NULL
       AND t.status NOT IN (${DEAD})
       AND t.due_at >= ${w.today}::date AND t.due_at < (${w.today}::date + 1)
     ORDER BY t.due_at ASC LIMIT 10
  `)).rows as Array<Record<string, unknown>>;

  const overdue = (await tx.execute(sql`
    SELECT t.id, t.title, t.type, t.due_at, t.priority, i.name AS client, au.name AS assignee,
           EXTRACT(EPOCH FROM (now() - t.due_at))::bigint / 86400 AS days_over
      FROM tasks t LEFT JOIN investors i ON i.id = ${taskInvestor("t")}
      LEFT JOIN users au ON au.id = t.assignee_id
     WHERE ${staffMatch("assignee_id", w, "t")} AND t.deleted_at IS NULL
       AND t.status NOT IN (${DEAD}) AND t.due_at < now()
     ORDER BY t.due_at ASC LIMIT 10
  `)).rows as Array<Record<string, unknown>>;

  const bl = (await tx.execute(sql`
    SELECT (type IN (${FIN})) AS fin,
           COUNT(*) FILTER (WHERE status NOT IN (${DEAD}) AND due_at::date = ${w.today}::date)::int AS due_today,
           COUNT(*) FILTER (WHERE status NOT IN (${DEAD}))::int                                    AS open_n,
           COUNT(*) FILTER (WHERE status NOT IN (${DEAD}) AND due_at::date < ${w.today}::date)::int AS overdue,
           COUNT(*) FILTER (WHERE status = 'completed'
                              AND completed_at >= ${`${w.today.slice(0, 8)}01`}::date)::int      AS done_mtd
      FROM tasks
     WHERE ${staffMatch("assignee_id", w)} AND deleted_at IS NULL
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;

  // A task about a client outside this book keeps its name (the task carries
  // it anyway) but loses the link into another book.
  const openRows = (await tx.execute(sql`
    SELECT t.id, t.title, t.type, t.status, t.priority, t.created_at, t.due_at,
           CASE WHEN i.id IN ${clientIds({ ...w.scope, filter: undefined })} THEN i.id END AS client_id,
           i.name AS client, (t.type IN (${FIN})) AS fin,
           (t.due_at::date < ${w.today}::date) AS overdue,
           EXTRACT(EPOCH FROM (now() - t.created_at))::bigint / 86400 AS age_days
      FROM tasks t LEFT JOIN investors i ON i.id = ${taskInvestor("t")}
     WHERE ${staffMatch("assignee_id", w, "t")} AND t.deleted_at IS NULL AND t.status NOT IN (${DEAD})
     ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC
     LIMIT 15
  `)).rows as Array<Record<string, unknown>>;

  const backlogOf = (fin: boolean): TaskBacklog => {
    const r = bl.find((x) => x.fin === fin);
    return { dueToday: num(r?.due_today), open: num(r?.open_n), overdue: num(r?.overdue), completedMtd: num(r?.done_mtd) };
  };

  const side = (fin: boolean) => {
    const r = t.find((x) => x.fin === fin);
    const assigned = num(r?.assigned);
    return {
      assigned,
      completed: num(r?.completed),
      pending: num(r?.pending),
      overdue: num(r?.overdue),
      // Nothing assigned is no denominator, not 0%.
      pct: assigned > 0 ? num(r?.completed) / assigned : null,
    };
  };

  return {
    financial: side(true),
    nonFinancial: side(false),
    backlog: { financial: backlogOf(true), nonFinancial: backlogOf(false) },
    openRows: openRows.map((r) => ({
      id: String(r.id), title: String(r.title ?? "—"),
      client: r.client ? String(r.client) : null, clientId: r.client_id ? String(r.client_id) : null,
      type: String(r.type ?? "—"), created: String(r.created_at), due: r.due_at ? String(r.due_at) : null,
      ageDays: num(r.age_days), status: String(r.status ?? "open"), priority: String(r.priority ?? "normal"),
      financial: r.fin === true, overdue: r.overdue === true,
    })),
    today: today.map((r) => ({
      id: String(r.id), title: String(r.title ?? "—"),
      client: r.client ? String(r.client) : null,
      type: String(r.type ?? "—"), due: r.due_at ? String(r.due_at) : null,
      priority: String(r.priority ?? "normal"), status: String(r.status ?? "open"),
      assignee: r.assignee ? String(r.assignee) : null,
    })),
    overdue: overdue.map((r) => ({
      id: String(r.id), title: String(r.title ?? "—"),
      client: r.client ? String(r.client) : null,
      type: String(r.type ?? "—"), due: r.due_at ? String(r.due_at) : null,
      priority: String(r.priority ?? "normal"), daysOver: num(r.days_over),
      assignee: r.assignee ? String(r.assignee) : null,
    })),
  };
}

export type MyQueries = {
  open: number;
  waitingClient: number;
  received: number;
  solved: number;
  overdue: number;
  avgResolutionDays: number | null;
  oldestDays: number | null;
  /** Open queries (with us or waiting on the client) by age — the brief's buckets. */
  ageing: Array<{ key: string; label: string; count: number }>;
  byType: Array<{ type: string; open: number }>;
  byStatus: Array<{ status: string; count: number }>;
  rows: Array<{
    id: string; client: string; type: string; created: string; ageDays: number;
    assignedTo: string | null; status: string; remarks: string | null; breached: boolean;
    rm: string | null;
  }>;
};

export const QUERY_AGEING = [
  { key: "d0", label: "Same day", min: 0, max: 0 },
  { key: "d1_2", label: "1–2 days", min: 1, max: 2 },
  { key: "d3_5", label: "3–5 days", min: 3, max: 5 },
  { key: "d6_7", label: "6–7 days", min: 6, max: 7 },
  { key: "d8_15", label: "8–15 days", min: 8, max: 15 },
  { key: "d15p", label: "15+ days", min: 16, max: null },
] as const;

export async function loadMyQueries(tx: Tx, w: MyWindow): Promise<MyQueries> {
  const MINE = clientIds(w.scope);
  const OPEN = asInList(SR_OPEN_ON_US);
  const WAITING = asInList(SR_WAITING_CLIENT);

  const t = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN (${OPEN}))::int                              AS open_n,
      COUNT(*) FILTER (WHERE status IN (${WAITING}))::int                           AS waiting_n,
      COUNT(*) FILTER (WHERE created_at >= ${w.from}::date
                         AND created_at < (${w.to}::date + 1))::int                 AS received_n,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                         AND resolved_at >= ${w.from}::date
                         AND resolved_at < (${w.to}::date + 1))::int                AS solved_n,
      COUNT(*) FILTER (WHERE status IN (${OPEN}) AND sla_resolution_at IS NOT NULL
                         AND sla_resolution_at < now())::int                        AS overdue_n,
      AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400.0)
        FILTER (WHERE resolved_at IS NOT NULL
                  AND resolved_at >= ${w.from}::date
                  AND resolved_at < (${w.to}::date + 1))                            AS avg_days,
      MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0)
        FILTER (WHERE status IN (${OPEN}))                                          AS oldest_days
      FROM service_requests WHERE investor_id IN ${MINE}
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT sr.id, i.name AS client, sr.type, sr.created_at, sr.status, sr.remarks,
           u.name AS assigned_to, ru.name AS rm_name,
           EXTRACT(EPOCH FROM (now() - sr.created_at))::bigint / 86400 AS age_days,
           (sr.sla_resolution_at IS NOT NULL AND sr.sla_resolution_at < now()
            AND sr.resolved_at IS NULL) AS breached
      FROM service_requests sr
      JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users u ON u.id = sr.assigned_to_user_id
      LEFT JOIN users ru ON ru.id = i.rm_id
     WHERE sr.investor_id IN ${MINE}
       AND sr.status NOT IN ('resolved','closed')
     ORDER BY sr.created_at ASC LIMIT 12
  `)).rows as Array<Record<string, unknown>>;

  const open = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(btrim(type), ''), 'other') AS type, status,
           (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS d
      FROM service_requests
     WHERE investor_id IN ${MINE} AND status NOT IN ('resolved','closed')
  `)).rows as Array<{ type: string; status: string; d: number }>;
  const tally = (key: (r: (typeof open)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of open) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  return {
    open: num(t?.open_n),
    waitingClient: num(t?.waiting_n),
    received: num(t?.received_n),
    solved: num(t?.solved_n),
    overdue: num(t?.overdue_n),
    // Nothing closed in the window has no mean. "0 days" would read as instant.
    avgResolutionDays: numOrNull(t?.avg_days),
    oldestDays: numOrNull(t?.oldest_days),
    ageing: QUERY_AGEING.map((b) => ({
      key: b.key, label: b.label,
      count: open.filter((r) => num(r.d) >= b.min && (b.max == null || num(r.d) <= b.max)).length,
    })),
    byType: tally((r) => r.type).map(([type, n]) => ({ type, open: n })),
    byStatus: tally((r) => r.status).map(([status, n]) => ({ status, count: n })),
    rows: rows.map((r) => ({
      id: String(r.id),
      client: String(r.client ?? "—"),
      type: String(r.type ?? "other"),
      created: String(r.created_at),
      ageDays: num(r.age_days),
      assignedTo: r.assigned_to ? String(r.assigned_to) : null,
      status: String(r.status ?? "open"),
      remarks: r.remarks ? String(r.remarks) : null,
      breached: r.breached === true,
      rm: r.rm_name ? String(r.rm_name) : null,
    })),
  };
}

/* ────────────────── §17 insurance relationship view ────────────────── */

export type InsuranceView = {
  /** null when no policy exists for any of my clients — not "0 insured". */
  clientsWithCover: number | null;
  renewals30: number;
  renewals60: number;
  openProposals: number;
  openClaims: number;
  businessMtd: number;
  /** Premium COLLECTED this month on cover that started before it. */
  renewalMtd: number;
  rows: Array<{
    id: string; client: string; mf: boolean;
    life: string; health: string; general: string;
    renewalDue: string | null; openClaim: boolean;
    /** The client's most recent claim, in the insurer's words; null = no claim on record. */
    claimStatus: string | null;
  }>;
};

/**
 * "No CRM record", never "needs product".
 *
 * The brief is explicit and it is also the compliance-safe reading: a blank
 * column means the CRM has not captured a policy, which says nothing about
 * whether the client holds one elsewhere. Turning that blank into a
 * recommendation is how a relationship tool becomes a mis-selling engine.
 */
const LIFE_TYPES = ["term", "ulip", "endowment", "money_back", "life_other"];
const HEALTH_TYPES = ["health", "critical_illness", "group_health"];

export async function loadInsuranceView(tx: Tx, w: MyWindow): Promise<InsuranceView> {
  const MINE = clientIds(w.scope);
  const LIFE = asInList(LIFE_TYPES);
  const HEALTH = asInList(HEALTH_TYPES);

  const t = (await tx.execute(sql`
    SELECT
      COUNT(DISTINCT investor_id) FILTER (WHERE status = 'active')::int AS with_cover,
      COUNT(*) FILTER (WHERE status = 'active' AND next_premium_due_date
                         BETWEEN ${w.today}::date AND (${w.today}::date + 30))::int AS r30,
      COUNT(*) FILTER (WHERE status = 'active' AND next_premium_due_date
                         BETWEEN ${w.today}::date AND (${w.today}::date + 60))::int AS r60,
      COUNT(*) FILTER (WHERE status IN ('proposed','in_underwriting'))::int         AS open_proposals,
      COALESCE(SUM(annual_premium::numeric) FILTER (WHERE policy_start_date >= date_trunc('month', ${w.to}::date)
                                                      AND policy_start_date <= ${w.to}::date), 0) AS mtd,
      COALESCE(SUM(annual_premium::numeric) FILTER (WHERE policy_start_date < date_trunc('month', ${w.to}::date)
                                                      AND last_premium_date >= date_trunc('month', ${w.to}::date)
                                                      AND last_premium_date <= ${w.to}::date), 0) AS renew_mtd,
      COUNT(*)::int AS any_ever
      FROM insurance_policies WHERE investor_id IN ${MINE}
  `)).rows[0] as Row | undefined;

  const claims = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM insurance_claims
     WHERE investor_id IN ${MINE}
       AND claim_status NOT IN ('settled_fully','settled_partially','rejected','withdrawn')
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT i.id, i.name, (i.aum::numeric > 0) AS mf,
           COUNT(p.id) FILTER (WHERE p.policy_type IN (${LIFE}) AND p.status = 'active')::int   AS life,
           COUNT(p.id) FILTER (WHERE p.policy_type IN (${HEALTH}) AND p.status = 'active')::int AS health,
           COUNT(p.id) FILTER (WHERE p.status = 'active'
                                 AND p.policy_type NOT IN (${LIFE})
                                 AND p.policy_type NOT IN (${HEALTH}))::int                      AS general,
           MIN(p.next_premium_due_date) FILTER (WHERE p.status = 'active')                       AS renewal_due,
           EXISTS (SELECT 1 FROM insurance_claims c WHERE c.investor_id = i.id
                     AND c.claim_status NOT IN ('settled_fully','settled_partially','rejected','withdrawn')) AS open_claim,
           (SELECT c.claim_status FROM insurance_claims c WHERE c.investor_id = i.id
             ORDER BY c.created_at DESC LIMIT 1)                                                 AS claim_status
      FROM investors i
      LEFT JOIN insurance_policies p ON p.investor_id = i.id
     WHERE ${clientsWhereOn("i", w.scope)}
     GROUP BY i.id, i.name, i.aum
     ORDER BY i.aum::numeric DESC NULLS LAST
     LIMIT 12
  `)).rows as Array<Record<string, unknown>>;

  const cell = (n: number) => (n > 0 ? `${n} active` : "No CRM record");

  return {
    clientsWithCover: num(t?.any_ever) > 0 ? num(t?.with_cover) : null,
    renewals30: num(t?.r30),
    renewals60: num(t?.r60),
    openProposals: num(t?.open_proposals),
    openClaims: num(claims?.n),
    businessMtd: num(t?.mtd),
    renewalMtd: num(t?.renew_mtd),
    rows: rows.map((r) => ({
      claimStatus: r.claim_status ? String(r.claim_status) : null,
      id: String(r.id),
      client: String(r.name ?? "—"),
      mf: r.mf === true,
      life: cell(num(r.life)),
      health: cell(num(r.health)),
      general: cell(num(r.general)),
      renewalDue: r.renewal_due ? String(r.renewal_due) : null,
      openClaim: r.open_claim === true,
    })),
  };
}
