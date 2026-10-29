/**
 * This period against the same period last year, one line per person: a grey
 * dot for then, a filled dot for now, joined. Growth, slippage and the spread
 * across a team at a glance. Plain HTML with positioned dots. Server-safe.
 */

import Link from "next/link";
import { CHART } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";

export type DumbbellRow = { key: string; name: string; prev: number | null; cur: number; href?: string };

export function Dumbbell({ rows, prevLabel, curLabel }: { rows: DumbbellRow[]; prevLabel: string; curLabel: string }) {
  const values = rows.flatMap((r) => [r.cur, r.prev ?? r.cur]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values, 1);
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const change = r.prev && r.prev > 0 ? ((r.cur - r.prev) / r.prev) * 100 : null;
          const up = r.prev == null || r.cur >= r.prev;
          const left = Math.min(r.cur, r.prev ?? r.cur);
          const right = Math.max(r.cur, r.prev ?? r.cur);
          return (
            <li key={r.key} className="grid grid-cols-12 items-center gap-2 text-sm">
              <span className="col-span-4 truncate sm:col-span-3">
                {r.href ? <Link href={r.href} className="hover:underline">{r.name}</Link> : r.name}
              </span>
              <span className="relative col-span-6 h-5 sm:col-span-7"
                title={`${r.name} · ${prevLabel}: ${r.prev == null ? "not recorded" : formatMoney(r.prev)} · ${curLabel}: ${formatMoney(r.cur)}`}>
                {lo < 0 && <span className="absolute inset-y-0 w-px bg-border" style={{ left: pos(0) }} />}
                <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
                  style={{ left: pos(left), width: `calc(${pos(right)} - ${pos(left)})`, background: up ? CHART.indigo : CHART.slate, opacity: 0.35 }} />
                {r.prev != null && (
                  <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                    style={{ left: pos(r.prev), background: CHART.slate }} />
                )}
                <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: pos(r.cur), background: CHART.indigo }} />
              </span>
              <span className={`col-span-2 text-right text-xs font-semibold tabular-nums ${change == null ? "text-muted-foreground" : up ? "text-emerald-700" : "text-amber-700"}`}>
                {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(0)}%`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        <span><span className="mr-1 inline-block size-2.5 rounded-full align-middle" style={{ background: CHART.slate }} />{prevLabel}</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-full align-middle" style={{ background: CHART.indigo }} />{curLabel}</span>
      </p>
    </div>
  );
}
