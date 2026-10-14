/**
 * Process measures — how well each core process of the practice is done
 * (The E-Myth Revisited: a process that is not measured is not a system).
 *
 * One function per ProcessMeasureKey in ./catalog.ts. Every one is
 * firm-wide, looks back 90 days unless the measure is a balance (a stock of
 * clients "in order" today, the freshness of the RTA feed), and reuses the
 * firm's existing definitions where lib/metrics or the dashboards already
 * have one, so a figure here never disagrees with the same figure elsewhere.
 *
 * NO DATA IS NOT ZERO. When the CRM holds nothing the question could be
 * answered from (no leads in the window, no RTA import ever, no birthdays
 * recorded), a measure returns `hasData: false` and `value: null` — never a
 * 0% that reads as a failing process.
 *
 * Every query carries an explicit `tenant_id` predicate (local dev connects as
 * a superuser, which bypasses RLS) and filters on indexed columns with bounded
 * dates. SERVER-ONLY.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { getLeadStageCounts } from "@/lib/metrics/leads";
import { clientWhere } from "@/lib/metrics/scope";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { loadRetention } from "@/lib/dashboard/insurance/renewals";
import type { InsWindow } from "@/lib/dashboard/insurance/window";
import { DEFAULT_SERVICE_PROMISES, type ProcessMeasureKey } from "./catalog";

export type MeasureUnit = "%" | "days" | "count";

export type MeasureResult = {
  value: number | null;
  unit: MeasureUnit;
  /** What the figure is, in a few words ("Leads won"). */
  label: string;
  /** The facts behind it, or why there is no figure. */
  detail?: string;
  hasData: boolean;
};

export type MeasureFn = (tx: Tx, tenantId: string) => Promise<MeasureResult>;

/** The look-back every flow measure uses. */
export const MEASURE_WINDOW_DAYS = 90;

/* ───────────────────────────── helpers ───────────────────────────── */

const n = (v: unknown): number => (v == null || v === "" ? 0 : Number(v) || 0);
const nOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** A share as a whole-ish percentage (one decimal), or null with no denominator. */
export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function noData(unit: MeasureUnit, label: string, detail: string): MeasureResult {
  return { value: null, unit, label, detail, hasData: false };
}

/** Today in India, yyyy-mm-dd. */
function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(day: string, k: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

const TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const SINCE_TS = sql`(now() - make_interval(days => ${MEASURE_WINDOW_DAYS}::int))`;
const SINCE_DAY = sql`((now() AT TIME ZONE 'Asia/Kolkata')::date - ${MEASURE_WINDOW_DAYS}::int)`;
const plural = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString("en-IN")} ${k === 1 ? one : many}`;

/* ───────────────────────────── leads ───────────────────────────── */

/** Lead conversion — lib/metrics/leads' one rate, over leads created in the last 90 days. */
const leadConversion: MeasureFn = async (tx, tenantId) => {
  const to = indiaToday();
  const c = await getLeadStageCounts(tx, { tenantId }, { from: addDays(to, -MEASURE_WINDOW_DAYS), to });
  const label = "Enquiries won";
  if (c.total === 0) return noData("%", label, "No leads were created in the last 90 days.");
  return {
    value: c.conversion == null ? null : Math.round(c.conversion * 1000) / 10,
    unit: "%",
    label,
    detail: `${c.won} won, ${c.lost} lost and ${c.open} still open of ${plural(c.total, "lead")} created in the last 90 days.`,
    hasData: true,
  };
};

type Journey = { fromEnquiry: number; fromWon: number };

/**
 * Converted leads whose client made a first processed investment in the last
 * 90 days: days from the enquiry, and from the win (the first time the lead
 * entered Won on its journey, else its conversion), to that investment.
 */
async function loadLeadJourneys(tx: Tx, tenantId: string): Promise<Journey[]> {
  const rows = (await tx.execute(sql`
    SELECT (ft.order_date - (l.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS from_enquiry,
           (ft.order_date - (COALESCE(won.entered_at, l.converted_at, l.created_at) AT TIME ZONE 'Asia/Kolkata')::date) AS from_won
      FROM leads l
      JOIN LATERAL (
        SELECT t.order_date FROM transactions t
         WHERE t.tenant_id = ${tenantId}::uuid AND t.investor_id = l.converted_investor_id
           AND t.status IN ('processed', 'successful') AND t.order_date IS NOT NULL
         ORDER BY t.order_date ASC LIMIT 1
      ) ft ON true
      LEFT JOIN LATERAL (
        SELECT h.entered_at FROM lead_stage_history h
         WHERE h.tenant_id = ${tenantId}::uuid AND h.lead_id = l.id AND h.stage_key = 'won_lead'
         ORDER BY h.entered_at ASC LIMIT 1
      ) won ON true
     WHERE l.tenant_id = ${tenantId}::uuid
       AND l.converted_investor_id IS NOT NULL
       AND l.lost_reason IS DISTINCT FROM '__deleted__'
       AND ft.order_date >= ${SINCE_DAY} AND ft.order_date <= ${TODAY}
  `)).rows as Array<{ from_enquiry: unknown; from_won: unknown }>;
  return rows.map((r) => ({ fromEnquiry: n(r.from_enquiry), fromWon: n(r.from_won) }));
}

/** Median of a list, or null when empty. Pure. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Enquiry to first investment, median days. */
const leadToClientDays: MeasureFn = async (tx, tenantId) => {
  // A first transaction dated before the enquiry was an existing investor
  // re-entered as a lead: not a journey, left out.
  const days = (await loadLeadJourneys(tx, tenantId)).map((j) => j.fromEnquiry).filter((d) => d >= 0);
  const label = "Days from enquiry to first investment";
  if (!days.length) return noData("days", label, "No converted lead made a first investment in the last 90 days.");
  const within30 = days.filter((d) => d <= 30).length;
  return {
    value: median(days),
    unit: "days",
    label,
    detail: `Median of ${plural(days.length, "new client")} whose first investment came in the last 90 days; ${pct(within30, days.length)}% invested within 30 days of enquiring.`,
    hasData: true,
  };
};

/** Won to investible (first investment), median days — onboarding's own clock. */
const onboardingDays: MeasureFn = async (tx, tenantId) => {
  const days = (await loadLeadJourneys(tx, tenantId)).map((j) => Math.max(0, j.fromWon));
  const label = "Days from won to first investment";
  if (!days.length) return noData("days", label, "No converted lead made a first investment in the last 90 days.");
  const inWeek = days.filter((d) => d <= 7).length;
  return {
    value: median(days),
    unit: "days",
    label,
    detail: `Median of ${plural(days.length, "new client")}; ${pct(inWeek, days.length)}% were investible (KYC, UCC, mandate, first order) within a week of being won.`,
    hasData: true,
  };
};

/* ───────────────────────────── SIPs and redemptions ───────────────────────────── */

/** SIP rejections in the last 90 days that were recovered (repurchased / reprocessed). */
const sipRejectionRecovery: MeasureFn = async (tx, tenantId) => {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE r.recovery_status IN ('recovered', 'reprocessed'))::int AS recovered,
           COUNT(*) FILTER (WHERE r.recovery_status = 'not_recoverable')::int AS closed,
           COUNT(*) FILTER (WHERE r.recovery_status IN ('pending', 'client_contacted', 'bank_issue', 'mandate_issue'))::int AS open
      FROM sip_rejections r
      JOIN investors i ON i.id = r.investor_id AND i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL
     WHERE r.tenant_id = ${tenantId}::uuid
       AND r.rejection_date >= ${SINCE_DAY} AND r.rejection_date <= ${TODAY}
  `)).rows[0] as Record<string, unknown> | undefined;
  const total = n(r?.total);
  const label = "Bounced SIPs recovered";
  if (!total) return noData("%", label, "No SIP rejections were recorded in the last 90 days.");
  return {
    value: pct(n(r?.recovered), total),
    unit: "%",
    label,
    detail: `${n(r?.recovered)} recovered, ${n(r?.closed)} closed as not recoverable and ${n(r?.open)} still being chased, of ${plural(total, "rejection")} in the last 90 days.`,
    hasData: true,
  };
};

/**
 * Large redemptions (the firm's own test: the rupee floor OR the share of the
 * client's book, Settings → Dashboard thresholds) in the last 90 days that were
 * followed up — a task about the client or a logged contact on or after the
 * redemption date, as the Redemption watch reads it.
 */
const redemptionFollowedUp: MeasureFn = async (tx, tenantId) => {
  const t = await loadDashboardThresholds(tx);
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE
             EXISTS (SELECT 1 FROM tasks tk
                      WHERE tk.tenant_id = ${tenantId}::uuid AND tk.deleted_at IS NULL
                        AND (tk.related_investor_id = t.investor_id OR (tk.subject_type = 'investor' AND tk.subject_id = t.investor_id))
                        AND tk.created_at >= t.order_date::timestamptz)
             OR EXISTS (SELECT 1 FROM activities a
                         WHERE a.tenant_id = ${tenantId}::uuid AND a.subject_type = 'investor'
                           AND a.subject_id = t.investor_id AND a.occurred_at >= t.order_date::timestamptz)
           )::int AS followed
      FROM transactions t
      JOIN investors i ON i.id = t.investor_id AND i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL
     WHERE t.tenant_id = ${tenantId}::uuid
       AND t.type IN ('redemption', 'swp') AND t.status IN ('processed', 'successful')
       AND t.order_date >= ${SINCE_DAY} AND t.order_date <= ${TODAY}
       AND (t.amount::numeric >= ${t.largeRedemptionAbsolute}::numeric
            OR t.amount::numeric >= ${t.largeRedemptionShareOfAum}::numeric * (COALESCE(i.aum, 0)::numeric + t.amount::numeric))
  `)).rows[0] as Record<string, unknown> | undefined;
  const total = n(r?.total);
  const label = "Large redemptions followed up";
  if (!total) return noData("%", label, "No large redemption reached the RTA feed in the last 90 days.");
  return {
    value: pct(n(r?.followed), total),
    unit: "%",
    label,
    detail: `${n(r?.followed)} of ${plural(total, "large redemption")} had a task or a logged contact after the redemption date.`,
    hasData: true,
  };
};

/* ───────────────────────────── reviews ───────────────────────────── */

/**
 * Live clients whose review is not overdue. A client's review is due on its
 * scheduled next review, or — with none scheduled — its last review (else its
 * onboarding) plus the cadence the firm promises its service tier
 * (service_promises, else the catalog's default), else the client's own
 * review frequency. A client with none of those has no due date to miss and
 * is reported, not counted.
 */
const reviewOnTime: MeasureFn = async (tx, tenantId) => {
  const promises = (await tx.execute(sql`
    SELECT tier, items FROM service_promises WHERE tenant_id = ${tenantId}::uuid
  `)).rows as Array<{ tier: string; items: { reviewEveryDays?: number | null } | null }>;
  const cadence = (tier: "A" | "B" | "C") => {
    const own = promises.find((p) => p.tier === tier)?.items?.reviewEveryDays;
    return own && own > 0 ? Math.round(own) : DEFAULT_SERVICE_PROMISES[tier].reviewEveryDays;
  };
  const cad = sql`CASE upper(btrim(COALESCE(i.service_tier, '')))
      WHEN 'A' THEN ${cadence("A")}::int WHEN 'B' THEN ${cadence("B")}::int WHEN 'C' THEN ${cadence("C")}::int
      ELSE NULLIF(i.review_frequency_days, 0) END`;
  const due = sql`COALESCE(
      (i.next_review_at AT TIME ZONE 'Asia/Kolkata')::date,
      (COALESCE(i.last_review_at, i.onboarded_at) AT TIME ZONE 'Asia/Kolkata')::date + ${cad})`;
  const r = (await tx.execute(sql`
    SELECT COUNT(*) FILTER (WHERE d.due IS NOT NULL)::int AS with_due,
           COUNT(*) FILTER (WHERE d.due IS NOT NULL AND d.due >= ${TODAY})::int AS on_time,
           COUNT(*) FILTER (WHERE d.due IS NULL)::int AS no_due
      FROM (SELECT ${due} AS due FROM investors i WHERE ${clientWhere({ tenantId }, "i")}) d
  `)).rows[0] as Record<string, unknown> | undefined;
  const withDue = n(r?.with_due);
  const label = "Clients reviewed on cadence";
  if (!withDue) return noData("%", label, "No client has a scheduled review, a service tier or a review frequency to measure against.");
  const overdue = withDue - n(r?.on_time);
  const noDue = n(r?.no_due);
  return {
    value: pct(n(r?.on_time), withDue),
    unit: "%",
    label,
    detail: `${plural(overdue, "client")} overdue for review of ${withDue.toLocaleString("en-IN")} with a review due date${noDue ? `; ${plural(noDue, "client")} with no review scheduled and no tier cadence` : ""}.`,
    hasData: true,
  };
};

/* ───────────────────────────── service requests and complaints ───────────────────────────── */

/** When a ticket was finished: its resolved time, else the last edit of a closed one. */
const DONE_AT = sql`COALESCE(sr.resolved_at, CASE WHEN sr.status IN ('resolved', 'closed') THEN sr.updated_at END)`;

/**
 * Service requests (not complaints) whose resolution SLA fell due in the last
 * 90 days, or that were resolved in them: resolved by the SLA.
 */
const srWithinSla: MeasureFn = async (tx, tenantId) => {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ${DONE_AT} IS NOT NULL AND ${DONE_AT} <= sr.sla_resolution_at)::int AS within,
           COUNT(*) FILTER (WHERE ${DONE_AT} IS NULL)::int AS open_late
      FROM service_requests sr
     WHERE sr.tenant_id = ${tenantId}::uuid AND sr.type <> 'complaint'
       AND sr.sla_resolution_at IS NOT NULL
       AND ((sr.sla_resolution_at >= ${SINCE_TS} AND sr.sla_resolution_at <= now())
            OR sr.resolved_at >= ${SINCE_TS})
  `)).rows[0] as Record<string, unknown> | undefined;
  const total = n(r?.total);
  const label = "Requests resolved within SLA";
  if (!total) return noData("%", label, "No service request with an SLA fell due or was resolved in the last 90 days.");
  return {
    value: pct(n(r?.within), total),
    unit: "%",
    label,
    detail: `${n(r?.within)} of ${plural(total, "request")} resolved on time; ${n(r?.open_late)} still open past the SLA.`,
    hasData: true,
  };
};

/** Complaints whose 21-day clock ran out in the last 90 days, or resolved in them: resolved within 21 days. */
const complaintWithinSla: MeasureFn = async (tx, tenantId) => {
  const deadline = sql`(sr.created_at + interval '21 days')`;
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ${DONE_AT} IS NOT NULL AND ${DONE_AT} <= ${deadline})::int AS within,
           COUNT(*) FILTER (WHERE ${DONE_AT} IS NULL)::int AS open_late
      FROM service_requests sr
     WHERE sr.tenant_id = ${tenantId}::uuid AND sr.type = 'complaint'
       AND ((sr.created_at >= ${SINCE_TS} - interval '21 days' AND sr.created_at <= now() - interval '21 days')
            OR sr.resolved_at >= ${SINCE_TS})
  `)).rows[0] as Record<string, unknown> | undefined;
  const total = n(r?.total);
  const label = "Complaints resolved within 21 days";
  if (!total) return noData("%", label, "No complaint's 21-day clock ran out, and none was resolved, in the last 90 days.");
  return {
    value: pct(n(r?.within), total),
    unit: "%",
    label,
    detail: `${n(r?.within)} of ${plural(total, "complaint")} resolved within 21 days; ${n(r?.open_late)} still open past it.`,
    hasData: true,
  };
};

/* ───────────────────────────── insurance ───────────────────────────── */

/**
 * Of the premiums that fell due in the last 90 days, how many were renewed —
 * the Insurance Team Dashboard's retention (loadRetention), firm-wide.
 */
const renewalOnTime: MeasureFn = async (tx, tenantId) => {
  const today = indiaToday();
  const from = addDays(today, -MEASURE_WINDOW_DAYS);
  const w: InsWindow = {
    tenantId, userId: "", scope: { kind: "firm" }, filter: {},
    from, to: today, periodLabel: "Last 90 days",
    prevFrom: from, prevTo: today, prevLabel: "",
    fyStart: from, pyFrom: from, pyTo: today,
    today, t: await loadDashboardThresholds(tx),
  };
  const all = (await loadRetention(tx, w, from, today)).find((x) => x.key == null || x.key === "all") ?? null;
  const label = "Premiums due that were renewed";
  if (!all || all.due === 0) return noData("%", label, "No insurance premium fell due in the last 90 days.");
  return {
    value: all.policyPct == null ? null : Math.round(all.policyPct * 1000) / 10,
    unit: "%",
    label,
    detail: `${all.renewed} of ${plural(all.due, "premium")} due in the last 90 days marked renewed.`,
    hasData: true,
  };
};

/* ───────────────────────────── compliance ───────────────────────────── */

const KYC_OK = ["verified", "validated", "registered"];

/** Live clients whose KYC is in order today: a valid status and an unexpired CKYC. */
const kycExpiryCleared: MeasureFn = async (tx, tenantId) => {
  const ok = sql.join(KYC_OK.map((s) => sql`${s}`), sql`, `);
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE lower(COALESCE(i.kyc_status, '')) NOT IN (${ok}))::int AS not_valid,
           COUNT(*) FILTER (WHERE i.ckyc_expiry_at < ${TODAY})::int AS expired,
           COUNT(*) FILTER (WHERE lower(COALESCE(i.kyc_status, '')) IN (${ok})
                              AND (i.ckyc_expiry_at IS NULL OR i.ckyc_expiry_at >= ${TODAY}))::int AS in_order
      FROM investors i WHERE ${clientWhere({ tenantId }, "i")}
  `)).rows[0] as Record<string, unknown> | undefined;
  const total = n(r?.total);
  const label = "Clients with KYC in order";
  if (!total) return noData("%", label, "No live clients on record.");
  return {
    value: pct(n(r?.in_order), total),
    unit: "%",
    label,
    detail: `${plural(n(r?.not_valid), "client")} without a verified KYC and ${plural(n(r?.expired), "CKYC")} past expiry, of ${plural(total, "live client")}.`,
    hasData: true,
  };
};

/** Days since the last successful CAMS / KFintech import. */
const rtaImportFreshness: MeasureFn = async (tx, tenantId) => {
  const r = (await tx.execute(sql`
    SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date
              - (MAX(COALESCE(f.parsed_at, f.created_at)) AT TIME ZONE 'Asia/Kolkata')::date) AS days,
           to_char(MAX(f.period_end), 'YYYY-MM-DD') AS data_to,
           COUNT(*) FILTER (WHERE f.created_at >= ${SINCE_TS})::int AS recent
      FROM rta_file_imports f
     WHERE f.tenant_id = ${tenantId}::uuid AND f.status IN ('completed', 'partial') AND f.deleted_at IS NULL
  `)).rows[0] as Record<string, unknown> | undefined;
  const days = nOrNull(r?.days);
  const label = "Days since the last RTA import";
  if (days == null) return noData("days", label, "No CAMS / KFintech file has been imported yet.");
  return {
    value: days,
    unit: "days",
    label,
    detail: `Feeds cover transactions up to ${String(r?.data_to ?? "—")}; ${plural(n(r?.recent), "file")} imported in the last 90 days.`,
    hasData: true,
  };
};

/* ───────────────────────────── client touchpoints ───────────────────────────── */

/**
 * Live clients whose birthday fell in the last 90 days (up to yesterday) and
 * were wished: an outbound message that went out, or a logged contact, on
 * the birthday or the day either side. Only what the CRM recorded can count —
 * so with no outbound message and no logged contact at all in the window,
 * wishes may simply be going out elsewhere, and the measure has no data.
 */
const birthdayWished: MeasureFn = async (tx, tenantId) => {
  const used = (await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM communications c WHERE c.tenant_id = ${tenantId}::uuid AND c.direction = 'outbound'
                      AND c.created_at >= ${SINCE_TS} AND c.status IN ('sent', 'delivered', 'read', 'replied')) AS comms,
           EXISTS (SELECT 1 FROM activities a WHERE a.tenant_id = ${tenantId}::uuid AND a.occurred_at >= ${SINCE_TS}) AS acts
  `)).rows[0] as { comms: boolean; acts: boolean } | undefined;
  // This year's birthday, or last year's when this year's is still ahead
  // (date + interval keeps 29 Feb on 28 Feb in a common year).
  const thisYear = sql`(i.dob + make_interval(years => (extract(year from ${TODAY}) - extract(year from i.dob))::int))::date`;
  const bday = sql`CASE WHEN ${thisYear} > ${TODAY} THEN (${thisYear} - interval '1 year')::date ELSE ${thisYear} END`;
  const r = (await tx.execute(sql`
    WITH b AS (
      SELECT i.id, ${bday} AS bday FROM investors i
       WHERE ${clientWhere({ tenantId }, "i")} AND i.dob IS NOT NULL
    )
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE
             EXISTS (SELECT 1 FROM communications c
                      WHERE c.tenant_id = ${tenantId}::uuid AND c.investor_id = b.id AND c.direction = 'outbound'
                        AND c.status IN ('sent', 'delivered', 'read', 'replied')
                        AND c.created_at >= (b.bday - 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
                        AND c.created_at < (b.bday + 2)::timestamp AT TIME ZONE 'Asia/Kolkata')
             OR EXISTS (SELECT 1 FROM activities a
                         WHERE a.tenant_id = ${tenantId}::uuid AND a.subject_type = 'investor' AND a.subject_id = b.id
                           AND a.occurred_at >= (b.bday - 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
                           AND a.occurred_at < (b.bday + 2)::timestamp AT TIME ZONE 'Asia/Kolkata')
           )::int AS wished
      FROM b
     WHERE b.bday >= ${SINCE_DAY} AND b.bday < ${TODAY}
  `)).rows[0] as Record<string, unknown> | undefined;
  const total = n(r?.total);
  const label = "Birthdays wished";
  if (!total) return noData("%", label, "No client with a recorded date of birth had a birthday in the last 90 days.");
  if (!used?.comms && !used?.acts) {
    return noData("%", label, `${plural(total, "client")} had a birthday, but the CRM recorded no outbound message or logged contact in the period — wishes sent outside it cannot be counted.`);
  }
  return {
    value: pct(n(r?.wished), total),
    unit: "%",
    label,
    detail: `${n(r?.wished)} of ${plural(total, "client")} with a birthday in the last 90 days got a message or a logged call around the day.`,
    hasData: true,
  };
};

/* ───────────────────────────── registry ───────────────────────────── */

export const PROCESS_MEASURES: Record<ProcessMeasureKey, MeasureFn> = {
  lead_to_client_days: leadToClientDays,
  lead_conversion: leadConversion,
  onboarding_days: onboardingDays,
  sip_rejection_recovery: sipRejectionRecovery,
  redemption_followed_up: redemptionFollowedUp,
  review_on_time: reviewOnTime,
  sr_within_sla: srWithinSla,
  complaint_within_sla: complaintWithinSla,
  renewal_on_time: renewalOnTime,
  kyc_expiry_cleared: kycExpiryCleared,
  rta_import_freshness: rtaImportFreshness,
  birthday_wished: birthdayWished,
};

/**
 * Run one measure. A measure that fails (a missing table on an old database,
 * a bad row) reports "no data" rather than taking the whole map down — but
 * inside a savepoint, so the failed statement does not abort the caller's
 * transaction.
 */
export async function runMeasure(tx: Tx, tenantId: string, key: ProcessMeasureKey): Promise<MeasureResult> {
  const fn = PROCESS_MEASURES[key];
  try {
    return await tx.transaction(async (sp) => fn(sp as unknown as Tx, tenantId));
  } catch (err) {
    console.error(`[practice] measure ${key} failed`, err);
    return noData("count", "Not measured", "The CRM could not compute this measure.");
  }
}

/** Every measure, in one pass (sequential: one connection, one transaction). */
export async function runAllMeasures(tx: Tx, tenantId: string, keys: ProcessMeasureKey[]): Promise<Map<ProcessMeasureKey, MeasureResult>> {
  const out = new Map<ProcessMeasureKey, MeasureResult>();
  for (const k of new Set(keys)) out.set(k, await runMeasure(tx, tenantId, k));
  return out;
}

/** The figure as people read it: "42%", "6 days", "—". Pure. */
export function formatMeasure(m: Pick<MeasureResult, "value" | "unit" | "hasData">): string {
  if (!m.hasData || m.value == null) return "—";
  const v = Number.isInteger(m.value) ? m.value.toLocaleString("en-IN") : m.value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  if (m.unit === "%") return `${v}%`;
  if (m.unit === "days") return `${v} ${m.value === 1 ? "day" : "days"}`;
  return v;
}
