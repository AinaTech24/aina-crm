"use client";

/**
 * The Claims Control Centre's filter bar. Every filter is a URL param
 * (lib/dashboard/claims/params.ts), so a view can be bookmarked and shared.
 * Only values the CRM holds are offered: its own status, type and mode
 * picklists, insurers as keyed, people and branches that exist. The CRM has
 * no TPA, priority or claim-executive field, so there is no filter for them.
 * On a phone the pickers fold behind one "Filters" button.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useDashboardNav } from "@/components/dashboards/system/DashboardNav";
import { useState } from "react";
import {
  Building2, CalendarClock, ClipboardList, FileCheck2, Flag, Gauge, Hourglass, Landmark, Layers, ListChecks, Repeat, Scale, Shapes,
  SlidersHorizontal, UserCheck, UserRound, Wallet,
} from "lucide-react";
import { Select } from "@/components/ui/Select";
import { buttonClass } from "@/components/ui/button-class";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };
const KEYS = ["line", "grp", "ctyp", "cst", "mode", "branch", "rm", "own", "insurer", "val", "pw", "doc", "sla", "age", "out", "act"] as const;

export function ClaimFilters({
  branches, staff, groups, insurers, statuses, types, modes, bands, pendingWith, ages, resetHref, active,
}: {
  /** Null when the viewer is locked to one branch. */
  branches: Opt[] | null;
  staff: Opt[];
  groups: Opt[];
  insurers: Opt[];
  statuses: Opt[];
  types: Opt[];
  modes: Opt[];
  bands: Opt[];
  pendingWith: Opt[];
  ages: Opt[];
  resetHref: string;
  active: boolean;
}) {
  const nav = useDashboardNav();
  const pathname = usePathname();
  const params = useSearchParams();
  const val = (k: string) => params?.get(k) ?? "";
  const [open, setOpen] = useState(false);
  const applied = KEYS.filter((k) => val(k)).length;

  function set(k: string, v: string) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("wf");
    const qs = next.toString();
    nav.go(`${pathname}${qs ? `?${qs}` : ""}`);
  }
  const sel = (k: string, label: string, options: Opt[], icon: React.ReactNode, width = "w-44") =>
    options.length === 0 ? null : (
      <Select size="sm" value={val(k)} onChange={(v) => set(k, v)} searchable={options.length > 8} className={width}
        leadingIcon={icon} ariaLabel={label} options={[{ value: "", label }, ...options]} />
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5" role="group" aria-label="Business type">
          {[{ key: "", label: "All claims" }, { key: "personal", label: "Personal Lines" }, { key: "commercial", label: "Commercial Lines" }].map((o) => {
            const on = val("line") === o.key;
            return (
              <button key={o.label} type="button" aria-pressed={on} onClick={() => set("line", o.key)}
                className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
                  on ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {o.label}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="claim-filter-fields"
          className={cn(buttonClass("secondary", "sm"), "lg:hidden")}>
          <SlidersHorizontal className="size-3.5" aria-hidden /> {open ? "Hide filters" : "Filters"}{applied ? ` · ${applied}` : ""}
        </button>
      </div>
      <div id="claim-filter-fields" className={cn("space-y-2 lg:block", open ? "block" : "hidden")}>
        <div className="flex flex-wrap items-center gap-2">
          {sel("grp", "Any product", groups, <Shapes className="size-3.5" />, "w-52")}
          {sel("ctyp", "Any claim type", types, <Layers className="size-3.5" />)}
          {sel("cst", "Any status", statuses, <ListChecks className="size-3.5" />)}
          {sel("mode", "Any claim mode", modes, <Scale className="size-3.5" />)}
          {sel("insurer", "Any insurer", insurers, <Landmark className="size-3.5" />, "w-52")}
          {branches && sel("branch", "All branches", branches, <Building2 className="size-3.5" />)}
          {sel("rm", "Any client RM", staff, <UserRound className="size-3.5" />)}
          {sel("own", "Any claim owner", [{ value: "none", label: "Owner missing" }, ...staff], <UserCheck className="size-3.5" />)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sel("val", "Any claim value", bands, <Wallet className="size-3.5" />, "w-48")}
          {sel("pw", "Pending with anyone", pendingWith, <Hourglass className="size-3.5" />, "w-48")}
          {sel("doc", "Any document status", [
            { value: "complete", label: "Checklist complete" }, { value: "partial", label: "Checklist incomplete" }, { value: "none", label: "No documents on file" },
          ], <FileCheck2 className="size-3.5" />, "w-48")}
          {sel("sla", "Any SLA status", [
            { value: "within", label: "Within SLA" }, { value: "approaching", label: "Approaching SLA" }, { value: "breached", label: "SLA breached" },
          ], <Gauge className="size-3.5" />)}
          {sel("age", "Any ageing", ages, <CalendarClock className="size-3.5" />)}
          {sel("out", "Any outcome", [
            { value: "settled_fully", label: "Settled" }, { value: "settled_partially", label: "Part settled" },
            { value: "rejected", label: "Rejected" }, { value: "withdrawn", label: "Withdrawn" },
          ], <Flag className="size-3.5" />)}
          {sel("act", "Next action with anyone", [{ value: "none", label: "No next action" }, ...staff], <ClipboardList className="size-3.5" />, "w-52")}
          {active && (
            <Link href={resetHref} className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-accent">
              <Repeat className="size-3" aria-hidden /> Reset filters
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
