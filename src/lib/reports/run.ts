/**
 * Custom-report runner. Turns a saved-report definition into safe, tenant-
 * scoped, parameterized SQL by reusing the Filter AST compiler + catalog — the
 * exact same path segments use. Field keys are looked up in the catalog (which
 * throws on anything not declared there), and every value rides as a bind
 * param, so a tenant-authored report can't inject SQL.
 *
 * Three shapes:
 *   - runDetailed: SELECT <chosen catalog columns> … ORDER BY … LIMIT …, with
 *                  the total count and a link to each row's record
 *   - runMatrix:   GROUP BY <row field> [, <pivot field>] with COUNT/SUM,
 *                  pivoted into a cross-tab in JS
 *   - runSummary:  GROUP BY ROLLUP over 1–3 levels, with sub/grand totals
 *
 * Group-by and pivot keys may bucket a date ("onboarded_at@month",
 * lib/reports/grouping.ts). Every runner also takes the viewer's quick
 * filters (`extraAst`, ANDed with the saved filter — it can only narrow), and
 * runDetailed takes `drill`: the group values a click on a summary row or a
 * matrix cell stands for, so the records behind any number can be listed.
 */
import type { Tx } from "@/db/client";
import { and, type FilterAST } from "@/lib/filter/ast";
import { getCatalog, getField, type FieldType } from "@/lib/filter/catalog";
import { compileToSql, bindCompiled } from "@/lib/filter/compiler";
import { sql as dsql, type SQL } from "drizzle-orm";
import { groupField } from "./grouping";
import { growthByKey } from "./growth";
import { findCategory, categorySql, isCategoryKey, type CategoryColumn } from "./categories";

export type ReportSubject = "investor" | "lead" | "task" | "user" | "transaction" | "sip" | "insurance" | "goal" | "service_request" | "claim" | "review_meeting" | "business_line" | "equity_brokerage" | "equity_dmat";

export type ReportAggregate = "count" | "sum" | "avg" | "min" | "max";

/**
 * Build a SQL aggregate expression. `count` ignores the measure; the rest act
 * on a numeric cast of the catalog field's SQL fragment (which is never
 * user-controlled — it comes from the catalog).
 */
function aggExpr(fn: ReportAggregate, measureSql?: string): string {
  if (fn === "count") return "COUNT(*)";
  const m = `(${measureSql})::numeric`;
  switch (fn) {
    case "sum":
      return `COALESCE(SUM(${m}), 0)`;
    case "avg":
      return `AVG(${m})`;
    case "min":
      return `MIN(${m})`;
    case "max":
      return `MAX(${m})`;
  }
}

const AGG_LABEL: Record<ReportAggregate, string> = {
  count: "Count",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
};
export function aggLabel(fn: ReportAggregate): string {
  return AGG_LABEL[fn] ?? fn;
}

/**
 * Where a row of each subject opens. Transactions and SIPs have no page of
 * their own, so they open their client; a business entry line opens its entry.
 */
const RECORD_PAGE: Record<string, { col: string; path: string }> = {
  investor: { col: "id", path: "/dashboard/investors/" },
  lead: { col: "id", path: "/dashboard/leads/" },
  task: { col: "id", path: "/dashboard/tasks/" },
  insurance: { col: "id", path: "/dashboard/insurance/" },
  goal: { col: "id", path: "/dashboard/goals/" },
  service_request: { col: "id", path: "/dashboard/service-requests/" },
  claim: { col: "id", path: "/dashboard/insurance-claims/" },
  review_meeting: { col: "id", path: "/dashboard/review-meetings/" },
  business_entry: { col: "id", path: "/dashboard/business-entries/" },
  business_line: { col: "entry_id", path: "/dashboard/business-entries/" },
  equity_dmat: { col: "investor_id", path: "/dashboard/investors/" },
  transaction: { col: "investor_id", path: "/dashboard/investors/" },
  sip: { col: "investor_id", path: "/dashboard/investors/" },
};
/** The column each row carries its record id in (never shown or exported). */
export const LINK_KEY = "__link";

export interface DetailedColumn {
  key: string;
  label: string;
  type: FieldType;
}
export interface DetailedResult {
  kind: "detailed";
  columns: DetailedColumn[];
  rows: Record<string, unknown>[];
  /** Rows matching the report, before the page limit. */
  total: number;
  /** Prefix of a row's record page; the row's `__link` completes it. Null = no page. */
  linkBase: string | null;
}

export interface MatrixDef {
  groupBy: string;
  pivot?: string;
  aggregate: ReportAggregate;
  measure?: string;
  /** Row order: by the row value (default) or by the row total, largest first. */
  rowSort?: "key" | "total";
}
export interface MatrixResult {
  kind: "matrix";
  groupByLabel: string;
  /** The group-by / pivot keys — what a drill-down filters on. */
  rowField: string;
  colField: string | null;
  /** Raw column values (drill-down) and how they read. */
  colKeys: string[];
  colLabels: string[];
  rows: { key: string; label: string; cells: number[]; total: number }[];
  grandTotal: number;
  aggregate: ReportAggregate;
}

export interface SummaryAggregate {
  field: string;
  fn: ReportAggregate;
  label?: string;
}
export interface SummaryDef {
  groupBy: string[];
  columns?: string[];
  aggregates?: SummaryAggregate[];
  showDetailRows?: boolean;
  sort?: { field: string; dir: "asc" | "desc" } | null;
  /** Group order at every level: by value (default), record count, or the first total — largest first. */
  groupSort?: "key" | "count" | "value";
  /** Grouped by a date first: add the first total's growth on the previous period (We Care's MoM %, 2026-11-20). */
  growth?: boolean;
}
export interface SummaryGroupNode {
  key: string;
  /** How the key reads ("Apr 2026" for the key "2026-04"). */
  label: string;
  count: number;
  /** Aggregate values, in the order of SummaryResult.aggregateDefs. */
  aggregates: number[];
  children?: SummaryGroupNode[];
  /** Detail rows (leaf level only, when showDetailRows). */
  rows?: Record<string, unknown>[];
  /** Top level only, when summary.growth: % change of the first total on the previous period; null = not meaningful. */
  growth?: number | null;
}
export interface SummaryResult {
  kind: "summary";
  groupLabels: string[];
  /** The group-by keys, one per level — what a drill-down filters on. */
  groupFields: string[];
  aggregateDefs: { key: string; label: string; fn: ReportAggregate; type: FieldType }[];
  detailColumns: DetailedColumn[];
  showDetailRows: boolean;
  /** Prefix of a detail row's record page (see DetailedResult). */
  linkBase: string | null;
  tree: SummaryGroupNode[];
  grand: { count: number; aggregates: number[] };
  /** Set when the report asks for growth: the column's heading ("MoM % · Net"). */
  growthLabel?: string | null;
}

/** One group value behind a clicked number: `field` is a group key, `value` the raw group value ("—" = blank). */
export type DrillValue = { field: string; value: string };

const MAX_ROWS = 5000;
const clampLimit = (n: unknown) => Math.min(Math.max(Math.trunc(Number(n) || 100), 1), MAX_ROWS);
const clampOffset = (n: unknown) => Math.max(Math.trunc(Number(n) || 0), 0);

/** First few catalog fields — the fallback column set for a detailed report. */
function defaultColumns(subject: string): string[] {
  return getCatalog(subject).fields.slice(0, 6).map((f) => f.key);
}

/** How a null / empty group value is shown, and matched on drill-down. */
export const BLANK = "—";
const disp = (v: unknown) => (v == null || v === "" ? BLANK : String(v));

/**
 * A display column: a catalog field, or a category column — selected as its
 * bucket code and read as its label after the query (`readCategories`).
 */
function columnDef(subject: string, key: string, categories?: CategoryColumn[] | null) {
  if (isCategoryKey(key)) {
    const c = findCategory(categories, key);
    const { sql, labelOf } = categorySql(subject, c);
    return { key, label: c.label, sql, type: "string" as FieldType, labelOf };
  }
  const d = getField(subject, key);
  return { key: d.key, label: d.label, sql: d.sql, type: d.type, labelOf: null };
}

function readCategories(rows: Record<string, unknown>[], cols: ReturnType<typeof columnDef>[]) {
  const cats = cols.filter((c) => c.labelOf);
  if (!cats.length) return rows;
  for (const r of rows) for (const c of cats) r[c.key] = c.labelOf!(String(r[c.key] ?? ""));
  return rows;
}

/**
 * FROM + WHERE shared by every runner: tenant, the saved filter AND the
 * viewer's quick filter, the viewer's row scope, and any drill-down values.
 * Scope and drill conditions ride as SQL "params" — bindCompiled embeds an
 * SQL chunk as SQL, so they are never bound literals.
 */
function baseQuery(opts: {
  subject: string;
  ast: FilterAST | null | undefined;
  extraAst?: FilterAST | null;
  tenantId: string;
  scope?: SQL;
  drill?: DrillValue[];
  categories?: CategoryColumn[] | null;
}) {
  const cat = getCatalog(opts.subject);
  const filter = opts.extraAst ? (opts.ast ? and(opts.ast, opts.extraAst) : opts.extraAst) : opts.ast ?? and();
  const where = compileToSql(filter, opts.subject);
  const params: unknown[] = [...where.params, opts.tenantId];
  const conds = [`${cat.alias}.tenant_id = $${params.length}`, where.sql];
  params.push(opts.scope ?? dsql`TRUE`);
  conds.push(`$${params.length}`);
  for (const d of opts.drill ?? []) {
    const g = groupField(opts.subject, d.field, opts.categories);
    params.push(
      d.value === BLANK
        ? dsql`((${dsql.raw(g.sql)}) IS NULL OR (${dsql.raw(g.sql)})::text = '')`
        : dsql`(${dsql.raw(g.sql)})::text = ${d.value}`,
    );
    conds.push(`$${params.length}`);
  }
  return { cat, from: `${cat.table} ${cat.alias}`, where: conds.join(" AND "), params };
}

/**
 * Validate a report definition against the catalog. Throws (with a 400-ish
 * message) if any referenced field key is unknown — call before persisting.
 */
export function assertValidReport(def: {
  subject: string;
  reportType: "detailed" | "summary" | "matrix";
  columns?: string[] | null;
  sort?: { field: string; dir: "asc" | "desc" } | null;
  matrix?: MatrixDef | null;
  summary?: SummaryDef | null;
  categories?: CategoryColumn[] | null;
}): void {
  getCatalog(def.subject); // throws on unknown subject
  const col = (k: string) => (isCategoryKey(k) ? findCategory(def.categories, k) : getField(def.subject, k));
  if (def.reportType === "detailed") {
    for (const k of def.columns ?? []) col(k);
    if (def.sort?.field) getField(def.subject, def.sort.field);
  } else if (def.reportType === "summary") {
    const s = def.summary;
    if (!s?.groupBy?.length) throw new Error("summary report needs at least one 'group by' field");
    if (s.groupBy.length > 3) throw new Error("summary report supports at most 3 grouping levels");
    for (const k of s.groupBy) groupField(def.subject, k, def.categories);
    for (const k of s.columns ?? []) col(k);
    for (const a of s.aggregates ?? []) {
      if (a.fn !== "count") {
        if (!a.field) throw new Error(`${a.fn} aggregate needs a field`);
        getField(def.subject, a.field);
      }
    }
    if (s.sort?.field) getField(def.subject, s.sort.field);
  } else {
    if (!def.matrix?.groupBy) throw new Error("matrix report needs a groupBy field");
    groupField(def.subject, def.matrix.groupBy, def.categories);
    if (def.matrix.pivot) groupField(def.subject, def.matrix.pivot, def.categories);
    if (def.matrix.aggregate !== "count") {
      if (!def.matrix.measure) throw new Error(`${def.matrix.aggregate} aggregate needs a measure field`);
      getField(def.subject, def.matrix.measure);
    }
  }
}

export async function runDetailed(
  tx: Tx,
  opts: {
    subject: string;
    ast: FilterAST | null | undefined;
    /** The viewer's quick filter, ANDed with the saved one. */
    extraAst?: FilterAST | null;
    /** Group values from a clicked summary row / matrix cell. */
    drill?: DrillValue[];
    columns?: string[] | null;
    sort?: { field: string; dir: "asc" | "desc" } | null;
    tenantId: string;
    limit?: number;
    offset?: number;
    /** Row scope over the subject's catalog alias (lib/reports/scope.ts) — the viewer's access. */
    scope?: SQL;
    /** Skip the COUNT(*) (the scheduler and export don't show it). */
    skipTotal?: boolean;
    /** The report's category columns ("cat:<id>" columns / drill fields). */
    categories?: CategoryColumn[] | null;
  }
): Promise<DetailedResult> {
  const q = baseQuery(opts);
  const keys = opts.columns?.length ? opts.columns : defaultColumns(opts.subject);
  const colDefs = keys.map((k) => columnDef(opts.subject, k, opts.categories));
  const page = RECORD_PAGE[opts.subject] ?? null;
  const colSql = [
    ...colDefs.map((d) => `${d.sql} AS "${d.key}"`),
    ...(page ? [`${q.cat.alias}.${page.col} AS "${LINK_KEY}"`] : []),
  ].join(", ");

  let text = `SELECT ${colSql} FROM ${q.from} WHERE ${q.where}`;
  if (opts.sort?.field) {
    const sd = getField(opts.subject, opts.sort.field);
    text += ` ORDER BY ${sd.sql} ${opts.sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
  }
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  text += ` LIMIT ${limit} OFFSET ${offset}`;

  const res = await tx.execute(bindCompiled(text, q.params));
  const rows = readCategories(res.rows as Record<string, unknown>[], colDefs);
  // A short page is the end: no need to count.
  let total = offset + rows.length;
  if (!opts.skipTotal && rows.length >= limit) {
    const c = await tx.execute(bindCompiled(`SELECT COUNT(*)::int AS n FROM ${q.from} WHERE ${q.where}`, q.params));
    total = Number((c.rows[0] as { n?: number } | undefined)?.n ?? total);
  }
  return {
    kind: "detailed",
    columns: colDefs.map((d) => ({ key: d.key, label: d.label, type: d.type })),
    rows,
    total,
    linkBase: page?.path ?? null,
  };
}

export async function runMatrix(
  tx: Tx,
  opts: { subject: string; ast: FilterAST | null | undefined; extraAst?: FilterAST | null; matrix: MatrixDef; tenantId: string; scope?: SQL; categories?: CategoryColumn[] | null }
): Promise<MatrixResult> {
  const q = baseQuery(opts);
  const groupDef = groupField(opts.subject, opts.matrix.groupBy, opts.categories);
  const measureSql =
    opts.matrix.aggregate !== "count" && opts.matrix.measure
      ? getField(opts.subject, opts.matrix.measure).sql
      : undefined;
  const agg = aggExpr(opts.matrix.aggregate, measureSql);

  const pivotDef = opts.matrix.pivot ? groupField(opts.subject, opts.matrix.pivot, opts.categories) : null;
  const text = pivotDef
    ? `SELECT (${groupDef.sql})::text AS row_key, (${pivotDef.sql})::text AS col_key, ${agg}::numeric AS val
            FROM ${q.from} WHERE ${q.where}
            GROUP BY row_key, col_key ORDER BY row_key`
    : `SELECT (${groupDef.sql})::text AS row_key, ${agg}::numeric AS val
            FROM ${q.from} WHERE ${q.where}
            GROUP BY row_key ORDER BY row_key`;

  const res = await tx.execute(bindCompiled(text, q.params));
  const raw = res.rows as Array<{ row_key: string | null; col_key?: string | null; val: unknown }>;
  const rowLabel = (k: string) => groupDef.labelOf(k);
  const sortRows = <T extends { total: number }>(rows: T[]) =>
    opts.matrix.rowSort === "total" ? [...rows].sort((a, b) => b.total - a.total) : rows;

  if (pivotDef) {
    const colSet = new Set<string>();
    const rowMap = new Map<string, Record<string, number>>();
    for (const r of raw) {
      const rk = disp(r.row_key);
      const ck = disp(r.col_key);
      colSet.add(ck);
      if (!rowMap.has(rk)) rowMap.set(rk, {});
      rowMap.get(rk)![ck] = Number(r.val);
    }
    const colKeys = [...colSet].sort();
    let grandTotal = 0;
    const rows = [...rowMap.entries()].map(([rk, cells]) => {
      const arr = colKeys.map((c) => cells[c] ?? 0);
      const total = arr.reduce((s, v) => s + v, 0);
      grandTotal += total;
      return { key: rk, label: rowLabel(rk), cells: arr, total };
    });
    return {
      kind: "matrix",
      groupByLabel: groupDef.label,
      rowField: groupDef.key,
      colField: pivotDef.key,
      colKeys,
      colLabels: colKeys.map((c) => pivotDef.labelOf(c)),
      rows: sortRows(rows),
      grandTotal,
      aggregate: opts.matrix.aggregate,
    };
  }

  const colLabel = opts.matrix.aggregate === "count" ? "Count" : aggLabel(opts.matrix.aggregate);
  let grandTotal = 0;
  const rows = raw.map((r) => {
    const v = Number(r.val);
    grandTotal += v;
    const key = disp(r.row_key);
    return { key, label: rowLabel(key), cells: [v], total: v };
  });
  return {
    kind: "matrix",
    groupByLabel: groupDef.label,
    rowField: groupDef.key,
    colField: null,
    colKeys: [colLabel],
    colLabels: [colLabel],
    rows: sortRows(rows),
    grandTotal,
    aggregate: opts.matrix.aggregate,
  };
}

/**
 * Summary report: row grouping (1–3 levels) with per-group sub-totals + grand
 * totals computed by Postgres `GROUP BY ROLLUP`, plus optional detail rows
 * beneath each leaf group. ROLLUP means avg/min/max sub-totals are real
 * database aggregates at each level (not JS roll-ups of leaf values, which
 * would be wrong for average).
 */
export async function runSummary(
  tx: Tx,
  opts: { subject: string; ast: FilterAST | null | undefined; extraAst?: FilterAST | null; summary: SummaryDef; tenantId: string; scope?: SQL; categories?: CategoryColumn[] | null }
): Promise<SummaryResult> {
  const q = baseQuery(opts);
  const groupBy = (opts.summary.groupBy ?? []).slice(0, 3);
  const groupDefs = groupBy.map((k) => groupField(opts.subject, k, opts.categories));
  const n = groupDefs.length;

  const aggDefs = (opts.summary.aggregates ?? []).map((a) => {
    const fieldDef = a.fn !== "count" && a.field ? getField(opts.subject, a.field) : null;
    return {
      key: `${a.fn}:${a.field ?? "*"}`,
      label: a.label ?? `${aggLabel(a.fn)}${fieldDef ? ` · ${fieldDef.label}` : ""}`,
      fn: a.fn,
      type: (a.fn === "count" ? "integer" : (fieldDef?.type ?? "number")) as FieldType,
      measureSql: fieldDef?.sql,
    };
  });

  const groupSel = groupDefs.map((d, i) => `(${d.sql})::text AS g${i}`).join(", ");
  const groupingSel = groupDefs.map((d, i) => `GROUPING((${d.sql})) AS gg${i}`).join(", ");
  const groupExprs = groupDefs.map((d) => `(${d.sql})`).join(", ");
  const aggSel = aggDefs.map((a, i) => `${aggExpr(a.fn, a.measureSql)}::numeric AS a${i}`).join(", ");

  const text = `SELECT ${groupSel}, ${groupingSel}, COUNT(*)::numeric AS _cnt${aggDefs.length ? ", " + aggSel : ""}
    FROM ${q.from}
    WHERE ${q.where}
    GROUP BY ROLLUP (${groupExprs})
    ORDER BY ${groupDefs.map((_, i) => `g${i} NULLS LAST`).join(", ")}`;

  const res = await tx.execute(bindCompiled(text, q.params));
  const raw = res.rows as any[];

  const aggsOf = (r: any): number[] => aggDefs.map((_, i) => Number(r[`a${i}`] ?? 0));
  const levelOf = (r: any): number => {
    let L = 0;
    for (let i = 0; i < n; i++) {
      if (Number(r[`gg${i}`]) === 1) break;
      L++;
    }
    return L;
  };

  // Grand total = the all-rolled-up row (level 0).
  const grandRow = raw.find((r) => levelOf(r) === 0);
  const grand = { count: Number(grandRow?._cnt ?? 0), aggregates: grandRow ? aggsOf(grandRow) : aggDefs.map(() => 0) };

  // Build the group tree from the rollup rows (levels 1..n). ROLLUP emits a
  // parent's sub-total row AFTER its children (its rolled-up column sorts
  // NULLS LAST), so we build every node first, then link by level — that way a
  // child never looks up a parent that hasn't been created yet.
  const pathKey = (vals: string[]) => JSON.stringify(vals);
  const entries: { node: SummaryGroupNode; vals: string[]; L: number }[] = [];
  const byPath = new Map<string, { node: SummaryGroupNode; vals: string[]; L: number }>();
  for (const r of raw) {
    const L = levelOf(r);
    if (L < 1) continue;
    const vals = Array.from({ length: L }, (_, i) => disp(r[`g${i}`]));
    const key = vals[L - 1];
    const node: SummaryGroupNode = { key, label: groupDefs[L - 1].labelOf(key), count: Number(r._cnt ?? 0), aggregates: aggsOf(r) };
    const entry = { node, vals, L };
    entries.push(entry);
    byPath.set(pathKey(vals), entry);
  }
  const roots: SummaryGroupNode[] = [];
  for (let lvl = 1; lvl <= n; lvl++) {
    for (const e of entries) {
      if (e.L !== lvl) continue;
      if (lvl === 1) roots.push(e.node);
      else {
        const parent = byPath.get(pathKey(e.vals.slice(0, lvl - 1)));
        if (parent) (parent.node.children ??= []).push(e.node);
      }
    }
  }

  // Growth on the previous period, from the first total of each top-level date bucket.
  const grain = groupDefs[0]?.grain ?? null;
  const wantGrowth = !!opts.summary.growth && (grain === "month" || grain === "quarter" || grain === "fy" || grain === "year") && aggDefs.length > 0;
  if (wantGrowth) {
    const g = growthByKey(grain, roots);
    for (const r of roots) r.growth = g[r.key] ?? null;
  }

  // "Top RMs by AUM": order every level by count or the first total.
  const gs = opts.summary.groupSort;
  if (gs === "count" || gs === "value") {
    const metric = (x: SummaryGroupNode) => (gs === "count" || !x.aggregates.length ? x.count : x.aggregates[0]);
    const sortLevel = (nodes: SummaryGroupNode[]) => {
      nodes.sort((a, b) => metric(b) - metric(a));
      for (const c of nodes) if (c.children) sortLevel(c.children);
    };
    sortLevel(roots);
  }

  // Detail rows (leaf level), bucketed under their leaf group.
  const showDetail = !!opts.summary.showDetailRows;
  const colKeys = opts.summary.columns?.length ? opts.summary.columns : defaultColumns(opts.subject);
  const colDefs = colKeys.map((k) => columnDef(opts.subject, k, opts.categories));
  const page = RECORD_PAGE[opts.subject] ?? null;
  if (showDetail && n > 0) {
    const pathSel = groupDefs.map((d, i) => `(${d.sql})::text AS gp${i}`).join(", ");
    const colSql = [
      ...colDefs.map((d) => `${d.sql} AS "${d.key}"`),
      ...(page ? [`${q.cat.alias}.${page.col} AS "${LINK_KEY}"`] : []),
    ].join(", ");
    let dtext = `SELECT ${pathSel}, ${colSql} FROM ${q.from}
      WHERE ${q.where}
      ORDER BY ${groupDefs.map((_, i) => `gp${i} NULLS LAST`).join(", ")}`;
    if (opts.summary.sort?.field) {
      const sd = getField(opts.subject, opts.summary.sort.field);
      dtext += `, ${sd.sql} ${opts.summary.sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
    }
    dtext += ` LIMIT ${MAX_ROWS}`;
    const dres = await tx.execute(bindCompiled(dtext, q.params));
    for (const row of readCategories(dres.rows as Record<string, unknown>[], colDefs)) {
      const vals = Array.from({ length: n }, (_, i) => disp(row[`gp${i}`]));
      const leaf = byPath.get(pathKey(vals));
      if (leaf) (leaf.node.rows ??= []).push(row as Record<string, unknown>);
    }
  }

  return {
    kind: "summary",
    groupLabels: groupDefs.map((d) => d.label),
    groupFields: groupDefs.map((d) => d.key),
    aggregateDefs: aggDefs.map((a) => ({ key: a.key, label: a.label, fn: a.fn, type: a.type })),
    detailColumns: colDefs.map((d) => ({ key: d.key, label: d.label, type: d.type })),
    showDetailRows: showDetail,
    linkBase: page?.path ?? null,
    tree: roots,
    grand,
    growthLabel: wantGrowth ? `${grain === "month" ? "MoM" : grain === "quarter" ? "QoQ" : "YoY"} % · ${aggDefs[0].label}` : null,
  };
}
