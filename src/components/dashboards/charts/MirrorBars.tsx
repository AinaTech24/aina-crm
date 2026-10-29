/**
 * Two shares of the same bands, back to back: share of clients to the left,
 * share of AUM to the right (both %, one scale). A band with no record
 * ("Date of birth not recorded") is drawn grey — a record gap, not an age.
 * Plain HTML. Server-safe.
 */

import { CHART } from "@/lib/dashboard/chart-palette";

export type MirrorRow = { label: string; left: number; right: number; gap?: boolean };

export function MirrorBars({ rows, leftLabel, rightLabel }: { rows: MirrorRow[]; leftLabel: string; rightLabel: string }) {
  const max = Math.max(...rows.flatMap((r) => [r.left, r.right]), 1);
  const w = (v: number) => `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-12 gap-2 text-2xs text-muted-foreground">
        <span className="col-span-4 text-right">← {leftLabel}</span>
        <span className="col-span-4" />
        <span className="col-span-4">{rightLabel} →</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-12 items-center gap-2 text-xs"
          title={`${r.label}: ${r.left.toFixed(1)}% of ${leftLabel.toLowerCase()}, ${r.right.toFixed(1)}% of ${rightLabel.toLowerCase()}`}>
          <span className="col-span-4 flex items-center justify-end gap-1.5">
            <span className="tabular-nums text-muted-foreground">{r.left.toFixed(0)}%</span>
            <span className="h-3.5 rounded" style={{ width: w(r.left), background: r.gap ? CHART.slate : CHART.blue, opacity: r.gap ? 0.5 : 1 }} />
          </span>
          <span className={`col-span-4 truncate text-center font-medium ${r.gap ? "text-muted-foreground" : "text-foreground"}`}>{r.label}</span>
          <span className="col-span-4 flex items-center gap-1.5">
            <span className="h-3.5 rounded" style={{ width: w(r.right), background: r.gap ? CHART.slate : CHART.indigo, opacity: r.gap ? 0.5 : 1 }} />
            <span className="tabular-nums text-muted-foreground">{r.right.toFixed(0)}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}
