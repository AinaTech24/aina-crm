/**
 * The shared frame every "book" loader works in. SERVER-ONLY.
 *
 * ── One set of queries, three books ─────────────────────────────────────────
 *
 * The Relationship Manager Dashboard and the Branch Head Dashboard ask the
 * same questions of different books — "what is the AUM", "which reviews are
 * overdue", "how many SIPs bounced". They run the SAME queries; only the
 * spine differs. A figure on the branch dashboard and the sum
 * of that figure across the branch's RMs therefore cannot disagree about what
 * the figure means, because there is only one definition of it.
 *
 *   rm      clients whose `investors.rm_id` is the user
 *   branch  clients whose `investors.branch_id` is the branch
 *           (optionally narrowed to one RM's clients within it)
 *
 * ── Client facts and staff facts ────────────────────────────────────────────
 *
 * The attribution rule — mixing the two silently double-counts:
 *
 *   CLIENT facts (AUM, SIP, flows, reviews, queries, new clients) go through
 *   the client spine — the branch that owns the relationship.
 *
 *   STAFF facts (meetings held, tasks, proposals written) go through the
 *   people: the user themselves, or everyone whose `users.branch_id` is the
 *   branch. An Ahmedabad RM meeting a Surat client adds the meeting to
 *   Ahmedabad and the client's AUM to Surat — the correct reading of both.
 *
 * Leads sit in between: a lead has no client record yet, so it belongs to the
 * branch it was captured in (`leads.branch_id`), falling back to its owner's
 * branch when that was never recorded.
 *
 * Insurance is scoped both ways on purpose, because both briefs ask for both:
 * premium BOOKED is `sold_by_user_id` for a person and `insurance_policies.
 * branch_id` for a branch ("business attributed to this RM / sourced from own
 * branch"), while the insurance relationship view is the book's CLIENTS'
 * policies whoever sold them. Different numbers, labelled differently.
 */

import { sql, type SQL } from "drizzle-orm";

/**
 * Client filters — narrow the CLIENT spine, and with it every client fact on
 * the page (book, AUM, flows, reviews, SIPs, queries, insurance, risk, data
 * quality, contact). Staff facts — the person's own tasks, meetings, leads and
 * proposals — are the person's work, not a slice of the book, and are not
 * filtered; the filter bar says so.
 *
 * Applied in ONE place (spine, below), so a new section inherits the filters
 * by using clientIds / clientsWhere / clientsWhereOn and cannot forget them.
 */
export type ClientFilter = {
  /** Client category letters; "none" is the uncategorised bucket. */
  categories?: string[];
  type?: "head" | "member" | "individual";
  /** "new" = added on or after `since` (the FY start); "existing" = before it. */
  cohort?: { kind: "new" | "existing"; since: string };
  activity?: "active" | "inactive";
  /** Matched case-insensitively against the address city. */
  city?: string;
  /** Source of the lead the client was converted from; "__none__" = no lead. */
  source?: string;
  familyId?: string;
};

export type BookScope =
  | { kind: "rm"; userId: string; filter?: ClientFilter }
  | {
      kind: "branch";
      branchId: string;
      /** Narrow the branch view to one RM's clients and work within it. */
      rmId?: string | null;
      filter?: ClientFilter;
    };

export type MyWindow = {
  /** Whose book. Never "all" — the firm-wide cockpit has its own loaders. */
  scope: BookScope;
  /**
   * The PEOPLE whose work counts as this book's staff facts, resolved once by
   * the page: [the user] for a personal book, everyone in the branch for a
   * branch book. Kept as ids rather than a subquery so the SAME list builds
   * both the SQL and the drill-down links (`?assignee=a,b,c`) — a list page
   * then shows exactly the rows the count was taken over.
   */
  staff: string[];
  /** "My" / "Branch" for tile labels ("My AUM", "Branch AUM"); null when a
   *  director is looking at someone else's book and neither word is true. */
  possessive: string | null;
  /** Selected period, yyyy-mm-dd inclusive. */
  from: string;
  to: string;
  /** Previous CORRESPONDING period — 1–22 Aug against 1–22 Sep, not all of August. */
  prevFrom: string;
  prevTo: string;
  /** 1 April of the running FY. */
  fyStart: string;
  /** 'YYYY-YY', the key targets are stored under. */
  fiscalYear: string;
  /** 0..1 through the FY — 50% of target in September is on pace. */
  fyPace: number;
  /** Today, local. Action-centre queries are "today", never "the period". */
  today: string;
};

/** Number, or 0. Postgres hands back numerics as strings. */
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Number, or null — for figures where absent and zero are different answers. */
export const numOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `alias.column`, with the alias reduced to identifier characters. */
function col(alias: string | undefined, column: string): SQL {
  const a = (alias ?? "").replace(/[^a-zA-Z0-9_]/g, "");
  return sql.raw(a ? `${a}.${column}` : column);
}

/**
 * The client spine predicate. `status <> 'closed'` and `merged_into_id IS NULL`
 * match what the firm pulse counts, so a figure here and the same figure on the
 * firm cockpit differ only by the book — which is the point of switching.
 */
function spine(scope: BookScope, alias?: string, records = false): SQL {
  // Live = lib/metrics aliveClient: not deleted, not merged, not closed
  // (`exited` is the legacy spelling of closed). A RECORD is any client not
  // deleted or merged, whatever its status.
  const alive = records
    ? sql`${col(alias, "deleted_at")} IS NULL
             AND ${col(alias, "merged_into_id")} IS NULL`
    : sql`${col(alias, "deleted_at")} IS NULL
             AND ${col(alias, "merged_into_id")} IS NULL
             AND ${col(alias, "status")} NOT IN ('closed', 'exited')`;
  const f = filterSql(scope.filter, alias);
  if (scope.kind === "rm") {
    return sql`${col(alias, "rm_id")} = ${scope.userId}::uuid AND ${alive}${f}`;
  }
  const oneRm = scope.rmId ? sql` AND ${col(alias, "rm_id")} = ${scope.rmId}::uuid` : sql``;
  return sql`${col(alias, "branch_id")} = ${scope.branchId}::uuid${oneRm} AND ${alive}${f}`;
}

/** The client filters as extra AND terms (empty when none is set). */
function filterSql(f: ClientFilter | undefined, alias?: string): SQL {
  if (!f) return sql``;
  const parts: SQL[] = [];
  const id = col(alias, "id");
  const cats = (f.categories ?? []).map((c) => c.toUpperCase());
  if (cats.length) {
    const named = cats.filter((c) => c !== "NONE");
    const terms: SQL[] = [];
    if (named.length) {
      terms.push(sql`upper(btrim(COALESCE(${col(alias, "client_category")}, ''))) IN (${sql.join(named.map((c) => sql`${c}`), sql`, `)})`);
    }
    if (named.length !== cats.length) {
      terms.push(sql`btrim(COALESCE(${col(alias, "client_category")}, '')) = ''`);
    }
    parts.push(sql`(${sql.join(terms, sql` OR `)})`);
  }
  // The id is compared OUTSIDE each subquery (`id IN (SELECT …)`), never
  // inside it: an unqualified `id` inside `SELECT … FROM families` binds to
  // families.id, and callers use this spine both with and without an alias.
  const heads = sql`(SELECT primary_investor_id FROM families WHERE primary_investor_id IS NOT NULL)`;
  if (f.type === "head") {
    parts.push(sql`${id} IN ${heads}`);
  } else if (f.type === "member") {
    parts.push(sql`(${col(alias, "family_id")} IS NOT NULL AND ${id} NOT IN ${heads})`);
  } else if (f.type === "individual") {
    parts.push(sql`${col(alias, "family_id")} IS NULL`);
  }
  if (f.cohort) {
    parts.push(f.cohort.kind === "new"
      ? sql`${col(alias, "created_at")} >= ${f.cohort.since}::date`
      : sql`${col(alias, "created_at")} < ${f.cohort.since}::date`);
  }
  if (f.activity === "active") parts.push(sql`${col(alias, "status")} = 'active'`);
  else if (f.activity === "inactive") parts.push(sql`${col(alias, "status")} <> 'active'`);
  if (f.city) {
    parts.push(sql`lower(btrim(COALESCE(${col(alias, "address")}->>'city', ''))) = lower(btrim(${f.city}))`);
  }
  if (f.source) {
    parts.push(f.source === "__none__"
      ? sql`${id} NOT IN (SELECT converted_investor_id FROM leads WHERE converted_investor_id IS NOT NULL)`
      : sql`${id} IN (SELECT converted_investor_id FROM leads
                       WHERE converted_investor_id IS NOT NULL AND source = ${f.source})`);
  }
  if (f.familyId) parts.push(sql`${col(alias, "family_id")} = ${f.familyId}::uuid`);
  return parts.length ? sql` AND ${sql.join(parts, sql` AND `)}` : sql``;
}

/** True when any client filter narrows the book. */
export function hasClientFilter(scope: BookScope): boolean {
  const f = scope.filter;
  return !!f && !!((f.categories?.length ?? 0) || f.type || f.cohort || f.activity || f.city || f.source || f.familyId);
}

/** The book's clients, as a subquery: `investor_id IN ${clientIds(scope)}`. */
export function clientIds(scope: BookScope): SQL {
  return sql`(SELECT id FROM investors WHERE ${spine(scope)})`;
}

/** The spine inline, for a query already selecting FROM investors. */
export function clientsWhere(scope: BookScope): SQL {
  return spine(scope);
}

/**
 * The spine against an aliased investors table. Needed the moment the query
 * joins anything else with a `status` or `rm_id` column — insurance_policies has
 * both, and Postgres rejects the ambiguity rather than guessing.
 */
export function clientsWhereOn(alias: string, scope: BookScope): SQL {
  return spine(scope, alias);
}

/**
 * The book's client RECORDS against an investors alias — status not
 * considered — for facts that stay true after a client leaves. New clients
 * use it: a client onboarded in April and closed in August was still won in
 * April (lib/metrics/new-clients.ts).
 */
export function clientRecordsWhereOn(alias: string, scope: BookScope): SQL {
  return spine(scope, alias, true);
}

/**
 * New clients: onboarded in the period by India date — the ONE definition
 * (lib/metrics/new-clients.ts), never created_at: an import creates hundreds
 * of records in an afternoon and none of them is a new client.
 */
export { onboardedDateSql, onboardedInSql } from "@/lib/metrics/new-clients";

/**
 * The client a task is about, as an expression over a `tasks` alias.
 *
 * A task carries two client links and many rows fill only one: the task form,
 * meeting follow-ups and SIP defence write `related_investor_id`; SIP
 * rejections, onboarding, documents and the harvest actions write the generic
 * `subject_type = 'investor'` / `subject_id` pair. Reading one column alone
 * silently detaches every task the other paths raised — a rejection
 * follow-up then reads "no client linked" and a redemption looks unfollowed.
 */
export function taskInvestor(alias: string): SQL {
  const a = col(alias, "related_investor_id");
  return sql`COALESCE(${a}, CASE WHEN ${col(alias, "subject_type")} = 'investor' THEN ${col(alias, "subject_id")} END)`;
}

/** The lead a task is about — the same two links, for leads. */
export function taskLead(alias: string): SQL {
  const a = col(alias, "related_lead_id");
  return sql`COALESCE(${a}, CASE WHEN ${col(alias, "subject_type")} = 'lead' THEN ${col(alias, "subject_id")} END)`;
}

/**
 * "This task is about that client", written as an OR of the two links so the
 * index on each column can serve it — the COALESCE form above cannot use
 * either, which matters inside a correlated subquery run once per client.
 */
export function taskIsAbout(alias: string, investor: SQL): SQL {
  return sql`(${col(alias, "related_investor_id")} = ${investor}
              OR (${col(alias, "subject_type")} = 'investor' AND ${col(alias, "subject_id")} = ${investor}))`;
}

/** `column` belongs to one of the book's people. */
export function staffMatch(column: string, w: MyWindow, alias?: string): SQL {
  const c = col(alias, column);
  if (w.staff.length === 0) return sql`FALSE`;
  if (w.staff.length === 1) return sql`${c} = ${w.staff[0]}::uuid`;
  return sql`${c} IN (${sql.join(w.staff.map((id) => sql`${id}::uuid`), sql`, `)})`;
}

/**
 * Leads that belong to the book. A person's leads are the ones they own. A
 * branch's leads are the ones captured in it, plus — where the capture branch
 * was never recorded — the ones its people own.
 */
export function leadsMatch(w: MyWindow, alias?: string): SQL {
  const s = w.scope;
  if (s.kind === "rm") return sql`${col(alias, "owner_id")} = ${s.userId}::uuid`;
  if (s.rmId) return sql`${col(alias, "owner_id")} = ${s.rmId}::uuid`;
  return sql`(${col(alias, "branch_id")} = ${s.branchId}::uuid
              OR (${col(alias, "branch_id")} IS NULL AND ${staffMatch("owner_id", w, alias)}))`;
}

/** Insurance premium BOOKED by the book — see the header for why this differs
 *  from "the book's clients' policies". */
export function premiumMatch(w: MyWindow, alias?: string): SQL {
  const s = w.scope;
  if (s.kind === "rm") return sql`${col(alias, "sold_by_user_id")} = ${s.userId}::uuid`;
  const oneRm = s.rmId ? sql` AND ${col(alias, "sold_by_user_id")} = ${s.rmId}::uuid` : sql``;
  return sql`${col(alias, "branch_id")} = ${s.branchId}::uuid${oneRm}`;
}

/** The single person a book belongs to, when it belongs to one. */
export function bookPerson(scope: BookScope): string | null {
  return scope.kind === "rm" ? scope.userId : scope.rmId ?? null;
}

/**
 * Recorded balance history for the book — see migrations 0217 (rm_snapshots)
 * and 0218 (branch_snapshots). A person's history, or one RM inside a branch,
 * reads the RM rows; a whole branch reads the branch rows. Returns the FROM
 * clause with its predicate, e.g. `rm_snapshots WHERE rm_id = …`.
 */
export function snapshotSource(scope: BookScope): SQL {
  const person = bookPerson(scope);
  if (person) return sql`rm_snapshots WHERE rm_id = ${person}::uuid`;
  return sql`branch_snapshots WHERE branch_id = ${(scope as { branchId: string }).branchId}::uuid`;
}

/* ─────────────────────────────── targets ─────────────────────────────── */

/**
 * The metrics a dashboard can hold a book to, under ONE name each.
 *
 * Targets are stored in two tables with two vocabularies — per person in
 * `kra_targets` (the Team Scorecard's keys), per branch in `annual_targets`
 * (the branch-target settings' keys). The first version of the personal
 * cockpit read the one money target a person had (`mf_business`) and held the
 * SIP book, net new SIP AND net business against it — three different actuals
 * scored against one number. Each metric now maps to its own key, and a metric
 * with no key in a table simply has no target there ("Not set").
 */
export type TargetKey =
  | "aum" | "sip_book" | "net_sip" | "net_business"
  | "new_clients" | "meetings" | "reviews" | "insurance";

const PERSON_KEY: Record<TargetKey, string> = {
  aum: "aum",
  sip_book: "sip_book",
  net_sip: "net_sip",
  net_business: "mf_business",
  new_clients: "new_clients",
  meetings: "meetings",
  reviews: "reviews",
  insurance: "insurance_business",
};

const BRANCH_KEY: Record<TargetKey, string> = {
  aum: "aum",
  // The stored key predates the label: branch-target settings call it
  // "SIP book" and the director's scoreboard compares it with the SIP book.
  sip_book: "sip_book_addition",
  net_sip: "net_sip",
  net_business: "net_business",
  new_clients: "new_clients",
  meetings: "meetings",
  reviews: "reviews",
  insurance: "insurance_business",
};

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

/** FY targets for the book. `null` = not set — never a target of zero. */
export async function loadBookTargets(
  tx: Tx, w: MyWindow,
): Promise<(key: TargetKey) => number | null> {
  const person = bookPerson(w.scope);
  const values = new Map<string, number>();
  if (person) {
    const rows = (await tx.execute(sql`
      SELECT metric_key, annual_target::numeric AS v FROM kra_targets
       WHERE user_id = ${person}::uuid AND fiscal_year = ${w.fiscalYear}
    `)).rows as Array<{ metric_key: string; v: string }>;
    for (const r of rows) values.set(r.metric_key, num(r.v));
    return (key) => {
      const v = values.get(PERSON_KEY[key]);
      return v && v > 0 ? v : null;
    };
  }
  const branchId = (w.scope as { branchId: string }).branchId;
  const rows = (await tx.execute(sql`
    SELECT metric_key, target_value::numeric AS v FROM annual_targets
     WHERE scope_type = 'branch' AND scope_id = ${branchId}::uuid
       AND fiscal_year = ${w.fiscalYear}
  `)).rows as Array<{ metric_key: string; v: string }>;
  for (const r of rows) values.set(r.metric_key, num(r.v));
  return (key) => {
    const v = values.get(BRANCH_KEY[key]);
    return v && v > 0 ? v : null;
  };
}

/**
 * Drill-down params that narrow a list page to this book's people, using
 * filters those pages already read (grep them for `sp.<param>` before adding
 * one): tasks `assignee=`, meetings `rm=`, leads `owner=` — all comma lists of
 * user ids.
 */
export function staffParam(w: MyWindow): string {
  return w.staff.join(",");
}

/**
 * The query string that opens a CLIENT list on exactly this book, so a count
 * and the list behind it are taken over the same rows: `mine=1` for a person,
 * `branch=<id>` (plus `rm=<id>` when narrowed to one RM) for a branch. Both
 * are params the investors list reads (src/lib/investors/list-filters.ts).
 * A filter only ever NARROWS — the viewer's own access scope still applies on
 * top, so a link can never show more than the viewer may see.
 */
export function clientListQs(scope: BookScope): string {
  if (scope.kind === "rm") return "mine=1";
  return scope.rmId ? `branch=${scope.branchId}&rm=${scope.rmId}` : `branch=${scope.branchId}`;
}

/** `/dashboard/investors?<this book>[&extra]`. */
export function clientsHref(scope: BookScope, extra?: string): string {
  return `/dashboard/investors?${clientListQs(scope)}${extra ? `&${extra}` : ""}`;
}

/** The LEADS list on this book — the leads page reads `mine`, `owner` and `branch`. */
export function leadsHref(scope: BookScope, extra?: string): string {
  const qs = scope.kind === "rm" ? "mine=1" : scope.rmId ? `owner=${scope.rmId}` : `branch=${scope.branchId}`;
  return `/dashboard/leads?${qs}${extra ? `&${extra}` : ""}`;
}

export type Delta = {
  abs: number;
  /** Fraction, e.g. -0.0053. Null when the base was 0 — not "-100%". */
  pct: number | null;
} | null;

export function delta(current: number, previous: number | null | undefined): Delta {
  if (previous == null || !Number.isFinite(previous)) return null;
  const abs = current - previous;
  return { abs, pct: previous === 0 ? null : abs / previous };
}

/**
 * Constant lists as a literal IN clause. Safe because the inputs are
 * module-level constants, never user input — the quote strip is belt and
 * braces, not the defence.
 */
export const asInList = (xs: readonly string[]) =>
  sql.raw(xs.map((x) => `'${x.replace(/'/g, "")}'`).join(", "));

/**
 * Gross investment excludes SWITCH and STP. The RTA parser collapses both legs
 * of a switch into one row and reads direction off it, so every leg arrives as
 * an inflow — on one production book that was ₹39.56 Cr of "fresh investment"
 * that was the same money moving between schemes. See GROSS_TYPES in
 * src/lib/metrics/business.ts, the one definition.
 */
export { GROSS_TYPES, REDEMPTION_TYPES } from "@/lib/metrics/business";

/**
 * A SIP STOP is the RTA's own stop or pause event in the ledger, dated by its
 * `order_date` — the same definition the firm pulse and the director's branch
 * and RM scoreboards use, so a stop counts identically on all three dashboards.
 *
 * The first version of the personal cockpit read the SIP register instead:
 * `status = 'stopped'` with `updated_at` inside the period. `updated_at` moves
 * on ANY edit, so a SIP stopped last year whose remarks were tidied this month
 * counted as stopped this month — and a `rejected` mandate (a bounced debit,
 * which has its own exception queue) counted as a stop as well.
 *
 * The trade-off, stated once: a feed that never carries stop events shows no
 * stops. The register's stopped SIPs are still listed on the SIPs page.
 */
export { SIP_STOP_TYPES } from "@/lib/metrics/business";

/**
 * Service-request statuses, split by WHO the ball is with.
 *
 * `escalated` was missing from the firm-wide query's open set, which quietly
 * dropped the most urgent tickets out of the open count. `waiting_customer` is
 * genuinely open but not on us, so it is counted separately rather than folded
 * into either side — an RM chasing their own queue should not be charged for
 * the three days a client took to send a PAN copy.
 */
export { SR_OPEN_ON_US, SR_WAITING_CLIENT, SR_CLOSED } from "@/lib/metrics/service";

/** Task statuses that still need doing. `done` is not one of them — see below. */
export { TASK_OPEN } from "@/lib/metrics/tasks";
/** The completed value is `completed`. There is no `done`; filtering on it
 *  silently counts every finished task as still open. */
export { TASK_DEAD } from "@/lib/metrics/tasks";

/** Meeting statuses that mean the meeting still lies ahead. */
export const MEETING_UPCOMING = ["scheduled", "confirmed"] as const;

/**
 * FINANCIAL task types — the ones where money actually moves.
 *
 * The brief asks for tasks split financial / non-financial, which in an Indian
 * MFD office is a real operational distinction with its own SLAs: a financial
 * transaction hits the RTA and the client's money, a non-financial one (NFT)
 * changes a record — bank, nominee, address, KYC, contact details.
 *
 * `tasks.department` cannot carry this. It says WHO does the work, not WHAT
 * the work is, so a nominee update and a redemption both sit under
 * `back_office`. `tasks.type` is the column that knows, so the split is a
 * list of types and everything not on it is non-financial. Listing the
 * financial side rather than the other way round is deliberate: a new type
 * nobody has classified should default to the side with the gentler SLA, not
 * be quietly promoted into the money queue.
 */
export const FINANCIAL_TASK_TYPES = [
  "sip_retry", "sip_registration", "sip_stop", "mandate_renewal", "mandate_create",
  "transaction", "purchase", "lumpsum", "redemption", "switch", "stp", "swp",
] as const;

/**
 * Lead stages that mean the lead is FINISHED — won or lost — and so must not
 * appear in any open queue.
 *
 * `converted_investor_id IS NOT NULL` is the cleanest signal, but it is not the
 * only one: a lead can be moved to a won stage by hand without the conversion
 * ever being wired to an investor record. Checking only the id put a lead the
 * funnel was counting as "Client onboarded" back into "Follow-ups due" and into
 * the stale-lead queue on the same screen — the same row reported as both
 * finished and neglected.
 */
export const LEAD_WON_STAGES = ["converted", "won_lead", "transaction_successful"] as const;
export const LEAD_DEAD_STAGES = [
  "lost", "not_interested", "not_qualified", "cold",
  "mandate_reject", "mandate_rejected", "transaction_failed",
] as const;
export const LEAD_CLOSED_STAGES = [...LEAD_WON_STAGES, ...LEAD_DEAD_STAGES] as const;

/**
 * Proposal statuses. `converted` does not exist — a proposal the client took is
 * `accepted`, `partially_approved` or `executed`. Inventing the value costs a
 * silent zero on every conversion figure.
 */
export const PROPOSAL_WON = ["accepted", "partially_approved", "executed"] as const;
// `changes_requested` is open work — the client answered "change it" and the
// RM owes them a revised version. `superseded` is in none of these sets: it is
// an older version of a proposal that is counted through its latest version.
export const PROPOSAL_LIVE = ["sent", "viewed", "ready", "changes_requested"] as const;
export const PROPOSAL_LOST = ["rejected", "expired"] as const;

/**
 * A numeric cast that survives junk. Several money-ish columns are TEXT in
 * this schema (`leads.intended_amount`, `leads.aum_potential`) because they
 * arrive from imports and web forms, so a plain `::numeric` throws on the one
 * row somebody typed "5 lakh" into and takes the whole dashboard with it.
 */
export function safeNumeric(expr: SQL): SQL {
  return sql`NULLIF(regexp_replace(${expr}::text, '[^0-9.\-]', '', 'g'), '')::numeric`;
}
