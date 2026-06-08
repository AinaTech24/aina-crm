"use client";

import { useRouter } from "next/navigation";

/**
 * Module switcher for the unified "Work" area — Tasks, Service Requests and
 * Complaints are one operational hub now, selected via this dropdown instead of
 * three separate sidebar items. Each option routes to its page (which keeps its
 * own server-side access gate, so the dropdown can safely list all three).
 */
const WORK_OPTIONS = [
  { value: "/dashboard/tasks", label: "Tasks" },
  { value: "/dashboard/service-requests", label: "Service Requests" },
  { value: "/dashboard/complaints", label: "Complaints" },
];

export function WorkSwitcher({
  current,
  options = WORK_OPTIONS,
  label = "View",
}: {
  current: string;
  options?: { value: string; label: string }[];
  label?: string;
}) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={current}
        onChange={(e) => router.push(e.target.value)}
        className="rounded-md border bg-background px-2.5 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring/40"
        aria-label="Switch view"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
