"use client";

/**
 * The four quick filters above the Leads board and list: My leads, Overdue
 * follow-up, Source and RM — one click each, always visible.
 *
 * Each is a URL param the page already reads (mine=1, followup_overdue=1,
 * source=, owner=), so a filtered view is linkable and survives a refresh. The
 * Filters dropdown still has the multi-select versions of Source and RM; a
 * value picked there shows here as "Several".
 *
 * (This file used to hold a server-rendered strip of seven counted chips that
 * the page had commented out; its stage list and param names had drifted.)
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlarmClock, UserRound } from "lucide-react";

const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors";
const OFF = "border-border bg-card text-foreground/80 hover:bg-secondary";
const ON = "border-primary/30 bg-primary/10 text-primary";

export function LeadQuickFilters({
  sources,
  rms,
}: {
  sources: readonly { value: string; label: string }[];
  /** Offered only when there is more than one RM to choose between. */
  rms: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(next: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page"); // a new filter starts from the first page
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const mine = sp.get("mine") === "1";
  const overdue = sp.get("followup_overdue") === "1";
  const source = sp.get("source") ?? "";
  const owner = sp.get("owner") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick filters">
      <button
        type="button"
        aria-pressed={mine}
        onClick={() => set({ mine: mine ? null : "1" })}
        className={`${CHIP} ${mine ? ON : OFF}`}
      >
        <UserRound className="size-3.5" /> My leads
      </button>
      <button
        type="button"
        aria-pressed={overdue}
        onClick={() => set({ followup_overdue: overdue ? null : "1" })}
        className={`${CHIP} ${overdue ? ON : OFF}`}
      >
        <AlarmClock className="size-3.5" /> Overdue follow-up
      </button>
      <select
        aria-label="Source"
        value={source}
        onChange={(e) => set({ source: e.target.value || null })}
        className={`${CHIP} ${source ? ON : OFF} cursor-pointer pr-8`}
      >
        <option value="">Source: all</option>
        {source.includes(",") && <option value={source}>Source: several</option>}
        {sources.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {rms.length > 1 && (
        <select
          aria-label="RM"
          value={owner}
          onChange={(e) => set({ owner: e.target.value || null })}
          className={`${CHIP} ${owner ? ON : OFF} cursor-pointer pr-8`}
        >
          <option value="">RM: all</option>
          {owner.includes(",") && <option value={owner}>RM: several</option>}
          {rms.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
