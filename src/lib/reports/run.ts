/**
 * Custom-report runner. Turns a saved-report definition into safe, tenant-
 * scoped, parameterized SQL by reusing the Filter AST compiler + catalog — the
 * exact same path segments use. Field keys are looked up in the catalog (which
 * throws on anything not declared there), and every value rides as a bind
 * param, so a tenant-authored report can't inject SQL.
 *
 * Two shapes:
 *   - runDetailed: SELECT <chosen catalog columns> … ORDER BY … LIMIT …
 *   - runMatrix:   GROUP BY <row field> [, <pivot field>] with COUNT/SUM,
 *                  pivoted into a cross-tab in JS.
 */
import type { Tx } from "@/db/client";
import { and, type FilterAST } from "@/lib/filter/ast";
import { getCatalog, getField, type FieldType } from "@/lib/filter/catalog";
import { compileToSql, bindCompiled } from "@/lib/filter/compiler";

export type ReportSubject = "investor" | "lead" | "task" | "user" | "transaction" | "sip" | "insurance" | "goal" | "service_request" | "claim";

export interface DetailedColumn {
  key: string;
  label: string;
  type: FieldType;
}
export interface DetailedResult {
  kind: "detailed";
  columns: DetailedColumn[];
  rows: Record<string, unknown>[];
}

export interface MatrixDef {
  groupBy: string;
  pivot?: string;
  aggregate: "count" | "sum";
  measure?: string;
}
export interface MatrixResult {
  kind: "matrix";
  groupByLabel: string;
  colLabels: string[];
  rows: { key: string; cells: number[]; total: number }[];
  grandTotal: number;
  aggregate: "count" | "sum";
}

const MAX_ROWS = 5000;
const clampLimit = (n: unknown) => Math.min(Math.max(Math.trunc(Number(n) || 100), 1), MAX_ROWS);
const clampOffset = (n: unknown) => Math.max(Math.trunc(Number(n) || 0), 0);

/** First few catalog fields — the fallback column set for a detailed report. */
function defaultColumns(subject: string): string[] {
  return getCatalog(subject).fields.slice(0, 6).map((f) => f.key);
}

/**
 * Validate a report definition against the catalog. Throws (with a 400-ish
 * message) if any referenced field key is unknown — call before persisting.
 */
export function assertValidReport(def: {
  subject: string;
  reportType: "detailed" | "matrix";
  columns?: string[] | null;
  sort?: { field: string; dir: "asc" | "desc" } | null;
  matrix?: MatrixDef | null;
}): void {
  getCatalog(def.subject); // throws on unknown subject
  if (def.reportType === "detailed") {
    for (const k of def.columns ?? []) getField(def.subject, k);
    if (def.sort?.field) getField(def.subject, def.sort.field);
  } else {
    if (!def.matrix?.groupBy) throw new Error("matrix report needs a groupBy field");
    getField(def.subject, def.matrix.groupBy);
    if (def.matrix.pivot) getField(def.subject, def.matrix.pivot);
    if (def.matrix.aggregate === "sum") {
      if (!def.matrix.measure) throw new Error("sum aggregate needs a measure field");
      getField(def.subject, def.matrix.measure);
    }
  }
}

export async function runDetailed(
  tx: Tx,
  opts: {
    subject: string;
    ast: FilterAST | null | undefined;
    columns?: string[] | null;
    sort?: { field: string; dir: "asc" | "desc" } | null;
    tenantId: string;
    limit?: number;
    offset?: number;
  }
): Promise<DetailedResult> {
  const cat = getCatalog(opts.subject);
  const where = compileToSql(opts.ast ?? and(), opts.subject);
  const params = [...where.params, opts.tenantId];
  const tp = `$${params.length}`;

  const keys = opts.columns?.length ? opts.columns : defaultColumns(opts.subject);
  const colDefs = keys.map((k) => getField(opts.subject, k));
  const colSql = colDefs.map((d) => `${d.sql} AS "${d.key}"`).join(", ");

  let text = `SELECT ${colSql} FROM ${cat.table} ${cat.alias} WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}`;
  if (opts.sort?.field) {
    const sd = getField(opts.subject, opts.sort.field);
    text += ` ORDER BY ${sd.sql} ${opts.sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST`;
  }
  text += ` LIMIT ${clampLimit(opts.limit)} OFFSET ${clampOffset(opts.offset)}`;

  const res = await tx.execute(bindCompiled(text, params));
  return {
    kind: "detailed",
    columns: colDefs.map((d) => ({ key: d.key, label: d.label, type: d.type })),
    rows: res.rows as Record<string, unknown>[],
  };
}

export async function runMatrix(
  tx: Tx,
  opts: { subject: string; ast: FilterAST | null | undefined; matrix: MatrixDef; tenantId: string }
): Promise<MatrixResult> {
  const cat = getCatalog(opts.subject);
  const where = compileToSql(opts.ast ?? and(), opts.subject);
  const params = [...where.params, opts.tenantId];
  const tp = `$${params.length}`;

  const groupDef = getField(opts.subject, opts.matrix.groupBy);
  const agg =
    opts.matrix.aggregate === "sum" && opts.matrix.measure
      ? `COALESCE(SUM((${getField(opts.subject, opts.matrix.measure).sql})::numeric), 0)`
      : "COUNT(*)";

  const hasPivot = !!opts.matrix.pivot;
  let text: string;
  if (hasPivot) {
    const pivotDef = getField(opts.subject, opts.matrix.pivot!);
    text = `SELECT (${groupDef.sql})::text AS row_key, (${pivotDef.sql})::text AS col_key, ${agg}::numeric AS val
            FROM ${cat.table} ${cat.alias}
            WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}
            GROUP BY row_key, col_key ORDER BY row_key`;
  } else {
    text = `SELECT (${groupDef.sql})::text AS row_key, ${agg}::numeric AS val
            FROM ${cat.table} ${cat.alias}
            WHERE ${cat.alias}.tenant_id = ${tp} AND ${where.sql}
            GROUP BY row_key ORDER BY row_key`;
  }

  const res = await tx.execute(bindCompiled(text, params));
  const raw = res.rows as any[];

  if (hasPivot) {
    const colSet = new Set<string>();
    const rowMap = new Map<string, Record<string, number>>();
    for (const r of raw) {
      const rk = r.row_key ?? "—";
      const ck = r.col_key ?? "—";
      colSet.add(ck);
      if (!rowMap.has(rk)) rowMap.set(rk, {});
      rowMap.get(rk)![ck] = Number(r.val);
    }
    const colLabels = [...colSet].sort();
    let grandTotal = 0;
    const rows = [...rowMap.entries()].map(([rk, cells]) => {
      const arr = colLabels.map((c) => cells[c] ?? 0);
      const total = arr.reduce((s, v) => s + v, 0);
      grandTotal += total;
      return { key: rk, cells: arr, total };
    });
    return { kind: "matrix", groupByLabel: groupDef.label, colLabels, rows, grandTotal, aggregate: opts.matrix.aggregate };
  }

  const colLabel = opts.matrix.aggregate === "sum" ? "Total" : "Count";
  let grandTotal = 0;
  const rows = raw.map((r) => {
    const v = Number(r.val);
    grandTotal += v;
    return { key: r.row_key ?? "—", cells: [v], total: v };
  });
  return { kind: "matrix", groupByLabel: groupDef.label, colLabels: [colLabel], rows, grandTotal, aggregate: opts.matrix.aggregate };
}
