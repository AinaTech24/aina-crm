"use client";

/**
 * The three result tables of a custom report (detailed · summary · matrix).
 *
 * Every number is a door (Zoho's drill-down): a summary group or a matrix cell
 * calls `onDrill` with the group values it stands for, and the page lists the
 * records behind it. A record row links to its record (client, lead, task …)
 * when the subject has a page — transactions and SIPs open their client.
 */

import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";

export type DetailedColumn = { key: string; label: string; type: string };
export type Detailed = { kind: "detailed"; columns: DetailedColumn[]; rows: Record<string, unknown>[]; total: number; linkBase: string | null };
export type Matrix = {
  kind: "matrix";
  groupByLabel: string;
  rowField: string;
  colField: string | null;
  colKeys: string[];
  colLabels: string[];
  rows: { key: string; label: string; cells: number[]; total: number }[];
  grandTotal: number;
  aggregate: string;
};
export type SummaryNode = { key: string; label: string; count: number; aggregates: number[]; children?: SummaryNode[]; rows?: Record<string, unknown>[] };
export type Summary = {
  kind: "summary";
  groupLabels: string[];
  groupFields: string[];
  aggregateDefs: { key: string; label: string; fn: string; type: string }[];
  detailColumns: DetailedColumn[];
  showDetailRows: boolean;
  linkBase: string | null;
  tree: SummaryNode[];
  grand: { count: number; aggregates: number[] };
};
export type RunResult = Detailed | Matrix | Summary;
export type Drill = { field: string; value: string; label: string };

const LINK_KEY = "__link";
const NUMERIC = new Set(["currency", "number", "integer"]);

export function fmt(v: unknown, type?: string): string {
  if (v == null || v === "") return "—";
  if (type && NUMERIC.has(type)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString("en-IN");
  }
  if (v instanceof Date) return new Date(v).toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}
const num = (v: number) => Number(v).toLocaleString("en-IN");

function hrefOf(linkBase: string | null, row: Record<string, unknown>): string | null {
  const id = row[LINK_KEY];
  return linkBase && id ? `${linkBase}${String(id)}` : null;
}

/** A record row: the first cell links to the record. */
function RecordCells({ row, columns, linkBase }: { row: Record<string, unknown>; columns: DetailedColumn[]; linkBase: string | null }) {
  const href = hrefOf(linkBase, row);
  return (
    <>
      {columns.map((c, i) => (
        <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${NUMERIC.has(c.type) ? "text-right tabular-nums" : ""}`}>
          {i === 0 && href ? (
            <Link href={href} className="font-medium text-primary hover:underline">
              {fmt(row[c.key], c.type)}
            </Link>
          ) : (
            fmt(row[c.key], c.type)
          )}
        </td>
      ))}
    </>
  );
}

export function DetailedTable({
  r,
  sort,
  onSort,
}: {
  r: Detailed;
  sort?: { field: string; dir: "asc" | "desc" } | null;
  /** Click a header to sort by it (server-side, over every row — not just this page). */
  onSort?: (field: string) => void;
}) {
  if (r.rows.length === 0) return <EmptyState title="No rows match" description="Nothing matches this report's filters." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {r.columns.map((c) => {
              const active = sort?.field === c.key;
              return (
                <th key={c.key} className={`px-3 py-2 whitespace-nowrap ${NUMERIC.has(c.type) ? "text-right" : "text-left"}`} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {onSort ? (
                    <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                      {c.label}
                      {active && (sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => (
            <tr key={i}>
              <RecordCells row={row} columns={r.columns} linkBase={r.linkBase} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatrixTable({ r, onDrill }: { r: Matrix; onDrill?: (d: Drill[]) => void }) {
  if (r.rows.length === 0) return <EmptyState title="No rows match" description="Nothing matches this report's filters." />;
  const colTotals = r.colLabels.map((_, ci) => r.rows.reduce((s, row) => s + (row.cells[ci] ?? 0), 0));
  const rowDrill = (row: Matrix["rows"][number]): Drill => ({ field: r.rowField, value: row.key, label: row.label });
  const cell = (v: number, drill: Drill[] | null, strong = false) =>
    onDrill && drill && v !== 0 ? (
      <button type="button" onClick={() => onDrill(drill)} className={`tabular-nums hover:text-primary hover:underline ${strong ? "font-semibold" : ""}`} title="See these records">
        {num(v)}
      </button>
    ) : (
      <span className={`tabular-nums ${v === 0 ? "text-muted-foreground" : ""} ${strong ? "font-semibold" : ""}`}>{num(v)}</span>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left px-3 py-2">{r.groupByLabel}</th>
            {r.colLabels.map((c, i) => (
              <th key={`${c}-${i}`} className="text-right px-3 py-2 whitespace-nowrap">
                {c}
              </th>
            ))}
            {r.colField && <th className="text-right px-3 py-2">Total</th>}
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row) => (
            <tr key={row.key}>
              <td className="px-3 py-2 font-medium whitespace-nowrap">{row.label}</td>
              {row.cells.map((v, ci) => (
                <td key={ci} className="px-3 py-2 text-right">
                  {cell(v, r.colField ? [rowDrill(row), { field: r.colField, value: r.colKeys[ci], label: r.colLabels[ci] }] : [rowDrill(row)])}
                </td>
              ))}
              {r.colField && <td className="px-3 py-2 text-right">{cell(row.total, [rowDrill(row)], true)}</td>}
            </tr>
          ))}
          <tr className="bg-secondary/40 font-semibold">
            <td className="px-3 py-2">Total</td>
            {colTotals.map((v, ci) => (
              <td key={ci} className="px-3 py-2 text-right">
                {r.colField ? cell(v, [{ field: r.colField, value: r.colKeys[ci], label: r.colLabels[ci] }], true) : <span className="tabular-nums">{num(v)}</span>}
              </td>
            ))}
            {r.colField && <td className="px-3 py-2 text-right tabular-nums">{num(r.grandTotal)}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Summary report: nested groups with sub-totals, optional detail rows, grand total. */
export function SummaryTable({ r, showDetails, onDrill }: { r: Summary; showDetails: boolean; onDrill?: (d: Drill[]) => void }) {
  if (r.tree.length === 0) return <EmptyState title="No rows match" description="Nothing matches this report's filters." />;
  const aggCols = r.aggregateDefs;
  const span = 2 + aggCols.length;
  const renderNode = (node: SummaryNode, depth: number, path: string, trail: Drill[]): React.ReactNode[] => {
    const drill = [...trail, { field: r.groupFields[depth], value: node.key, label: node.label }];
    const out: React.ReactNode[] = [];
    out.push(
      <tr key={`g-${path}`} className={depth === 0 ? "bg-secondary/40 font-semibold" : "bg-secondary/20 font-medium"}>
        <td className="px-3 py-2 whitespace-nowrap" style={{ paddingLeft: 12 + depth * 18 }}>
          {onDrill ? (
            <button type="button" onClick={() => onDrill(drill)} className="inline-flex items-center gap-1 hover:text-primary hover:underline" title="See these records">
              {node.label} <ChevronRight className="size-3.5 text-muted-foreground" />
            </button>
          ) : (
            node.label
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{num(node.count)}</td>
        {node.aggregates.map((v, i) => (
          <td key={i} className="px-3 py-2 text-right tabular-nums">
            {num(v)}
          </td>
        ))}
      </tr>
    );
    if (node.children?.length) {
      node.children.forEach((c, i) => out.push(...renderNode(c, depth + 1, `${path}-${i}`, drill)));
    } else if (showDetails && r.showDetailRows && node.rows?.length) {
      out.push(
        <tr key={`d-${path}`}>
          <td colSpan={span} className="px-0 py-0">
            <div className="overflow-x-auto bg-card" style={{ paddingLeft: 12 + (depth + 1) * 18 }}>
              <table className="w-full text-xs table-raw">
                <thead className="text-muted-foreground">
                  <tr>
                    {r.detailColumns.map((c) => (
                      <th key={c.key} className="text-left px-3 py-1.5 font-medium whitespace-nowrap">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {node.rows!.map((row, ri) => (
                    <tr key={ri} className="hover:bg-secondary/30">
                      <RecordCells row={row} columns={r.detailColumns} linkBase={r.linkBase} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      );
    }
    return out;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left px-3 py-2">{r.groupLabels.join(" › ")}</th>
            <th className="text-right px-3 py-2">Records</th>
            {aggCols.map((a) => (
              <th key={a.key} className="text-right px-3 py-2 whitespace-nowrap">
                {a.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.tree.map((root, i) => renderNode(root, 0, String(i), []))}
          <tr className="bg-primary/5 font-bold border-t-2">
            <td className="px-3 py-2">Grand Total</td>
            <td className="px-3 py-2 text-right tabular-nums">{num(r.grand.count)}</td>
            {r.grand.aggregates.map((v, i) => (
              <td key={i} className="px-3 py-2 text-right tabular-nums">
                {num(v)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** A summary's top-level groups in the chart's matrix shape (first total, else the record count). */
export function summaryAsChart(r: Summary): { groupByLabel: string; colLabels: string[]; rows: { key: string; label: string; cells: number[]; total: number }[] } {
  const first = r.aggregateDefs[0];
  return {
    groupByLabel: r.groupLabels[0] ?? "",
    colLabels: [first?.label ?? "Records"],
    rows: r.tree.map((n) => {
      const v = first ? (n.aggregates[0] ?? 0) : n.count;
      return { key: n.key, label: n.label, cells: [v], total: v };
    }),
  };
}
