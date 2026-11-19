"use client";

/**
 * A summary report laid out the way Zoho shows one (We Care, 2026-11-19): one
 * column per grouping level (Host · Meeting type), the group's name printed
 * once at its first row, a tinted subtotal row under each top-level group and
 * a grand total. With only a count asked for there is one number column, not
 * "Records" and "Count" side by side. Show details puts each group's records
 * under it.
 */

import { Fragment } from "react";

type Node = { key: string; count: number; aggregates: number[]; children?: Node[]; rows?: Record<string, unknown>[] };
export type GroupedSummary = {
  groupLabels: string[];
  aggregateDefs: { key: string; label: string; fn: string; type: string }[];
  detailColumns: { key: string; label: string; type: string }[];
  showDetailRows: boolean;
  tree: Node[];
  grand: { count: number; aggregates: number[] };
};

const num = (v: number) => Number(v ?? 0).toLocaleString("en-IN");

function cell(v: unknown, type?: string): string {
  if (v == null || v === "") return "—";
  if (type === "currency" || type === "number" || type === "integer") {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString("en-IN");
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || v instanceof Date) {
    const d = new Date(s);
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return s;
}

type Line = { groups: Array<string | null>; node: Node; depth: number; kind: "leaf" | "subtotal" };

export function GroupedSummaryTable({ r }: { r: GroupedSummary }) {
  if (r.tree.length === 0) return <div className="p-12 text-center text-sm text-muted-foreground">No records for this filter.</div>;
  const levels = r.groupLabels.length;
  const onlyCount = r.aggregateDefs.length === 1 && r.aggregateDefs[0].fn === "count";
  const numCols = onlyCount ? [{ key: "count", label: "Count" }] : [{ key: "records", label: "Records" }, ...r.aggregateDefs.map((a) => ({ key: a.key, label: a.label }))];
  const values = (n: Node) => (onlyCount ? [n.count] : [n.count, ...n.aggregates]);
  const span = levels + numCols.length;

  // Flatten: a row per leaf; each group's name only on its first leaf row.
  const lines: Line[] = [];
  const walk = (node: Node, depth: number, prefix: Array<string | null>, first: boolean[]) => {
    if (!node.children?.length) {
      const groups = [...prefix, node.key];
      lines.push({ groups: groups.map((g, i) => (first[i] ? g : null)), node, depth, kind: "leaf" });
      return;
    }
    node.children.forEach((c, i) => walk(c, depth + 1, [...prefix, node.key], [...first.map((f) => f && i === 0), true]));
    if (depth === 0 && levels > 1) lines.push({ groups: [], node, depth, kind: "subtotal" });
  };
  r.tree.forEach((root) => walk(root, 0, [], [true]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm table-raw">
        <thead>
          <tr className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
            {r.groupLabels.map((l) => (
              <th key={l} className="text-left px-4 py-2.5 font-semibold">{l}</th>
            ))}
            {numCols.map((c) => (
              <th key={c.key} className="text-right px-4 py-2.5 font-semibold w-32">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, i) =>
            ln.kind === "subtotal" ? (
              <tr key={`s${i}`} className="border-b bg-secondary/40">
                <td colSpan={levels} className="px-4 py-2 text-xs text-muted-foreground">Total · {ln.node.key}</td>
                {values(ln.node).map((v, j) => (
                  <td key={j} className="px-4 py-2 text-right tabular-nums font-semibold">{num(v)}</td>
                ))}
              </tr>
            ) : (
              <Fragment key={`l${i}`}>
                <tr className={`border-b hover:bg-secondary/20 ${ln.groups[0] ? "border-t border-border" : ""}`}>
                  {Array.from({ length: levels }, (_, g) => (
                    <td key={g} className={`px-4 py-2 align-top ${g === 0 ? "font-semibold" : ""}`}>{ln.groups[g] ?? ""}</td>
                  ))}
                  {values(ln.node).map((v, j) => (
                    <td key={j} className="px-4 py-2 text-right tabular-nums text-primary">{num(v)}</td>
                  ))}
                </tr>
                {r.showDetailRows && ln.node.rows?.length ? (
                  <tr className="border-b">
                    <td colSpan={span} className="p-0">
                      <div className="overflow-x-auto bg-card px-4 py-2">
                        <table className="w-full text-xs table-raw">
                          <thead>
                            <tr className="text-muted-foreground">
                              {r.detailColumns.map((c) => <th key={c.key} className="text-left px-2 py-1.5 font-medium whitespace-nowrap">{c.label}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {ln.node.rows.map((row, ri) => (
                              <tr key={ri} className="border-t border-border/60 hover:bg-secondary/30">
                                {r.detailColumns.map((c) => (
                                  <td key={c.key} className={`px-2 py-1.5 align-top ${c.key === "description" ? "min-w-64 whitespace-pre-line" : "whitespace-nowrap"}`}>{cell(row[c.key], c.type)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
          </tr>
        </tbody>
      </table>
    </div>
  );
}
