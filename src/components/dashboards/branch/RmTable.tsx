/**
 * The one table every "by RM" breakdown on the branch command centre is drawn
 * with. Seventeen sections need an RM table; each is a set of COLUMNS over the
 * same ledger rows (src/lib/dashboard/branch/rm-ledger.ts), so two tables can
 * never disagree about one RM, and every table ends in the same branch-total
 * row that reconciles to the figures printed above it.
 *
 * Rules the table enforces so the sections cannot forget them:
 *
 *   · Synthetic rows ("Served from other branches", "No RM assigned") carry
 *     client facts only. A staff-fact cell on them reads "—" with the reason,
 *     never 0: nobody's work is being measured on that row.
 *   · A ratio with nothing under it is "—", not 0% — see `ratio()`.
 *   · The RM name opens the RM's one-on-one view: branch → RM is the first
 *     step of the brief's drill-down.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import type { RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import { Figure, Num, Table, type Tone } from "@/components/dashboards/my/Shared";
import { cn } from "@/lib/utils";

export type RmCol = {
  key: string;
  label: string;
  /** Header tooltip — how the column is measured. */
  title?: string;
  /** null = not applicable on this row. */
  get: (r: RmLedgerRow) => number | null;
  format?: "currency" | "count" | "percent";
  tone?: (v: number | null, r: RmLedgerRow) => Tone;
  /** "sum" (default) · "none" · a function computing the total from the rows. */
  total?: "sum" | "none" | ((rows: RmLedgerRow[]) => number | null);
  /** Optional link for a cell (e.g. the list behind the count). */
  href?: (r: RmLedgerRow) => string | null;
  /** Custom cell body; the numeric value still drives the total. */
  render?: (r: RmLedgerRow) => ReactNode;
};

const NOT_A_PERSON =
  "Not applicable — this row groups the branch's clients, not one person's work.";

export function RmTable({
  rows,
  cols,
  rmHref,
  empty = "No relationship managers in this view.",
  totalLabel = "Branch total",
  showTotal = true,
}: {
  rows: RmLedgerRow[];
  cols: RmCol[];
  /** Link for an RM's name — the one-on-one view. */
  rmHref: (id: string) => string;
  empty?: string;
  totalLabel?: string;
  showTotal?: boolean;
}) {
  const totals = cols.map((c) => {
    if (c.total === "none") return null;
    if (typeof c.total === "function") return c.total(rows);
    let any = false;
    let s = 0;
    for (const r of rows) {
      const v = c.get(r);
      if (v != null) { any = true; s += v; }
    }
    return any ? s : null;
  });

  return (
    <Table
      rows={rows.length}
      empty={empty}
      head={
        <>
          <th scope="col" className="sticky left-0 z-10 bg-secondary">RM</th>
          {cols.map((c) => (
            <th key={c.key} scope="col" className="whitespace-nowrap text-right" title={c.title}>
              {c.label}
            </th>
          ))}
        </>
      }
    >
      {rows.map((r) => {
        const person = r.kind === "person";
        return (
          <tr key={r.id}>
            <td className="sticky left-0 z-10 whitespace-nowrap bg-card py-2.5">
              {person ? (
                <Link href={rmHref(r.id)} className="font-medium hover:text-primary hover:underline">
                  {r.name}
                </Link>
              ) : (
                <span
                  className="text-muted-foreground"
                  title={r.kind === "other_branch"
                    ? "Clients of this branch whose RM works in another branch. Shown so the column totals equal the branch figures."
                    : "Clients of this branch with no RM assigned. Shown so the column totals equal the branch figures."}
                >
                  {r.name}
                </span>
              )}
              {person && !r.active && <span className="ml-1.5 text-2xs text-muted-foreground">inactive</span>}
            </td>
            {cols.map((c) => {
              const v = c.get(r);
              const href = c.href?.(r) ?? null;
              const body = c.render ? c.render(r) : (
                <Figure
                  value={v}
                  format={c.format ?? "count"}
                  decimals={c.format === "percent" ? 0 : undefined}
                  unavailable={person ? "Nothing to measure yet." : NOT_A_PERSON}
                />
              );
              return (
                <Num key={c.key} tone={c.tone ? c.tone(v, r) : "neutral"} className="whitespace-nowrap">
                  {href && v != null && v !== 0 ? (
                    <Link href={href} className="hover:text-primary hover:underline">{body}</Link>
                  ) : body}
                </Num>
              );
            })}
          </tr>
        );
      })}
      {showTotal && rows.length > 1 && (
        <tr className="border-t-2 border-border font-semibold">
          <td className="sticky left-0 z-10 bg-card py-2.5">{totalLabel}</td>
          {cols.map((c, i) => (
            <Num key={c.key} className={cn("whitespace-nowrap font-semibold")}>
              <Figure
                value={totals[i]}
                format={c.format ?? "count"}
                decimals={c.format === "percent" ? 0 : undefined}
                unavailable="No total for this column."
              />
            </Num>
          ))}
        </tr>
      )}
    </Table>
  );
}

/** Rows that belong in an RM table: people who carry clients or an RM role, plus the synthetic rows. */
export function rmRows(rows: RmLedgerRow[]): RmLedgerRow[] {
  return rows.filter((r) => r.isRm);
}

/** People only — for work tables where the synthetic rows have nothing to show. */
export function peopleRows(rows: RmLedgerRow[], keep?: (r: RmLedgerRow) => boolean): RmLedgerRow[] {
  return rows.filter((r) => r.kind === "person" && (keep ? keep(r) : true));
}
