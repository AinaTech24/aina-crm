/**
 * Run a saved report for a file: the Excel / CSV export (GET …/export) and the
 * Excel attachment on a scheduled or sent email use the same rows, so the file
 * someone downloads and the one in their inbox never differ.
 */

import * as XLSX from "xlsx";
import type { Tx } from "@/db/client";
import type { SQL } from "drizzle-orm";
import type { SavedReport } from "@/db/schema";
import type { FilterAST } from "@/lib/filter/ast";
import { runDetailed, runMatrix, runSummary, type DetailedResult, type MatrixResult, type SummaryGroupNode, type SummaryResult } from "./run";
import type { CategoryColumn } from "./categories";

/** The most rows a file carries (Zoho's detailed export goes to 50,000; ours runs in one request). */
export const FILE_ROW_LIMIT = 5000;

export type Aoa = (string | number)[][];

function fmt(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function detailedAoa(d: DetailedResult): Aoa {
  return [d.columns.map((c) => c.label), ...d.rows.map((row) => d.columns.map((c) => fmt(row[c.key])))];
}

export function matrixAoa(m: MatrixResult): Aoa {
  return [[m.groupByLabel, ...m.colLabels, "Total"], ...m.rows.map((row) => [row.label, ...row.cells, row.total])];
}

/** Flatten a summary report into a grouped AOA: group cols + Records + aggregates. */
export function summaryAoa(s: SummaryResult): Aoa {
  const g = !!s.growthLabel;
  const header = [...s.groupLabels, "Records", ...s.aggregateDefs.map((a) => a.label), ...(g ? [s.growthLabel as string] : [])];
  const out: Aoa = [header];
  const walk = (node: SummaryGroupNode, depth: number) => {
    const row: (string | number)[] = new Array(s.groupLabels.length).fill("");
    row[depth] = node.label;
    out.push([...row, node.count, ...node.aggregates, ...(g ? [depth === 0 && node.growth != null ? `${node.growth}%` : ""] : [])]);
    for (const c of node.children ?? []) walk(c, depth + 1);
  };
  for (const root of s.tree) walk(root, 0);
  const grandRow: (string | number)[] = new Array(s.groupLabels.length).fill("");
  grandRow[0] = "Grand Total";
  out.push([...grandRow, s.grand.count, ...s.grand.aggregates, ...(g ? [""] : [])]);
  return out;
}

/** Run a saved report (optionally with the viewer's quick filter) into rows for a file. */
export async function reportAoa(
  tx: Tx,
  r: SavedReport,
  opts: { tenantId: string; scope?: SQL; extraAst?: FilterAST | null },
): Promise<Aoa> {
  const base = {
    subject: r.subject,
    ast: r.ast as FilterAST | null,
    extraAst: opts.extraAst ?? null,
    tenantId: opts.tenantId,
    scope: opts.scope,
    categories: r.categories as CategoryColumn[] | null,
  };
  if (r.reportType === "matrix") return matrixAoa(await runMatrix(tx, { ...base, matrix: r.matrix as any }));
  if (r.reportType === "summary") return summaryAoa(await runSummary(tx, { ...base, summary: r.summary as any }));
  const d = await runDetailed(tx, { ...base, columns: r.columns as string[] | null, sort: r.sort as any, limit: FILE_ROW_LIMIT, skipTotal: true });
  return detailedAoa(d);
}

export function aoaToXlsx(aoa: Aoa): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function aoaToCsv(aoa: Aoa): string {
  return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(aoa));
}

export function fileSlug(s: string) {
  return (s || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
