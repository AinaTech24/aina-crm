"use client";

/**
 * DataTable — one definition for the list screens.
 *
 * 179 files currently hand-roll a `<table>`; 9 of them use `.table-modern` and
 * 3 use `.table-scroll`. That is why header casing, row height, hover, edge
 * padding and the "nothing here" message differ from one list to the next.
 *
 * Beyond consistency it fixes two things the audit found on real screens:
 *
 *   · Dead columns. On Clients, `Category` and `Tier` are "—" on every row and
 *     still occupy width. `hideWhenEmpty` on a column drops it when no row in
 *     the CURRENT result set has a value, so a filtered view tightens up by
 *     itself and nobody has to maintain a list of which columns to hide.
 *
 *   · Ad-hoc empties. Every table gets the same quiet inline empty state
 *     instead of one of the 474 bespoke strings in the codebase.
 *
 * It is deliberately NOT a data grid. No sorting/paging/virtualisation — the
 * pages that need those already own that state, and taking it over would make
 * this a migration rather than a drop-in.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InlineEmpty } from "@/components/common/EmptyState";

export type Column<Row> = {
  /** Stable key — also used for the `hideWhenEmpty` scan. */
  key: string;
  header: ReactNode;
  /** Cell renderer. Return null/undefined/"" and the cell counts as empty. */
  cell: (row: Row, index: number) => ReactNode;
  /** Right-align numbers. Money and counts should always set this. */
  align?: "left" | "right" | "center";
  /** Drop the column when every row in the current set renders it empty. */
  hideWhenEmpty?: boolean;
  /** Hide below `sm`. Use for anything that is not the row's identity. */
  hideOnMobile?: boolean;
  className?: string;
  width?: string;
};

function isEmptyCell(value: ReactNode): boolean {
  return (
    value === null ||
    value === undefined ||
    value === false ||
    value === "" ||
    value === "—" ||
    value === "-"
  );
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  onRowClick,
  density = "cozy",
  empty,
  caption,
  className,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row, index: number) => string;
  onRowClick?: (row: Row) => void;
  density?: "cozy" | "compact";
  /** Replaces the default inline empty state. */
  empty?: ReactNode;
  /** Screen-reader description of what the table lists. */
  caption?: string;
  className?: string;
}) {
  // Drop columns that are empty across every row currently shown.
  const visible = columns.filter((c) => {
    if (!c.hideWhenEmpty) return true;
    return rows.some((row, i) => !isEmptyCell(c.cell(row, i)));
  });

  if (rows.length === 0) {
    return <>{empty ?? <InlineEmpty message="Nothing to show yet." />}</>;
  }

  const pad = density === "compact" ? "py-2" : "py-3";

  return (
    <div className={cn("table-scroll", className)}>
      <table className="table-modern w-full">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {visible.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  c.align === "right" && "text-right",
                  c.align === "center" && "text-center",
                  c.hideOnMobile && "hidden sm:table-cell",
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer" : undefined}
            >
              {visible.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    pad,
                    c.align === "right" && "text-right tabular-nums",
                    c.align === "center" && "text-center",
                    c.hideOnMobile && "hidden sm:table-cell",
                    c.className,
                  )}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
