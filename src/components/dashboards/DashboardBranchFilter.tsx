"use client";

/**
 * Branch selector for the firm dashboard.
 *
 * Date and team-member filters already existed (DashboardHeaderBar and
 * DashboardMemberFilter); branch was the one leg of the trio missing, even
 * though `branches` is a real table and leads / investors / activities /
 * insurance_policies / insurance_claims all carry `branch_id`.
 *
 * Writes `?branch=<id>` and preserves every other search param so it composes
 * with the period and member filters rather than resetting them.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { Select } from "@/components/ui/Select";

export function DashboardBranchFilter({
  branches,
  selected,
}: {
  branches: { id: string; name: string }[];
  selected?: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // Nothing to choose between on a single-branch firm — most MFD firms start
  // that way, and a dropdown with one option is noise.
  if (branches.length < 2) return null;

  function go(value: string) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value) next.set("branch", value);
    else next.delete("branch");
    const qs = next.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
  }

  return (
    <Select
      size="sm"
      value={selected ?? ""}
      onChange={go}
      leadingIcon={<Building2 className="size-3.5" />}
      ariaLabel="Filter by branch"
      options={[
        { value: "", label: "All branches" },
        ...branches.map((b) => ({ value: b.id, label: b.name })),
      ]}
    />
  );
}
