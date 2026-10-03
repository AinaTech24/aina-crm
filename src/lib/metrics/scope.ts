/**
 * Who a metric is about. Every function in lib/metrics takes one of these, so
 * the dashboard, the module pages, the sidebar badges and the reports all
 * count the SAME clients for the same viewer.
 *
 * `tenantId` is always explicit. Local development connects as a Postgres
 * superuser, which bypasses row-level security, so a query without a tenant
 * predicate silently counts every firm in the database.
 *
 * The restriction (rmIds / branchIds) is the viewer's record access decided
 * by the caller (an RM sees their own clients, a branch head their branch);
 * the dashboard filter bar can only narrow it further, never widen it.
 *
 * ── Client facts and staff facts ────────────────────────────────────────────
 *
 * The same rule as lib/dashboard/my/window.ts, so a figure here and the same
 * figure on the RM desk or the branch view cannot disagree:
 *
 *   CLIENT facts (AUM, SIP book, flows, new clients, health, service
 *   requests, risk profiles) follow the client: `investors.rm_id` and
 *   `investors.branch_id`.
 *
 *   STAFF facts (tasks, leads) follow the person: the assignee or owner, and
 *   for a branch, everyone whose `users.branch_id` is that branch.
 */

import { sql, type SQL } from "drizzle-orm";
import { expandLeadSources } from "@/lib/leads/sources";

export type MetricScope = {
  tenantId: string;
  /** Clients whose RM is one of these; work assigned to / owned by one of these. */
  rmIds?: string[];
  /** Clients in one of these branches; work of people in one of these branches. */
  branchIds?: string[];
  /** Client segment (investors.segment_tag). */
  segments?: string[];
  /** Client category A–D (investors.client_category); "none" = uncategorised. */
  categories?: string[];
  /** Family ids. */
  familyIds?: string[];
  /** Client tags (investors.tags, any of). */
  tags?: string[];
  /** AMC names — narrows SIPs, holdings and transactions, not the client list. */
  amcs?: string[];
  /** Lead source — narrows leads, and clients to those converted from such a lead. */
  leadSources?: string[];
};

/** A metric's period: inclusive India calendar dates, yyyy-mm-dd. */
export type MetricPeriod = { from: string; to: string };

/** `alias.column`, alias reduced to identifier characters. */
export function col(alias: string, column: string): SQL {
  const a = alias.replace(/[^a-zA-Z0-9_]/g, "");
  return sql.raw(a ? `${a}.${column}` : column);
}

export const uuidList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
export const textList = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** Only well-formed uuids — a hand-edited URL must narrow, never 500. */
export const cleanIds = (ids: string[] | undefined): string[] =>
  (ids ?? []).filter((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));

/**
 * A LIVE client: not deleted, not merged into another record, not closed.
 * The one definition of "a client we still serve" — the base of AUM, SIP
 * book, client counts, health and every per-RM figure. `exited` is the legacy
 * spelling of `closed` (see the investors schema) and is excluded with it.
 */
export function aliveClient(alias = "i"): SQL {
  return sql`${col(alias, "deleted_at")} IS NULL AND ${col(alias, "merged_into_id")} IS NULL AND ${col(alias, "status")} NOT IN ('closed', 'exited')`;
}

/** The client filters (segment, category, family, tags, lead source) on an investors alias. */
function clientFilterParts(scope: MetricScope, alias: string): SQL[] {
  const parts: SQL[] = [];
  if (scope.segments?.length) parts.push(sql`${col(alias, "segment_tag")} IN (${textList(scope.segments)})`);
  if (scope.categories?.length) {
    const named = scope.categories.filter((c) => c !== "none").map((c) => c.toUpperCase());
    const none = scope.categories.includes("none");
    const catCol = sql`upper(btrim(COALESCE(${col(alias, "client_category")}, '')))`;
    const terms: SQL[] = [];
    if (named.length) terms.push(sql`${catCol} IN (${textList(named)})`);
    if (none) terms.push(sql`${catCol} = ''`);
    if (terms.length) parts.push(sql`(${sql.join(terms, sql` OR `)})`);
  }
  const fams = cleanIds(scope.familyIds);
  if (fams.length) parts.push(sql`${col(alias, "family_id")} IN (${uuidList(fams)})`);
  if (scope.tags?.length) {
    parts.push(sql`COALESCE(${col(alias, "tags")}, '[]'::jsonb) ?| ARRAY[${textList(scope.tags)}]::text[]`);
  }
  if (scope.leadSources?.length) {
    parts.push(sql`${col(alias, "id")} IN (SELECT converted_investor_id FROM leads
      WHERE tenant_id = ${scope.tenantId}::uuid AND converted_investor_id IS NOT NULL
        AND source IN (${textList(expandLeadSources(scope.leadSources))}))`);
  }
  return parts;
}

/** Tenant + live + the scope's restrictions, on an investors alias. */
export function clientWhere(scope: MetricScope, alias = "i"): SQL {
  const parts: SQL[] = [sql`${col(alias, "tenant_id")} = ${scope.tenantId}::uuid`, aliveClient(alias)];
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  if (rms.length) parts.push(sql`${col(alias, "rm_id")} IN (${uuidList(rms)})`);
  if (branches.length) parts.push(sql`${col(alias, "branch_id")} IN (${uuidList(branches)})`);
  parts.push(...clientFilterParts(scope, alias));
  return sql.join(parts, sql` AND `);
}

/**
 * Tenant + not deleted/merged + restrictions, WITHOUT the status rule — for
 * facts about a client that stay true after the client leaves (a client
 * onboarded in April and closed in August was still acquired in April).
 */
export function clientRecordWhere(scope: MetricScope, alias = "i"): SQL {
  const parts: SQL[] = [
    sql`${col(alias, "tenant_id")} = ${scope.tenantId}::uuid`,
    sql`${col(alias, "deleted_at")} IS NULL AND ${col(alias, "merged_into_id")} IS NULL`,
  ];
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  if (rms.length) parts.push(sql`${col(alias, "rm_id")} IN (${uuidList(rms)})`);
  if (branches.length) parts.push(sql`${col(alias, "branch_id")} IN (${uuidList(branches)})`);
  parts.push(...clientFilterParts(scope, alias));
  return sql.join(parts, sql` AND `);
}

/** True when a client-only filter is set (segment, category, family, tags, lead source). */
export function hasClientFilter(scope: MetricScope): boolean {
  return !!(scope.segments?.length || scope.categories?.length || scope.familyIds?.length
    || scope.tags?.length || scope.leadSources?.length);
}

/**
 * A STAFF fact's person matches the scope: `userCol` is one of rmIds, and/or
 * belongs to one of branchIds. Client-only filters do not apply to staff facts
 * — callers that care report them as "Filter not applied".
 */
export function staffWhere(scope: MetricScope, userCol: SQL): SQL {
  const parts: SQL[] = [];
  const rms = cleanIds(scope.rmIds);
  const branches = cleanIds(scope.branchIds);
  if (rms.length) parts.push(sql`${userCol} IN (${uuidList(rms)})`);
  if (branches.length) {
    parts.push(sql`${userCol} IN (SELECT id FROM users WHERE tenant_id = ${scope.tenantId}::uuid
      AND branch_id IN (${uuidList(branches)}))`);
  }
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}
