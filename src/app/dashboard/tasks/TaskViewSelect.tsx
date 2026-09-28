"use client";

/**
 * Tasks view controls — three independent axes, all in the URL:
 *
 *   ?tab=    ""  (all open) | overdue | today | upcoming | completed
 *   ?view=   ""  (all)      | to_me   | by_me          — the scope dropdown
 *   ?layout= ""  (list)     | kanban                   — "List" / "Board"
 *
 * The quick tabs are WHEN (the question people open Tasks to answer); the
 * scope is WHOSE. They used to be one segmented row of whose-tabs with no
 * when at all, so an RM with July reminders still open had to build a due
 * filter by hand to find them. Tabs are a list thing: the board's columns are
 * already the statuses, so it keeps only the scope and layout controls.
 *
 * Every control keeps the other query params (search, priority, sort…) so it
 * composes with the active filters instead of resetting the page.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";

const TABS = [
  { value: "", label: "All open" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
];

const SCOPES = [
  { value: "", label: "All tasks" },
  { value: "to_me", label: "Assigned to me" },
  { value: "by_me", label: "Assigned by me" },
];

export function TaskViewSelect({
  current,
  layout,
  tab,
  overdueCount,
}: {
  current: string;
  layout: string;
  tab: string;
  overdueCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(params: URLSearchParams) {
    params.delete("page"); // any re-scope starts from the first page
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function goTab(v: string) {
    if (v === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("tab", v);
    else params.delete("tab");
    // A tab decides status and due by itself; a lingering Status / Due filter
    // from the Filters menu would silently fight it.
    params.delete("status");
    params.delete("due");
    push(params);
  }

  function goScope(v: string) {
    if (v === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("view", v);
    else params.delete("view");
    push(params);
  }

  function goLayout(v: "list" | "kanban") {
    if (v === layout) return;
    const params = new URLSearchParams(searchParams.toString());
    if (v === "kanban") {
      params.set("layout", "kanban");
      // The kanban's columns ARE the statuses, so a lingering status/due/tab
      // filter would collapse the board to one column. Clear them on the way in.
      params.delete("status");
      params.delete("due");
      params.delete("tab");
    } else {
      params.delete("layout");
    }
    push(params);
  }

  const seg = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-card/60"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {layout !== "kanban" && (
        <div role="tablist" aria-label="Which tasks" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
          {TABS.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value || "open"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => goTab(t.value)}
                className={seg(active)}
              >
                {t.label}
                {t.value === "overdue" && (
                  // Red only when something is actually late.
                  <span className={`tabular-nums ${overdueCount > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                    ({overdueCount})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Whose tasks — a dropdown now that the tabs above say which. */}
        <SelectField
          value={current}
          onChange={(e) => goScope(e.target.value)}
          aria-label="Whose tasks"
          size="sm"
          className="w-40"
        >
          {SCOPES.map((s) => (
            <option key={s.value || "all"} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>

        {/* Layout — available in every scope, labelled rather than two bare icons. */}
        <div role="group" aria-label="Layout" className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
          {([
            ["list", List, "List"],
            ["kanban", LayoutGrid, "Board"],
          ] as const).map(([key, Icon, label]) => {
            const active = layout === key;
            return (
              <button key={key} type="button" onClick={() => goLayout(key)} aria-pressed={active} className={seg(active)}>
                <Icon className="size-4" /> {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
