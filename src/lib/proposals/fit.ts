/**
 * Does a recommendation fit the client? Checked as each row is added, not
 * after the proposal is built.
 *
 * Two checks, both reusing the CRM's existing definitions so the builder can
 * never disagree with the client page or the suitability email:
 *
 *  - Per line: the scheme's AMFI riskometer level against the risk profile
 *    (lib/proposal/risk-alignment.ts). The riskometer has six levels; the
 *    alignment table knows four, so the in-between levels map down
 *    conservatively — "low to moderate" is checked as moderate, "moderately
 *    high" as high.
 *
 *  - Whole proposal: the equity share of the client's book once this money
 *    goes in, against the profile's equity ceiling (lib/investors/suitability).
 *    "Equity" is lib/investors/asset-class's definition. The added money is
 *    one-time amounts plus a YEAR of SIPs — the same "proposal value" the
 *    pipeline totals use. SWP and STP move money that is already invested, so
 *    they are left out rather than guessed at.
 *
 * Plain module: the builder (a client component) calls it live.
 */

import { checkAlignment, type ClientProfile, type SchemeRisk } from "@/lib/proposal/risk-alignment";
import { equityScheme } from "@/lib/investors/asset-class";
import type { ProposalSnapshot } from "./snapshot";
import { itemMonthly, itemName, itemOneTime, recommendationType } from "./items";

export type LineFit =
  | { status: "fits"; message: string }
  | { status: "above"; message: string }
  | { status: "unknown"; message: string };

const TO_DIAL: Record<string, SchemeRisk> = {
  low: "low",
  low_to_moderate: "moderate",
  moderate: "moderate",
  moderately_high: "high",
  high: "high",
  very_high: "very_high",
};

const PROFILE_LABEL: Record<string, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
  very_aggressive: "Very aggressive",
};

/** Riskometer level vs the client's risk profile, for one line. */
export function lineFit(item: any, profile: string | null | undefined): LineFit {
  if (item?.kind !== "mf") return { status: "unknown", message: "" };
  if (!profile) return { status: "unknown", message: "No risk profile on file — capture one to check fit." };
  const dial = item.riskRating ? TO_DIAL[item.riskRating] : null;
  if (!dial) return { status: "unknown", message: "Set the scheme's riskometer level to check fit." };

  const r = checkAlignment(profile as ClientProfile, [{ name: itemName(item), riskRating: dial }]);
  const f = r.findings[0];
  if (f?.severity === "ok") return { status: "fits", message: `Within a ${PROFILE_LABEL[profile] ?? profile} profile.` };
  const level = (item.riskRating as string).replace(/_/g, " ");
  return {
    status: "above",
    message: `${level.charAt(0).toUpperCase()}${level.slice(1)} risk is above a ${PROFILE_LABEL[profile] ?? profile} client's comfort.`,
  };
}

/** Is this MF line money going INTO equity? */
function isEquityLine(item: any): boolean {
  return equityScheme(item?.category || item?.schemeName || undefined);
}

export type EquityAfter = {
  /** Equity share TODAY, before this proposal — null for a lead or when too
   *  little is classified. A book already over its band is not this
   *  proposal's doing, and the warning must say so. */
  before: number | null;
  /** Equity share once this proposal is invested, or null when unknowable. */
  pct: number | null;
  /** The profile's ceiling, when there is a profile. */
  ceiling: number | null;
  aboveBand: boolean;
  /** Why pct is null, when it is. */
  reason: string | null;
};

export function equityAfter(items: any[], snap: ProposalSnapshot | null): EquityAfter {
  const ceiling = snap?.band?.ceiling ?? null;
  let addedTotal = 0;
  let addedEquity = 0;
  for (const it of items) {
    if (it?.kind !== "mf") continue;
    const rt = recommendationType(it);
    if (rt === "swp" || rt === "stp") continue;
    const money = (itemOneTime(it) ?? 0) + (itemMonthly(it) ?? 0) * 12;
    addedTotal += money;
    if (isEquityLine(it)) addedEquity += money;
  }

  const h = snap?.holdings ?? null;
  const before = h && h.aum > 0 ? h.equityPct : null;
  if (h && h.aum > 0 && h.equityPct == null) {
    return { before, pct: null, ceiling, aboveBand: false, reason: "Too little of the current book is classified to estimate equity share." };
  }
  const total = (h?.aum ?? 0) + addedTotal;
  if (total <= 0) return { before, pct: null, ceiling, aboveBand: false, reason: "Add amounts to see the equity share." };

  const pct = (((h?.equityValue ?? 0) + addedEquity) / total) * 100;
  return { before, pct, ceiling, aboveBand: ceiling != null && pct > ceiling, reason: null };
}
