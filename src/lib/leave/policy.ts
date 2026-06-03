/**
 * Leave policy + helpers.
 *
 * Default annual entitlements per leave type (tenant-wide policy for v1 — no
 * per-employee overrides yet). Balances are computed: entitlement − approved
 * days in the current financial year. `null` entitlement = uncapped (unpaid).
 *
 * India FY runs Apr–Mar; usage is summed within the current FY.
 */

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: "Casual Leave",
  sick: "Sick Leave",
  earned: "Earned / Privilege Leave",
  unpaid: "Unpaid Leave",
  comp_off: "Comp-off",
  other: "Other",
};

export const LEAVE_DURATION_LABELS: Record<string, string> = {
  full_day: "Full day",
  half_day: "Half day",
};

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Default annual entitlement (days) per type. null = uncapped. */
export const LEAVE_ENTITLEMENTS: Record<string, number | null> = {
  casual: 12,
  sick: 6,
  earned: 15,
  comp_off: null,
  unpaid: null,
  other: null,
};

/** Start of the current Indian financial year (Apr 1) as YYYY-MM-DD. */
export function currentFyStart(today = new Date()): string {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${y}-04-01`;
}

/**
 * Inclusive working-day count between two YYYY-MM-DD dates. Half-day → 0.5.
 * Counts calendar days inclusive (Indian MFD offices commonly work Saturdays);
 * the form lets the user override.
 */
export function computeDays(fromDate: string, toDate: string, duration: "full_day" | "half_day"): number {
  if (duration === "half_day") return 0.5;
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T00:00:00");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}
