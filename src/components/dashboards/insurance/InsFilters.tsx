"use client";

/**
 * The command centre's filter bar. Every filter is a URL param (parsed by
 * lib/dashboard/insurance/params.ts), so a view can be bookmarked and shared.
 * Only values the CRM holds are offered: product groups from the policy-type
 * picklist, insurers and sources as keyed, branches and people who exist.
 * On a phone the pickers fold behind one "Filters" button.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useDashboardNav } from "@/components/dashboards/system/DashboardNav";
import { useState } from "react";
import {
  Ban, Briefcase, Building2, Factory, FileWarning, Filter, Layers, Landmark, ListChecks, Repeat, Shapes, SlidersHorizontal, Tag, UserCheck, UserRound, Users, Wallet,
} from "lucide-react";
import { Select } from "@/components/ui/Select";
import { buttonClass } from "@/components/ui/button-class";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

const KEYS = ["line", "nature", "grp", "branch", "rm", "exec", "insurer", "cat", "ctype", "mf", "pst", "band", "src", "cst", "ctyp", "ind", "lr"] as const;

export function InsFilters({
  branches, owners, execs, groups, insurers, sources, statuses, bands, claimGroups, claimTypes, industries = [], lossReasons = [], resetHref, active,
}: {
  /** Null when the viewer is locked to one branch. */
  branches: Opt[] | null;
  owners: Opt[];
  execs: Opt[];
  groups: Opt[];
  insurers: Opt[];
  sources: Opt[];
  statuses: Opt[];
  bands: Opt[];
  claimGroups: Opt[];
  claimTypes: Opt[];
  /** Clients' occupation / nature of business as keyed — the CRM has no industry field. */
  industries?: Opt[];
  /** Lapse / cancellation reasons recorded on policies. */
  lossReasons?: Opt[];
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
          {[{ key: "", label: "All insurance" }, { key: "personal", label: "Personal" }, { key: "commercial", label: "Commercial" }].map((o) => {
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
        <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5" role="group" aria-label="Business nature">
          {[{ key: "", label: "New + Renewal" }, { key: "new", label: "New" }, { key: "renewal", label: "Renewal" }].map((o) => {
            const on = val("nature") === o.key;
            return (
              <button key={o.label} type="button" aria-pressed={on} onClick={() => set("nature", o.key)}
                className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
                  on ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {o.label}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="ins-filter-fields"
          className={cn(buttonClass("secondary", "sm"), "lg:hidden")}>
          <SlidersHorizontal className="size-3.5" aria-hidden /> {open ? "Hide filters" : "Filters"}{applied ? ` · ${applied}` : ""}
        </button>
      </div>
      <div id="ins-filter-fields" className={cn("space-y-2 lg:block", open ? "block" : "hidden")}>
        <div className="flex flex-wrap items-center gap-2">
          {sel("grp", "Any product", groups, <Shapes className="size-3.5" />, "w-52")}
          {branches && sel("branch", "All branches", branches, <Building2 className="size-3.5" />)}
          {sel("rm", "Any RM / owner", owners, <UserRound className="size-3.5" />)}
          {sel("exec", "Any insurance executive", execs, <UserCheck className="size-3.5" />, "w-52")}
          {sel("src", "Any source", sources, <Tag className="size-3.5" />)}
          {sel("insurer", "Any insurer", insurers, <Landmark className="size-3.5" />, "w-52")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sel("cat", "Any client category", [
            { value: "A", label: "Category A" }, { value: "B", label: "Category B" }, { value: "C", label: "Category C" },
            { value: "D", label: "Category D" }, { value: "none", label: "Uncategorised" },
          ], <Filter className="size-3.5" />, "w-48")}
          {sel("ctype", "Any client type", [
            { value: "individual", label: "Individual" }, { value: "family", label: "Family" }, { value: "corporate", label: "Corporate" },
          ], <Users className="size-3.5" />)}
          {sel("mf", "MF relationship", [
            { value: "yes", label: "Existing MF client" }, { value: "no", label: "Insurance-only client" },
          ], <Briefcase className="size-3.5" />)}
          {sel("pst", "Any policy status", statuses, <ListChecks className="size-3.5" />)}
          {sel("band", "Any premium band", bands, <Wallet className="size-3.5" />, "w-48")}
          {sel("cst", "Any claim status", claimGroups, <FileWarning className="size-3.5" />)}
          {sel("ctyp", "Any claim type", claimTypes, <Layers className="size-3.5" />)}
          {sel("ind", "Any industry", industries, <Factory className="size-3.5" />, "w-52")}
          {sel("lr", "Any loss reason", lossReasons, <Ban className="size-3.5" />, "w-52")}
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
