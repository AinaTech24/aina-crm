"use client";

/**
 * A dropdown that sets ONE search param and keeps every other one.
 *
 * The branch command centre's two pickers — which branch (only for a viewer
 * permitted to see other branches) and which RM — are both "narrow the same
 * page", never "go somewhere else", so they must not drop the period, the
 * target horizon or the redemption threshold the reader already chose. The
 * director cockpit's member picker rebuilds the query from scratch, which is
 * right there and wrong here.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useDashboardNav } from "@/components/dashboards/system/DashboardNav";
import { Building2, Users } from "lucide-react";
import { Select } from "@/components/ui/Select";

export function ParamSelect({
  param,
  value,
  options,
  allLabel,
  icon = "users",
  ariaLabel,
  clear = [],
}: {
  param: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  /** The "no filter" entry. Omit to force a choice (the branch picker). */
  allLabel?: string;
  icon?: "users" | "branch";
  ariaLabel: string;
  /** Params that stop meaning anything once this one changes. */
  clear?: string[];
}) {
  const nav = useDashboardNav();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(v: string) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (v) next.set(param, v);
    else next.delete(param);
    for (const c of clear) next.delete(c);
    const qs = next.toString();
    nav.go(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  const Icon = icon === "branch" ? Building2 : Users;
  return (
    <Select
      size="sm"
      value={value}
      onChange={go}
      searchable={options.length > 8}
      className="w-48"
      leadingIcon={<Icon className="size-3.5" />}
      ariaLabel={ariaLabel}
      options={[...(allLabel != null ? [{ value: "", label: allLabel }] : []), ...options]}
    />
  );
}
