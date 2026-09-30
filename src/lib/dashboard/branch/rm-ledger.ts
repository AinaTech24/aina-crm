/**
 * The RM ledger — every per-RM figure the branch command centre shows, in one
 * pass. SERVER-ONLY.
 *
 * Seventeen of the branch dashboard's sections are "the same thing, by RM":
 * the scoreboard, the target matrix, SIP exceptions by RM, reviews by RM, tasks
 * by RM, and so on. Each of them is a PROJECTION of the rows this returns, so
 * two tables on the page cannot disagree about one RM — there is one number
 * per RM per metric, computed once.
 *
 * ── The rows add up to the branch ──────────────────────────────────────────
 *
 * Client facts are grouped by the client's RM, over the BRANCH's clients
 * (investors.branch_id). Two synthetic rows make the column totals equal the
 * branch totals in the KPI strip:
 *
 *   "Served from other branches"  branch clients whose RM works elsewhere
 *   "No RM assigned"              branch clients with no RM at all
 *
 * Without them an RM table would silently stop short of the figure printed
 * above it, and a branch head reconciling the two would find money nowhere.
 *
 * Staff facts (meetings held, proposals written, tasks, calls, premium booked)
 * belong to people, and only the branch's own people have rows for them; the
 * synthetic rows show "—" there.
 *
 * Definitions are the personal cockpit's (src/lib/dashboard/my/*), so a row
 * here equals that RM's own dashboard for the same period — with one caveat
 * stated where it applies: client facts here count only the RM's clients IN
 * THIS BRANCH.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  asInList, FINANCIAL_TASK_TYPES, GROSS_TYPES, LEAD_CLOSED_STAGES, num, PROPOSAL_LIVE,
  PROPOSAL_LOST, PROPOSAL_WON, REDEMPTION_TYPES, SIP_STOP_TYPES, SR_OPEN_ON_US,
  staffMatch, TASK_DEAD, type MyWindow, type TargetKey, onboardedInSql,
} from "../my/window";

export const OTHER_BRANCH = "__other__";
export const NO_RM = "__none__";

export type RmLedgerRow = {
  /** A user id, or OTHER_BRANCH / NO_RM for the synthetic rows. */
  id: string;
  name: string;
  kind: "person" | "other_branch" | "unassigned";
  /** Holds the rm / branch_head / insurance_team role, or carries branch
   *  clients — i.e. belongs in an RM table, not only in a task table. */
  isRm: boolean;
  roles: string[];
  active: boolean;

  /* ── client facts (the RM's clients in THIS branch) ── */
  clients: number;
  aum: number;
  sipBook: number;
  newClients: number;
  abClients: number;
  grossSip: number;
  grossSipCount: number;
  sipStop: number;
  sipStopCount: number;
  grossInvestment: number;
  redemption: number;
  redemptionClients: number;
  /** Lump-sum style purchases — count and value — for the average ticket.
   *  SIP instalments are left out: they would pull the average down to the
   *  SIP size and say nothing about how big a fresh investment is. */
  buys: number;
  buyValue: number;
  sipRejections: number;
  sipRejectionValue: number;
  sipRepurchased: number;
  sipRepurchasedValue: number;
  sipPending: number;
  sipPendingValue: number;
  sipNoRemarks: number;
  sipPastSla: number;
  reviewsOverdue: number;
  reviewsDueInPeriod: number;
  neverReviewed: number;
  contact30: number;
  contact60: number;
  contact90: number;
  contact90p: number;
  contactNone: number;
  recordsComplete: number;
  riskSigned: number;
  riskPending: number;
  riskProvisional: number;
  riskDue: number;
  queriesOpen: number;
  queriesOverdue: number;
  queriesWaiting: number;
  /* ── staff facts (the person's own work) — null on synthetic rows ── */
  newMeetings: number | null;
  reviewMeetings: number | null;
  meetingsHeld: number | null;
  meetingsCancelled: number | null;
  proposals: number | null;
  proposalValue: number | null;
  proposalsConverted: number | null;
  proposalsDecided: number | null;
  proposalsLive: number | null;
  proposalAvgDaysPending: number | null;
  leadsOpen: number | null;
  leadsNew: number | null;
  leadsConverted: number | null;
  leadFollowUps: number | null;
  calls: number | null;
  tasksAssigned: number | null;
  tasksDone: number | null;
  tasksOpen: number | null;
  tasksOverdue: number | null;
  finTasksAssigned: number | null;
  finTasksDone: number | null;
  finTasksOverdue: number | null;
  /**
   * The BACKLOG as it stands today, whenever the work was raised. The columns
   * above are the period's cohort (raised in the period, and how much of that
   * closed); a branch head asking "who is sitting on overdue work" needs this
   * instead — the cohort view read 0 overdue next to ten tasks 80+ days late.
   */
  tasksOpenNow: number | null;
  tasksOverdueNow: number | null;
  finTasksOverdueNow: number | null;
  /** Premium booked in THIS branch by the person. */
  insurance: number;
  /** FY targets from kra_targets — null means not set. */
  targets: Partial<Record<TargetKey, number>>;
};

/** Client → RM bucket, over the branch's clients. */
/** The branch's clients, each in its RM bucket. Live clients; with `records`, every record, whatever its status. */
function bucketed(w: MyWindow, branchId: string, rmId: string | null, records = false): SQL {
  const staff = w.staff.length
    ? sql.join(w.staff.map((id) => sql`${id}::uuid`), sql`, `)
    : sql`NULL::uuid`;
  const oneRm = rmId ? sql` AND i.rm_id = ${rmId}::uuid` : sql``;
  return sql`
    SELECT i.*,
           CASE WHEN i.rm_id IS NULL THEN ${NO_RM}
                WHEN i.rm_id IN (${staff}) THEN i.rm_id::text
                ELSE ${OTHER_BRANCH} END AS bucket
      FROM investors i
     WHERE i.branch_id = ${branchId}::uuid${oneRm}
       AND i.deleted_at IS NULL AND i.merged_into_id IS NULL${records ? sql`` : sql` AND i.status NOT IN ('closed', 'exited')`}`;
}

const TARGET_KEYS: Array<[TargetKey, string]> = [
  ["aum", "aum"], ["sip_book", "sip_book"], ["net_sip", "net_sip"],
  ["net_business", "mf_business"], ["new_clients", "new_clients"],
  ["meetings", "meetings"], ["reviews", "reviews"], ["insurance", "insurance_business"],
];

export async function loadRmLedger(
  tx: Tx,
  w: MyWindow,
  opts: { sipRejectionSlaDays: number },
): Promise<RmLedgerRow[]> {
  if (w.scope.kind !== "branch") throw new Error("loadRmLedger needs a branch scope");
  const branchId = w.scope.branchId;
  const rmId = w.scope.rmId ?? null;
  const BC = bucketed(w, branchId, rmId);
  const GROSS_IN = asInList(GROSS_TYPES);
  const RED_IN = asInList(REDEMPTION_TYPES);
  const STOP_IN = asInList(SIP_STOP_TYPES);
  const OPEN_SR = asInList(SR_OPEN_ON_US);
  const DEAD_TASK = asInList(TASK_DEAD);
  const FIN = asInList(FINANCIAL_TASK_TYPES);
  const WON = asInList(PROPOSAL_WON);
  const LOST = asInList(PROPOSAL_LOST);
  const LIVE = asInList(PROPOSAL_LIVE);
  const CLOSED_LEAD = asInList(LEAD_CLOSED_STAGES);

  /* ── people ─────────────────────────────────────────────────────────── */
  const people = (await tx.execute(sql`
    SELECT u.id::text AS id, u.name, u.status, COALESCE(u.roles::text, '') AS roles
      FROM users u
     WHERE ${staffMatch("id", w, "u")}
  `)).rows as Array<{ id: string; name: string; status: string; roles: string }>;

  /* ── client facts, by bucket ────────────────────────────────────────── */
  const book = (await tx.execute(sql`
    WITH bc AS (${BC})
    SELECT bucket,
      COUNT(*)::int                                                          AS clients,
      COALESCE(SUM(aum::numeric), 0)                                         AS aum,
      COALESCE(SUM(active_sip_amount::numeric), 0)                           AS sip_book,
      COUNT(*) FILTER (WHERE upper(COALESCE(client_category,'')) IN ('A','B'))::int AS ab,
      COUNT(*) FILTER (WHERE next_review_at::date < ${w.today}::date)::int  AS reviews_overdue,
      COUNT(*) FILTER (WHERE next_review_at::date <= ${w.to}::date)::int     AS reviews_due,
      COUNT(*) FILTER (WHERE last_review_at IS NULL)::int                    AS never_reviewed,
      COUNT(*) FILTER (WHERE d <= 30)::int                                   AS c30,
      COUNT(*) FILTER (WHERE d > 30 AND d <= 60)::int                        AS c60,
      COUNT(*) FILTER (WHERE d > 60 AND d <= 90)::int                        AS c90,
      COUNT(*) FILTER (WHERE d > 90)::int                                    AS c90p,
      COUNT(*) FILTER (WHERE d IS NULL)::int                                 AS cnone,
      COUNT(*) FILTER (WHERE (pan IS NOT NULL AND btrim(pan) <> '') AND dob IS NOT NULL
                         AND (email IS NOT NULL AND btrim(email) <> '')
                         AND (phone IS NOT NULL AND btrim(phone) <> '')
                         AND (client_category IS NOT NULL AND btrim(client_category) <> ''))::int AS complete,
      COUNT(*) FILTER (WHERE risk_profile IS NOT NULL
                         AND COALESCE(risk_profile_provisional, false) = false)::int AS risk_signed,
      COUNT(*) FILTER (WHERE risk_profile IS NULL)::int                      AS risk_pending,
      COUNT(*) FILTER (WHERE COALESCE(risk_profile_provisional, false))::int AS risk_provisional,
      COUNT(*) FILTER (WHERE risk_profile IS NOT NULL AND risk_profile_signed_at IS NOT NULL
                         AND risk_profile_signed_at < now() - interval '1 year')::int AS risk_due
      FROM (SELECT bc.*, (${w.today}::date - last_contact_at::date) AS d FROM bc) x
     GROUP BY bucket
  `)).rows as Array<Record<string, unknown>>;

  // New clients by onboarding date, over client RECORDS: a client won in the
  // period and closed since was still won (lib/metrics/new-clients.ts), so the
  // column sums to the branch's New clients figure.
  const fresh = (await tx.execute(sql`
    WITH bc AS (${bucketed(w, branchId, rmId, true)})
    SELECT bucket, COUNT(*)::int AS new_clients FROM bc
     WHERE ${onboardedInSql({ from: w.from, to: w.to }, "bc")}
     GROUP BY bucket
  `)).rows as Array<Record<string, unknown>>;

  const flows = (await tx.execute(sql`
    WITH bc AS (${BC})
    SELECT bc.bucket,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.type IN (${GROSS_IN})), 0)  AS gross,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.type IN (${RED_IN})), 0)    AS redemption,
      COUNT(DISTINCT t.investor_id) FILTER (WHERE t.type IN (${RED_IN}))::int     AS red_clients,
      COUNT(*) FILTER (WHERE t.type IN ('purchase','lumpsum','additional_purchase'))::int AS buys,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.type IN ('purchase','lumpsum','additional_purchase')), 0) AS buy_value,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.type IN (${STOP_IN})), 0)   AS stop,
      COUNT(*) FILTER (WHERE t.type IN (${STOP_IN}))::int                         AS stop_n
      FROM bc JOIN transactions t ON t.investor_id = bc.id
     WHERE t.status IN ('processed','successful') AND t.amount IS NOT NULL
       AND t.order_date >= ${w.from}::date AND t.order_date <= ${w.to}::date
     GROUP BY bc.bucket
  `)).rows as Array<Record<string, unknown>>;

  const newSip = (await tx.execute(sql`
    WITH bc AS (${BC})
    SELECT bc.bucket, COALESCE(SUM(s.amount::numeric), 0) AS gross_sip, COUNT(*)::int AS n
      FROM bc JOIN sips s ON s.investor_id = bc.id
     WHERE s.start_date >= ${w.from}::date AND s.start_date <= ${w.to}::date
     GROUP BY bc.bucket
  `)).rows as Array<Record<string, unknown>>;

  // Bounced SIP debits IN THE PERIOD, from the ledger, with the register's
  // recovery state where one exists — the personal cockpit's definition.
  const rejections = (await tx.execute(sql`
    WITH bc AS (${BC})
    SELECT bc.bucket,
      COUNT(*)::int                                                          AS n,
      COALESCE(SUM(t.amount::numeric), 0)                                    AS value,
      COUNT(*) FILTER (WHERE r.recovery_status IN ('recovered','reprocessed'))::int AS repurchased,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE r.recovery_status IN ('recovered','reprocessed')), 0) AS repurchased_value,
      COUNT(*) FILTER (WHERE r.recovery_status IS NULL
                         OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable'))::int AS pending,
      COALESCE(SUM(t.amount::numeric) FILTER (WHERE r.recovery_status IS NULL
                         OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable')), 0) AS pending_value,
      COUNT(*) FILTER (WHERE r.remarks IS NULL OR btrim(r.remarks) = '')::int AS no_remarks,
      COUNT(*) FILTER (WHERE (r.recovery_status IS NULL
                          OR r.recovery_status NOT IN ('recovered','reprocessed','not_recoverable'))
                         AND t.order_date < ${w.today}::date - ${opts.sipRejectionSlaDays}::int)::int AS past_sla
      FROM bc
      JOIN transactions t ON t.investor_id = bc.id
      LEFT JOIN sip_rejections r ON r.transaction_id = t.id
     WHERE t.status = 'rejected' AND t.type IN ('sip','sip_topup')
       AND t.order_date >= ${w.from}::date AND t.order_date <= ${w.to}::date
     GROUP BY bc.bucket
  `)).rows as Array<Record<string, unknown>>;

  const queries = (await tx.execute(sql`
    WITH bc AS (${BC})
    SELECT bc.bucket,
      COUNT(*) FILTER (WHERE sr.status IN (${OPEN_SR}))::int                  AS open_n,
      COUNT(*) FILTER (WHERE sr.status = 'waiting_customer')::int             AS waiting_n,
      COUNT(*) FILTER (WHERE sr.status IN (${OPEN_SR})
                         AND sr.sla_resolution_at IS NOT NULL
                         AND sr.sla_resolution_at < now())::int               AS overdue_n
      FROM bc JOIN service_requests sr ON sr.investor_id = bc.id
     GROUP BY bc.bucket
  `)).rows as Array<Record<string, unknown>>;

  /* ── staff facts, by person ─────────────────────────────────────────── */
  const meetings = (await tx.execute(sql`
    SELECT m.rm_id::text AS id,
      COUNT(*) FILTER (WHERE m.status = 'completed' AND m.category = 'new')::int    AS new_n,
      COUNT(*) FILTER (WHERE m.status = 'completed' AND m.category = 'review')::int AS review_n,
      COUNT(*) FILTER (WHERE m.status = 'completed')::int                           AS held,
      COUNT(*) FILTER (WHERE m.status IN ('cancelled','no_show'))::int              AS cancelled
      FROM review_meetings m
     WHERE ${staffMatch("rm_id", w, "m")}
       AND m.meeting_date >= ${w.from}::date AND m.meeting_date < (${w.to}::date + 1)
     GROUP BY m.rm_id
  `)).rows as Array<Record<string, unknown>>;

  // Has anyone in this view EVER logged a meeting / written a proposal? If
  // not, every meeting and proposal figure is UNKNOWN, not zero — the same
  // rule as the meeting and proposal desks ("no meeting has ever been
  // logged"), so an RM table never prints a row of 0s for a module the branch
  // has not started using.
  const ever = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM review_meetings m0 WHERE ${staffMatch("rm_id", w, "m0")})             AS meetings,
           EXISTS (SELECT 1 FROM proposals p1 WHERE ${staffMatch("prepared_by_user_id", w, "p1")})    AS proposals
  `)).rows[0] as { meetings: boolean; proposals: boolean } | undefined;

  const proposals = (await tx.execute(sql`
    SELECT p.prepared_by_user_id::text AS id,
      COUNT(*) FILTER (WHERE in_window)::int                                   AS n,
      COALESCE(SUM(total_investment::numeric) FILTER (WHERE in_window), 0)     AS value,
      COUNT(*) FILTER (WHERE in_window AND status IN (${WON}))::int            AS converted,
      COUNT(*) FILTER (WHERE in_window AND status IN (${WON}, ${LOST}))::int   AS decided,
      COUNT(*) FILTER (WHERE status IN (${LIVE}))::int                         AS live,
      AVG(EXTRACT(EPOCH FROM (now() - COALESCE(sent_at, created_at))) / 86400.0)
        FILTER (WHERE status IN ('sent','viewed'))                             AS avg_days
      FROM (
        SELECT p0.*, (p0.created_at >= ${w.from}::date AND p0.created_at < (${w.to}::date + 1)) AS in_window
          FROM proposals p0
         WHERE ${staffMatch("prepared_by_user_id", w, "p0")}
      ) p
     GROUP BY p.prepared_by_user_id
  `)).rows as Array<Record<string, unknown>>;

  const leads = (await tx.execute(sql`
    SELECT l.owner_id::text AS id,
      COUNT(*) FILTER (WHERE l.converted_investor_id IS NULL
                         AND lower(btrim(COALESCE(l.stage,''))) NOT IN (${CLOSED_LEAD}))::int AS open_n,
      COUNT(*) FILTER (WHERE l.created_at >= ${w.from}::date
                         AND l.created_at < (${w.to}::date + 1))::int                       AS new_n,
      COUNT(*) FILTER (WHERE l.converted_at >= ${w.from}::date
                         AND l.converted_at < (${w.to}::date + 1))::int                     AS converted_n,
      COUNT(*) FILTER (WHERE l.last_follow_up_at >= ${w.from}::date
                         AND l.last_follow_up_at < (${w.to}::date + 1))::int                AS followups
      FROM leads l
     WHERE ${staffMatch("owner_id", w, "l")}
       AND (l.branch_id = ${branchId}::uuid OR l.branch_id IS NULL)
     GROUP BY l.owner_id
  `)).rows as Array<Record<string, unknown>>;

  const calls = (await tx.execute(sql`
    SELECT a.owner_user_id::text AS id, COUNT(*)::int AS n
      FROM activities a
     WHERE ${staffMatch("owner_user_id", w, "a")} AND a.kind = 'call'
       AND a.occurred_at >= ${w.from}::date AND a.occurred_at < (${w.to}::date + 1)
     GROUP BY a.owner_user_id
  `)).rows as Array<Record<string, unknown>>;

  // Cohort: tasks RAISED in the period, and how many of those closed — the
  // personal cockpit's definition (see MyTaskPanel's note).
  const tasks = (await tx.execute(sql`
    SELECT t.assignee_id::text AS id,
      COUNT(*)::int                                                           AS assigned,
      COUNT(*) FILTER (WHERE t.status = 'completed')::int                     AS done,
      COUNT(*) FILTER (WHERE t.status NOT IN (${DEAD_TASK}))::int             AS open_n,
      COUNT(*) FILTER (WHERE t.status NOT IN (${DEAD_TASK}) AND t.due_at < now())::int AS overdue,
      COUNT(*) FILTER (WHERE t.type IN (${FIN}))::int                         AS fin_assigned,
      COUNT(*) FILTER (WHERE t.type IN (${FIN}) AND t.status = 'completed')::int AS fin_done,
      COUNT(*) FILTER (WHERE t.type IN (${FIN}) AND t.status NOT IN (${DEAD_TASK})
                         AND t.due_at < now())::int                           AS fin_overdue
      FROM tasks t
     WHERE ${staffMatch("assignee_id", w, "t")} AND t.deleted_at IS NULL
       AND t.created_at >= ${w.from}::date AND t.created_at < (${w.to}::date + 1)
     GROUP BY t.assignee_id
  `)).rows as Array<Record<string, unknown>>;

  const backlog = (await tx.execute(sql`
    SELECT t.assignee_id::text AS id,
      COUNT(*)::int                                                           AS open_now,
      COUNT(*) FILTER (WHERE t.due_at < now())::int                           AS overdue_now,
      COUNT(*) FILTER (WHERE t.type IN (${FIN}) AND t.due_at < now())::int    AS fin_overdue_now
      FROM tasks t
     WHERE ${staffMatch("assignee_id", w, "t")} AND t.deleted_at IS NULL
       AND t.status NOT IN (${DEAD_TASK})
     GROUP BY t.assignee_id
  `)).rows as Array<Record<string, unknown>>;

  // Premium booked TO THIS BRANCH, split by who sold it. A policy booked here
  // by someone outside the branch lands in the "other branches" row, so the
  // column still sums to the branch's premium.
  const premium = (await tx.execute(sql`
    SELECT CASE WHEN p.sold_by_user_id IS NULL THEN ${NO_RM}
                WHEN ${staffMatch("sold_by_user_id", w, "p")} THEN p.sold_by_user_id::text
                ELSE ${OTHER_BRANCH} END AS id,
           COALESCE(SUM(p.annual_premium::numeric), 0) AS premium
      FROM insurance_policies p
     WHERE p.branch_id = ${branchId}::uuid
       ${rmId ? sql`AND p.sold_by_user_id = ${rmId}::uuid` : sql``}
       AND p.status NOT IN ('lapsed','surrendered','cancelled')
       AND p.policy_start_date >= ${w.from}::date AND p.policy_start_date <= ${w.to}::date
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;

  const kra = (await tx.execute(sql`
    SELECT user_id::text AS id, metric_key, annual_target::numeric AS v
      FROM kra_targets
     WHERE ${staffMatch("user_id", w)} AND fiscal_year = ${w.fiscalYear}
  `)).rows as Array<{ id: string; metric_key: string; v: string }>;

  /* ── assemble ───────────────────────────────────────────────────────── */
  const byKey = (rows: Array<Record<string, unknown>>, key = "bucket") =>
    new Map(rows.map((r) => [String(r[key]), r]));
  const B = byKey(book), F = byKey(flows), N = byKey(newSip), R = byKey(rejections), Q = byKey(queries);
  const NC = byKey(fresh);
  const M = byKey(meetings, "id"), P = byKey(proposals, "id"), L = byKey(leads, "id");
  const C = byKey(calls, "id"), T = byKey(tasks, "id"), I = byKey(premium, "id"), K = byKey(backlog, "id");

  const targets = new Map<string, Partial<Record<TargetKey, number>>>();
  for (const k of kra) {
    const entry = TARGET_KEYS.find(([, stored]) => stored === k.metric_key);
    if (!entry || !(num(k.v) > 0)) continue;
    const t = targets.get(k.id) ?? {};
    t[entry[0]] = num(k.v);
    targets.set(k.id, t);
  }

  const RM_ROLES = ["rm", "branch_head", "insurance_team"];
  const make = (
    id: string, name: string, kind: RmLedgerRow["kind"], roles: string[], active: boolean,
  ): RmLedgerRow => {
    const b = B.get(id), f = F.get(id), n = N.get(id), r = R.get(id), q = Q.get(id);
    const person = kind === "person";
    const m = person ? M.get(id) : undefined, p = person ? P.get(id) : undefined;
    const l = person ? L.get(id) : undefined, c = person ? C.get(id) : undefined;
    const t = person ? T.get(id) : undefined;
    const k = person ? K.get(id) : undefined;
    const staff = (row: Record<string, unknown> | undefined, col: string) =>
      person ? num(row?.[col]) : null;
    const staffIf = (used: boolean | undefined, row: Record<string, unknown> | undefined, col: string) =>
      person && used ? num(row?.[col]) : null;
    const clients = num(b?.clients);
    return {
      id, name, kind, roles, active,
      isRm: kind !== "person" || clients > 0 || roles.some((x) => RM_ROLES.includes(x)),
      clients,
      aum: num(b?.aum),
      sipBook: num(b?.sip_book),
      newClients: num(NC.get(id)?.new_clients),
      abClients: num(b?.ab),
      grossSip: num(n?.gross_sip),
      grossSipCount: num(n?.n),
      sipStop: num(f?.stop),
      sipStopCount: num(f?.stop_n),
      grossInvestment: num(f?.gross),
      redemption: num(f?.redemption),
      redemptionClients: num(f?.red_clients),
      buys: num(f?.buys),
      buyValue: num(f?.buy_value),
      sipRejections: num(r?.n),
      sipRejectionValue: num(r?.value),
      sipRepurchased: num(r?.repurchased),
      sipRepurchasedValue: num(r?.repurchased_value),
      sipPending: num(r?.pending),
      sipPendingValue: num(r?.pending_value),
      sipNoRemarks: num(r?.no_remarks),
      sipPastSla: num(r?.past_sla),
      reviewsOverdue: num(b?.reviews_overdue),
      reviewsDueInPeriod: num(b?.reviews_due),
      neverReviewed: num(b?.never_reviewed),
      contact30: num(b?.c30),
      contact60: num(b?.c60),
      contact90: num(b?.c90),
      contact90p: num(b?.c90p),
      contactNone: num(b?.cnone),
      recordsComplete: num(b?.complete),
      riskSigned: num(b?.risk_signed),
      riskPending: num(b?.risk_pending),
      riskProvisional: num(b?.risk_provisional),
      riskDue: num(b?.risk_due),
      queriesOpen: num(q?.open_n),
      queriesOverdue: num(q?.overdue_n),
      queriesWaiting: num(q?.waiting_n),
      newMeetings: staffIf(ever?.meetings, m, "new_n"),
      reviewMeetings: staffIf(ever?.meetings, m, "review_n"),
      meetingsHeld: staffIf(ever?.meetings, m, "held"),
      meetingsCancelled: staffIf(ever?.meetings, m, "cancelled"),
      proposals: staffIf(ever?.proposals, p, "n"),
      proposalValue: staffIf(ever?.proposals, p, "value"),
      proposalsConverted: staffIf(ever?.proposals, p, "converted"),
      proposalsDecided: staffIf(ever?.proposals, p, "decided"),
      proposalsLive: staffIf(ever?.proposals, p, "live"),
      proposalAvgDaysPending: person && p?.avg_days != null ? num(p.avg_days) : null,
      leadsOpen: staff(l, "open_n"),
      leadsNew: staff(l, "new_n"),
      leadsConverted: staff(l, "converted_n"),
      leadFollowUps: staff(l, "followups"),
      calls: staff(c, "n"),
      tasksAssigned: staff(t, "assigned"),
      tasksDone: staff(t, "done"),
      tasksOpen: staff(t, "open_n"),
      tasksOverdue: staff(t, "overdue"),
      finTasksAssigned: staff(t, "fin_assigned"),
      finTasksDone: staff(t, "fin_done"),
      finTasksOverdue: staff(t, "fin_overdue"),
      tasksOpenNow: staff(k, "open_now"),
      tasksOverdueNow: staff(k, "overdue_now"),
      finTasksOverdueNow: staff(k, "fin_overdue_now"),
      insurance: num(I.get(id)?.premium),
      targets: targets.get(id) ?? {},
    };
  };

  const parseRoles = (raw: string) =>
    raw.replace(/[{}\[\]"]/g, "").split(",").map((s) => s.trim()).filter(Boolean);

  const rows: RmLedgerRow[] = people
    .filter((u) => !rmId || u.id === rmId)
    .map((u) => make(u.id, u.name ?? "—", "person", parseRoles(u.roles), u.status === "active"));
  // A departed or never-activated user with nothing in this view is noise in
  // every RM table; one who still holds clients or did work in the period
  // stays, marked inactive, because that history is real.
  const hasAnything = (r: RmLedgerRow) =>
    r.clients > 0 || r.insurance > 0 || (r.meetingsHeld ?? 0) > 0 || (r.proposals ?? 0) > 0
    || (r.tasksAssigned ?? 0) > 0 || (r.tasksOpenNow ?? 0) > 0 || (r.leadsOpen ?? 0) > 0 || (r.leadsNew ?? 0) > 0
    || (r.calls ?? 0) > 0;
  // (Not when the view is narrowed to that one person — then they are the point.)
  if (!rmId) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!rows[i].active && !hasAnything(rows[i])) rows.splice(i, 1);
    }
  }
  if (!rmId) {
    const other = make(OTHER_BRANCH, "Served from other branches", "other_branch", [], true);
    const none = make(NO_RM, "No RM assigned", "unassigned", [], true);
    // Only when they hold something — an empty synthetic row is noise.
    for (const s of [other, none]) {
      if (s.clients > 0 || s.insurance > 0) rows.push(s);
    }
  }
  return rows.sort((a, b) =>
    Number(a.kind !== "person") - Number(b.kind !== "person") || b.aum - a.aum || a.name.localeCompare(b.name));
}

/** Column totals across the ledger — what the RM tables reconcile to. */
export function sumLedger<K extends keyof RmLedgerRow>(rows: RmLedgerRow[], key: K): number {
  return rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
}
