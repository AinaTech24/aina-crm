"use client";

/**
 * A summary report laid out the way Zoho shows one (We Care, 2026-11-19): one
 * column per grouping level (Host · Meeting type), the group's name printed
 * once at its first row, a tinted subtotal row under each top-level group and
 * a grand total. With only a count asked for there is one number column, not
 * "Records" and "Count" side by side. Show details puts each group's records
 * under it.
 */

import { Fragment, useState } from "react";
import { formatGrowth } from "@/lib/reports/growth";
import { humanCode, periodLabel } from "@/lib/reports/display";
import { useRecordPanel } from "./RecordPanel";

type Node = { key: string; label?: string; count: number; aggregates: number[]; children?: Node[]; rows?: Record<string, unknown>[]; growth?: number | null };
export type GroupedSummary = {
  groupLabels: string[];
  aggregateDefs: { key: string; label: string; fn: string; type: string }[];
  detailColumns: { key: string; label: string; type: string }[];
  showDetailRows: boolean;
  tree: Node[];
  grand: { count: number; aggregates: number[] };
  /** "MoM % · Net" when the report asks for growth (top-level date groups only). */
  growthLabel?: string | null;
};

const num = (v: number) => Number(v ?? 0).toLocaleString("en-IN");

const NUMERIC = new Set(["currency", "number", "integer"]);
const DETAIL_PAGE = 50;

function cell(v: unknown, type?: string): string {
  if (v == null || v === "") return "—";
  if (type && NUMERIC.has(type)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString("en-IN");
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || v instanceof Date) {
    const d = new Date(s);
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  }
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return periodLabel(s);
  if (type === "enum") return humanCode(s);
  return s;
}

type Line = { groups: Array<string | null>; node: Node; depth: number; kind: "leaf" | "subtotal" };

/** Every node of the tree, for checks across the whole report. */
function allNodes(tree: Node[]): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    n.children?.forEach(walk);
  };
  tree.forEach(walk);
  return out;
}

export function GroupedSummaryTable({ r }: { r: GroupedSummary }) {
  const panel = useRecordPanel();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (r.tree.length === 0) return <div className="p-12 text-center text-sm text-muted-foreground">No records for this filter.</div>;
  const levels = r.groupLabels.length;
  const onlyCount = r.aggregateDefs.length === 1 && r.aggregateDefs[0].fn === "count";
  // "Records" says nothing when another column already counts the same thing (Rejection no. = Records).
  const nodes = allNodes(r.tree);
  const recordsRepeated =
    !onlyCount &&
    r.aggregateDefs.some((_, j) => nodes.every((n) => Number(n.aggregates[j]) === n.count) && Number(r.grand.aggregates[j]) === r.grand.count);
  const showRecords = !onlyCount && !recordsRepeated;
  const numCols = onlyCount
    ? [{ key: "count", label: "Count" }]
    : [...(showRecords ? [{ key: "records", label: "Records" }] : []), ...r.aggregateDefs.map((a) => ({ key: a.key, label: a.label }))];
  const values = (n: Node) => (onlyCount ? [n.count] : [...(showRecords ? [n.count] : []), ...n.aggregates]);
  const growth = !!r.growthLabel;
  const span = levels + numCols.length + (growth ? 1 : 0);
  // Growth sits on a top-level group's own row: the leaf row when there is one level, its subtotal row otherwise.
  const growthCell = (n: Node | null, bold = false) =>
    growth ? (
      <td className={`px-4 py-2 text-right tabular-nums ${bold ? "font-semibold" : ""} ${n?.growth != null && n.growth < 0 ? "text-destructive" : ""}`}>{n ? formatGrowth(n.growth) : ""}</td>
    ) : null;

  // Flatten: a row per leaf; each group's name only on its first leaf row.
  const lines: Line[] = [];
  const walk = (node: Node, depth: number, prefix: Array<string | null>, first: boolean[]) => {
    if (!node.children?.length) {
      const groups = [...prefix, periodLabel(node.label ?? node.key)];
      lines.push({ groups: groups.map((g, i) => (first[i] ? g : null)), node, depth, kind: "leaf" });
      return;
    }
    node.children.forEach((c, i) => walk(c, depth + 1, [...prefix, periodLabel(node.label ?? node.key)], [...first.map((f) => f && i === 0), true]));
    if (depth === 0 && levels > 1) lines.push({ groups: [], node, depth, kind: "subtotal" });
  };
  r.tree.forEach((root) => walk(root, 0, [], [true]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm table-raw">
        <thead>
          <tr className="border-b bg-secondary/50 text-xs font-medium text-muted-foreground">
            {r.groupLabels.map((l) => (
              <th key={l} className="text-left px-4 py-3 font-medium whitespace-nowrap">{l}</th>
            ))}
            {numCols.map((c) => (
              <th key={c.key} className="text-right px-4 py-3 font-medium whitespace-nowrap">{c.label}</th>
            ))}
            {growth && <th className="text-right px-4 py-3 font-medium whitespace-nowrap">{r.growthLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, i) =>
            ln.kind === "subtotal" ? (
              <tr key={`s${i}`} className="border-b bg-secondary/30">
                <td colSpan={levels} className="px-4 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{periodLabel(ln.node.label ?? ln.node.key)} total</td>
                {values(ln.node).map((v, j) => (
                  <td key={j} className="px-4 py-2 text-right tabular-nums font-semibold">{num(v)}</td>
                ))}
                {growthCell(ln.node, true)}
              </tr>
            ) : (
              <Fragment key={`l${i}`}>
                <tr className={`border-b hover:bg-secondary/20 ${ln.groups[0] && i > 0 ? "border-t border-border" : ""}`}>
                  {Array.from({ length: levels }, (_, g) => (
                    <td key={g} className={`px-4 py-2.5 align-top whitespace-nowrap ${g === 0 ? "font-semibold" : ""}`}>{ln.groups[g] ?? ""}</td>
                  ))}
                  {values(ln.node).map((v, j) => (
                    <td key={j} className="px-4 py-2.5 text-right tabular-nums">{num(v)}</td>
                  ))}
                  {growthCell(levels === 1 ? ln.node : null)}
                </tr>
                {r.showDetailRows && ln.node.rows?.length ? (
                  <tr className="border-b">
                    <td colSpan={span} className="p-0">
                      <div className="overflow-x-auto bg-secondary/10 px-4 py-2">
                        <table className="w-full text-xs table-raw">
                          <thead>
                            <tr className="text-muted-foreground">
                              {r.detailColumns.map((c) => (
                                <th key={c.key} className={`px-2 py-1.5 font-medium whitespace-nowrap ${NUMERIC.has(c.type) ? "text-right" : "text-left"}`}>{c.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(expanded.has(String(i)) ? ln.node.rows : ln.node.rows.slice(0, DETAIL_PAGE)).map((row, ri) => (
                              <tr
                                key={ri}
                                className={`border-t border-border/60 hover:bg-secondary/30 ${panel ? "cursor-pointer" : ""}`}
                                onClick={panel ? () => panel.open(row, r.detailColumns) : undefined}
                                title={panel ? "Open to update" : undefined}
                              >
                                {r.detailColumns.map((c) => (
                                  <td
                                    key={c.key}
                                    className={`px-2 py-1.5 align-top ${c.key === "description" || c.key === "remarks" ? "min-w-64 whitespace-pre-line" : "whitespace-nowrap"} ${NUMERIC.has(c.type) ? "text-right tabular-nums" : ""}`}
                                  >
                                    {cell(row[c.key], c.type)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {ln.node.rows.length > DETAIL_PAGE && (
                          <button
                            type="button"
                            className="mt-1 px-2 py-1 text-xs font-medium text-primary hover:underline"
                            onClick={() =>
                              setExpanded((s) => {
                                const next = new Set(s);
                                if (next.has(String(i))) next.delete(String(i));
                                else next.add(String(i));
                                return next;
                              })
                            }
                          >
                            {expanded.has(String(i)) ? "Show fewer" : `Show all ${ln.node.rows.length.toLocaleString("en-IN")} records`}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          )}
          <tr className="border-t-2 bg-primary/5 font-bold">
            <td colSpan={levels} className="px-4 py-2.5">Grand total</td>
            {values({ ...r.grand, key: "", children: [] } as Node).map((v, j) => (
              <td key={j} className="px-4 py-2.5 text-right tabular-nums">{num(v)}</td>
            ))}
            {growthCell(null)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
