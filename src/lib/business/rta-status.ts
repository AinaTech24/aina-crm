/**
 * How a booked line's RTA outcome reads on screen (lib/business/rta-match.ts
 * decides it). Plain module, safe for server and client.
 */

import type { BadgeTone } from "@/components/ui/Badge";

export const RTA_STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting RTA",
  confirmed: "Confirmed by RTA",
  mismatch: "Amount differs",
  rejected: "Rejected by RTA",
  not_found: "Not found in RTA",
  not_applicable: "Not in RTA",
};

/** Red only for a rejection (business lost); amber for what Operations must check. */
export const RTA_STATUS_TONE: Record<string, BadgeTone> = {
  pending: "neutral",
  confirmed: "success",
  mismatch: "warning",
  rejected: "danger",
  not_found: "warning",
  not_applicable: "neutral",
};

/** Most urgent first — an entry reads as its most urgent line. */
export const RTA_STATUS_ORDER = ["rejected", "not_found", "mismatch", "pending", "confirmed", "not_applicable"] as const;

export function entryRtaStatus(counts: Record<string, number> | null | undefined): string | null {
  if (!counts) return null;
  return RTA_STATUS_ORDER.find((s) => (counts[s] ?? 0) > 0) ?? null;
}

/** "2 confirmed · 1 awaiting RTA" — the per-line picture behind an entry's one status. */
export function rtaCountsText(counts: Record<string, number> | null | undefined): string {
  if (!counts) return "";
  return RTA_STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${counts[s]} ${RTA_STATUS_LABEL[s].toLowerCase()}`)
    .join(" · ");
}
