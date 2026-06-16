"use client";

/**
 * Investor list sort dropdown. A single Select that writes `?sort` + `?dir`
 * (the same params the column-header arrows use, so the two stay in sync). The
 * direction is encoded in each option ("col:dir") so the dropdown offers
 * ascending AND descending — including a sort by date added.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowDownUp } from "lucide-react";
import { Select } from "@/components/ui/Select";

const OPTIONS = [
  { value: "aum:desc", label: "AUM — high to low" },
  { value: "aum:asc", label: "AUM — low to high" },
  { value: "created:desc", label: "Date added — newest" },
  { value: "created:asc", label: "Date added — oldest" },
  { value: "name:asc", label: "Name — A to Z" },
  { value: "name:desc", label: "Name — Z to A" },
  { value: "sip:desc", label: "Monthly SIP — high to low" },
  { value: "sip:asc", label: "Monthly SIP — low to high" },
  { value: "health:asc", label: "Health — worst first" },
  { value: "health:desc", label: "Health — best first" },
];

export function InvestorSortSelect({ sort, dir }: { sort: string; dir: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = `${sort}:${dir}`;

  function onChange(v: string) {
    const [col, d] = v.split(":");
    const p = new URLSearchParams(sp.toString());
    // AUM is the implicit default — keep the URL clean by dropping the param.
    if (col === "aum") p.delete("sort");
    else p.set("sort", col);
    p.set("dir", d);
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <Select
      size="sm"
      leadingIcon={<ArrowDownUp className="size-3.5 text-muted-foreground" />}
      value={OPTIONS.some((o) => o.value === current) ? current : "aum:desc"}
      onChange={onChange}
      options={OPTIONS}
      ariaLabel="Sort investors"
      className="min-w-[12rem]"
    />
  );
}
