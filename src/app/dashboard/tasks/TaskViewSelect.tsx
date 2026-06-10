"use client";

/**
 * View switcher for the Tasks page — a branded custom dropdown (replaces the old
 * row of tabs). Navigates to ?view=<key> on change.
 */

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";

const VIEWS = [
  { value: "", label: "All tasks" },
  { value: "to_me", label: "Assigned to me" },
  { value: "by_me", label: "Assigned by me" },
  { value: "kanban", label: "Kanban board" },
];

export function TaskViewSelect({ current }: { current: string }) {
  const router = useRouter();
  return (
    <div className="w-52">
      <Select
        value={current}
        ariaLabel="View"
        options={VIEWS}
        onChange={(v) => router.push(v ? `/dashboard/tasks?view=${v}` : "/dashboard/tasks")}
      />
    </div>
  );
}
