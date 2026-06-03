/**
 * StatusChips — a counted, clickable status-filter bar (Sanchay parity).
 *
 * Renders a horizontal row of chips like:  All 242 · New 14 · In Process 1 …
 * Each chip is a deep link that sets `paramKey` to its value while preserving
 * the other current query params; the active chip is highlighted. Server
 * component (pure links) — drop it atop any list page.
 *
 *   <StatusChips
 *     basePath="/dashboard/investors"
 *     paramKey="kyc"
 *     current={sp.kyc ?? ""}
 *     params={sp}
 *     chips={[{ value: "", label: "All", count: total }, ...]}
 *   />
 */

import Link from "next/link";

export type StatusChip = {
  value: string;
  label: string;
  count?: number;
  tone?: "rose" | "amber" | "emerald" | "violet" | "sky" | "slate";
};

const ACTIVE_TONE: Record<string, string> = {
  rose: "border-rose-300 bg-rose-50 text-rose-700",
  amber: "border-amber-300 bg-amber-50 text-amber-700",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700",
  violet: "border-violet-300 bg-violet-50 text-violet-700",
  sky: "border-sky-300 bg-sky-50 text-sky-700",
  slate: "border-slate-300 bg-slate-100 text-slate-700",
};

function buildHref(basePath: string, params: Record<string, string | undefined>, paramKey: string, value: string) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === paramKey || v == null || v === "") continue;
    usp.set(k, v);
  }
  if (value) usp.set(paramKey, value);
  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function StatusChips({
  basePath,
  paramKey,
  current,
  params,
  chips,
}: {
  basePath: string;
  paramKey: string;
  current: string;
  params: Record<string, string | undefined>;
  chips: StatusChip[];
}) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {chips.map((c) => {
        const active = (current ?? "") === c.value;
        const tone = c.tone ?? "slate";
        return (
          <Link
            key={c.value || "__all"}
            href={buildHref(basePath, params, paramKey, c.value)}
            className={`shrink-0 rounded-lg border px-3 py-2 min-w-[96px] transition-colors ${
              active ? ACTIVE_TONE[tone] : "border-border bg-card hover:bg-secondary/50"
            }`}
          >
            <div className="text-[11px] text-muted-foreground leading-none">{c.label}</div>
            <div className={`text-lg font-bold tabular-nums leading-tight mt-1 ${active ? "" : "text-foreground"}`}>{c.count ?? 0}</div>
          </Link>
        );
      })}
    </div>
  );
}
