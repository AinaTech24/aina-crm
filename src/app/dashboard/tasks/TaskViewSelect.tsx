"use client";

/**
 * View switcher for the Tasks page — a segmented TAB bar (All / Assigned to me /
 * Assigned by me / Kanban board). Sets ?view=<key> while PRESERVING the other
 * query params (search, status, priority, sort…) so the tabs compose with the
 * active filters instead of resetting the page.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const VIEWS = [
  { value: "", label: "All tasks" },
  { value: "to_me", label: "Assigned to me" },
  { value: "by_me", label: "Assigned by me" },
  { value: "kanban", label: "Kanban board" },
];

export function TaskViewSelect({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(v: string) {
    if (v === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("view", v);
    else params.delete("view");
    // Re-scoping restarts from the first page of the new result set.
    params.delete("page");
    // The kanban's columns ARE the statuses, so a lingering status/due filter
    // would collapse the board to one column. Clear those when entering it.
    if (v === "kanban") {
      params.delete("status");
      params.delete("due");
      params.delete("page");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
      {VIEWS.map((v) => {
        const active = current === v.value;
        return (
          <button
            key={v.value || "all"}
            type="button"
            onClick={() => go(v.value)}
            aria-pressed={active}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-card/60"
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
