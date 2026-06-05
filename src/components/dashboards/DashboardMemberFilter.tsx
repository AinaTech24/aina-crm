"use client";

/**
 * Team-member selector for the owner/branch-head dashboard. Picking a member
 * deep-links to /dashboard?rm=<id>, which swaps the firm-wide OwnerCockpit for
 * that member's RmDashboard (read-only). "Whole firm" clears the scope.
 *
 * Owners only — the dashboard page renders this above the cockpit when the
 * viewer can see the whole firm.
 */

import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Select } from "@/components/ui/Select";

export function DashboardMemberFilter({
  members,
  selected,
  period,
  pstart,
}: {
  members: { id: string; name: string }[];
  selected?: string;
  period?: string;
  pstart?: string;
}) {
  const router = useRouter();

  const options = [
    { value: "", label: "Whole firm" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  function onChange(v: string) {
    const params = new URLSearchParams();
    // Preserve the period selector (mtd is the default — omit it to keep URLs clean).
    if (period && period !== "mtd") params.set("period", period);
    if (period === "custom" && pstart) params.set("pstart", pstart);
    if (v) params.set("rm", v);
    const qs = params.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
        <Users className="size-3.5" /> Viewing
      </span>
      <Select
        value={selected ?? ""}
        onChange={onChange}
        options={options}
        size="sm"
        className="w-56"
        ariaLabel="View dashboard for a team member"
      />
    </div>
  );
}
