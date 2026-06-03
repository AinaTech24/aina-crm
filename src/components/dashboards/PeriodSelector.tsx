"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays } from "lucide-react";
import { PERIOD_LABELS, type Period } from "@/lib/dashboard/period";

// Re-export the type for existing importers of this module.
export type { Period };

/**
 * Period selector — MTD / QTD / FYTD / Last Month.
 *
 * Purely a URL-param writer. The server OwnerCockpit reads ?period= and
 * adjusts its SQL date ranges accordingly. No client-side state beyond
 * the navigation transition.
 *
 * India FY = April–March. QTD quarters:
 *   Q1: Apr–Jun · Q2: Jul–Sep · Q3: Oct–Dec · Q4: Jan–Mar
 */
export function PeriodSelector({ current }: { current: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pstart = searchParams.get("pstart") ?? "";

  function select(p: Period) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pstart");
    if (p === "mtd") params.delete("period");
    else params.set("period", p);
    const qs = params.toString();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  function selectCustom(d: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (d) { params.set("period", "custom"); params.set("pstart", d); }
    else { params.delete("period"); params.delete("pstart"); }
    const qs = params.toString();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  return (
    <div
      className={`inline-flex rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm p-0.5 gap-0.5 ${
        pending ? "opacity-60 pointer-events-none" : ""
      }`}
    >
      {(Object.keys(PERIOD_LABELS) as Array<"mtd" | "qtd" | "fytd" | "lm">).map((p) => (
        <button
          key={p}
          onClick={() => select(p)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
            current === p
              ? "bg-white text-slate-900 shadow-sm"
              : "text-white/75 hover:text-white hover:bg-white/10"
          }`}
        >
          {p === "mtd" && <CalendarDays className="size-3" />}
          {PERIOD_LABELS[p]}
        </button>
      ))}
      <label
        className={`px-2 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
          current === "custom" ? "bg-white text-slate-900 shadow-sm" : "text-white/75 hover:text-white hover:bg-white/10"
        }`}
        title="Custom — show everything since this date"
      >
        <CalendarDays className="size-3" />
        <span>Since</span>
        <input
          type="date"
          value={pstart}
          onChange={(e) => selectCustom(e.target.value)}
          className="bg-transparent text-xs outline-none w-[7.5rem]"
        />
      </label>
    </div>
  );
}
