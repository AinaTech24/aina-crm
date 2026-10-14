/**
 * The client-book half of the personal cockpit. SERVER-ONLY.
 *
 *   §5  My client book        — the shape of the book
 *   §6  Category distribution — count AND AUM AND share, never count alone
 *   §7  My key clients        — the relationship table
 *   §14 Relationship opportunities
 *   §18 Risk profile / suitability status
 *   §19 Client data quality
 *   §20 Client contact gap
 *
 * ── Two rules the brief states and this module enforces ─────────────────────
 *
 * 1. "Do not only show the number of clients." A category with 23 clients and
 *    one with 23 clients are the same bar; a category holding 42% of the book
 *    and one holding 4% are not. Every category row carries count, AUM and
 *    share of MY AUM — not the firm's.
 *
 * 2. "Do not automatically recommend products." Everything in §14 is framed as
 *    a relationship or service gap that the DATA shows — "no SIP on record",
 *    "no insurance record" — never as "needs a product". A CRM that has no
 *    record of a policy has not established that the client is uninsured, and
 *    a dashboard that says otherwise is manufacturing a sales prompt out of a
 *    blank field.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** A raw SQL result row. Postgres hands numerics back as strings, so every
 *  field goes through num() / numOrNull() before it is used. */
type Row = Record<string, unknown>;
import {
  asInList, clientsHref, clientsWhere, clientsWhereOn, num, PROPOSAL_LIVE, staffMatch,
  type MyWindow,
  taskIsAbout,
} from "./window";
import { missingAdultTextSql, missingDobSql, needsNomineeSql } from "@/lib/investors/type-rules";

/* ────────────────────────── §5 + §6 the book ────────────────────────── */

export type CategoryRow = {
  key: string;
  label: string;
  clients: number;
  aum: number;
  /** Share of MY AUM, 0..1. Null when my book is worth nothing yet. */
  share: number | null;
  sipBook: number;
  href: string;
};

export type ClientBook = {
  total: number;
  familyHeads: number;
  familyMembers: number;
  individuals: number;
  active: number;
  newThisMonth: number;
  newFytd: number;
  uncategorised: number;
  aum: number;
  categories: CategoryRow[];
};

/** A / B / C / D plus the bucket the brief insists on naming rather than hiding. */
const CATEGORY_ORDER = ["A", "B", "C", "D"] as const;

export async function loadClientBook(tx: Tx, w: MyWindow): Promise<ClientBook> {
  // A family HEAD is the investor the family record points at
  // (`families.primary_investor_id`), not one whose free-text `family_role`
  // happens to read "head". That column is an optional relationship label
  // — "spouse", "son", "self" — and is null on most books, so counting heads
  // from it reports zero family heads on a firm that has mapped every family.
  const shape = (await tx.execute(sql`
    SELECT
      COUNT(*)::int                                                              AS total,
      COUNT(*) FILTER (WHERE is_head)::int                                        AS family_heads,
      COUNT(*) FILTER (WHERE family_id IS NOT NULL AND NOT is_head)::int          AS family_members,
      COUNT(*) FILTER (WHERE family_id IS NULL)::int                             AS individuals,
      COUNT(*) FILTER (WHERE status = 'active')::int                             AS active,
      COUNT(*) FILTER (WHERE (onboarded_at AT TIME ZONE 'Asia/Kolkata')::date >= date_trunc('month', ${w.to}::date)::date)::int AS new_month,
      COUNT(*) FILTER (WHERE (onboarded_at AT TIME ZONE 'Asia/Kolkata')::date >= ${w.fyStart}::date)::int AS new_fy,
      COUNT(*) FILTER (WHERE client_category IS NULL OR btrim(client_category) = '')::int AS uncategorised,
      COALESCE(SUM(aum::numeric), 0)                                             AS aum
      FROM (
        SELECT i.*, EXISTS (SELECT 1 FROM families f WHERE f.primary_investor_id = i.id) AS is_head
          FROM investors i
         WHERE ${clientsWhereOn("i", w.scope)}
      ) investors
  `)).rows[0] as Row | undefined;

  const cats = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(btrim(upper(client_category)), ''), '?') AS cat,
           COUNT(*)::int AS clients,
           COALESCE(SUM(aum::numeric), 0) AS aum,
           COALESCE(SUM(active_sip_amount::numeric), 0) AS sip_book
      FROM investors
     WHERE ${clientsWhere(w.scope)}
     GROUP BY 1
  `)).rows as Array<Record<string, unknown>>;

  const byCat = new Map(cats.map((c) => [String(c.cat), c]));
  const totalAum = num(shape?.aum);

  const row = (key: string, label: string): CategoryRow => {
    const r = byCat.get(key);
    const aum = num(r?.aum);
    return {
      key,
      label,
      clients: num(r?.clients),
      aum,
      // A share of nothing is not 0% — it is undefined. Printing "0% of my
      // book" against a book worth ₹0 reads as a measurement.
      share: totalAum > 0 ? aum / totalAum : null,
      sipBook: num(r?.sip_book),
      href: clientsHref(w.scope, `category=${key === "?" ? "none" : key}`),
    };
  };

  return {
    total: num(shape?.total),
    familyHeads: num(shape?.family_heads),
    familyMembers: num(shape?.family_members),
    individuals: num(shape?.individuals),
    active: num(shape?.active),
    newThisMonth: num(shape?.new_month),
    newFytd: num(shape?.new_fy),
    uncategorised: num(shape?.uncategorised),
    aum: totalAum,
    categories: [
      ...CATEGORY_ORDER.map((c) => row(c, `${c} category`)),
      row("?", "Uncategorised"),
    ],
  };
}

/* ─────────────────────────── §7 key clients ─────────────────────────── */

export type KeyClient = {
  id: string;
  name: string;
  family: string | null;
  category: string | null;
  aum: number;
  sip: number;
  lastMeeting: string | null;
  nextReview: string | null;
  reviewDaysOver: number | null;
  openQueries: number;
  pendingTasks: number;
  /** "3 policies" / "No record" — never "needs cover". */
  insurance: string;
  lastTransaction: string | null;
};

export type KeyClientSort = "aum" | "sip" | "interaction" | "review" | "category";

const SORTS: Record<KeyClientSort, ReturnType<typeof sql>> = {
  aum: sql`i.aum::numeric DESC NULLS LAST`,
  sip: sql`i.active_sip_amount::numeric DESC NULLS LAST`,
  // Longest-neglected first: the useful end of "last interaction".
  interaction: sql`i.last_contact_at ASC NULLS FIRST`,
  review: sql`i.next_review_at ASC NULLS LAST`,
  // Uncategorised sorts last rather than first — a blank is not an A.
  category: sql`COALESCE(NULLIF(btrim(upper(i.client_category)), ''), 'Z') ASC, i.aum::numeric DESC`,
};

export async function loadKeyClients(
  tx: Tx, w: MyWindow, sort: KeyClientSort = "aum", limit = 12,
): Promise<KeyClient[]> {
  const OPEN_SR = asInList(["open", "in_progress", "escalated"]);
  const rows = (await tx.execute(sql`
    SELECT i.id, i.name, i.client_category, i.aum, i.active_sip_amount,
           COALESCE(f.family_name, f.head_name) AS family, i.next_review_at, i.last_transaction_at,
           (${w.today}::date - i.next_review_at::date) AS review_days_over,
           (SELECT MAX(m.meeting_date) FROM review_meetings m
             WHERE m.investor_id = i.id AND m.status = 'completed')                  AS last_meeting,
           (SELECT COUNT(*)::int FROM service_requests sr
             WHERE sr.investor_id = i.id AND sr.status IN (${OPEN_SR}))              AS open_queries,
           (SELECT COUNT(*)::int FROM tasks t
             WHERE ${taskIsAbout("t", sql`i.id`)} AND t.deleted_at IS NULL
               AND t.status NOT IN ('completed','cancelled'))                        AS pending_tasks,
           (SELECT COUNT(*)::int FROM insurance_policies p
             WHERE p.investor_id = i.id AND p.status = 'active')                      AS policies
      FROM investors i
      LEFT JOIN families f ON f.id = i.family_id
     WHERE ${clientsWhereOn("i", w.scope)}
     ORDER BY ${SORTS[sort]}
     LIMIT ${limit}
  `)).rows as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? "—"),
    family: r.family ? String(r.family) : null,
    category: r.client_category ? String(r.client_category).toUpperCase() : null,
    aum: num(r.aum),
    sip: num(r.active_sip_amount),
    lastMeeting: r.last_meeting ? String(r.last_meeting) : null,
    nextReview: r.next_review_at ? String(r.next_review_at) : null,
    reviewDaysOver: r.review_days_over == null ? null : num(r.review_days_over),
    openQueries: num(r.open_queries),
    pendingTasks: num(r.pending_tasks),
    // The wording matters. "No record" states what the CRM knows; "no cover"
    // would state something about the client that the CRM cannot know.
    insurance: num(r.policies) > 0 ? `${num(r.policies)} active` : "No record",
    lastTransaction: r.last_transaction_at ? String(r.last_transaction_at) : null,
  }));
}

/* ────────────────── §14 relationship opportunities ────────────────── */

export type Opportunity = {
  key: string;
  label: string;
  /** What the DATA shows. Never a product recommendation. */
  basis: string;
  count: number;
  /** AUM sitting behind the gap, where money is the relevant scale. */
  aum: number | null;
  href: string;
  clients: Array<{ id: string; name: string; meta: string | null }>;
  /**
   * True when the gap covers EVERY client on the book.
   *
   * That is almost never a list of conversations to have — it is a module
   * nobody has populated. "13 of 13 clients have no insurance record" on a
   * firm that has not started using the insurance module was ranking above
   * every genuine per-client gap purely because it carried the most AUM.
   * Flagged so the UI can say what it actually means and sort it last.
   */
  wholeBook: boolean;
};

export async function loadOpportunities(tx: Tx, w: MyWindow): Promise<Opportunity[]> {
  const LIVE_PROPOSAL = asInList(PROPOSAL_LIVE);

  // One pass, one row per client, every flag computed together — eight
  // separate queries over the same 13 rows would cost eight index scans to
  // answer one question.
  const rows = (await tx.execute(sql`
    SELECT i.id, i.name, i.aum::numeric AS aum, i.client_category, i.family_id, i.family_role,
           i.active_sip_amount::numeric AS sip, i.last_review_at, i.next_review_at,
           (SELECT COUNT(*)::int FROM sips s WHERE s.investor_id = i.id AND s.status = 'active') AS active_sips,
           (SELECT COUNT(*)::int FROM insurance_policies p WHERE p.investor_id = i.id
             AND p.status NOT IN ('cancelled','surrendered'))                                    AS policies,
           (SELECT COUNT(*)::int FROM proposals pr WHERE pr.investor_id = i.id
             AND pr.status IN (${LIVE_PROPOSAL}))                                                AS live_proposals,
           -- Holdings live inside folios.schemes, a jsonb array of
           -- schemeCode / schemeName / category / units / nav / value. There is
           -- no per-scheme holdings TABLE in this schema, so the category and
           -- the value are read out of the array. A folio whose array is empty
           -- (every folio on a book imported before holdings were captured)
           -- contributes nothing, which is why this opportunity disappears
           -- rather than reading zero.
           (SELECT COALESCE(SUM((s->>'value')::numeric), 0) FROM folios fo,
                   LATERAL jsonb_array_elements(COALESCE(fo.schemes, '[]'::jsonb)) s
             WHERE fo.investor_id = i.id
               AND (lower(COALESCE(s->>'category', '')) LIKE '%liquid%'
                 OR lower(COALESCE(s->>'category', '')) LIKE '%overnight%'
                 OR lower(COALESCE(s->>'schemeName', '')) LIKE '%liquid%'))                      AS liquid_value,
           EXISTS (SELECT 1 FROM families fam WHERE fam.primary_investor_id = i.id)              AS is_head,
           (i.family_id IS NOT NULL)                                                             AS has_family,
           (i.risk_profile IS NULL)                                                              AS risk_missing,
           (SELECT MAX(m.meeting_date) FROM review_meetings m
             WHERE m.investor_id = i.id AND m.status = 'completed')                              AS last_meeting,
           EXISTS (SELECT 1 FROM transactions t WHERE t.investor_id = i.id AND t.status = 'rejected'
                    AND t.type IN ('sip','sip_topup') AND t.order_date >= (${w.today}::date - 90)) AS sip_rejected,
           EXISTS (SELECT 1 FROM service_requests sr WHERE sr.investor_id = i.id
                    AND sr.status NOT IN ('resolved','closed'))                                  AS open_query
      FROM investors i
     WHERE ${clientsWhereOn("i", w.scope)}
  `)).rows as Array<Record<string, unknown>>;

  type R = (typeof rows)[number];
  const isAb = (r: R) => ["A", "B"].includes(String(r.client_category ?? "").toUpperCase());
  const reviewOverdue = (r: R) =>
    r.next_review_at != null && new Date(String(r.next_review_at)) < new Date(w.today);

  const group = (
    key: string, label: string, basis: string, href: string,
    match: (r: R) => boolean, meta: (r: R) => string | null, withAum = true,
  ): Opportunity => {
    const hit = rows.filter(match);
    return {
      key, label, basis,
      count: hit.length,
      aum: withAum ? hit.reduce((s, r) => s + num(r.aum), 0) : null,
      href,
      wholeBook: rows.length > 1 && hit.length === rows.length,
      clients: hit
        .sort((a, b) => num(b.aum) - num(a.aum))
        .slice(0, 5)
        .map((r) => ({ id: String(r.id), name: String(r.name ?? "—"), meta: meta(r) })),
    };
  };

  const inr = (n: number) =>
    n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

  const out = [
    group("no_sip", "Investing, but no active SIP",
      "Has AUM on the book and no SIP mandate recorded.",
      clientsHref(w.scope, "sip=none"),
      (r) => num(r.aum) > 0 && num(r.active_sips) === 0,
      (r) => inr(num(r.aum))),

    group("sip_no_review", "SIP running, review overdue",
      "Contributing every month, and past the review date on the record.",
      clientsHref(w.scope, "review=overdue"),
      (r) => num(r.active_sips) > 0 && reviewOverdue(r),
      (r) => `${inr(num(r.sip))}/mo`),

    group("no_insurance_record", "No insurance record on file",
      "An investment relationship with no policy captured in the CRM. This says what the CRM holds, not what the client owns.",
      "/dashboard/insurance",
      (r) => num(r.aum) > 0 && num(r.policies) === 0,
      (r) => inr(num(r.aum))),

    group("insurance_only", "Insurance client, limited investment record",
      "A policy on file with little or no investment relationship recorded.",
      clientsHref(w.scope),
      (r) => num(r.policies) > 0 && num(r.aum) <= 0,
      () => "Policy on file"),

    group("high_aum_review", "High-value client, review overdue",
      "An A or B category client past their review date.",
      clientsHref(w.scope, "category=A,B&review=overdue"),
      (r) => isAb(r) && reviewOverdue(r),
      (r) => inr(num(r.aum))),

    group("idle_liquid", "Money parked in liquid",
      "Holding a liquid or overnight scheme — worth a conversation about intent, not an automatic switch.",
      clientsHref(w.scope),
      (r) => num(r.liquid_value) > 0,
      (r) => inr(num(r.liquid_value))),

    group("proposal_open", "Proposal shared, not yet converted",
      "A live proposal with no decision recorded against it.",
      "/dashboard/proposals?status=sent",
      (r) => num(r.live_proposals) > 0,
      (r) => `${num(r.live_proposals)} open`),

    group("family_unmapped", "Family mapping incomplete",
      "Holds real money with no family linked, so household roll-ups under-count this relationship.",
      "/dashboard/families",
      (r) => r.has_family !== true && num(r.aum) > 0,
      (r) => inr(num(r.aum))),

    group("risk_pending", "Risk profile pending",
      "No risk profile on record. It is never inferred — the client completes the questionnaire.",
      clientsHref(w.scope, "gaps=risk_pending"),
      (r) => r.risk_missing === true,
      (r) => inr(num(r.aum))),

    group("no_recent_meeting", "No meeting in the last 12 months",
      "Invested with you, and no completed meeting recorded in a year.",
      clientsHref(w.scope),
      (r) => num(r.aum) > 0 && (r.last_meeting == null
        || Date.parse(String(r.last_meeting)) < Date.parse(`${w.today}T00:00:00`) - 365 * 864e5),
      (r) => (r.last_meeting ? `last ${String(r.last_meeting).slice(0, 10)}` : "never met")),

    group("sip_rejected", "Client with a SIP rejection",
      "A SIP debit bounced in the last 90 days — worth a call about the mandate, not a new product.",
      "/dashboard/sip-rejections",
      (r) => r.sip_rejected === true,
      (r) => inr(num(r.aum))),

    group("open_query", "Client with an open service request",
      "Something the client is waiting on. Resolve it before any other conversation.",
      "/dashboard/service-requests?mine=1",
      (r) => r.open_query === true,
      () => "service request open"),
  ];

  // An opportunity with nobody in it is not an opportunity. Then: gaps that
  // single somebody OUT first, biggest by money; the ones covering the whole
  // book last, because they describe an empty module rather than a worklist.
  return out
    .filter((o) => o.count > 0)
    .sort((a, b) =>
      Number(a.wholeBook) - Number(b.wholeBook) ||
      (b.aum ?? 0) - (a.aum ?? 0) ||
      b.count - a.count);
}

/* ─────────────────── §18 risk profile / suitability ─────────────────── */

export type RiskDesk = {
  completed: number;
  pending: number;
  dueForReview: number;
  provisional: number;
  proposalsWithoutSuitability: number | null;
  rows: Array<{
    id: string; name: string; category: string | null;
    status: "Completed" | "Provisional" | "Not completed";
    updated: string | null; aum: number;
  }>;
};

/**
 * A risk profile is DUE FOR REVIEW when it was signed more than a year ago —
 * the standard SEBI-aligned re-profiling cadence. Nothing here infers a
 * client's risk category from age, income or holdings: the brief is explicit
 * ("Do not infer client risk category when data is missing"), and a guessed
 * category is worse than a blank one because it looks like a signed answer.
 */
export async function loadRiskDesk(tx: Tx, w: MyWindow): Promise<RiskDesk> {
  const totals = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE risk_profile IS NOT NULL AND COALESCE(risk_profile_provisional, false) = false)::int AS completed,
      COUNT(*) FILTER (WHERE risk_profile IS NULL)::int                                                          AS pending,
      COUNT(*) FILTER (WHERE COALESCE(risk_profile_provisional, false))::int                                     AS provisional,
      COUNT(*) FILTER (WHERE risk_profile IS NOT NULL
                         AND risk_profile_signed_at IS NOT NULL
                         AND risk_profile_signed_at < now() - interval '1 year')::int                            AS due_review
      FROM investors
     WHERE ${clientsWhere(w.scope)}
  `)).rows[0] as Row | undefined;

  // A proposal needs suitability information when the client it is for has no
  // signed profile. `suitability_note` being blank is the second signal.
  const proposals = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           (SELECT COUNT(*)::int FROM proposals WHERE ${staffMatch("prepared_by_user_id", w)}) AS any_ever
      FROM proposals p
      LEFT JOIN investors i ON i.id = p.investor_id
     WHERE ${staffMatch("prepared_by_user_id", w, "p")}
       AND p.status NOT IN ('draft','expired','rejected')
       AND (i.risk_profile IS NULL OR COALESCE(i.risk_profile_provisional, false))
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT id, name, client_category, aum, risk_profile, risk_profile_provisional, risk_profile_signed_at
      FROM investors
     WHERE ${clientsWhere(w.scope)}
       AND (risk_profile IS NULL
            OR COALESCE(risk_profile_provisional, false)
            OR risk_profile_signed_at < now() - interval '1 year')
     ORDER BY aum::numeric DESC NULLS LAST
     LIMIT 10
  `)).rows as Array<Record<string, unknown>>;

  return {
    completed: num(totals?.completed),
    pending: num(totals?.pending),
    dueForReview: num(totals?.due_review),
    provisional: num(totals?.provisional),
    proposalsWithoutSuitability: num(proposals?.any_ever) > 0 ? num(proposals?.n) : null,
    rows: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "—"),
      category: r.client_category ? String(r.client_category).toUpperCase() : null,
      // "Not completed", the brief's word for a missing profile — never a guess.
      status: r.risk_profile == null ? "Not completed" : r.risk_profile_provisional ? "Provisional" : "Completed",
      updated: r.risk_profile_signed_at ? String(r.risk_profile_signed_at) : null,
      aum: num(r.aum),
    })),
  };
}

/* ───────────────────────── §19 data quality ───────────────────────── */

export type DataGap = {
  key: string; label: string; missing: number; href: string;
  /** Asked for by the branch brief but optional in this CRM — shown, but NOT
   *  counted in the complete-records score. */
  optional?: boolean;
};
export type DataQuality = {
  clients: number;
  gaps: DataGap[];
  /** Share of clients with every checked field present, 0..1. */
  completePct: number | null;
};

/**
 * Only fields that are genuinely required to service a client are checked.
 * Profession and company are in the brief's list but are optional in this
 * schema, so counting them would push every firm's "complete records" score
 * down for information nobody is obliged to hold. The checks here are the ones
 * that actually block work: no PAN blocks a transaction, no mobile blocks a
 * mandate, no category blocks the whole segmentation the rest of this page
 * rests on.
 */
export async function loadDataQuality(tx: Tx, w: MyWindow): Promise<DataQuality> {
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS clients,
      COUNT(*) FILTER (WHERE pan IS NULL OR btrim(pan) = '')::int                        AS no_pan,
      COUNT(*) FILTER (WHERE ${missingDobSql("")})::int                                   AS no_dob,
      COUNT(*) FILTER (WHERE email IS NULL OR btrim(email) = '')::int                      AS no_email,
      COUNT(*) FILTER (WHERE phone IS NULL OR btrim(phone) = '')::int                      AS no_phone,
      COUNT(*) FILTER (WHERE client_category IS NULL OR btrim(client_category) = '')::int  AS no_category,
      COUNT(*) FILTER (WHERE family_id IS NULL)::int                                       AS no_family,
      COUNT(*) FILTER (WHERE kyc_status IS NULL OR kyc_status NOT IN ('validated','registered','verified'))::int AS kyc_gap,
      COUNT(*) FILTER (WHERE ${needsNomineeSql("")})::int                                 AS no_nominee,
      COUNT(*) FILTER (WHERE ${missingAdultTextSql("", "occupation")})::int               AS no_profession,
      COUNT(*) FILTER (WHERE ${missingAdultTextSql("", "employer_name")})::int            AS no_company,
      COUNT(*) FILTER (WHERE risk_profile IS NULL)::int                                    AS no_risk,
      COUNT(*) FILTER (WHERE notes IS NULL OR btrim(notes) = '')::int                    AS no_remarks,
      COUNT(*) FILTER (WHERE (pan IS NOT NULL AND btrim(pan) <> '')
                         AND NOT ${missingDobSql("")}
                         AND (email IS NOT NULL AND btrim(email) <> '')
                         AND (phone IS NOT NULL AND btrim(phone) <> '')
                         AND (client_category IS NOT NULL AND btrim(client_category) <> ''))::int AS complete
      FROM investors
     WHERE ${clientsWhere(w.scope)}
  `)).rows[0] as Row | undefined;

  const clients = num(r?.clients);
  const gap = (key: string, label: string, missing: number, q: string): DataGap => ({
    key, label, missing, href: clientsHref(w.scope, q),
  });

  return {
    clients,
    // No clients means no score, not 100%.
    completePct: clients > 0 ? num(r?.complete) / clients : null,
    gaps: [
      gap("pan", "PAN", num(r?.no_pan), "gaps=pan"),
      gap("mobile", "Mobile", num(r?.no_phone), "gaps=phone"),
      gap("email", "Email", num(r?.no_email), "gaps=email"),
      gap("dob", "Date of birth", num(r?.no_dob), "gaps=dob"),
      gap("category", "Category", num(r?.no_category), "category=none"),
      gap("family", "Family mapping", num(r?.no_family), "unmapped=1"),
      gap("kyc", "KYC not validated", num(r?.kyc_gap), "gaps=kyc"),
      gap("nominee", "Nominee", num(r?.no_nominee), "gaps=nominee"),
      // The branch brief lists these too. They are optional in this schema, so
      // they are shown for follow-up but kept OUT of the completeness score —
      // otherwise every firm's score falls for data nobody is obliged to hold.
      // Both briefs list these; they are optional in this schema, so they are
      // shown for follow-up but kept OUT of the completeness score.
      { ...gap("profession", "Profession missing", num(r?.no_profession), "gaps=occupation"), optional: true },
      { ...gap("company", "Company missing", num(r?.no_company), "gaps=employer"), optional: true },
      { ...gap("risk", "Risk profile pending", num(r?.no_risk), "gaps=risk_pending"), optional: true },
      { ...gap("remarks", "No remarks on record", num(r?.no_remarks), "gaps=notes"), optional: true },
    ].filter((g) => g.missing > 0),
  };
}

/* ───────────────────────── §20 contact gap ───────────────────────── */

export type ContactBand = { key: string; label: string; clients: number; aum: number; abClients: number };
export type ContactGap = {
  bands: ContactBand[];
  /** Never contacted, or no contact recorded — a different statement from 90+ days. */
  noRecord: number;
  rows: Array<{
    id: string; name: string; category: string | null; aum: number;
    lastContact: string | null; daysSince: number | null; nextReview: string | null;
    rm: string | null;
    /** The client's review cadence, where one is recorded. A gap inside it is
     *  explained by the schedule, not a lapse in service (§12). */
    cadenceDays: number | null;
    phone: string | null;
    email: string | null;
  }>;
};

/**
 * `last_contact_at` is the only column that records an interaction of any kind.
 * A client with NULL has no recorded contact, which is not the same as 90+
 * days — a book imported last week would otherwise show every client as
 * catastrophically neglected on day one. So nulls get their own count.
 */
export async function loadContactGap(tx: Tx, w: MyWindow): Promise<ContactGap> {
  const b = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE d IS NOT NULL AND d <= 30)::int                  AS b0,
      COUNT(*) FILTER (WHERE d > 30 AND d <= 60)::int                         AS b31,
      COUNT(*) FILTER (WHERE d > 60 AND d <= 90)::int                         AS b61,
      COUNT(*) FILTER (WHERE d > 90)::int                                     AS b90,
      COUNT(*) FILTER (WHERE d IS NULL)::int                                  AS none,
      COALESCE(SUM(aum) FILTER (WHERE d IS NOT NULL AND d <= 30), 0)          AS a0,
      COALESCE(SUM(aum) FILTER (WHERE d > 30 AND d <= 60), 0)                 AS a31,
      COALESCE(SUM(aum) FILTER (WHERE d > 60 AND d <= 90), 0)                 AS a61,
      COALESCE(SUM(aum) FILTER (WHERE d > 90), 0)                             AS a90,
      COUNT(*) FILTER (WHERE d IS NOT NULL AND d <= 30 AND ab)::int           AS ab0,
      COUNT(*) FILTER (WHERE d > 30 AND d <= 60 AND ab)::int                  AS ab31,
      COUNT(*) FILTER (WHERE d > 60 AND d <= 90 AND ab)::int                  AS ab61,
      COUNT(*) FILTER (WHERE d > 90 AND ab)::int                              AS ab90
    FROM (
      SELECT aum::numeric AS aum,
             (${w.today}::date - last_contact_at::date) AS d,
             upper(COALESCE(client_category, '')) IN ('A','B') AS ab
        FROM investors WHERE ${clientsWhere(w.scope)}
    ) s
  `)).rows[0] as Row | undefined;

  // Worst first, and inside a band the biggest relationship first — an A
  // client silent for 100 days outranks a D client silent for 200.
  const rows = (await tx.execute(sql`
    SELECT i.id, i.name, i.client_category, i.aum, i.last_contact_at, i.next_review_at,
           (${w.today}::date - i.last_contact_at::date) AS days_since, ru.name AS rm_name,
           NULLIF(regexp_replace(COALESCE(i.review_frequency_days::text, ''), '[^0-9]', '', 'g'), '')::int AS cadence,
           i.phone, i.email
      FROM investors i
      LEFT JOIN users ru ON ru.id = i.rm_id
     WHERE ${clientsWhereOn("i", w.scope)}
       AND (i.last_contact_at IS NULL OR i.last_contact_at::date < ${w.today}::date - 30)
     ORDER BY (upper(COALESCE(i.client_category, 'Z')) IN ('A','B')) DESC,
              i.aum::numeric DESC NULLS LAST,
              i.last_contact_at ASC NULLS FIRST
     LIMIT 10
  `)).rows as Array<Record<string, unknown>>;

  return {
    noRecord: num(b?.none),
    bands: [
      { key: "d30", label: "Contacted in 30 days", clients: num(b?.b0), aum: num(b?.a0), abClients: num(b?.ab0) },
      { key: "d60", label: "31–60 days", clients: num(b?.b31), aum: num(b?.a31), abClients: num(b?.ab31) },
      { key: "d90", label: "61–90 days", clients: num(b?.b61), aum: num(b?.a61), abClients: num(b?.ab61) },
      { key: "d90p", label: "90+ days", clients: num(b?.b90), aum: num(b?.a90), abClients: num(b?.ab90) },
    ],
    rows: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "—"),
      category: r.client_category ? String(r.client_category).toUpperCase() : null,
      aum: num(r.aum),
      lastContact: r.last_contact_at ? String(r.last_contact_at) : null,
      daysSince: r.days_since == null ? null : num(r.days_since),
      nextReview: r.next_review_at ? String(r.next_review_at) : null,
      rm: r.rm_name ? String(r.rm_name) : null,
      cadenceDays: r.cadence == null ? null : num(r.cadence),
      phone: r.phone ? String(r.phone) : null,
      email: r.email ? String(r.email) : null,
    })),
  };
}

/* ──────────────────── §8 client review management ──────────────────── */

export type ReviewDesk = {
  completedThisMonth: number | null;
  dueToday: number;
  dueThisWeek: number;
  dueThisMonth: number;
  dueNext30: number;
  overdue: number;
  neverReviewed: number;
  rows: Array<{
    id: string; name: string; category: string | null; aum: number;
    lastReview: string | null; nextReview: string | null; daysOverdue: number | null;
    rm: string | null;
    /** A review meeting is already booked from today on. */
    booked: boolean;
  }>;
};

/**
 * Reviews owed, and to whom first.
 *
 * ── The ordering is the whole point ─────────────────────────────────────────
 *
 * The brief asks for A before B before C before D "when review dates are
 * equally overdue" — so how far overdue decides first, and category only
 * breaks ties. (The first version sorted category first, which let a C client
 * three days late outrank one a hundred days late; the briefs rule that out.)
 * Size is the last tiebreak.
 *
 * "Never reviewed" is counted separately from "overdue". A client with no
 * review date has not missed one — nobody ever set one — and lumping the two
 * together hides a scheduling gap inside a service failure.
 */
export async function loadReviewDesk(tx: Tx, w: MyWindow): Promise<ReviewDesk> {
  const t = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE next_review_at::date >= date_trunc('month', ${w.today}::date)
                         AND next_review_at::date <  (date_trunc('month', ${w.today}::date) + interval '1 month')
                         AND next_review_at::date >= ${w.today}::date)::int            AS due_month,
      COUNT(*) FILTER (WHERE next_review_at::date >= ${w.today}::date
                         AND next_review_at::date <= (${w.today}::date + 30))::int     AS due_30,
      COUNT(*) FILTER (WHERE next_review_at::date < ${w.today}::date)::int             AS overdue,
      COUNT(*) FILTER (WHERE next_review_at::date = ${w.today}::date)::int             AS due_today,
      COUNT(*) FILTER (WHERE next_review_at::date >= ${w.today}::date
                         AND next_review_at::date <= (${w.today}::date + 6))::int      AS due_week,
      COUNT(*) FILTER (WHERE last_review_at IS NULL)::int                              AS never,
      (SELECT COUNT(*)::int FROM review_meetings m
        WHERE ${staffMatch("rm_id", w, "m")} AND m.status = 'completed'
          AND m.category = 'review'
          AND m.meeting_date >= date_trunc('month', ${w.today}::date))                 AS completed_month,
      (SELECT COUNT(*)::int FROM review_meetings WHERE ${staffMatch("rm_id", w)})        AS meetings_ever
      FROM investors
     WHERE ${clientsWhere(w.scope)}
  `)).rows[0] as Row | undefined;

  const rows = (await tx.execute(sql`
    SELECT i.id, i.name, i.client_category, i.aum, i.last_review_at, i.next_review_at,
           (${w.today}::date - i.next_review_at::date) AS days_overdue, ru.name AS rm_name,
           EXISTS (SELECT 1 FROM review_meetings bm WHERE bm.investor_id = i.id
                    AND bm.status IN ('scheduled','confirmed') AND bm.meeting_date >= ${w.today}::date) AS booked
      FROM investors i
      LEFT JOIN users ru ON ru.id = i.rm_id
     WHERE ${clientsWhereOn("i", w.scope)}
       AND (i.next_review_at IS NULL
            OR i.next_review_at::date <= (${w.today}::date + 30))
     -- Days overdue FIRST, category as the tiebreak, then size. Both briefs
     -- say so in terms: A before B before C "when review dates are equally
     -- overdue", and the branch brief orders it 1. overdue days 2. category
     -- 3. AUM. Z stands in for "uncategorised" so a blank never outranks a D.
     ORDER BY (${w.today}::date - i.next_review_at::date) DESC NULLS LAST,
              COALESCE(NULLIF(btrim(upper(i.client_category)), ''), 'Z') ASC,
              i.aum::numeric DESC NULLS LAST
     LIMIT 12
  `)).rows as Array<Record<string, unknown>>;

  return {
    // No meeting has ever been logged means the count is unknown, not zero —
    // reviews may well be happening outside the CRM.
    completedThisMonth: num(t?.meetings_ever) > 0 ? num(t?.completed_month) : null,
    dueToday: num(t?.due_today),
    dueThisWeek: num(t?.due_week),
    dueThisMonth: num(t?.due_month),
    dueNext30: num(t?.due_30),
    overdue: num(t?.overdue),
    neverReviewed: num(t?.never),
    rows: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "—"),
      category: r.client_category ? String(r.client_category).toUpperCase() : null,
      aum: num(r.aum),
      lastReview: r.last_review_at ? String(r.last_review_at) : null,
      nextReview: r.next_review_at ? String(r.next_review_at) : null,
      daysOverdue: r.days_overdue == null ? null : num(r.days_overdue),
      rm: r.rm_name ? String(r.rm_name) : null,
      booked: r.booked === true,
    })),
  };
}
