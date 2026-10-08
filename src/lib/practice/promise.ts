/**
 * The service promise — a turn-key client experience (The E-Myth Revisited).
 *
 * Every client of a service tier (investors.service_tier) is promised the same
 * service, whoever their RM is. This module says what the firm promised
 * (`loadPromises`) and how often it kept it (`evaluatePromise`, `promiseGaps`).
 * SERVER-ONLY for the loaders; the helpers at the top are pure.
 *
 * How each item is measured — only what the CRM records can count:
 *
 *   review     investors.last_review_at within reviewEveryDays. Completing a
 *              review meeting writes it (api/review-meetings/[id], and the
 *              family propagation), so it is the review record of the client.
 *   call       investors.last_contact_at within callEveryDays. A logged call,
 *              WhatsApp, SMS or email writes it; "No answer" / "Busy" never do.
 *   statement  the latest of investors.last_statement_sent_at (the statement
 *              scheduler's watermark) and an outbound communications row with
 *              payload.kind = 'valuation_statement' (every statement send,
 *              manual or scheduled, writes one), within statementEveryDays.
 *   birthday   the client's last birthday (date of birth on record, while a
 *              client of ours) had an outbound message that went out, or a
 *              logged contact, on the day or the day either side.
 *   query      service requests (not complaints — those have their own 21-day
 *              clock) raised in the last 90 days resolved within querySlaHours.
 *              A request still open inside the SLA is not judged yet.
 *
 * "No data is not zero": an item the firm has never recorded at all (no review,
 * no contact, no statement or no outbound message / logged contact ever) reads
 * "Not recorded", never 0% — the work may simply be done outside the CRM.
 */

import { eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { aliveClient } from "@/lib/metrics/scope";
import { servicePromises, type ServicePromiseItems } from "@/db/schema";
import { DEFAULT_SERVICE_PROMISES, SERVICE_TIERS, type ServiceTier } from "./catalog";

/* ───────────────────────────── vocabulary ───────────────────────────── */

export type PromiseItemKey = "review" | "call" | "statement" | "birthday" | "query";
export const PROMISE_ITEM_KEYS: PromiseItemKey[] = ["review", "call", "statement", "birthday", "query"];
export const PROMISE_ITEM_LABEL: Record<PromiseItemKey, string> = {
  review: "Portfolio review",
  call: "Call",
  statement: "Statement",
  birthday: "Birthday wish",
  query: "Query answered in time",
};

/** A tier's promise with every item resolved: a number / true = promised, null / false = not promised. */
export type ResolvedPromise = {
  reviewEveryDays: number | null;
  callEveryDays: number | null;
  statementEveryDays: number | null;
  birthdayWish: boolean;
  querySlaHours: number | null;
};

/** Window the query SLA looks back over. */
export const QUERY_WINDOW_DAYS = 90;

/* ──────────────────────────── pure helpers ──────────────────────────── */

/**
 * The stored items over the defaults. A key the firm never set (undefined)
 * takes the default; a key set to null (or birthdayWish false) is "not
 * promised" and stays so.
 */
export function mergePromise(defaults: ResolvedPromise, stored: ServicePromiseItems | null | undefined): ResolvedPromise {
  const s = stored ?? {};
  const pick = (k: "reviewEveryDays" | "callEveryDays" | "statementEveryDays" | "querySlaHours"): number | null => {
    if (!(k in s) || s[k] === undefined) return defaults[k];
    const v = s[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  };
  return {
    reviewEveryDays: pick("reviewEveryDays"),
    callEveryDays: pick("callEveryDays"),
    statementEveryDays: pick("statementEveryDays"),
    birthdayWish: typeof s.birthdayWish === "boolean" ? s.birthdayWish : defaults.birthdayWish,
    querySlaHours: pick("querySlaHours"),
  };
}

/**
 * Was a recurring item kept? null when the item is not promised (no cadence).
 * A client with no record of it at all (daysSince null) did not get it.
 */
export function isKept(daysSince: number | null | undefined, everyDays: number | null | undefined): boolean | null {
  if (everyDays == null || everyDays <= 0) return null;
  if (daysSince == null) return false;
  return daysSince <= everyDays;
}

/** kept ÷ eligible as a percentage (one decimal), or null when nobody was eligible. */
export function keptPct(kept: number, eligible: number): number | null {
  if (!eligible || eligible <= 0) return null;
  return Math.round((kept / eligible) * 1000) / 10;
}

const EVERY: Record<number, string> = {
  1: "every day", 7: "every week", 14: "every two weeks", 30: "every month", 31: "every month",
  60: "every two months", 90: "every quarter", 91: "every quarter", 180: "every six months",
  182: "every six months", 183: "every six months", 365: "every year", 366: "every year",
};
export function everyPhrase(days: number): string {
  return EVERY[days] ?? `every ${days} days`;
}

/** The promise in plain words: "Every A client: a portfolio review every quarter, …". */
export function describePromise(tier: string, p: ResolvedPromise): string {
  const parts: string[] = [];
  if (p.reviewEveryDays) parts.push(`a portfolio review ${everyPhrase(p.reviewEveryDays)}`);
  if (p.callEveryDays) parts.push(`a call ${everyPhrase(p.callEveryDays)}`);
  if (p.statementEveryDays) parts.push(`a statement ${everyPhrase(p.statementEveryDays)}`);
  if (p.birthdayWish) parts.push("a birthday wish");
  if (p.querySlaHours) parts.push(`every query answered within ${p.querySlaHours} hours`);
  if (!parts.length) return `Every ${tier} client: nothing promised yet.`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Every ${tier} client: ${list}.`;
}

/** What the CRM can say about one client, before the promise is applied. */
export type ClientFacts = {
  reviewDays: number | null;
  contactDays: number | null;
  statementDays: number | null;
  /** Days since the last birthday, null when it does not apply (no date of birth, or before they were a client). */
  birthdayDays: number | null;
  birthdayWished: boolean;
  /** Service requests in the window whose SLA can be judged (resolved, or open past the SLA). */
  queriesJudged: number;
  queriesLate: number;
};

/** Which items the firm records at all. An unrecorded item is never a 0%. */
export type Recorded = Record<PromiseItemKey, boolean>;

/**
 * Each item for one client: true kept, false missed, null not applicable
 * (not promised, not recorded, no birthday on file, no request to judge).
 */
export function clientFlags(f: ClientFacts, p: ResolvedPromise, rec: Recorded): Record<PromiseItemKey, boolean | null> {
  return {
    review: rec.review ? isKept(f.reviewDays, p.reviewEveryDays) : null,
    call: rec.call ? isKept(f.contactDays, p.callEveryDays) : null,
    statement: rec.statement ? isKept(f.statementDays, p.statementEveryDays) : null,
    birthday: rec.birthday && p.birthdayWish && f.birthdayDays != null ? f.birthdayWished : null,
    query: rec.query && p.querySlaHours && f.queriesJudged > 0 ? f.queriesLate === 0 : null,
  };
}

/** Kept every applicable item; null when no item could be judged for this client. */
export function keptAll(flags: Record<PromiseItemKey, boolean | null>): boolean | null {
  const vals = PROMISE_ITEM_KEYS.map((k) => flags[k]).filter((v): v is boolean => v != null);
  if (!vals.length) return null;
  return vals.every(Boolean);
}

export type ItemState = "measured" | "not_promised" | "not_recorded" | "none_due";

export type ItemResult = {
  key: PromiseItemKey;
  state: ItemState;
  eligible: number;
  kept: number;
  pct: number | null;
};

export type PromiseTally = {
  clients: number;
  /** Clients for whom at least one item could be judged. */
  judged: number;
  keptAll: number;
  /** keptAll ÷ clients; null when nothing could be judged. */
  keptPct: number | null;
  items: ItemResult[];
};

function itemPromised(key: PromiseItemKey, p: ResolvedPromise): boolean {
  switch (key) {
    case "review": return !!p.reviewEveryDays;
    case "call": return !!p.callEveryDays;
    case "statement": return !!p.statementEveryDays;
    case "birthday": return p.birthdayWish;
    case "query": return !!p.querySlaHours;
  }
}

/**
 * Tallies clients (each judged on its OWN tier's promise) into the overall and
 * per-item figures. `promised` says whether any of these clients' tiers
 * promise the item (a mixed-tier RM row promises an item if any tier does).
 */
export function tally(
  rows: Array<{ flags: Record<PromiseItemKey, boolean | null>; promise: ResolvedPromise }>,
  rec: Recorded,
  /** The promise to read "promised" from when there are no rows (an empty tier). */
  fallback?: ResolvedPromise,
): PromiseTally {
  let judged = 0;
  let all = 0;
  const items: ItemResult[] = PROMISE_ITEM_KEYS.map((key) => {
    let eligible = 0;
    let kept = 0;
    let promised = rows.length === 0 && fallback ? itemPromised(key, fallback) : false;
    for (const r of rows) {
      if (itemPromised(key, r.promise)) promised = true;
      const v = r.flags[key];
      if (v == null) continue;
      eligible++;
      if (v) kept++;
    }
    const state: ItemState = !promised ? "not_promised"
      : !rec[key] ? "not_recorded"
      : eligible === 0 ? "none_due"
      : "measured";
    return { key, state, eligible, kept, pct: state === "measured" ? keptPct(kept, eligible) : null };
  });
  for (const r of rows) {
    const k = keptAll(r.flags);
    if (k == null) continue;
    judged++;
    if (k) all++;
  }
  return { clients: rows.length, judged, keptAll: all, keptPct: judged ? keptPct(all, rows.length) : null, items };
}

/** The measured item with the lowest %, or null. */
export function worstItem(items: ItemResult[]): ItemResult | null {
  let worst: ItemResult | null = null;
  for (const it of items) {
    if (it.state !== "measured" || it.pct == null) continue;
    if (!worst || it.pct < (worst.pct ?? Infinity)) worst = it;
  }
  return worst;
}

/** Why an item has no figure, in the page's words. */
export function itemStateNote(state: ItemState, key: PromiseItemKey): string | null {
  if (state === "not_promised") return "Not promised";
  if (state === "not_recorded") {
    if (key === "statement") return "Not recorded — no statement has been sent through the CRM";
    if (key === "birthday") return "Not recorded — no outbound message or logged contact this year";
    if (key === "review") return "Not recorded — no review has been recorded in the CRM";
    if (key === "call") return "Not recorded — no client contact has been logged";
    return "Not recorded";
  }
  if (state === "none_due") {
    if (key === "query") return `No requests to judge in the last ${QUERY_WINDOW_DAYS} days`;
    if (key === "birthday") return "No birthday on record";
    return "No client to judge";
  }
  return null;
}

/* ──────────────────────────── loaders ──────────────────────────── */

export type PromiseMap = Record<ServiceTier, ResolvedPromise>;

/** The firm's promise per tier: stored rows over DEFAULT_SERVICE_PROMISES. */
export async function loadPromises(tx: Tx, tenantId: string): Promise<{ promises: PromiseMap; stored: Set<ServiceTier>; updatedAt: Partial<Record<ServiceTier, string>> }> {
  const rows = await tx
    .select({ tier: servicePromises.tier, items: servicePromises.items, updatedAt: servicePromises.updatedAt })
    .from(servicePromises)
    .where(eq(servicePromises.tenantId, tenantId));
  const byTier = new Map(rows.map((r) => [r.tier, r]));
  const promises = {} as PromiseMap;
  const stored = new Set<ServiceTier>();
  const updatedAt: Partial<Record<ServiceTier, string>> = {};
  for (const t of SERVICE_TIERS) {
    const row = byTier.get(t);
    if (row) {
      stored.add(t);
      updatedAt[t] = row.updatedAt.toISOString();
    }
    promises[t] = mergePromise(DEFAULT_SERVICE_PROMISES[t], row?.items);
  }
  return { promises, stored, updatedAt };
}

const TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const OK_SENT = sql`('sent', 'delivered', 'read', 'replied')`;

type FactRow = {
  id: string;
  name: string;
  rm_id: string | null;
  rm_name: string | null;
  tier: ServiceTier;
  review_days: number | null;
  contact_days: number | null;
  statement_days: number | null;
  birthday_days: number | null;
  birthday_wished: boolean | null;
  q_judged: number | null;
  q_late: number | null;
};

export type ScopeOpts = { rmId?: string | null; branchId?: string | null; tier?: ServiceTier | null };

/** "none" = clients with no RM. */
function scopeSql(tenantId: string, o: ScopeOpts): SQL {
  const parts: SQL[] = [
    sql`i.tenant_id = ${tenantId}::uuid`,
    aliveClient("i"),
    sql`i.service_tier IN ('A', 'B', 'C')`,
  ];
  if (o.rmId === "none") parts.push(sql`i.rm_id IS NULL`);
  else if (o.rmId) parts.push(sql`i.rm_id = ${o.rmId}::uuid`);
  if (o.branchId) parts.push(sql`i.branch_id = ${o.branchId}::uuid`);
  if (o.tier) parts.push(sql`i.service_tier = ${o.tier}`);
  return sql.join(parts, sql` AND `);
}

/**
 * One row per tiered live client in scope with the facts every item needs.
 * Each lateral is an index probe on (tenant_id, investor_id …).
 */
async function loadFacts(tx: Tx, tenantId: string, promises: PromiseMap, o: ScopeOpts): Promise<FactRow[]> {
  const slaA = promises.A.querySlaHours ?? 0;
  const slaB = promises.B.querySlaHours ?? 0;
  const slaC = promises.C.querySlaHours ?? 0;
  // This year's birthday, or last year's when this year's has not yet passed
  // (date + interval keeps 29 Feb on 28 Feb in a common year).
  const thisYear = sql`(c.dob + make_interval(years => (extract(year from ${TODAY}) - extract(year from c.dob))::int))::date`;
  const lastBday = sql`CASE WHEN ${thisYear} >= ${TODAY} THEN (${thisYear} - interval '1 year')::date ELSE ${thisYear} END`;
  const res = await tx.execute(sql`
    WITH c AS (
      SELECT i.id, i.name, i.rm_id, i.service_tier AS tier, i.dob,
             COALESCE(i.onboarded_at, i.created_at) AS since,
             i.last_review_at, i.last_contact_at, i.last_statement_sent_at
        FROM investors i
       WHERE ${scopeSql(tenantId, o)}
    ),
    b AS (
      SELECT c.*, CASE WHEN c.dob IS NULL THEN NULL ELSE ${lastBday} END AS bday,
             (CASE c.tier WHEN 'A' THEN ${slaA}::int WHEN 'B' THEN ${slaB}::int ELSE ${slaC}::int END) AS sla_h
        FROM c
    )
    SELECT b.id, b.name, b.rm_id, u.name AS rm_name, b.tier,
           floor(extract(epoch FROM now() - b.last_review_at) / 86400)::int AS review_days,
           floor(extract(epoch FROM now() - b.last_contact_at) / 86400)::int AS contact_days,
           floor(extract(epoch FROM now() - GREATEST(b.last_statement_sent_at, st.last_at)) / 86400)::int AS statement_days,
           CASE WHEN b.bday IS NOT NULL AND b.bday >= (b.since AT TIME ZONE 'Asia/Kolkata')::date
                THEN (${TODAY} - b.bday) END AS birthday_days,
           CASE WHEN b.bday IS NULL THEN NULL ELSE (
             EXISTS (SELECT 1 FROM communications cm
                      WHERE cm.tenant_id = ${tenantId}::uuid AND cm.investor_id = b.id AND cm.direction = 'outbound'
                        AND cm.status IN ${OK_SENT}
                        AND cm.created_at >= (b.bday - 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
                        AND cm.created_at < (b.bday + 2)::timestamp AT TIME ZONE 'Asia/Kolkata')
             OR EXISTS (SELECT 1 FROM activities a
                         WHERE a.tenant_id = ${tenantId}::uuid AND a.subject_type = 'investor' AND a.subject_id = b.id
                           AND a.occurred_at >= (b.bday - 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
                           AND a.occurred_at < (b.bday + 2)::timestamp AT TIME ZONE 'Asia/Kolkata')
           ) END AS birthday_wished,
           q.judged AS q_judged, q.late AS q_late
      FROM b
      LEFT JOIN users u ON u.id = b.rm_id
      LEFT JOIN LATERAL (
        SELECT MAX(COALESCE(cm.sent_at, cm.created_at)) AS last_at
          FROM communications cm
         WHERE cm.tenant_id = ${tenantId}::uuid AND cm.investor_id = b.id AND cm.direction = 'outbound'
           AND cm.payload->>'kind' = 'valuation_statement' AND cm.status IN ${OK_SENT}
      ) st ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE x.done_at IS NOT NULL OR now() > x.created_at + make_interval(hours => b.sla_h))::int AS judged,
               COUNT(*) FILTER (WHERE COALESCE(x.done_at, now()) > x.created_at + make_interval(hours => b.sla_h))::int AS late
          FROM (
            SELECT sr.created_at, COALESCE(sr.resolved_at, CASE WHEN sr.status = 'closed' THEN sr.updated_at END) AS done_at
              FROM service_requests sr
             WHERE sr.tenant_id = ${tenantId}::uuid AND sr.investor_id = b.id AND b.sla_h > 0
               AND sr.type <> 'complaint'
               AND sr.created_at >= now() - make_interval(days => ${QUERY_WINDOW_DAYS}::int)
          ) x
      ) q ON TRUE
  `);
  return res.rows as FactRow[];
}

/** Which items the firm has ever recorded (tenant-wide, cheap EXISTS probes). */
async function loadRecorded(tx: Tx, tenantId: string): Promise<Recorded> {
  const r = (await tx.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM investors WHERE tenant_id = ${tenantId}::uuid AND last_review_at IS NOT NULL) AS review,
      EXISTS (SELECT 1 FROM investors WHERE tenant_id = ${tenantId}::uuid AND last_contact_at IS NOT NULL) AS call,
      (EXISTS (SELECT 1 FROM investors WHERE tenant_id = ${tenantId}::uuid AND last_statement_sent_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM communications WHERE tenant_id = ${tenantId}::uuid AND direction = 'outbound'
                    AND payload->>'kind' = 'valuation_statement')) AS statement,
      (EXISTS (SELECT 1 FROM communications WHERE tenant_id = ${tenantId}::uuid AND direction = 'outbound'
                AND created_at >= now() - interval '366 days' AND status IN ${OK_SENT})
        OR EXISTS (SELECT 1 FROM activities WHERE tenant_id = ${tenantId}::uuid AND occurred_at >= now() - interval '366 days')) AS birthday
  `)).rows[0] as Partial<Record<PromiseItemKey, boolean>> | undefined;
  return {
    review: !!r?.review,
    call: !!r?.call,
    statement: !!r?.statement,
    birthday: !!r?.birthday,
    // Service requests are the CRM's own register: no request is a fact, not a gap.
    query: true,
  };
}

function factsOf(r: FactRow): ClientFacts {
  return {
    reviewDays: r.review_days == null ? null : Number(r.review_days),
    contactDays: r.contact_days == null ? null : Number(r.contact_days),
    statementDays: r.statement_days == null ? null : Number(r.statement_days),
    birthdayDays: r.birthday_days == null ? null : Number(r.birthday_days),
    birthdayWished: !!r.birthday_wished,
    queriesJudged: Number(r.q_judged ?? 0),
    queriesLate: Number(r.q_late ?? 0),
  };
}

export type PromiseEvaluation = {
  promises: PromiseMap;
  recorded: Recorded;
  tiers: Array<{ tier: ServiceTier } & PromiseTally>;
  byRm: Array<{ rmId: string | null; rmName: string | null; worst: ItemResult | null } & PromiseTally>;
  /** Live clients in scope with no service tier — they have no promise. */
  untiered: number;
};

/** How well the promise is kept, per tier and per RM, over live tiered clients in scope. */
export async function evaluatePromise(
  tx: Tx, tenantId: string, opts: { rmId?: string | null; branchId?: string | null } = {},
): Promise<PromiseEvaluation> {
  const { promises } = await loadPromises(tx, tenantId);
  const recorded = await loadRecorded(tx, tenantId);
  const facts = await loadFacts(tx, tenantId, promises, opts);
  const untieredParts: SQL[] = [sql`i.tenant_id = ${tenantId}::uuid`, aliveClient("i"), sql`(i.service_tier IS NULL OR i.service_tier NOT IN ('A', 'B', 'C'))`];
  if (opts.rmId === "none") untieredParts.push(sql`i.rm_id IS NULL`);
  else if (opts.rmId) untieredParts.push(sql`i.rm_id = ${opts.rmId}::uuid`);
  if (opts.branchId) untieredParts.push(sql`i.branch_id = ${opts.branchId}::uuid`);
  const u = (await tx.execute(sql`SELECT COUNT(*)::int AS n FROM investors i WHERE ${sql.join(untieredParts, sql` AND `)}`)).rows[0] as { n: number } | undefined;

  const judged = facts.map((r) => {
    const promise = promises[r.tier];
    return { row: r, promise, flags: clientFlags(factsOf(r), promise, recorded) };
  });

  const tiers = SERVICE_TIERS.map((tier) => ({ tier, ...tally(judged.filter((j) => j.row.tier === tier), recorded, promises[tier]) }));

  const rmGroups = new Map<string, typeof judged>();
  for (const j of judged) {
    const k = j.row.rm_id ?? "none";
    const arr = rmGroups.get(k);
    if (arr) arr.push(j);
    else rmGroups.set(k, [j]);
  }
  const byRm = [...rmGroups.entries()].map(([k, rows]) => {
    const t = tally(rows, recorded);
    return { rmId: k === "none" ? null : k, rmName: rows[0].row.rm_name, worst: worstItem(t.items), ...t };
  });
  byRm.sort((a, b) => (a.keptPct ?? 101) - (b.keptPct ?? 101) || b.clients - a.clients);

  return { promises, recorded, tiers, byRm, untiered: Number(u?.n ?? 0) };
}

export type PromiseGap = {
  id: string;
  name: string;
  rmId: string | null;
  rmName: string | null;
  tier: ServiceTier;
  /** The items this client missed. */
  missed: PromiseItemKey[];
  /** Days since the missed item last happened (null = never on record). */
  daysSince: number | null;
  detail: string;
};

function daysFor(key: PromiseItemKey, f: ClientFacts): number | null {
  switch (key) {
    case "review": return f.reviewDays;
    case "call": return f.contactDays;
    case "statement": return f.statementDays;
    case "birthday": return f.birthdayDays;
    case "query": return null;
  }
}

function gapDetail(key: PromiseItemKey, f: ClientFacts, p: ResolvedPromise): string {
  const since = (d: number | null, what: string, every: number | null) =>
    d == null ? `No ${what} on record` : `Last ${what} ${d} days ago (promise: ${everyPhrase(every ?? 0)})`;
  switch (key) {
    case "review": return since(f.reviewDays, "review", p.reviewEveryDays);
    case "call": return since(f.contactDays, "contact", p.callEveryDays);
    case "statement": return since(f.statementDays, "statement", p.statementEveryDays);
    case "birthday": return `Birthday ${f.birthdayDays} days ago — no message or logged contact around the day`;
    case "query": return `${f.queriesLate} of ${f.queriesJudged} requests resolved after ${p.querySlaHours} hours`;
  }
}

/**
 * The clients failing an item ("all" = failing any item), most overdue first.
 * Same facts and rules as evaluatePromise, so the list's length is the figure's gap.
 */
export async function promiseGaps(
  tx: Tx, tenantId: string,
  opts: { tier?: ServiceTier | null; item: PromiseItemKey | "all"; rmId?: string | null; branchId?: string | null; limit?: number },
): Promise<{ rows: PromiseGap[]; total: number }> {
  const { promises } = await loadPromises(tx, tenantId);
  const recorded = await loadRecorded(tx, tenantId);
  const facts = await loadFacts(tx, tenantId, promises, { tier: opts.tier, rmId: opts.rmId, branchId: opts.branchId });
  const out: PromiseGap[] = [];
  for (const r of facts) {
    const p = promises[r.tier];
    const f = factsOf(r);
    const flags = clientFlags(f, p, recorded);
    const missed = PROMISE_ITEM_KEYS.filter((k) => flags[k] === false && (opts.item === "all" || opts.item === k));
    if (!missed.length) continue;
    const lead = missed[0];
    out.push({
      id: r.id, name: r.name, rmId: r.rm_id, rmName: r.rm_name, tier: r.tier, missed,
      daysSince: daysFor(lead, f),
      detail: missed.map((k) => gapDetail(k, f, p)).join(" · "),
    });
  }
  // Never-on-record first, then the longest gap.
  out.sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity) || a.name.localeCompare(b.name));
  return { rows: out.slice(0, opts.limit ?? 200), total: out.length };
}
