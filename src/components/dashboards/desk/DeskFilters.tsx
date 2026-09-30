"use client";

/**
 * The desk's client filters. Each writes one URL param and keeps every other,
 * so the period, the action day and the rest survive a change.
 *
 *   cat      A,B,C,D,none (several)      ctype   head · member · individual
 *   cnew     new · existing (this FY)    cstatus active · inactive
 *   city     address city                src     lead source ("__none__" = no lead)
 *   fam      one family
 *
 * They narrow the CLIENT side of the page (see ClientFilter in
 * lib/dashboard/my/window.ts); the RM's own tasks, leads and meetings are
 * their work, not a slice of the book, and are not filtered. The owner is
 * always "Me" — the desk shows no one else's book.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useDashboardNav } from "@/components/dashboards/system/DashboardNav";
import { Lock, X } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

export function DeskFilters({
  cities, sources, families,
}: {
  cities: Opt[];
  sources: Opt[];
  families: Opt[];
}) {
  const nav = useDashboardNav();
  const pathname = usePathname();
  const params = useSearchParams();
  const get = (k: string) => params?.get(k) ?? "";
  const cats = get("cat").split(",").filter(Boolean);

  function go(next: URLSearchParams) {
    const qs = next.toString();
    nav.go(`${pathname}${qs ? `?${qs}` : ""}`);
  }
  function set(k: string, v: string | null) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (v) next.set(k, v);
    else next.delete(k);
    go(next);
  }
  function toggleCat(c: string) {
    const nextCats = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c];
    set("cat", nextCats.join(",") || null);
  }
  function clearAll() {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const k of ["cat", "ctype", "cnew", "cstatus", "city", "src", "fam"]) next.delete(k);
    go(next);
  }
  const active = ["cat", "ctype", "cnew", "cstatus", "city", "src", "fam"].filter((k) => get(k)).length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="chip bg-secondary text-secondary-foreground" title="The desk always shows your own book.">
        <Lock className="size-3" aria-hidden /> Owner: Me
      </span>
      <div className="flex items-center gap-1" role="group" aria-label="Client category">
        <span className="text-2xs text-muted-foreground">Category</span>
        {(["A", "B", "C", "D", "none"] as const).map((c) => (
          <button key={c} type="button" onClick={() => toggleCat(c)} aria-pressed={cats.includes(c)}
            className={cn("inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-semibold transition-colors",
              cats.includes(c) ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground")}>
            {c === "none" ? "Uncategorised" : c}
          </button>
        ))}
      </div>
      <Select size="sm" className="w-36" ariaLabel="Client type" value={get("ctype")} onChange={(v) => set("ctype", v || null)}
        options={[{ value: "", label: "Any client type" }, { value: "head", label: "Family head" },
                  { value: "member", label: "Family member" }, { value: "individual", label: "Individual" }]} />
      <Select size="sm" className="w-36" ariaLabel="New or existing" value={get("cnew")} onChange={(v) => set("cnew", v || null)}
        options={[{ value: "", label: "New & existing" }, { value: "new", label: "New this FY" }, { value: "existing", label: "Existing" }]} />
      <Select size="sm" className="w-32" ariaLabel="Active or inactive" value={get("cstatus")} onChange={(v) => set("cstatus", v || null)}
        options={[{ value: "", label: "Any status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
      {cities.length > 0 && (
        <Select size="sm" className="w-36" ariaLabel="City" searchable={cities.length > 8} value={get("city")}
          onChange={(v) => set("city", v || null)} options={[{ value: "", label: "Any city" }, ...cities]} />
      )}
      {sources.length > 0 && (
        <Select size="sm" className="w-40" ariaLabel="Source" searchable={sources.length > 8} value={get("src")}
          onChange={(v) => set("src", v || null)} options={[{ value: "", label: "Any source" }, ...sources]} />
      )}
      {families.length > 0 && (
        <Select size="sm" className="w-44" ariaLabel="Family" searchable value={get("fam")}
          onChange={(v) => set("fam", v || null)} options={[{ value: "", label: "Any family" }, ...families]} />
      )}
      {active > 0 && (
        <button type="button" onClick={clearAll}
          className="inline-flex min-h-6 items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-3" aria-hidden /> Clear {active} client filter{active === 1 ? "" : "s"}
        </button>
      )}
      <span className="w-full text-2xs text-muted-foreground sm:w-auto">
        Client filters narrow client figures; your own tasks, leads and meetings are not filtered.
      </span>
    </div>
  );
}
