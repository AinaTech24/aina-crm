"use client";

/**
 * A sortable contribution table (§9 branch-wise, §10 RM-wise). Sorting is by
 * any column; there is no composite rank or score — the brief forbids one.
 * Synthetic rows ("No branch recorded", "No owner recorded") always sort last
 * so each column still sums to the figure above the table.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PeopleCol = { key: string; label: string; format: "currency" | "count" | "percent" | "text"; tone?: "bad" };
export type PeopleTableRow = { id: string; name: string; href: string | null; synthetic?: boolean; cells: Record<string, number | string | null> };

export function PeopleTable({ cols, rows, empty }: { cols: PeopleCol[]; rows: PeopleTableRow[]; empty: string }) {
  const numeric = cols.filter((c) => c.format !== "text");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: numeric.find((c) => c.key === "total")?.key ?? numeric[0]?.key ?? "", dir: -1 });
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    if (!!a.synthetic !== !!b.synthetic) return a.synthetic ? 1 : -1;
    const av = a.cells[sort.key];
    const bv = b.cells[sort.key];
    const an = typeof av === "number" ? av : -Infinity;
    const bn = typeof bv === "number" ? bv : -Infinity;
    return (an - bn) * sort.dir || a.name.localeCompare(b.name);
  }), [rows, sort]);
  if (rows.length === 0) return <p className="dash-empty">{empty}</p>;
  const fmt = (c: PeopleCol, v: number | string | null) => {
    if (v == null) return <span className="text-muted-foreground" title="Not recorded">—</span>;
    if (c.format === "text") return String(v);
    if (typeof v !== "number") return String(v);
    if (c.format === "percent") return formatPercent(v * 100, 1);
    return c.format === "currency" ? formatMoney(v) : formatCount(v);
  };
  return (
    <div className="table-scroll">
      <table className="w-full">
        <thead>
          <tr>
            <th scope="col">Name</th>
            {cols.map((c) => (
              <th key={c.key} scope="col" className={cn(c.format !== "text" && "text-right")}>
                {c.format === "text" ? c.label : (
                  <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                    className="inline-flex min-h-6 items-center gap-1 hover:text-foreground" aria-label={`Sort by ${c.label}`}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === -1 ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className={cn(r.synthetic && "bg-secondary/30")}>
              <td className="py-2.5 text-xs font-medium">
                {r.href ? <Link href={r.href} scroll={false} className="hover:text-primary hover:underline">{r.name}</Link>
                  : <span className={cn(r.synthetic && "text-muted-foreground")}>{r.name}</span>}
              </td>
              {cols.map((c) => (
                <td key={c.key} className={cn("py-2.5 text-xs", c.format !== "text" && "text-right tabular-nums",
                  c.tone === "bad" && typeof r.cells[c.key] === "number" && (r.cells[c.key] as number) > 0 && "text-destructive")}>
                  {fmt(c, r.cells[c.key] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
