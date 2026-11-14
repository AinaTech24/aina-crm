/**
 * Lays out a dashboard's cards (flowSegments in sizes.ts). A run of
 * half-width cards stands in two columns that end level (BalancedColumns),
 * each card at its own height; every other card sits on its own in the grid.
 * SERVER-safe: no hooks of its own.
 */

import { Fragment, type ReactNode } from "react";
import type { WidgetSize } from "@/lib/dashboards/system/catalog";
import { flowSegments } from "./sizes";
import { BalancedColumns } from "./BalancedColumns";

export function CardFlow({ items }: { items: { key: string; size: WidgetSize; node: ReactNode }[] }) {
  const segments = flowSegments(items.map((it) => it.size));
  return (
    <div className="grid grid-cols-12 gap-4">
      {segments.map((s) => {
        if (s.kind === "one") return <Fragment key={items[s.index].key}>{items[s.index].node}</Fragment>;
        const run = [...s.left, ...s.right].sort((a, b) => a - b);
        return (
          <BalancedColumns
            key={items[run[0]].key}
            items={run.map((i) => ({ key: items[i].key, order: i, node: items[i].node }))}
          />
        );
      })}
    </div>
  );
}
