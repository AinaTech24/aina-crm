"use client";

/**
 * View switcher for the Tasks page — a branded custom dropdown (replaces the old
 * row of tabs). Sets ?view=<key> while PRESERVING the other query params
 * (search, status, priority, sort…) so "Assigned to me / by me" compose with the
 * active filters instead of resetting the page.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select } from "@/components/ui/Select";

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

  function onChange(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set("view", v);
    else params.delete("view");
    // Re-scoping restarts from the first page of the new result set.
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="w-52">
      <Select value={current} ariaLabel="View" options={VIEWS} onChange={onChange} />
    </div>
  );
}
